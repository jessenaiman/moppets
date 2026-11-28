/**
 * OO `LiveMoppetSinger` — Direct TypeScript/AudioWorklet port of CHIMERA's official
 * `Singer` (`crates/chimera/src/control/singer.rs`, `@chimera/ui/singing.ts`) and MPE contract
 * (`chimera/docs/plugin.md`, `crates/chimera-plugin/src/core.rs`):
 *
 *  - Preserves `-` melismas (`parentOf`) and phrase breaths.
 *  - True legato (`legatoFrom` passed into `planNoteOn` when overlapping keys).
 *  - True melisma & held-key stack glide (`planMelisma` + `release(tag + 1)`).
 *  - True word-final codas & breath-out cancellation (`planNoteOff` + `EXHALE_LABEL` + `tails`).
 *  - Official CHIMERA `breathFor(velocity)` scaling (`0.62 + 0.4 * clamp(v/96) + 0.12 * max(0, (v-96)/31)`).
 *  - Official MPE Lower Zone (`mpe: true` default): Ch 1 master bend `±2 st`; Ch 2–16 note bend `±48 st`
 *    + `CC 74` brightness slide relative to 50 ms finger-landing window; poly pressure on sounding pitch
 *    raising breath up to `+75%` (`PRESSURE_DEPTH = 0.75`).
 *  - Puppeteer (`Play`) mode: held keys set `f0` and open `gate: 1` on the user's live mouth posture.
 */
import { create } from "zustand";
import {
  ARTIC_SPECS,
  EXHALE_LABEL,
  NEUTRAL,
  planMelisma,
  planNoteOff,
  planNoteOn,
  VOWEL_TARGETS,
} from "@chimera/wasm/engine.ts";
import type { Gesture, Syllable } from "@chimera/wasm/types.ts";
import type { TelemetryMessage } from "@chimera/worklet/protocol.ts";
import { chimeraModule } from "@chimera/wasm/chimera.ts";
import liveUrl from "../worklet/live.ts?worker&url";
import type { FromLive, ToLive } from "../worklet/live.ts";
import { audio, useAudio } from "../audio/audio.ts";
import { g2p } from "../audio/g2p.ts";
import { shapeGesture, singingSource } from "./character.ts";
import type { Piece } from "./music.ts";
import { sungSyllables } from "./plan.ts";
import { poseFromArtic, SILENT_POSE, type Pose } from "./pose.ts";
import { midiToHz } from "./singerCore.ts";
import { useVoiceLevels, voiceLevel } from "./voiceLevels.ts";
import type { MoppetVoice } from "./voices.ts";

export type LiveMode = "off" | "puppet" | "words" | "edit";

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
export const MOUTH: readonly (readonly [MouthKey, number, number, string])[] = KNOBS.map(
  ([k, label]) => [k, ARTIC_SPECS[k].min, ARTIC_SPECS[k].max, label] as const,
);

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

const AH: Syllable = {
  text: "ah",
  onset: [],
  nucleus: { ipa: "ɑ", stress: 1 },
  coda: [],
  wordEnd: true,
  phraseEnd: false,
};

const BEND_RANGE = 2;
const MPE_BEND_RANGE = 48;
const PRESSURE_DEPTH = 0.75;
const SLIDE_LANDING_MS = 50;
const BREATH_MAX = 22;

/** Official CHIMERA velocity -> breath curve (`singing.ts:234` & `singer.rs:44`). */
const breathFor = (velocity: number) =>
  0.62 + 0.4 * Math.min(1, Math.max(0, velocity / 96)) + 0.12 * Math.max(0, (velocity - 96) / 31);

const bodyName = (v: MoppetVoice) =>
  v.body.child > 0.5 ? "child" : v.body.female > 0.5 ? "female" : "male";

export interface LiveState {
  mode: LiveMode;
  mpe: boolean;
  last: string;
  mouth: Partial<Record<MouthKey, number>>;
  pose: FromLive | null;
  syllables: Syllable[];
  words: string[];
  next: number;
  heldNotes: number[];
  editIndex: number;
  setCursor: (i: number) => void;
  setEditIndex: (i: number) => void;
  setMpe: (on: boolean) => void;
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

interface SoundingNote {
  midi: number;
  channel: number;
  syl: Syllable;
  tag: number;
  startedMs: number;
  slideOrigin: number;
}

/** OO CHIMERA Live Singer managing one Moppet's real-time AudioWorklet + MPE expression state. */
class LiveMoppetSinger {
  voice: MoppetVoice | null = null;
  wordsOf: { piece: Piece; id: string } | null = null;
  private volumeNode: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  private activeVoiceKey = "";
  private workletModulePromise?: Promise<void>;

