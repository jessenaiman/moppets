import { useVoiceLevels, voiceLevel } from "./voiceLevels.ts";
/**
 * The choir on one audio timeline: one singer Worker per voice (the engine is too heavy for six
 * on one audio thread: `bun tools/choir-bench.ts`), one mixer worklet on the app's AudioContext,
 * and telemetry tracks recorded while rendering so puppets and instrument views read what sounded.
 * Live mode renders a short way ahead of the playhead; pre-render finishes first, with progress
 * and cancel. Same path, different head start, so a download is exactly what you heard.
 */
import { create } from "zustand";
import mixerUrl from "../worklet/mixer.ts?worker&url";
import { audio } from "../audio/audio.ts";
import { chimeraModule } from "@chimera/wasm/chimera.ts";
import { g2p } from "../audio/g2p.ts";
import type { TelemetryMessage } from "@chimera/worklet/protocol.ts";
import type { MixerIn, MixerOut } from "../worklet/mixerProtocol.ts";
import type { Backing, FromSinger, ToSinger } from "./singer.worker.ts";
import { beatSeconds, LEAD_IN, pieceSeconds, planTrack } from "./plan.ts";
import { hopFor, midiToHz, TELE, TELE_HEADER, type CueConfig, type SingerConfig } from "./singerCore.ts";
import { beatReady, parseBeat } from "@chimera/wasm/engine.ts";
import { extraStems, hasAccompaniment, mixStems, pieceGains, wavBytes, type GainSection } from "./mix.ts";
import { bandFor } from "./band.ts";
import { poseFromRecord, SILENT_POSE, type Pose } from "./pose.ts";
import { MIX_LEVEL, type MoppetArtic, type MoppetSource, type MoppetVoice } from "./voices.ts";
import type { Piece } from "./music.ts";

export type Status = "idle" | "preparing" | "rendering" | "buffering" | "playing" | "paused" | "ended";
export type RenderMode = "auto" | "live" | "prerender";

export interface EnsembleState {
  status: Status;
  time: number;
  duration: number;
  /** 0..1 of the whole score rendered */
  progress: number;
  message: string;
  /** "live" (rendering just ahead) or "prerender" (finished first) while a performance runs */
  howPlaying: "live" | "prerender" | null;
  underruns: number;
  /** worst worker's seconds of CPU per second of audio */
  rtf: number;
  renderMode: RenderMode;
  peak: number;
  limited: number;
  soloMix: boolean;
  loopRange: { startSec: number; endSec: number; label: string } | null;
}

/**
 * The playing singer's latest telemetry (CHIMERA's snapshot: airway pressure and flow, the folds,
 * the articulators), at the moment now sounding; null when nothing plays.
 */
export const useTelemetry = create<{ id: string; tele: TelemetryMessage | null }>(() => ({ id: "", tele: null }));

export const useEnsemble = create<EnsembleState>(() => ({ status: "idle", time: 0, duration: 0, progress: 0, message: "", howPlaying: null, underruns: 0, rtf: 0, renderMode: "auto", peak: 0, limited: 0, soloMix: false, loopRange: null }));

/** How far ahead of the playhead live mode renders: the delay before a control is heard. */
const LOOKAHEAD = 0.3;
/** Auto: audio prepared before deciding live vs pre-render, and the worst real-time factor allowed. */
const AUTO_PROBE = 1.0;
const AUTO_MAX_RTF = 0.7;
/** Auto: this many live underruns in one performance switch it to pre-render. */
const MAX_UNDERRUNS = 3;

type Singer = { worker: Worker; voice: MoppetVoice | null; index: number; rendered: number; frames: number; rtf: number; tele: Float32Array | null; recordSize: number; nArtic: number; nPh: number; nOr: number; nScope: number; edited: boolean };

const set = useEnsemble.setState;
const get = useEnsemble.getState;

let node: AudioWorkletNode | null = null;
let soloId = "vee";
let session: Session | null = null;
let generation = 0;
let pos: Extract<MixerOut, { type: "pos" }> | null = null;
let raf = 0;
let workersAlive = 0;
let sessionsMade = 0;
let waiting: "probe" | "complete" | null = null;
let pendingStartFrame = 0;

