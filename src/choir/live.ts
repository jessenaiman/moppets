import { useVoiceLevels, voiceLevel } from "./voiceLevels.ts";
/**
 * Playing a Moppet live, on a Launchkey Mini (or any MIDI keyboard, or the on-screen keys):
 *
 *  - **Puppeteer:** you are the Moppet's mouth. The knobs move the jaw, the tongue (front/back,
 *    high/low), the lips (open, round) and the nose; the pads snap the mouth to a vowel
 *    (ee, eh, ah, aw, oh, oo, uh, mm); a key breathes the voice at its pitch while held.
 *  - **Sing the words:** each key sings the next syllable of the selected Moppet's lines in the
 *    song on stage, at the pitch you play (CHIMERA's live singing planner, as its Sing mode's keys).
 *    Hold one key into the next for legato. The words start over when they run out.
 *
 * The voice is the selected Moppet's own (body, airway size, posture, folds), in the live worklet.
 */
import { create } from "zustand";
import { instrumentNote, instrumentPart } from "./pluginScore.ts";
import { pluginRecording } from "./pluginPlayback.ts";
import { beatSeconds, LEAD_IN } from "./timeline.ts";
import { ARTIC_SPECS, NEUTRAL, planNoteOn, VOWEL_TARGETS } from "@chimera/wasm/engine.ts";
import type { Syllable } from "@chimera/wasm/types.ts";
import liveUrl from "../worklet/live.ts?worker&url";
import { chimeraModule } from "@chimera/wasm/chimera.ts";
import { singingSource, shapeGesture } from "./character.ts";
import type { ToLive, FromLive } from "../worklet/live.ts";
import { audio, useAudio } from "../audio/audio.ts";
import { g2p } from "../audio/g2p.ts";
import { sungSyllables } from "./plan.ts";
import { midiToHz } from "./singerCore.ts";
import { CAST, introIds, type MoppetVoice } from "./voices.ts";
import type { Piece } from "./music.ts";
import { SILENT_POSE, visemeFrom, type Pose } from "./pose.ts";

export type LiveMode = "off" | "puppet" | "words" | "edit";

/**
 * A knob of puppeteer mode: an articulator, its range (CHIMERA's own, in its units: cm for most),
 * and what the knob is called.
 */
const KNOBS = [
  ["jaw", "Jaw open"],
  ["tbX", "Tongue back ↔ front"],
  ["tbY", "Tongue low ↔ high"],
  ["lipAp", "Lips open"],
  ["lipProt", "Lips round"],
  ["velum", "Nose"],
  ["ttY", "Tongue tip up"],
  ["labiodental", "Lip to teeth (f, v)"],
] as const;
export type MouthKey = (typeof KNOBS)[number][0];
export const MOUTH: readonly (readonly [MouthKey, number, number, string])[] = KNOBS.map(([k, label]) => [k, ARTIC_SPECS[k].min, ARTIC_SPECS[k].max, label] as const);
/** The pads' vowels, in pad order (IPA, as CHIMERA's vowel table names them), and their labels. */
export const PAD_VOWELS = [
  ["i", "ee"],
  ["ɛ", "eh"],
  ["a", "ah"],
  ["ɔ", "aw"],
  ["o", "oh"],
  ["u", "oo"],
  ["ʌ", "uh"],
  ["m", "mm"],
] as const;

interface LiveState {
  mode: LiveMode;
  /** what the live voice did last, for the panel */
  last: string;
  /** the mouth now (puppeteer mode) */
  mouth: Partial<Record<MouthKey, number>>;
  /** the face's mouth from the live voice */
  pose: FromLive | null;
  /** the syllables the keys sing, and the next one */
  words: string[];
  next: number;
  /** melody step-edit cursor (event index in the selected Moppet's track) */
  editIndex: number;
  setEditIndex: (i: number) => void;
  setMode: (m: LiveMode) => Promise<void>;
}

type MelodyEditHook = (midi: number, index: number) => { nextIndex: number; label: string } | null;
let melodyEditHook: MelodyEditHook | null = null;
export function setMelodyEditHook(fn: MelodyEditHook | null): void {
  melodyEditHook = fn;
}

type StaffMidiHook = (midi: number, velocity: number) => boolean;
let staffMidiHook: StaffMidiHook | null = null;
export function setStaffMidiHook(fn: StaffMidiHook | null): void {
  staffMidiHook = fn;
}
export function offerStaffMidi(midi: number, velocity: number): boolean {
  return staffMidiHook ? staffMidiHook(midi, velocity) : false;
}

let voice: MoppetVoice | null = null;
let syllables: Syllable[] = [];
let wordsOf: { piece: Piece; id: string } | null = null;
let volumeNode: GainNode | null = null;
let analyser: AnalyserNode | null = null;
const meter = new Float32Array(256);
const held = new Map<number, { syl: string; velocity: number }>();
const bodyName = (v: MoppetVoice) => (v.body.child > .5 ? "child" : v.body.female > .5 ? "female" : "male");
function updateLiveVolume() {
  if (volumeNode && voice) volumeNode.gain.setTargetAtTime(voiceLevel(voice.id),volumeNode.context.currentTime,.01);
}
useVoiceLevels.subscribe(updateLiveVolume);
async function ensureNode() {
  await useAudio.getState().start();
  if(volumeNode)return;
  const ctx=audio.ctx!;
  volumeNode=ctx.createGain();analyser=ctx.createAnalyser();analyser.fftSize=meter.length;
  analyser.connect(volumeNode);audio.connect(volumeNode);updateLiveVolume();
}