  private keys: { midi: number; channel: number; velocity: number }[] = [];
  private sounding: SoundingNote | null = null;
  private nextTag = 2;
  private tails: number[] = [];
  private exhalesLive = false;

  /** Per-channel bend (-1..1), channel pressure (0..1), and CC 74 slide (0..1) */
  private readonly channelBend = new Float32Array(16);
  private readonly channelPressure = new Float32Array(16);
  private readonly channelSlide = new Float32Array(16).fill(0.5);
  private keyPressure = 0;
  private auditionTimer?: ReturnType<typeof setTimeout>;
  private auditionAbortCleanup?: () => void;
  latestPose: FromLive | null = null;

  updateVolume(): void {
    if (this.volumeNode && this.voice) {
      this.volumeNode.gain.setTargetAtTime(
        voiceLevel(this.voice.id),
        this.volumeNode.context.currentTime,
        0.01,
      );
    }
  }

  async ensureOutput(): Promise<void> {
    await useAudio.getState().start();
    if (this.volumeNode) return;
    const ctx = audio.ctx!;
    this.volumeNode = ctx.createGain();
    audio.connect(this.volumeNode);
    this.updateVolume();
  }

  async ensureWorklet(v: MoppetVoice): Promise<AudioWorkletNode> {
    await this.ensureOutput();
    const ctx = audio.ctx!;
    this.workletModulePromise ??= ctx.audioWorklet.addModule(liveUrl).catch((err) => {
      this.workletModulePromise = undefined;
      throw err;
    });
    await this.workletModulePromise;

    const key = `${v.id}:${v.body.female.toFixed(3)}:${v.body.child.toFixed(3)}:${(v.size ?? 1).toFixed(3)}`;
    if (!this.node || this.activeVoiceKey !== key) {
      this.disposeWorklet();
      const node = new AudioWorkletNode(ctx, "live-moppet", {
        numberOfInputs: 0,
        outputChannelCount: [1],
        processorOptions: { module: chimeraModule() },
      });
      node.port.onmessage = (e: MessageEvent<FromLive>) => {
        if (e.data?.type !== "pose") return;
        this.latestPose = e.data;
        useLive.setState({ pose: e.data });
      };
      node.connect(this.volumeNode!);
      node.port.postMessage({
        type: "voice",
        body: v.body,
        size: v.size ?? 1,
        artic: { ...v.artic },
        source: { ...singingSource(v.source) },
      } satisfies ToLive);
      if (useLive.getState().mode === "puppet") {
        node.port.postMessage({ type: "mouth", values: useLive.getState().mouth } satisfies ToLive);
      }
      this.node = node;
      this.activeVoiceKey = key;
    }
    return this.node;
  }

  disposeWorklet(): void {
    if (!this.node) return;
    try {
      this.node.port.postMessage({ type: "dispose" } satisfies ToLive);
      this.node.port.onmessage = null;
      this.node.disconnect();
    } catch {
      // ignore closed context
    }
    this.node = null;
    this.activeVoiceKey = "";
  }

  post(msg: ToLive): void {
    this.node?.port.postMessage(msg);
  }

  private parentOf(syls: Syllable[], i: number): Syllable {
    for (let k = i; k >= 0; k--) {
      if (!syls[k].melisma) return syls[k];
    }
    return AH;
  }

  private bendSemisFor(channel: number, mpe: boolean): number {
    if (mpe && channel >= 1 && channel <= 15) {
      return this.channelBend[0] * BEND_RANGE + this.channelBend[channel] * MPE_BEND_RANGE;
    }
    return this.channelBend[channel] * BEND_RANGE;
  }

