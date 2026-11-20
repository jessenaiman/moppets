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
import { chimeraModule } from "@chimera/wasm/chimera.ts";
import { ARTIC_SPECS, NEUTRAL, planNoteOff, planNoteOn, VOWEL_TARGETS } from "@chimera/wasm/engine.ts";
import type { Syllable } from "@chimera/wasm/types.ts";
import liveUrl from "../worklet/live.ts?worker&url";
import type { FromLive, ToLive } from "../worklet/live.ts";
import { audio, useAudio } from "../audio/audio.ts";
import { g2p } from "../audio/g2p.ts";
import { sungSyllables } from "./plan.ts";
import { shapeGesture } from "./character.ts";
import { midiToHz } from "./singerCore.ts";
import { PLAN_VIBRATO } from "./character.ts";
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

let node: AudioWorkletNode | null = null;
let volumeNode: GainNode | null = null;
function updateLiveVolume() {
  if (volumeNode && voice) volumeNode.gain.setTargetAtTime(voiceLevel(voice.id), volumeNode.context.currentTime, 0.01);
}
useVoiceLevels.subscribe(updateLiveVolume);
let starting: Promise<void> | null = null;
let voice: MoppetVoice | null = null;
let syllables: Syllable[] = [];
/** the piece and Moppet the words come from (split again once the dictionary has loaded) */
let wordsOf: { piece: Piece; id: string } | null = null;
/** keys down: key → the tag its gestures carry and the syllable it sings */
const held = new Map<number, { tag: number; syl: Syllable; midi: number }>();
let nextTag = 1;

const post = (m: ToLive) => node?.port.postMessage(m);
const bodyName = (v: MoppetVoice) => (v.body.child > 0.5 ? "child" : v.body.female > 0.5 ? "female" : "male");

async function ensureNode(): Promise<void> {
  if (node) return;
  starting ??= (async () => {
    // a failed start is tried again on the next note or mode change
    try {
      await start();
    } catch (e) {
      starting = null;
      throw e;
    }
  })();
  await starting;
}

async function start(): Promise<void> {
  await useAudio.getState().start();
  const ctx = audio.ctx!;
  await ctx.audioWorklet.addModule(liveUrl);
  node = new AudioWorkletNode(ctx, "live-moppet", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { module: chimeraModule() } });
  node.port.onmessage = (e: MessageEvent<FromLive>) => useLive.setState({ pose: e.data });
  volumeNode = ctx.createGain();
  volumeNode.gain.value = voice ? voiceLevel(voice.id) : 1;
  node.connect(volumeNode);
  audio.connect(volumeNode);
  if (voice) sendVoice(voice);
}

function sendVoice(v: MoppetVoice): void {
  post({ type: "voice", body: v.body, size: v.size ?? 1, artic: { ...v.artic }, source: { ...v.source } as Record<string, number> });
  if (useLive.getState().mode === "puppet") post({ type: "mouth", values: useLive.getState().mouth });
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
    if (mode === "puppet") post({ type: "mouth", values: get().mouth });
  },
}));

/**
 * The selected Moppet becomes the live voice, and its recipe edits follow. Only another body or
 * size rebuilds the voice (that allocates on the audio thread and cuts off what is sounding); the
 * rest is a patch at the render head.
 */
export function setLiveVoice(v: MoppetVoice): void {
  const same = voice && voice.id === v.id && voice.body.female === v.body.female && voice.body.child === v.body.child && (voice.size ?? 1) === (v.size ?? 1);
  voice = v;
  updateLiveVolume();
  if (!same) return sendVoice(v);
  post({ type: "source", values: { ...v.source } as Record<string, number> });
  if (useLive.getState().mode !== "puppet") post({ type: "mouth", values: { ...v.artic } });
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
  post({ type: "mouth", values: { [key]: n } });
}

/** A pad of puppeteer mode: the mouth snaps to a vowel (or closes, for "mm"). */
export function padVowel(i: number): void {
  const [ipa, label] = PAD_VOWELS[i] ?? [];
  if (!ipa || !voice) return;
  const target = ipa === "m" ? { lipAp: 0, jaw: 0.3, velum: 1 } : { ...VOWEL_TARGETS[bodyName(voice)]?.[ipa]?.artic, velum: 0.05 };
  useLive.setState((s) => ({ mouth: { ...s.mouth, ...target }, last: `Mouth: "${label}"` }));
  post({ type: "mouth", values: target as Record<string, number> });
}

let auditionTimer: ReturnType<typeof setTimeout> | null = null;
let auditionActive: { tag: number; syl: Syllable; midi: number; body: MoppetVoice["body"] } | null = null;

function releaseAudition(): void {
  if (auditionTimer !== null) {
    clearTimeout(auditionTimer);
    auditionTimer = null;
  }
  if (!auditionActive) return;
  const a = auditionActive;
  auditionActive = null;
  post({ type: "release", tag: a.tag });
  post({ type: "schedule", gestures: planNoteOff(a.syl, a.midi, a.body) });
}

function auditionSyllable(text?: string): Syllable {
  const clean = (text ?? "").replace(/[~–_]/g, "").trim();
  if (clean) {
    try {
      const list = sungSyllables(clean).filter((s) => !s.melisma);
      if (list.length) return list[0];
    } catch {
      // fall back to vowel
    }
  }
  return sungSyllables("ah")[0];
}