const post = (m: MixerIn, t: Transferable[] = []) => node?.port.postMessage(m, t);

useVoiceLevels.subscribe(() => {
  if (session) post({ type: "voiceLevels", values: session.levels() });
});

async function ensureMixer(ctx: AudioContext): Promise<void> {
  if (node) return;
  await ctx.audioWorklet.addModule(mixerUrl);
  node = new AudioWorkletNode(ctx, "choir-mixer", { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 1] });
  const splitter = ctx.createGain();
  node.connect(splitter, 0);
  // output 1 is the solo singer alone (CHIMERA's analysers listened to it); nothing needs it yet
  audio.connect(splitter);
  node.port.onmessage = (e: MessageEvent<MixerOut>) => onMixer(e.data);
}

function onMixer(m: MixerOut): void {
  if (m.type === "pos") {
    pos = m;
    set({ underruns: m.underruns, peak: m.peak, limited: m.limited });
    if (get().status === "buffering" && !m.buffering && m.playing) set({ status: "playing", message: playingMessage() });
    else if (get().status === "playing" && m.buffering) set({ status: "buffering", message: "Waiting for the singers…" });
    if (get().renderMode === "auto" && get().howPlaying === "live" && m.underruns >= MAX_UNDERRUNS) fallBackToPrerender();
  } else if (m.type === "ended" && session) {
    finishPlaying(m.frame);
  }
}

function playingMessage(): string {
  const how = get().howPlaying;
  if (how === "live") return `Live: six engines rendering ${Math.round(LOOKAHEAD * 1000)} ms ahead on the shared timeline.`;
  if (how === "prerender") return "Playing the pre-rendered performance.";
  return "";
}

class Session {
  readonly frames: number;
  readonly sampleRate: number;
  readonly hop: number;
  readonly singers: Singer[] = [];
  readonly gains: number[];
  section: GainSection | undefined;
  planError: string | null = null;

  constructor(readonly piece: Piece, readonly voices: MoppetVoice[], ctx: AudioContext, paced: boolean) {
    sessionsMade++;
    this.sampleRate = ctx.sampleRate;
    this.frames = Math.ceil(pieceSeconds(piece) * this.sampleRate);
    this.hop = hopFor(this.sampleRate);
    const module = chimeraModule();
    const ports: MessagePort[] = [];
    const ends: number[] = [];
    const spawn = (i: number, cfg: SingerConfig | null, voice: MoppetVoice | null, pluck?: Float32Array, cue?: CueConfig, backing?: Backing) => {
      const worker = new Worker(new URL("./singer.worker.ts", import.meta.url), { type: "module" });
      workersAlive++;
      const channel = new MessageChannel();
      ports.push(channel.port1);
      const init: ToSinger = { type: "init", module: cfg || cue ? module : null, port: channel.port2, voiceIndex: i, config: cfg, cue, pluck, backing, paced, lookahead: LOOKAHEAD };
      worker.onmessage = (e: MessageEvent<FromSinger>) => this.onSinger(e.data);
      worker.onerror = (e) => fail(`Singer ${voice?.name ?? "accompaniment"}: ${e.message}`);
      worker.postMessage(init, pluck ? [channel.port2, pluck.buffer] : [channel.port2]);
      const s: Singer = { worker, voice, index: i, rendered: 0, frames: this.frames, rtf: 0, tele: null, recordSize: 0, nArtic: 0, nPh: 0, nOr: 0, nScope: 0, edited: false };
      this.singers.push(s);
      ends.push(this.frames);
    };
    // planning can refuse a lyric: do all of it before starting any Worker, so a refusal leaks nothing
    const plans = piece.tracks.map((t) => {
      const voice = voices.find((v) => v.id === t.id)!;
      return { voice, plan: planTrack(t, piece, voice) };
    });
    plans.forEach(({ voice, plan }, i) => {
      spawn(i, { sampleRate: this.sampleRate, frames: this.frames, hop: this.hop, voice, gestures: plan.gestures, nasal: plan.nasal, firstF0: midiToHz(plan.firstMidi) }, voice);
    });
    // the backing renders in its own worker; the band is resolved here, where the band switch lives
    if (hasAccompaniment(piece)) spawn(piece.tracks.length, null, null, undefined, undefined, { piece: { ...piece, band: bandFor(piece) }, sampleRate: this.sampleRate, frames: this.frames });
    {
      const hop = this.hop, sampleRate = this.sampleRate, frames = this.frames, start = LEAD_IN;
      let index = this.singers.length;
      for (const e of extraStems(piece)) {
        if (e === "beat") {
          const b = piece.beat!;
          spawn(index++, null, null, undefined, { sampleRate, frames, hop, beat: { steps: parseBeat(b.text), bpm: piece.bpm, swing: b.swing, startSeconds: start, ready: { ...beatReady({ female: 0, child: 0 }) } as Record<string, number> } });
        } else {
          const calls = (piece.cameos ?? []).filter((c) => c.creature === e).map((c) => ({ id: c.call, seconds: LEAD_IN + c.beat * beatSeconds(piece) }));
          spawn(index++, null, null, undefined, { sampleRate, frames, hop, creature: { id: e, calls } });
        }
      }
    }
    const mixPlan = pieceGains(piece, this.sampleRate, LEAD_IN + piece.tracks.length * 20 * beatSeconds(piece), MIX_LEVEL);
    this.gains = mixPlan.gains;
    this.section = mixPlan.section;
    const gains = this.gains;
    post({ type: "setup", ends, gains, ports, section: this.section }, ports);
    post({ type: "voiceLevels", values: this.levels() });
  }