  private applyExpression(): void {
    const s = this.sounding;
    const v = this.voice;
    if (!s || !v || !this.node) return;
    const mpe = useLive.getState().mpe;
    const baseSrc = singingSource(v.source);
    const bendSemis = this.bendSemisFor(s.channel, mpe);
    const chPress = Math.max(this.channelPressure[0], this.channelPressure[s.channel]);
    const pressureNorm = Math.max(chPress, this.keyPressure);
    const basePressure = baseSrc.pressure ?? 7.2;
    const pressure = Math.min(BREATH_MAX, basePressure * (1 + PRESSURE_DEPTH * pressureNorm));

    const baseBrightness = baseSrc.brightness ?? 0.25;
    let brightness = baseBrightness;
    if (mpe && s.channel >= 1 && s.channel <= 15) {
      const slideDelta = this.channelSlide[s.channel] - s.slideOrigin;
      brightness = Math.max(0, Math.min(1, baseBrightness + slideDelta));
    } else if (s.channel === 0) {
      const slideDelta = this.channelSlide[0] - 0.5;
      if (Math.abs(slideDelta) > 0.005) {
        brightness = Math.max(0, Math.min(1, baseBrightness + slideDelta * 0.7));
      }
    }

    this.post({
      type: "source",
      values: {
        f0: midiToHz(s.midi + bendSemis),
        pressure,
        brightness,
      },
    });
  }

  setBend(norm: number, channel = 0): void {
    const ch = Math.max(0, Math.min(15, channel));
    this.channelBend[ch] = Math.max(-1, Math.min(1, norm));
    this.applyExpression();
  }

  setPressure(norm01: number, channel = 0): void {
    const ch = Math.max(0, Math.min(15, channel));
    this.channelPressure[ch] = Math.max(0, Math.min(1, norm01));
    this.applyExpression();
  }

  setKeyPressure(midi: number, norm01: number): void {
    // Per chimera/docs/plugin.md: poly pressure counts ONLY on the sounding key
    if (this.sounding?.midi !== midi) return;
    this.keyPressure = Math.max(0, Math.min(1, norm01));
    this.applyExpression();
  }

  setSlide(norm01: number, channel = 0): void {
    const ch = Math.max(0, Math.min(15, channel));
    const clamped = Math.max(0, Math.min(1, norm01));
    this.channelSlide[ch] = clamped;
    const s = this.sounding;
    if (s && s.channel === ch && performance.now() - s.startedMs <= SLIDE_LANDING_MS) {
      s.slideOrigin = clamped;
    }
    this.applyExpression();
  }

  private scheduleShaped(v: MoppetVoice, raw: Gesture[]): void {
    const shaped = raw.map((g) => shapeGesture(g, v, false));
    this.post({ type: "schedule", gestures: shaped });
  }

  private glideTo(v: MoppetVoice, midi: number, channel: number): void {
    const s = this.sounding;
    if (!s) return;
    this.post({ type: "release", tag: s.tag + 1 });
    s.midi = midi;
    s.channel = channel;
    if (useLive.getState().mode === "puppet") {
      this.applyExpression();
      return;
    }
    const gs = planMelisma(midi, { vibrato: v.vibrato, tag: s.tag });
    this.scheduleShaped(v, gs);
    this.applyExpression();
  }