/** Audition a single Moppet singing `midi` (concert pitch) on an optional syllable without advancing live cursors. */
export async function auditionNote(v: MoppetVoice, midi: number, syllableText?: string, durationMs = 420, heldSignal?: AbortSignal): Promise<void> {
  await ensureNode();
  if (!g2p.loaded) await g2p.load();
  if (heldSignal?.aborted) return;
  setLiveVoice(v);
  releaseAudition();
  const syl = auditionSyllable(syllableText);
  const tag = nextTag++;
  const gestures = planNoteOn(syl, midi, { body: v.body, vibrato: PLAN_VIBRATO, tag }).map((g) => shapeGesture(g, v, false));
  post({ type: "schedule", gestures });
  auditionActive = { tag, syl, midi, body: v.body };
  if (heldSignal) {
    heldSignal.addEventListener("abort", () => { if (auditionActive?.tag === tag) releaseAudition(); }, {once:true});
    return;
  }
  const holdMs = Math.max(220, Math.min(900, durationMs));
  auditionTimer = setTimeout(() => {
    auditionTimer = null;
    if (auditionActive?.tag === tag) releaseAudition();
  }, holdMs);
}

/** A key went down. Returns true when the live voice took it. */
export function liveNoteOn(midi: number, velocity = 100): boolean {
  const { mode } = useLive.getState();
  if (mode === "off" || !voice) return false;
  const activeVoice = voice;
  if (mode === "puppet") {
    held.set(midi, { tag: 0, syl: null as unknown as Syllable, midi });
    const fire = () => {
      if (!held.has(midi)) return;
      post({ type: "source", values: { f0: midiToHz(midi + (activeVoice.octave ?? 0)), pressure: 6 + 4 * (velocity / 127) } });
      post({ type: "gate", level: 1 });
    };
    if (node) fire();
    else ensureNode().then(fire).catch((e) => useLive.setState({ last: `The live voice could not start: ${e instanceof Error ? e.message : e}` }));
    return true;
  }
  if (!syllables.length) return true;
  const st = useLive.getState();
  const idx = mode === "edit" ? st.editIndex : st.next;
  const syl = syllables[idx % syllables.length];
  const sung = midi + (activeVoice.octave ?? 0);
  // legato: a key still held hands its vowel over to this one
  const prev = [...held.values()].pop();
  const tag = nextTag++;
  const gestures = planNoteOn(syl, sung, { body: activeVoice.body, vibrato: PLAN_VIBRATO, tag, ...(prev ? { legatoFrom: { syl: prev.syl, midi: prev.midi } } : {}) }).map((g) => shapeGesture(g, activeVoice, false));
  const scheduleIt = () => {
    if (prev) post({ type: "release", tag: prev.tag });
    post({ type: "schedule", gestures });
    if (!held.has(midi)) {
      post({ type: "release", tag });
      post({ type: "schedule", gestures: planNoteOff(syl, sung, activeVoice.body) });
    }
  };
  held.set(midi, { tag, syl, midi: sung });
  if (node) scheduleIt();
  else ensureNode().then(scheduleIt).catch((e) => useLive.setState({ last: `The live voice could not start: ${e instanceof Error ? e.message : e}` }));
  if (mode === "edit") {
    const res = melodyEditHook?.(midi, st.editIndex);
    useLive.setState({
      editIndex: res ? res.nextIndex : (st.editIndex + 1) % syllables.length,
      last: res ? res.label : `Set "${syl.text}" → MIDI ${midi}`,
    });
  } else {
    useLive.setState({ next: (st.next + 1) % syllables.length, last: `"${syl.text}"` });
  }
  return true;
}

/** A key let go. */
export function liveNoteOff(midi: number): boolean {
  const { mode } = useLive.getState();
  const h = held.get(midi);
  if (mode === "off" || !h) return false;
  held.delete(midi);
  if (mode === "puppet") {
    // back to the newest key still held, or the breath stops
    const still = [...held.keys()].pop();
    if (still === undefined) post({ type: "gate", level: 0 });
    else if (voice) post({ type: "source", values: { f0: midiToHz(still + (voice.octave ?? 0)) } });
    return true;
  }
  post({ type: "release", tag: h.tag });
  // the last key up ends the syllable: its closing consonants, then breath out
  if (![...held.values()].some((x) => x.tag > h.tag) && voice) post({ type: "schedule", gestures: planNoteOff(h.syl, h.midi, voice.body) });
  return true;
}

function allOff(): void {
  for (const h of held.values()) if (h.tag) post({ type: "release", tag: h.tag });
  held.clear();
  post({ type: "gate", level: 0 });
}

/** The live voice as a puppet pose (the face on stage), or null when it's off. */
export function liveMidiPitch(): number | undefined {
  return Array.from(held.values()).at(-1)?.midi ?? auditionActive?.midi;
}

export function livePose(): Pose | null {
  const { mode, pose: t } = useLive.getState();
  if (mode === "off" || !t) return null;
  const singing = t.rms > 0.012;
  if (!singing) return SILENT_POSE;
  const level = Math.min(1, t.rms * 5), round = Math.min(1, Math.max(0, t.lipProt));
  const open = t.lipAp <= 0.02 ? 0 : Math.max(Math.min(1, t.lipAp / 2.2) * (0.55 + 0.45 * level), t.lipProt > 0.9 && t.lipAp > 0.1 ? 0.25 : 0);
  return { open, jaw: Math.min(1, t.jaw / 1.9), round, level, singing, viseme: visemeFrom(t.lipAp, 0, round, t.jaw, singing), pressure: Math.min(1, t.pLung / 12), f0: 0, voicing: t.voicing };
}