export const useLive = create<LiveState>((set, get) => ({
  mode: "off",
  last: "",
  mouth: Object.fromEntries(KNOBS.map(([k]) => [k, NEUTRAL[k]])),
  pose: null,
  words: [],
  next: 0,
  editIndex: 0,
  setEditIndex: (editIndex) => set({ editIndex: Math.max(0, editIndex) }),
  setMode: async (mode) => {
    allOff();
    set({
      mode,
      last:
        mode === "puppet"
          ? "Turn a knob or tap a pad, then play a key"
          : mode === "words"
            ? "Play the tune: each key sings the next word"
            : mode === "edit"
              ? "Play a MIDI key to set the highlighted melody note and step forward"
              : "",
    });
    if (mode !== "off") await ensureNode();
    if ((mode === "words" || mode === "edit") && !g2p.loaded) {
      await g2p.load();
      if (wordsOf) setLiveWords(wordsOf.piece, wordsOf.id);
    }

  },
}));

/**
 * The selected Moppet becomes the live voice, and its recipe edits follow. Only another body or
 * size rebuilds the voice (that allocates on the audio thread and cuts off what is sounding); the
 * rest is a patch at the render head.
 */
export function setLiveVoice(v: MoppetVoice): void {
  if(voice && voice.id!==v.id)allOff();
  voice=v;updateLiveVolume();
}

/** The keys sing this Moppet's lines in `piece` (the lead's, if it sings none). */
export function setLiveWords(piece: Piece, id: string): void {
  wordsOf = { piece, id };
  const t = piece.tracks.find((x) => x.id === id && (x.phrases ?? x.lines)) ?? piece.tracks.find((x) => x.phrases ?? x.lines);
  const lines = t?.phrases ?? t?.lines ?? [];
  syllables = lines.flatMap((l) => {
    try {
      return sungSyllables(l).filter((s) => !s.melisma);
    } catch {
      return [];
    }
  });
  useLive.setState({ words: syllables.map((s) => s.text), next: 0, editIndex: 0 });
}

/** A knob of puppeteer mode turned to `x` (0..1 of its range). */
export function moveMouth(key: MouthKey, x: number): void {
  const [, lo, hi, label] = MOUTH.find((m) => m[0] === key)!;
  const n = +(lo + (hi - lo) * x).toFixed(3);
  useLive.setState((s) => ({ mouth: { ...s.mouth, [key]: n }, last: `${label}: ${n}` }));

}

/** A pad of puppeteer mode: the mouth snaps to a vowel (or closes, for "mm"). */
export function padVowel(i: number): void {
  const [ipa, label] = PAD_VOWELS[i] ?? [];
  if (!ipa || !voice) return;
  const target = ipa === "m" ? { lipAp: 0, jaw: 0.3, velum: 1 } : { ...VOWEL_TARGETS[bodyName(voice)]?.[ipa]?.artic, velum: 0.05 };
  useLive.setState((s) => ({ mouth: { ...s.mouth, ...target }, last: `Mouth: "${label}"` }));

}

let active: AudioBufferSourceNode | null = null;
let activePitch: number | undefined;
let sequence=0;
let nativeModule: Promise<void> | undefined;
let endNative: (() => void) | undefined;
function releaseNote() {
  sequence++;
  endNative?.();
  if(active){active.stop();active=null;}
  activePitch=undefined;
}