  async triggerNoteOn(midi: number, velocity = 96, channel = 0): Promise<void> {
    const st = useLive.getState();
    const v = this.voice;
    if (!v || st.mode === "off") return;

    this.clearAudition();
    const ch = Math.max(0, Math.min(15, channel));
    this.keys = this.keys.filter((k) => k.midi !== midi).concat({ midi, channel: ch, velocity });
    this.keyPressure = 0;
    useLive.setState({ heldNotes: this.keys.map((k) => k.midi) });

    if (st.mode === "edit") {
      const edit = melodyEditHook?.(midi, st.editIndex);
      const word = st.words[st.editIndex % Math.max(1, st.words.length)] ?? "la";
      useLive.setState({
        editIndex: edit?.nextIndex ?? st.editIndex + 1,
        last: edit?.label ?? `MIDI ${midi}`,
      });
      await this.audition(v, midi, word, 320);
      return;
    }

    await this.ensureWorklet(v);
    if (!this.keys.some((k) => k.midi === midi)) return;

    if (st.mode === "puppet") {
      const tag = this.nextTag;
      this.nextTag += 2;
      this.sounding = {
        midi,
        channel: ch,
        syl: AH,
        tag,
        startedMs: performance.now(),
        slideOrigin: this.channelSlide[ch],
      };
      this.post({ type: "mouth", values: useLive.getState().mouth });
      this.applyExpression();
      this.post({ type: "gate", level: 1 });
      useLive.setState({ last: `Puppeteer · MIDI ${midi}` });
      return;
    }

    const syls = st.syllables.length ? st.syllables : [AH];
    const i = st.next % syls.length;
    const syl = syls[i];
    useLive.setState({
      next: (i + 1) % syls.length,
      last: `"${syl.text}" · MIDI ${midi}`,
    });

    if (syl.melisma && this.sounding) {
      this.glideTo(v, midi, ch);
      return;
    }

    if (this.exhalesLive) {
      for (const t of this.tails) this.post({ type: "release", tag: t + 1 });
      this.exhalesLive = false;
    }
    const from = this.sounding;
    if (from) {
      this.post({ type: "release", tag: from.tag });
      this.post({ type: "release", tag: from.tag + 1 });
    }

    const tag = this.nextTag;
    this.nextTag += 2;
    const targetSyl = syl.melisma ? { ...this.parentOf(syls, i), onset: [] } : syl;
    const gs = planNoteOn(targetSyl, midi, {
      body: v.body,
      vibrato: v.vibrato,
      tag,
      legatoFrom: from ? { syl: from.syl, midi: from.midi } : undefined,
    });
    const breath = breathFor(velocity);
    for (const g of gs) {
      if (g.targets.breath !== undefined) {
        g.targets = { ...g.targets, breath: g.targets.breath * breath };
      }
    }
    this.sounding = {
      midi,
      channel: ch,
      syl: syl.melisma ? this.parentOf(syls, i) : syl,
      tag,
      startedMs: performance.now(),
      slideOrigin: this.channelSlide[ch],
    };
    this.applyExpression();
    this.scheduleShaped(v, gs);
  }

  noteOff(midi: number): boolean {
    const had = this.keys.some((k) => k.midi === midi);
    this.keys = this.keys.filter((k) => k.midi !== midi);
    useLive.setState({ heldNotes: this.keys.map((k) => k.midi) });
    if (!had) return false;

    const s = this.sounding;
    const v = this.voice;
    if (!s || s.midi !== midi || !v) return true;

    const remaining = this.keys[this.keys.length - 1];
    if (remaining) {
      this.glideTo(v, remaining.midi, remaining.channel);
      return true;
    }

    this.sounding = null;
    this.keyPressure = 0;
    if (useLive.getState().mode === "puppet") {
      this.post({ type: "gate", level: 0 });
      this.latestPose = null;
      useLive.setState({ pose: null });
      return true;
    }

    this.post({ type: "release", tag: s.tag });
    this.post({ type: "release", tag: s.tag + 1 });
    const st = useLive.getState();
    if (!st.syllables[st.next]?.melisma) {
      const coda = planNoteOff(s.syl, midi, v.body);
      if (coda.length > 0) {
        const tag = this.nextTag;
        this.nextTag += 2;
        const tagged = coda.map((g) => ({
          ...g,
          tag: g.label === EXHALE_LABEL ? tag + 1 : tag,
        }));
        this.scheduleShaped(v, tagged);
        this.tails.push(tag);
        if (this.tails.length > 8) this.tails.shift();
        this.exhalesLive = true;
      }
    }
    this.latestPose = null;
    useLive.setState({ pose: null });
    return true;
  }

  private clearAudition(): void {
    clearTimeout(this.auditionTimer);
    this.auditionTimer = undefined;
    this.auditionAbortCleanup?.();
    this.auditionAbortCleanup = undefined;
  }

  stopAll(): void {
    this.clearAudition();
    if (this.sounding) {
      this.post({ type: "release", tag: this.sounding.tag });
      this.post({ type: "release", tag: this.sounding.tag + 1 });
      this.sounding = null;
    }
    for (const t of this.tails) {
      this.post({ type: "release", tag: t });
      this.post({ type: "release", tag: t + 1 });
    }
    this.tails = [];
    this.exhalesLive = false;
    this.keys = [];
    this.keyPressure = 0;
    this.post({ type: "gate", level: 0 });
    this.latestPose = null;
    useLive.setState({ heldNotes: [], pose: null });
  }