  levels() {
    return this.piece.tracks.map(t => voiceLevel(t.id));
  }

  private onSinger(m: FromSinger): void {
    if (session !== this) return;
    const s = this.singers[m.voiceIndex];
    switch (m.type) {
      case "progress":
        s.rendered = m.rendered;
        s.rtf = m.rtf;
        this.onProgress();
        break;
      case "telemetry":
        if (!s.tele) {
          s.recordSize = m.recordSize;
          const head = m.records;
          s.nArtic = head[TELE.nArtic];
          s.nPh = head[TELE.nPh];
          s.nOr = head[TELE.nOr];
          s.nScope = head[TELE.nScope];
          s.tele = new Float32Array(m.recordSize * Math.ceil(this.frames / this.hop));
        }
        s.tele.set(m.records, m.from * m.recordSize);
        break;
      case "error":
        fail(`${s.voice?.name ?? "Accompaniment"}: ${m.message}`);
        break;
      case "stem":
        pendingStems?.deliver(m.voiceIndex, m.pcm);
        break;
    }
  }

  private onProgress(): void {
    const total = this.singers.length * this.frames;
    const done = this.singers.reduce((a, s) => a + s.rendered, 0);
    const progress = done / total;
    const rtf = Math.max(0, ...this.singers.filter((s) => s.voice).map((s) => s.rtf));
    set({ progress, rtf });
    const allAt = (f: number) => this.singers.every((s) => s.rendered >= Math.min(this.frames, f));
    if (waiting === "probe" && allAt(Math.round(AUTO_PROBE * this.sampleRate))) {
      waiting = null;
      if (get().renderMode === "auto" && rtf >= AUTO_MAX_RTF) {
        resumeAt = pendingStartFrame;
        beginPrerender(`This device renders one voice at ${rtf.toFixed(2)}× real time, too slow for six live.`);
      } else beginPlaying(pendingStartFrame, "live");
    } else if (waiting === "complete" && allAt(this.frames)) {
      waiting = null;
      beginPlaying(resumeAt, "prerender");
    }
    if (get().status === "rendering" && waiting === "complete") set({ message: `Pre-rendering ${Math.round(progress * 100)} %. ${prerenderReason}` });
  }

  indexOf(id: string): number {
    return this.singers.findIndex((s) => s.voice?.id === id);
  }

