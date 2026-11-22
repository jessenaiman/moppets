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
 * The voice is the selected Moppet's own (body, posture, folds), in the live worklet.
 */
import { create } from "zustand";
import { ARTIC_SPECS, EXHALE_LABEL, NEUTRAL, planMelisma, planNoteOff, planNoteOn, VOWEL_TARGETS } from "@chimera/wasm/engine.ts";
import type { Syllable } from "@chimera/wasm/types.ts";
import liveUrl from "../worklet/live.ts?worker&url";
import { chimeraModule } from "@chimera/wasm/chimera.ts";
import type { ToLive, FromLive } from "../worklet/live.ts";
import { audio, useAudio } from "../audio/audio.ts";
import { g2p } from "../audio/g2p.ts";
import { sungSyllables } from "./plan.ts";
import { midiToHz } from "./singerCore.ts";
import type { MoppetVoice } from "./voices.ts";
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
const held = new Map<number, Syllable>();
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
    if (mode !== "off") await ensureLiveNode();
    if ((mode === "words" || mode === "edit") && !g2p.loaded) {
      await g2p.load();
      if (wordsOf) setLiveWords(wordsOf.piece, wordsOf.id);
    }

  },
}));

/**
 * The selected Moppet and its current recipe are used for live notes.
 */
export function setLiveVoice(v: MoppetVoice): void {
  if(voice && voice.id!==v.id)allOff();
  voice = v;
  updateLiveVolume();
  if (activeNode && sounding?.voice.id === v.id) {
    configureVoice(v, sounding.puppet);
    sounding.voice = v;
  }
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
  if (useLive.getState().mode === "puppet") send({ type: "mouth", values: { [key]: n } });
}

/** A pad of puppeteer mode: the mouth snaps to a vowel (or closes, for "mm"). */
export function padVowel(i: number): void {
  const [ipa, label] = PAD_VOWELS[i] ?? [];
  if (!ipa || !voice) return;
  const target = ipa === "m" ? { lipAp: 0, jaw: 0.3, velum: 1 } : { ...VOWEL_TARGETS[bodyName(voice)]?.[ipa]?.artic, velum: 0.05 };
  useLive.setState((s) => ({ mouth: { ...s.mouth, ...target }, last: `Mouth: "${label}"` }));
  if (useLive.getState().mode === "puppet") send({ type: "mouth", values: target });
}

let activeNode: AudioWorkletNode | null = null;
let nodeLoading: Promise<void> | undefined;
let generation = 0;
let nextTag = 2;
let auditionCleanup: (() => void) | undefined;
let configured: MoppetVoice | undefined;
let configuredForPuppet = false;
let activePitch: number | undefined;
let sounding: { midi: number; syl: Syllable; tag: number; voice: MoppetVoice; puppet: boolean } | undefined;
const exhales: number[] = [];

function send(message: ToLive): void {
  activeNode?.port.postMessage(message);
}

async function ensureLiveNode(): Promise<void> {
  await ensureNode();
  if (activeNode) return;
  const ctx = audio.ctx!;
  await (nodeLoading ??= (async () => {
    await ctx.audioWorklet.addModule(liveUrl);
    const node = new AudioWorkletNode(ctx, "live-moppet", {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: { module: chimeraModule() },
    });
    node.connect(analyser!);
    activeNode = node;
  })().finally(() => { nodeLoading = undefined; }));
}

function configureVoice(v: MoppetVoice, puppet: boolean): void {
  if (configured === v && configuredForPuppet === puppet) return;
  if (volumeNode) volumeNode.gain.setTargetAtTime(voiceLevel(v.id), volumeNode.context.currentTime, .01);
  const artic = configuredForPuppet && !puppet ? { ...NEUTRAL, ...v.artic } : { ...v.artic };
  send({ type: "voice", body: v.body, artic, source: { ...v.source } });
  if (puppet) send({ type: "mouth", values: useLive.getState().mouth });
  configured = v;
  configuredForPuppet = puppet;
}

function releaseTags(tag: number): void {
  send({ type: "release", tag });
  send({ type: "release", tag: tag + 1 });
}

function releaseNote(): void {
  generation++;
  auditionCleanup?.();
  const note = sounding;
  sounding = undefined;
  activePitch = undefined;
  if (!note) return;
  if (note.puppet) {
    send({ type: "gate", level: 0 });
    return;
  }
  releaseTags(note.tag);
  const tag = nextTag;
  nextTag += 2;
  const gestures = planNoteOff(note.syl, note.midi, note.voice.body).map((gesture) => ({
    ...gesture, tag: gesture.label === EXHALE_LABEL ? tag + 1 : tag,
  }));
  if (gestures.length) {
    send({ type: "schedule", gestures });
    exhales.push(tag + 1);
    if (exhales.length > 8) exhales.shift();
  }
}