  async audition(
    v: MoppetVoice,
    midi: number,
    text = "la",
    durationMs = 380,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return;
    this.stopAll();
    this.voice = v;
    this.updateVolume();
    const node = await this.ensureWorklet(v);
    if (signal?.aborted) return;

    const syl = sungSyllables(text)[0] ?? AH;
    const tag = this.nextTag;
    this.nextTag += 2;
    const gs = planNoteOn(syl, midi, { body: v.body, vibrato: v.vibrato, tag });
    this.sounding = {
      midi,
      channel: 0,
      syl,
      tag,
      startedMs: performance.now(),
      slideOrigin: 0.5,
    };
    node.port.postMessage({
      type: "source",
      values: { ...singingSource(v.source), f0: midiToHz(midi) },
    } satisfies ToLive);
    this.scheduleShaped(v, gs);

    const endAudition = () => {
      if (this.sounding?.tag !== tag) return;
      this.sounding = null;
      this.post({ type: "release", tag });
      this.post({ type: "release", tag: tag + 1 });
      const coda = planNoteOff(syl, midi, v.body);
      if (coda.length) this.scheduleShaped(v, coda);
      this.latestPose = null;
      useLive.setState({ pose: null });
    };

    if (signal) {
      signal.addEventListener("abort", endAudition, { once: true });
      this.auditionAbortCleanup = () => signal.removeEventListener("abort", endAudition);
    } else {
      this.auditionTimer = setTimeout(endAudition, Math.max(80, durationMs));
    }
  }