  telemetry(index: number, hop: number): TelemetryMessage | null {
    const s = this.singers[index];
    if (!s?.tele || !s.voice) return null;
    const r = s.recordSize, n = Math.floor(s.tele.length / r);
    if (hop < 0 || hop >= n) return null;
    const a = hop * r, head = s.tele.subarray(a, a + TELE_HEADER);
    let o = a + TELE_HEADER;
    const take = (k: number) => s.tele!.subarray(o, (o += k));
    const artic = take(s.nArtic), phAreas = take(s.nPh), orAreas = take(s.nOr), pressureRms = take(s.nPh + s.nOr), flow = take(s.nPh + s.nOr), glottalArea = take(s.nScope), glottalFlow = take(s.nScope);
    return {
      type: "telemetry",
      t: { artic, phAreas, orAreas, phLen: head[0], orLen: head[1], pressureRms, flow, velumPort: head[2], glottalArea, glottalFlow, f0: head[3], voicing: head[4], pLung: head[5], outRms: head[6], noiseLevel: head[7], noiseNode: head[8], gate: head[9], clock: head[10], active: [] },
      load: s.rtf,
      body: s.voice.body,
      nPh: s.nPh,
      nOr: s.nOr,
      beatStep: -1,
    };
  }

  pose(index: number, hop: number): Pose {
    const s = this.singers[index];
    if (!s?.tele || !s.recordSize) return SILENT_POSE;
    const at = hop * s.recordSize;
    if (hop < 0 || at + s.recordSize > s.tele.length) return SILENT_POSE;
    return poseFromRecord(s.tele, at);
  }

  dispose(): void {
    for (const s of this.singers) {
      s.worker.terminate();
      workersAlive--;
    }
  }
}

let prerenderReason = "";
let resumeAt = 0;
let pendingStems: { deliver: (i: number, pcm: Float32Array) => void } | null = null;

function fail(message: string): void {
  cancel();
  set({ status: "idle", message: `Could not sing: ${message}` });
}

function startTick(): void {
  cancelAnimationFrame(raf);
  const loop = () => {
    raf = requestAnimationFrame(loop);
    tick();
  };
  raf = requestAnimationFrame(loop);
}

function audibleFrame(): number {
  if (!pos || !audio.ctx) return 0;
  if (!pos.playing) return pos.frame;
  const sr = audio.ctx.sampleRate;
  const latency = (audio.ctx.outputLatency || 0) + (audio.ctx.baseLatency || 0);
  const now = audio.ctx.currentTime * sr;
  return Math.max(0, Math.min(pos.frame + (now - pos.contextFrame), pos.frame + 2048) - latency * sr);
}

function tick(): void {
  const s = session;
  if (!s) return;
  const st = get().status;
  if (st === "playing" || st === "buffering" || st === "paused") {
    // paused, the timeline is where the pause (or a seek) put it: the mixer's last report runs on for
    // a moment and isn't latency-corrected, so reading it moved a paused playhead by ~0.1 s
    const frame = st === "paused" ? resumeAt : audibleFrame();
    const hop = Math.floor(frame / s.hop);
    const tele = s.telemetry(s.indexOf(soloId), hop);
    if (tele) useTelemetry.setState({ id: soloId, tele });
    const sec = frame / s.sampleRate;
    set({ time: sec });
    const loop = get().loopRange;
    if (st === "playing" && loop && sec >= loop.endSec) seek(loop.startSec);
  }
}

function soloMixIndex(): number {
  if (!session || !get().soloMix) return -1;
  return session.indexOf(soloId);
}

function beginPlaying(frame: number, how: "live" | "prerender"): void {
  if (!session) return;
  generation++;
  post({ type: "gains", gains: session.gains });
  post({ type: "solo", voice: Math.max(0, session.indexOf(soloId)) });
  post({ type: "soloMix", voice: soloMixIndex() });
  post({ type: "play", generation, frame });
  for (const s of session.singers) {
    s.worker.postMessage({ type: "seek", frame, generation } satisfies ToSinger);
    if (how === "live") s.worker.postMessage({ type: "pace", paced: true } satisfies ToSinger);
  }
  startTick();
  set({ status: "buffering", howPlaying: how, message: how === "live" ? "Starting live…" : "Starting the pre-rendered performance…", progress: get().progress });
}