async function startNote(v: MoppetVoice, midi: number, syl: Syllable, puppet: boolean, signal?: AbortSignal): Promise<number | undefined> {
  const pending = ++generation;
  try {
    if (!activeNode) await ensureLiveNode();
    if (pending !== generation || signal?.aborted) return;
    const previous = sounding;
    configureVoice(v, puppet);
    for (const tag of exhales.splice(0)) send({ type: "release", tag });

    const tag = nextTag;
    nextTag += 2;
    if (puppet) {
      if (previous && !previous.puppet) releaseTags(previous.tag);
      send({ type: "source", values: { f0: midiToHz(midi) } });
      if (!previous?.puppet) send({ type: "gate", level: 1 });
    } else {
      if (previous?.puppet) send({ type: "gate", level: 0 });
      else if (previous) releaseTags(previous.tag);
      const legatoFrom = previous && !previous.puppet && previous.voice.id === v.id
        ? { syl: previous.syl, midi: previous.midi }
        : undefined;
      const gestures = planNoteOn(syl, midi, { body: v.body, vibrato: v.vibrato, tag, legatoFrom });
      send({ type: "schedule", gestures });
    }
    sounding = { midi, syl, tag, voice: v, puppet };
    activePitch = midi;
    return pending;
  } catch (e) {
    if (pending === generation) useLive.setState({ last: e instanceof Error ? e.message : "CHIMERA voice unavailable" });
  }
}

export async function auditionNote(v: MoppetVoice, midi: number, text = "la", durationMs = 420, signal?: AbortSignal) {
  if (signal?.aborted) return;
  allOff();
  const syl = sungSyllables(text || "la")[0] ?? sungSyllables("la")[0];
  const started = await startNote(v, midi, syl, false, signal);
  if (started === undefined || started !== generation) return;
  if (signal?.aborted) {
    releaseNote();
    return;
  }
  const timer = signal ? undefined : setTimeout(releaseNote, durationMs);
  auditionCleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", releaseNote);
    auditionCleanup = undefined;
  };
  signal?.addEventListener("abort", releaseNote, { once: true });
}

export function liveNoteOn(midi: number, _velocity = 100): boolean {
  const state = useLive.getState();
  if (!voice || state.mode === "off") return false;
  if (auditionCleanup) releaseNote();
  const index = state.mode === "edit" ? state.editIndex : state.next;
  const syl = syllables[index % Math.max(1, syllables.length)] ?? sungSyllables("la")[0];
  held.delete(midi);
  held.set(midi, syl);
  void startNote(voice, midi, syl, state.mode === "puppet");
  if (state.mode === "edit") {
    const edit = melodyEditHook?.(midi, index);
    useLive.setState({ editIndex: edit?.nextIndex ?? index + 1, last: edit?.label ?? `MIDI ${midi}` });
  } else {
    useLive.setState({ next: (index + 1) % Math.max(1, syllables.length), last: `"${state.mode === "puppet" ? "la" : syl.text}" · MIDI ${midi}` });
  }
  return true;
}

export function liveNoteOff(midi: number): boolean {
  const last = [...held.keys()].at(-1);
  if (!held.delete(midi)) return false;
  if (midi !== last) return true;
  const previous = [...held.entries()].at(-1);
  if (!previous) {
    releaseNote();
    return true;
  }
  const [pitch, syl] = previous;
  const note = sounding;
  if (note) {
    if (note.puppet) send({ type: "source", values: { f0: midiToHz(pitch) } });
    else {
      send({ type: "release", tag: note.tag + 1 });
      send({ type: "schedule", gestures: planMelisma(pitch, { vibrato: note.voice.vibrato, tag: note.tag }) });
    }
    note.midi = pitch;
    activePitch = pitch;
  } else if (voice) {
    void startNote(voice, pitch, syl, useLive.getState().mode === "puppet");
  }
  return true;
}

function allOff(): void {
  held.clear();
  releaseNote();
}
export const liveMidiPitch = () => activePitch;

export function livePose():Pose|null {
  if(activePitch===undefined||!analyser)return null;
  analyser.getFloatTimeDomainData(meter);
  const rms=Math.sqrt(meter.reduce((sum,x)=>sum+x*x,0)/meter.length),level=Math.min(1,rms*5);
  if(rms<.008)return SILENT_POSE;
  return {...SILENT_POSE,level,singing:true,open:level,jaw:level,voicing:1,pressure:level,f0:midiToHz(activePitch),viseme:visemeFrom(level*2,0,0,level,true)};
}