  get activePitch(): number | undefined {
    return this.sounding?.midi;
  }
}

const liveSinger = new LiveMoppetSinger();
useVoiceLevels.subscribe(() => liveSinger.updateVolume());

export const useLive = create<LiveState>((set, get) => ({
  mode: "words",
  mpe: true,
  last: "",
  mouth: Object.fromEntries(KNOBS.map(([k]) => [k, NEUTRAL[k]])),
  pose: null,
  syllables: [],
  words: [],
  next: 0,
  heldNotes: [],
  editIndex: 0,
  setCursor: (i) => {
    const n = Math.max(1, get().syllables.length);
    set({ next: Math.max(0, Math.min(n - 1, i)) });
  },
  setEditIndex: (editIndex) => set({ editIndex: Math.max(0, editIndex) }),
  setMpe: (mpe) => set({ mpe }),
  setMode: async (mode) => {
    liveSinger.stopAll();
    set({
      mode,
      last:
        mode === "puppet"
          ? "Puppeteer: hold a key to voice your live mouth posture"
          : mode === "words"
            ? "CHIMERA Sing: each key sings the next syllable (overlap keys for legato)"
            : mode === "edit"
              ? "Step-edit: press a MIDI key to set the highlighted score note"
              : "",
    });
    if (mode !== "off") await liveSinger.ensureOutput();
    if ((mode === "words" || mode === "edit") && !g2p.loaded) {
      await g2p.load().catch(() => undefined);
      if (liveSinger.wordsOf) setLiveWords(liveSinger.wordsOf.piece, liveSinger.wordsOf.id);
    }
  },
}));

export function setLiveVoice(v: MoppetVoice): void {
  if (liveSinger.voice && liveSinger.voice.id !== v.id) liveSinger.stopAll();
  liveSinger.voice = v;
  liveSinger.updateVolume();
}

export function setLiveWords(piece: Piece, id: string): void {
  liveSinger.wordsOf = { piece, id };
  const t =
    piece.tracks.find((x) => x.id === id && (x.phrases ?? x.lines)) ??
    piece.tracks.find((x) => x.phrases ?? x.lines);
  const lines = t?.phrases ?? t?.lines ?? [];
  const parsed = lines.flatMap((line) => {
    try {
      return sungSyllables(line);
    } catch {
      return [];
    }
  });
  useLive.setState({
    syllables: parsed,
    words: parsed.map((s) => (s.melisma ? "–" : s.text)),
    next: 0,
    editIndex: 0,
  });
}

export function moveMouth(key: MouthKey, x: number): void {
  const [, lo, hi, label] = MOUTH.find((m) => m[0] === key)!;
  const n = +(lo + (hi - lo) * x).toFixed(3);
  useLive.setState((s) => ({ mouth: { ...s.mouth, [key]: n }, last: `${label}: ${n}` }));
  liveSinger.post({ type: "mouth", values: { [key]: n } });
}

export function padVowel(i: number): void {
  const [ipa, label] = PAD_VOWELS[i] ?? [];
  const v = liveSinger.voice;
  if (!ipa || !v) return;
  const target =
    ipa === "m"
      ? { lipAp: 0, jaw: 0.3, velum: 1 }
      : { ...VOWEL_TARGETS[bodyName(v)]?.[ipa]?.artic, velum: 0.05 };
  useLive.setState((s) => ({ mouth: { ...s.mouth, ...target }, last: `Mouth: "${label}"` }));
  liveSinger.post({ type: "mouth", values: target });
}

export function setLivePitchBend(norm: number, channel = 0): void {
  liveSinger.setBend(norm, channel);
}

export function setLivePressure(norm01: number, channel = 0): void {
  liveSinger.setPressure(norm01, channel);
}

export function setLiveKeyPressure(midi: number, norm01: number): void {
  liveSinger.setKeyPressure(midi, norm01);
}

export function setLiveSlide(norm01: number, channel = 0): void {
  liveSinger.setSlide(norm01, channel);
}

export async function auditionNote(
  v: MoppetVoice,
  midi: number,
  text = "la",
  durationMs = 380,
  signal?: AbortSignal,
): Promise<void> {
  await liveSinger.audition(v, midi, text || "la", durationMs, signal);
}

export function liveNoteOn(midi: number, velocity = 96, channel = 0): boolean {
  if (!liveSinger.voice || useLive.getState().mode === "off") return false;
  void liveSinger.triggerNoteOn(midi, velocity, channel);
  return true;
}

export function liveNoteOff(midi: number): boolean {
  return liveSinger.noteOff(midi);
}

export const liveMidiPitch = () => liveSinger.activePitch;

export function livePose(): Pose | null {
  const pitch = liveSinger.activePitch;
  if (pitch === undefined) return null;
  const p = liveSinger.latestPose;
  if (!p) return SILENT_POSE;
  return poseFromArtic({
    jaw: p.jaw,
    lipAp: p.lipAp,
    lipProt: p.lipProt,
    lipWidth: p.lipWidth,
    labiodental: p.labiodental,
    mouthPressure: p.mouthPressure,
    rms: p.rms,
    voicing: p.voicing,
    pLung: p.pLung,
    f0: p.f0 > 20 ? p.f0 : midiToHz(pitch),
  });
}

const livePressureBuf = new Float32Array(8);
const liveArticBuf = new Float32Array(17);
const liveEmptyBuf = new Float32Array(0);
const liveTeleSnapshot: TelemetryMessage = {
  type: "telemetry",
  t: {
    artic: liveArticBuf,
    phAreas: liveEmptyBuf,
    orAreas: liveEmptyBuf,
    phLen: 0,
    orLen: 0,
    pressureRms: livePressureBuf,
    flow: liveEmptyBuf,
    velumPort: 0,
    glottalArea: liveEmptyBuf,
    glottalFlow: liveEmptyBuf,
    f0: 0,
    voicing: 0,
    pLung: 0,
    outRms: 0,
    noiseLevel: 0,
    noiseNode: 0,
    gate: 0,
    clock: 0,
    active: [],
  },
  load: 0,
  body: { female: 0, child: 0 },
  nPh: 4,
  nOr: 4,
  beatStep: -1,
};

/** Zero-allocation `TelemetryMessage` for the active live-key/MIDI singer so `Expression` responds at rest. */
export function liveTelemetry(): { id: string; tele: TelemetryMessage } | null {
  const pitch = liveSinger.activePitch;
  const v = liveSinger.voice;
  const p = liveSinger.latestPose;
  if (pitch === undefined || !v || !p) return null;
  liveArticBuf[0] = p.jaw;
  liveArticBuf[7] = p.lipAp;
  liveArticBuf[8] = p.lipProt;
  liveArticBuf[9] = p.lipWidth;
  liveArticBuf[10] = p.labiodental;
  // Index `nPh + nOr - 3` (= 5) stores intra-oral pressure in dyn/cm² for `@chimera/ui/render/expression.ts`
  livePressureBuf[5] = Math.max(0, p.mouthPressure) * 980.665;
  const t = liveTeleSnapshot.t;
  t.f0 = p.f0 > 20 ? p.f0 : midiToHz(pitch);
  t.voicing = p.voicing;
  t.pLung = p.pLung;
  t.outRms = p.rms;
  t.gate = 1;
  liveTeleSnapshot.body = v.body;
  return { id: v.id, tele: liveTeleSnapshot };
}