function beginPrerender(reason: string): void {
  if (!session) return;
  prerenderReason = reason;
  waiting = "complete";
  for (const s of session.singers) s.worker.postMessage({ type: "pace", paced: false } satisfies ToSinger);
  set({ status: "rendering", message: `Pre-rendering. ${reason}` });
}

function fallBackToPrerender(): void {
  if (!session) return;
  resumeAt = Math.floor(audibleFrame());
  post({ type: "pause" });
  beginPrerender(`Live rendering fell behind ${MAX_UNDERRUNS} times, so the rest is being finished first.`);
  set({ howPlaying: "prerender" });
}

function finishPlaying(frame: number): void {
  const loop = get().loopRange;
  if (loop && session) {
    const startFrame = Math.max(0, Math.min(session.frames, Math.round(loop.startSec * session.sampleRate)));
    resumeAt = startFrame;
    set({ time: startFrame / session.sampleRate });
    beginPlaying(startFrame, get().howPlaying ?? "prerender");
    return;
  }
  stopVisuals();
  set({ status: "ended", time: frame / (session?.sampleRate ?? 48000), message: "The workshop is awake.", howPlaying: null });
}

function stopVisuals(): void {
  cancelAnimationFrame(raf);
  useTelemetry.setState({ tele: null });
}

/** Choose the next performance. Clears whatever was prepared. */
export function loadPiece(next: Piece): void {
  disposeSession();
  piece = next;
  pendingStartFrame = 0;
  set({ status: "idle", time: 0, duration: 0, progress: 0, message: "", howPlaying: null, underruns: 0, rtf: 0, peak: 0, limited: 0, loopRange: null });
}

let piece: Piece | null = null;
let voicesProvider: () => MoppetVoice[] = () => [];
export function setVoicesProvider(fn: () => MoppetVoice[]): void {
  voicesProvider = fn;
}

function disposeSession(): void {
  stopVisuals();
  waiting = null;
  post({ type: "clear", generation: ++generation });
  session?.dispose();
  session = null;
  pos = null;
}

/** Everything ready to start? (a session exists, with no edits waiting for a re-render) */
function sessionFresh(): boolean {
  return !!session && !session.singers.some((s) => s.edited);
}

