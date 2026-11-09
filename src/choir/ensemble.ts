/**
 * The choir on one audio timeline: one singer Worker per voice (the engine is too heavy for six
 * on one audio thread: `bun tools/choir-bench.ts`), one mixer worklet on the app's AudioContext,
 * and telemetry tracks recorded while rendering so puppets and instrument views read what sounded.
 * Live mode renders a short way ahead of the playhead; pre-render finishes first, with progress
 * and cancel. Same path, different head start, so a download is exactly what you heard.
 */
import { create } from "zustand";
import mixerUrl from "../worklet/mixer.ts?worker&url";
import { engine } from "../audio/AudioEngine.ts";
import { chimeraModule } from "../wasm/chimera.ts";
import { g2p } from "../ui/speech.ts";
import type { TelemetryMessage } from "../worklet/protocol.ts";
import type { MixerIn, MixerOut } from "../worklet/mixerProtocol.ts";
import type { FromSinger, ToSinger } from "./singer.worker.ts";
import { beatSeconds, LEAD_IN, pieceSeconds, planTrack } from "./plan.ts";
import { renderPluck } from "./pluck.ts";
import { hopFor, midiToHz, TELE, TELE_HEADER, type CueConfig, type SingerConfig } from "./singerCore.ts";
import { beatReady, parseBeat } from "../wasm/engine.ts";
import { extraStems, mixStems, pieceGains, wavBytes, type GainSection } from "./mix.ts";
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
}

export const useEnsemble = create<EnsembleState>(() => ({ status: "idle", time: 0, duration: 0, progress: 0, message: "", howPlaying: null, underruns: 0, rtf: 0, renderMode: "auto", peak: 0, limited: 0 }));

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

const post = (m: MixerIn, t: Transferable[] = []) => node?.port.postMessage(m, t);

async function ensureMixer(ctx: AudioContext): Promise<void> {
  if (node) return;
  await ctx.audioWorklet.addModule(mixerUrl);
  node = new AudioWorkletNode(ctx, "choir-mixer", { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 1] });
  const splitter = ctx.createGain();
  node.connect(splitter, 0);
  const soloBus = ctx.createGain();
  node.connect(soloBus, 1);
  engine.connectChoir(splitter, soloBus);
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
    const spawn = (i: number, cfg: SingerConfig | null, voice: MoppetVoice | null, pluck?: Float32Array, cue?: CueConfig) => {
      const worker = new Worker(new URL("./singer.worker.ts", import.meta.url), { type: "module" });
      workersAlive++;
      const channel = new MessageChannel();
      ports.push(channel.port1);
      const init: ToSinger = { type: "init", module: cfg || cue ? module : null, port: channel.port2, voiceIndex: i, config: cfg, cue, pluck, paced, lookahead: LOOKAHEAD };
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
      spawn(i, { sampleRate: this.sampleRate, frames: this.frames, hop: this.hop, voice, gestures: plan.gestures, firstF0: midiToHz(plan.firstMidi) }, voice);
    });
    if (piece.pluck) {
      const p = renderPluck(piece, this.sampleRate, this.frames);
      spawn(piece.tracks.length, null, null, p);
    }
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
        beginPrerender(`This device renders one voice at ${rtf.toFixed(2)}× real time, too slow for six live.`);
      } else beginPlaying(0, "live");
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
  if (!pos || !engine.ctx) return 0;
  if (!pos.playing) return pos.frame;
  const sr = engine.ctx.sampleRate;
  const latency = (engine.ctx.outputLatency || 0) + (engine.ctx.baseLatency || 0);
  const now = engine.ctx.currentTime * sr;
  return Math.max(0, Math.min(pos.frame + (now - pos.contextFrame), pos.frame + 2048) - latency * sr);
}

function tick(): void {
  const s = session;
  if (!s) return;
  const st = get().status;
  if (st === "playing" || st === "buffering" || st === "paused") {
    const frame = audibleFrame();
    const hop = Math.floor(frame / s.hop);
    const tele = s.telemetry(s.indexOf(soloId), hop);
    if (tele) engine.overrideTelemetry(tele);
    set({ time: frame / s.sampleRate });
  }
}

function beginPlaying(frame: number, how: "live" | "prerender"): void {
  if (!session) return;
  generation++;
  post({ type: "gains", gains: session.gains });
  post({ type: "solo", voice: Math.max(0, session.indexOf(soloId)) });
  post({ type: "play", generation, frame });
  for (const s of session.singers) {
    s.worker.postMessage({ type: "seek", frame, generation } satisfies ToSinger);
    if (how === "live") s.worker.postMessage({ type: "pace", paced: true } satisfies ToSinger);
  }
  engine.gate(0);
  engine.setBypass(true);
  engine.analysersOnChoir(true);
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
  stopVisuals();
  set({ status: "ended", time: frame / (session?.sampleRate ?? 48000), message: "The workshop is awake.", howPlaying: null });
}