async function soundNote(v:MoppetVoice,midi:number,word:string,seconds:number|undefined,signal?:AbortSignal,velocity=100) {
  releaseNote();
  if(!import.meta.env.DEV)v=CAST.find(singer=>singer.id===v.id)??v;
  const seq=sequence;
  await ensureNode();
  if(seq!==sequence || signal?.aborted)return;
  const ctx=audio.ctx!;
  let buffer:AudioBuffer, offset=0, limit=Infinity;
  try {
    // The additional cast has native tract profiles, including size and articulation.
    if (!introIds.includes(v.id)) {
      nativeModule ??= ctx.audioWorklet.addModule(liveUrl).catch(error => {nativeModule = undefined; throw error});
      await nativeModule;
      if (seq !== sequence || signal?.aborted) return;
      const syl = sungSyllables(word)[0] ?? sungSyllables("la")[0];
      const gestures = planNoteOn(syl, midi, {body: v.body, vibrato: v.vibrato, tag: 1}).map(g =>
        shapeGesture(g.targets.vibrato === undefined ? g : {...g, t0: Math.max(.45, g.t0), rampIn: .10}, v, false));
      const node = new AudioWorkletNode(ctx, "live-moppet", {numberOfInputs: 0, outputChannelCount: [1],
        processorOptions: {module: chimeraModule()}});
      const gain = ctx.createGain();
      gain.gain.value = Math.min(1, Math.max(0, velocity/100));
      node.connect(gain).connect(analyser!);
      const send = (m: ToLive) => node.port.postMessage(m);
      send({type: "voice", body: v.body, size: v.size ?? 1, artic: {...v.artic}, source: {...singingSource(v.source)}});
      if (useLive.getState().mode === "puppet") send({type:"mouth", values: useLive.getState().mouth});
      send({type: "schedule", gestures});
      activePitch = midi;
      const timer = seconds === undefined ? undefined : setTimeout(releaseNote, seconds*1000);
      const stop = () => {
        endNative = undefined;
        signal?.removeEventListener("abort", releaseNote);
        clearTimeout(timer);
        gain.gain.setTargetAtTime(0, ctx.currentTime, .008);
        setTimeout(() => {send({type:"dispose"}); node.disconnect(); gain.disconnect();}, 50);
      };
      endNative = stop;
      signal?.addEventListener("abort", releaseNote, {once:true});
      return;
    }
    // For a staff audition, reuse the exact sung note including its consonants.
    const score=wordsOf?.piece,track=score?.tracks.find(t=>t.id===v.id);
    const note=score && track && word!=="la" && seconds!==undefined
      ? track.events.find(e=>e.midi===midi && (e.text===word || (e.line!==undefined && track.phrases?.[e.line]?.split(/\s+/).includes(word)))) : null;
    if(note && score && track){
      buffer=await pluginRecording(ctx,instrumentPart(score,track,v));
      offset=LEAD_IN+note.beat*beatSeconds(score);limit=note.beats*beatSeconds(score);
    }else {
      const part=instrumentNote(v,midi,word);
      if(useLive.getState().mode==="puppet" && import.meta.env.DEV) {
        part.mode="play";
        part.artic=useLive.getState().mouth as Record<string,number>;
      }
      buffer=await pluginRecording(ctx,part);
    }
  }catch(e){if(seq===sequence)useLive.setState({last:e instanceof Error?e.message:"CHIMERA instrument unavailable"});return;}
  if(seq!==sequence || signal?.aborted)return;
  const player=ctx.createBufferSource(),gain=ctx.createGain();
  gain.gain.value=Math.min(1,Math.max(0,velocity/100));player.buffer=buffer;
  player.connect(gain);gain.connect(analyser!);active=player;activePitch=midi;
  player.loop=seconds===undefined && !Number.isFinite(limit);
  player.loopStart=.6;player.loopEnd=Math.min(1.45,buffer.duration);
  const stop=()=>{if(seq===sequence)releaseNote();};
  signal?.addEventListener("abort",stop,{once:true});
  const ended=()=>{signal?.removeEventListener("abort",stop);gain.disconnect();player.disconnect();if(active===player){active=null;activePitch=undefined;}};
  player.onended=ended;
  player.start(0,offset);
  if(seconds!==undefined)player.stop(ctx.currentTime+Math.min(seconds,limit));
}
export async function auditionNote(v:MoppetVoice,midi:number,text="la",durationMs=420,signal?:AbortSignal){
  if(signal?.aborted)return;
  await soundNote(v,midi,text||"la",signal?undefined:Math.max(.08,durationMs/1000),signal);
}
export function liveNoteOn(midi:number,velocity=100):boolean{
  const s=useLive.getState();if(!voice||s.mode==="off")return false;
  const index=s.mode==="edit"?s.editIndex:s.next;
  const syl=s.mode==="puppet"?"la":syllables[index%Math.max(1,syllables.length)]?.text??"la";
  held.delete(midi);held.set(midi,{syl,velocity});
  void soundNote(voice,midi,syl,undefined,undefined,velocity);
  if(s.mode==="edit"){
    const edit=melodyEditHook?.(midi,index);
    useLive.setState({editIndex:edit?.nextIndex??index+1,last:edit?.label??`MIDI ${midi}`});
  }else useLive.setState({next:(index+1)%Math.max(1,syllables.length),last:`"${syl}" · MIDI ${midi}`});
  return true;
}
export function liveNoteOff(midi:number):boolean {
  const last=[...held.keys()].at(-1);
  if(!held.delete(midi))return false;
  if(last===midi){releaseNote();const next=[...held.entries()].at(-1);if(next&&voice)void soundNote(voice,next[0],next[1].syl,undefined,undefined,next[1].velocity);}
  return true;
}
function allOff(){held.clear();releaseNote();}
export const liveMidiPitch=()=>activePitch;
export function livePose():Pose|null {
  if(activePitch===undefined||!analyser)return null;
  analyser.getFloatTimeDomainData(meter);
  const rms=Math.sqrt(meter.reduce((sum,x)=>sum+x*x,0)/meter.length),level=Math.min(1,rms*5);
  if(rms<.008)return SILENT_POSE;
  return {...SILENT_POSE,level,singing:true,open:level,jaw:level,voicing:1,pressure:level,f0:midiToHz(activePitch),viseme:visemeFrom(level*2,0,0,level,true)};
}