export async function play(start: () => Promise<void>, startSec = 0): Promise<void> {
  const st = get().status;
  if (!piece || st === "preparing" || st === "rendering" || st === "buffering") return;
  if (st === "playing") return pause();
  if (st === "paused" && session) return resume();
  const token = ++playToken;
  set({ status: "preparing", time: startSec, message: "Waking the singers…" });
  try {
    await start();
  } catch (e) {
    // no audio (an insecure page, a blocked device): say why instead of waking forever
    if (token === playToken) set({ status: "idle", message: e instanceof Error ? e.message : String(e) });
    return;
  }
  // the lyric planner reads CMUdict: without it words fall back to letter-to-sound and weak forms vanish
  try {
    await g2p.load();
  } catch (e) {
    if (token === playToken) set({ status: "idle", message: `Could not load the pronunciation dictionary: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  if (token !== playToken) return;
  if (!audio.ctx) return set({ status: "idle", message: "Audio could not start." });
  await ensureMixer(audio.ctx);
  if (token !== playToken) return;
  const mode = get().renderMode;
  const reuse = sessionFresh() && session!.sampleRate === audio.ctx.sampleRate;
  pendingStartFrame = startSec > 0 ? Math.round(startSec * audio.ctx.sampleRate) : 0;
  if (!reuse) {
    const paced = mode !== "prerender";
    disposeSession();
    try {
      session = new Session(piece, voicesProvider(), audio.ctx, paced);
    } catch (e) {
      session = null;
      set({ status: "idle", message: `Could not plan the song: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    pendingStartFrame = Math.max(0, Math.min(session.frames, pendingStartFrame));
    set({ duration: session.frames / session.sampleRate, progress: 0 });
    if (mode === "prerender") {
      resumeAt = pendingStartFrame;
      beginPrerender("Pre-render mode chosen.");
    } else if (mode === "auto") {
      // probe with a full second before committing to live
      for (const s of session.singers) s.worker.postMessage({ type: "pace", paced: false } satisfies ToSinger);
      waiting = "probe";
      set({ status: "rendering", message: "Measuring how fast this device sings…" });
    } else {
      waiting = "probe";
      set({ status: "rendering", message: "Gathering the singers…" });
    }
  } else if (session!.singers.every((s) => s.rendered >= s.frames)) {
    beginPlaying(pendingStartFrame, "prerender");
  } else {
    waiting = "probe";
    set({ status: "rendering", message: "Gathering the singers…" });
    if (session!.singers.every((s) => s.rendered >= Math.round(AUTO_PROBE * session!.sampleRate))) {
      waiting = null;
      beginPlaying(pendingStartFrame, get().renderMode === "prerender" ? "prerender" : "live");
    }
  }
}
let playToken = 0;

export function pause(): void {
  if (get().status !== "playing" && get().status !== "buffering") return;
  post({ type: "pause" });
  set({ status: "paused", message: "Paused." });
  if (session) {
    resumeAt = Math.floor(audibleFrame());
    set({ time: resumeAt / session.sampleRate });
  }
}

function resume(): void {
  beginPlaying(resumeAt, get().howPlaying ?? "live");
}

/** Back to the top, keeping what was rendered. */
export function stop(): void {
  playToken++;
  waiting = null;
  pendingStartFrame = 0;
  post({ type: "pause" });
  stopVisuals();
  set({ status: "idle", time: 0, message: "", howPlaying: null, loopRange: null });
}

/** Abandon a render in progress. */
export function cancel(): void {
  playToken++;
  pendingStartFrame = 0;
  disposeSession();
  set({ status: "idle", time: 0, progress: 0, message: "Rendering cancelled. Nothing is playing.", howPlaying: null, loopRange: null });
}

export function seek(seconds: number): void {
  if (!session) return;
  const frame = Math.max(0, Math.min(session.frames, Math.round(seconds * session.sampleRate)));
  resumeAt = frame;
  set({ time: frame / session.sampleRate });
  const st = get().status;
  if (st === "playing" || st === "buffering") {
    // forward of the render head the singers race there; the shared timeline waits for them all
    beginPlaying(frame, get().howPlaying ?? "live");
  }
}

export function setRenderMode(mode: RenderMode): void {
  set({ renderMode: mode });
}

/** Solo one Moppet in the main mix (or restore the full choir). */
export function setSoloMix(on: boolean): void {
  set({ soloMix: on });
  if (session) post({ type: "soloMix", voice: soloMixIndex() });
}

/** Set or clear a rehearsal loop range in seconds. */
export function setLoopRange(range: { startSec: number; endSec: number; label: string } | null): void {
  set({ loopRange: range });
}

/** Start or seek playback into a loop over `range`. */
export async function playLoop(start: () => Promise<void>, range: { startSec: number; endSec: number; label: string }): Promise<void> {
  set({ loopRange: range });
  const st = get().status;
  if (session && sessionFresh() && (st === "playing" || st === "buffering" || st === "paused")) {
    seek(range.startSec);
    if (st === "paused") resume();
    return;
  }
  await play(start, range.startSec);
}

/** Choose which singer the instruments inspect. */
export function inspect(id: string): void {
  soloId = id;
  if (session) {
    post({ type: "solo", voice: Math.max(0, session.indexOf(id)) });
    post({ type: "soloMix", voice: soloMixIndex() });
  }
  tick();
}

/** A control moved: it reaches the singer's own engine at its render head. */
export function editVoice(id: string, edit: { source?: Partial<MoppetSource>; artic?: MoppetArtic; rerender?: boolean }): void {
  const i = session?.singers.findIndex((s) => s.voice?.id === id) ?? -1;
  if (i < 0 || !session) return;
  const s = session.singers[i];
  if (edit.source) s.worker.postMessage({ type: "source", values: edit.source } satisfies ToSinger);
  if (edit.artic) s.worker.postMessage({ type: "character", artic: edit.artic } satisfies ToSinger);
  s.edited = true;
}

/** A singer's pose at a time of the rendered session, whatever is playing (video capture). */
export function poseAt(id: string, seconds: number): Pose {
  const s = session;
  if (!s) return SILENT_POSE;
  return s.pose(s.indexOf(id), Math.floor((seconds * s.sampleRate) / s.hop));
}

export function pose(id: string): Pose {
  const s = session;
  const st = get().status;
  if (!s || (st !== "playing" && st !== "buffering" && st !== "paused")) return SILENT_POSE;
  return s.pose(s.indexOf(id), Math.floor(audibleFrame() / s.hop));
}

/**
 * A singer's glottal flow over the last few milliseconds (CHIMERA's scope: the air pulses the
 * folds let through), at the moment now sounding, or at `seconds` of the rendered session
 * (video capture). Null when silent or not rendered.
 */
export function scopeOf(id: string, seconds?: number): Float32Array | null {
  const s = session;
  if (!s) return null;
  const st = get().status;
  if (seconds === undefined && st !== "playing" && st !== "buffering" && st !== "paused") return null;
  const frame = seconds === undefined ? audibleFrame() : seconds * s.sampleRate;
  const t = s.telemetry(s.indexOf(id), Math.floor(frame / s.hop));
  return t ? (t.t.glottalFlow as Float32Array) : null;
}

/** Render to the end if needed, then the piece through the same bus as playback, as a WAV. `only`: one singer's stem. */
export async function exportWav(start: () => Promise<void>, only?: number): Promise<{ bytes: ArrayBuffer; peak: number; limited: number; nonFinite: number }> {
  if (!session || !sessionFresh()) {
    await start();
    await g2p.load();
    if (!audio.ctx) throw new Error("audio not started");
    await ensureMixer(audio.ctx);
    if (!piece) throw new Error("no piece");
    disposeSession();
    session = new Session(piece, voicesProvider(), audio.ctx, false);
    set({ duration: session.frames / session.sampleRate, progress: 0, status: "rendering" });
  } else {
    for (const s of session.singers) s.worker.postMessage({ type: "pace", paced: false } satisfies ToSinger);
  }
  const s = session;
  const token = ++exportToken;
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (token !== exportToken || session !== s) return reject(new Error("cancelled"));
      if (s.singers.every((v) => v.rendered >= v.frames)) return resolve();
      set({ status: get().status === "rendering" ? "rendering" : get().status, message: `Rendering the WAV ${Math.round(get().progress * 100)} %…` });
      setTimeout(check, 100);
    };
    check();
  });
  const stems: Float32Array[] = await new Promise((resolve) => {
    const out: Float32Array[] = [];
    let n = 0;
    pendingStems = {
      deliver: (i, pcm) => {
        out[i] = pcm;
        if (++n === s.singers.length) {
          pendingStems = null;
          resolve(out);
        }
      },
    };
    for (const v of s.singers) v.worker.postMessage({ type: "stem" } satisfies ToSinger);
  });
  if (get().status === "rendering") set({ status: "idle", message: "" });
  if (only !== undefined) {
    const stem = stems[only];
    let peak = 0;
    for (let i = 0; i < stem.length; i++) peak = Math.max(peak, Math.abs(stem[i]));
    const level = s.levels()[only] ?? 1;
    const g = peak > 0 ? level * 0.75 / peak : 1;
    const samples = new Float32Array(stem.length);
    for (let i = 0; i < stem.length; i++) samples[i] = stem[i] * g;
    return { bytes: wavBytes(samples, s.sampleRate), peak, limited: 0, nonFinite: 0 };
  }
  const { samples, limited, peak, nonFinite } = mixStems(stems, s.gains, s.frames, s.section, s.levels());
  return { bytes: wavBytes(samples, s.sampleRate), peak, limited, nonFinite };
}
let exportToken = 0;

export function ensembleDebug() {
  return { pos, workersAlive, sessionsMade, hasSession: !!session, singers: session?.singers.map((s) => ({ id: s.voice?.id ?? "pluck", rendered: s.rendered, frames: s.frames, rtf: s.rtf })) ?? [] };
}

/** Called when leaving Moppet mode: nothing keeps playing or running. */
export function leaveEnsemble(): void {
  playToken++;
  disposeSession();
  set({ status: "idle", time: 0, progress: 0, message: "", howPlaying: null });
}