function stopVisuals(): void {
  cancelAnimationFrame(raf);
  engine.setBypass(false);
  engine.overrideTelemetry(null);
  engine.analysersOnChoir(false);
}

/** Choose the next performance. Clears whatever was prepared. */
export function loadPiece(next: Piece): void {
  disposeSession();
  piece = next;
  set({ status: "idle", time: 0, duration: 0, progress: 0, message: "", howPlaying: null, underruns: 0, rtf: 0, peak: 0, limited: 0 });
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

export async function play(start: () => Promise<void>): Promise<void> {
  const st = get().status;
  if (!piece || st === "preparing" || st === "rendering" || st === "buffering") return;
  if (st === "playing") return pause();
  if (st === "paused" && session) return resume();
  const token = ++playToken;
  set({ status: "preparing", time: 0, message: "Waking the singers…" });
  await start();
  // the lyric planner reads CMUdict: without it words fall back to letter-to-sound and weak forms vanish
  try {
    await g2p.load();
  } catch (e) {
    if (token === playToken) set({ status: "idle", message: `Could not load the pronunciation dictionary: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  if (token !== playToken) return;
  if (!engine.ctx) return set({ status: "idle", message: "Audio could not start." });
  await ensureMixer(engine.ctx);
  if (token !== playToken) return;
  const mode = get().renderMode;
  const reuse = sessionFresh() && session!.sampleRate === engine.ctx.sampleRate;
  if (!reuse) {
    const paced = mode !== "prerender";
    disposeSession();
    try {
      session = new Session(piece, voicesProvider(), engine.ctx, paced);
    } catch (e) {
      session = null;
      set({ status: "idle", message: `Could not plan the song: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    set({ duration: session.frames / session.sampleRate, progress: 0 });
    if (mode === "prerender") {
      resumeAt = 0;
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
    beginPlaying(0, "prerender");
  } else {
    waiting = "probe";
    set({ status: "rendering", message: "Gathering the singers…" });
    if (session!.singers.every((s) => s.rendered >= Math.round(AUTO_PROBE * session!.sampleRate))) {
      waiting = null;
      beginPlaying(0, get().renderMode === "prerender" ? "prerender" : "live");
    }
  }
}
let playToken = 0;

export function pause(): void {
  if (get().status !== "playing" && get().status !== "buffering") return;
  post({ type: "pause" });
  set({ status: "paused", message: "Paused." });
  if (session) resumeAt = Math.floor(audibleFrame());
}

function resume(): void {
  beginPlaying(resumeAt, get().howPlaying ?? "live");
}

/** Back to the top, keeping what was rendered. */
export function stop(): void {
  playToken++;
  waiting = null;
  post({ type: "pause" });
  stopVisuals();
  set({ status: "idle", time: 0, message: "", howPlaying: null });
}

/** Abandon a render in progress. */
export function cancel(): void {
  playToken++;
  disposeSession();
  set({ status: "idle", time: 0, progress: 0, message: "Rendering cancelled. Nothing is playing.", howPlaying: null });
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

/** Choose which singer the instruments inspect. */
export function inspect(id: string): void {
  soloId = id;
  if (session) post({ type: "solo", voice: Math.max(0, session.indexOf(id)) });
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

export function pose(id: string): Pose {
  const s = session;
  const st = get().status;
  if (!s || (st !== "playing" && st !== "buffering" && st !== "paused")) return SILENT_POSE;
  return s.pose(s.indexOf(id), Math.floor(audibleFrame() / s.hop));
}

/** Render to the end if needed, then the piece through the same bus as playback, as a WAV. `only`: one singer's stem. */
export async function exportWav(start: () => Promise<void>, only?: number): Promise<{ bytes: ArrayBuffer; peak: number; limited: number; nonFinite: number }> {
  if (!session || !sessionFresh()) {
    await start();
    await g2p.load();
    if (!engine.ctx) throw new Error("audio not started");
    await ensureMixer(engine.ctx);
    if (!piece) throw new Error("no piece");
    disposeSession();
    session = new Session(piece, voicesProvider(), engine.ctx, false);
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
    const g = peak > 0 ? 0.75 / peak : 1;
    const samples = new Float32Array(stem.length);
    for (let i = 0; i < stem.length; i++) samples[i] = stem[i] * g;
    return { bytes: wavBytes(samples, s.sampleRate), peak, limited: 0, nonFinite: 0 };
  }
  const { samples, limited, peak, nonFinite } = mixStems(stems, s.gains, s.frames, s.section);
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
