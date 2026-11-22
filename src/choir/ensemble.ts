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
import { midiToHz, hopFor, TELE, TELE_HEADER, type CueConfig, type SingerConfig } from "./singerCore.ts";
import { beatReady, parseBeat } from "@chimera/wasm/engine.ts";
import { extraStems, hasAccompaniment, mixStems, pieceGains, wavBytes } from "./mix.ts";
import { bandEnabled, bandFor } from "./band.ts";
import { poseFromRecord, SILENT_POSE, type Pose } from "./pose.ts";
import { MIX_LEVEL, type MoppetArtic, type MoppetSource, type MoppetVoice } from "./voices.ts";
import type { Piece } from "./music.ts";
import { vocalLevelAt, type VocalTiming } from "./vocalTiming.ts";

export type Status = "idle" | "preparing" | "rendering" | "buffering" | "playing" | "paused" | "ended";

export interface EnsembleState {
  status: Status;
  time: number;
  duration: number;
  /** 0..1 of the whole score rendered */
  progress: number;
  message: string;
  howPlaying: "live" | null;
  underruns: number;
  /** worst worker's seconds of CPU per second of audio */
  rtf: number;
  peak: number;
  soloMix: boolean;
  loopRange: { startSec: number; endSec: number; label: string } | null;
  vocalTiming?: VocalTiming;
}

/**
 * The playing singer's latest telemetry (CHIMERA's snapshot: airway pressure and flow, the folds,
 * the articulators), at the moment now sounding; null when nothing plays.
 */
export const useTelemetry = create<{ id: string; tele: TelemetryMessage | null }>(() => ({ id: "", tele: null }));

export const useEnsemble = create<EnsembleState>(() => ({ status: "idle", time: 0, duration: 0, progress: 0, message: "", howPlaying: null, underruns: 0, rtf: 0, peak: 0, soloMix: false, loopRange: null }));

/** How far ahead of the playhead live mode renders: the delay before a control is heard. */
const LOOKAHEAD = 0.3;
type Singer = { nativeEnvelope?: number[]; worker: Worker; voice: MoppetVoice | null; index: number; rendered: number; frames: number; rtf: number; tele: Float32Array | null; recordSize: number; nArtic: number; nPh: number; nOr: number; nScope: number; edited: boolean };

const set = useEnsemble.setState;
const get = useEnsemble.getState;

let node: AudioWorkletNode | null = null;
let mixerLoading: Promise<void> | null = null;
let soloId = "vee";
let session: Session | null = null;
let generation = 0;
let pos: Extract<MixerOut, { type: "pos" }> | null = null;
let raf = 0;
let workersAlive = 0;
let sessionsMade = 0;

const post = (m: MixerIn, t: Transferable[] = []) => node?.port.postMessage(m, t);

useVoiceLevels.subscribe(() => {
  cancelExport();
  if (session) post({ type: "voiceLevels", values: session.levels() });
});

async function ensureMixer(ctx: AudioContext): Promise<void> {
  if (node) return;
  mixerLoading ??= ctx.audioWorklet.addModule(mixerUrl).then(() => {
    const mixer = new AudioWorkletNode(ctx, "choir-mixer", { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 1] });
    // Connect directly to CHIMERA app master volume (single GainNode, zero stacked wrappers).
    audio.connect(mixer);
    ctx.addEventListener("statechange", () => {
      if (ctx.state !== "running") pause();
    });
    mixer.port.onmessage = (e: MessageEvent<MixerOut>) => onMixer(e.data);
    node = mixer;
  }).finally(() => { mixerLoading = null; });
  await mixerLoading;
}

function onMixer(m: MixerOut): void {
  if (m.generation !== generation) return;
  if (m.type === "pos") {
    pos = m;
    set({ underruns: m.underruns, peak: m.peak });
    if (get().status === "buffering" && !m.buffering && m.playing) set({ status: "playing", message: "CHIMERA vocals · live mix." });
    else if (get().status === "playing" && m.buffering) set({ status: "buffering", message: "Waiting for the singers…" });
  } else if (m.type === "ended" && session) {
    finishPlaying(m.frame);
  }
}

type OfflineRender = {
  progress?: (fraction: number) => void;
  stem: (index: number, pcm: Float32Array, total: number) => void;
  error: (error: Error) => void;
};

class Session {
  readonly frames: number;
  readonly sampleRate: number;
  readonly hop: number;
  readonly vocalTiming: VocalTiming;
  readonly singers: Singer[] = [];
  readonly gains: number[];
  private disposed = false;

  constructor(readonly piece: Piece, voices: MoppetVoice[], sampleRate: number, private readonly offline?: OfflineRender) {
    sessionsMade++;
    this.sampleRate = sampleRate;
    this.frames = Math.ceil(pieceSeconds(piece) * this.sampleRate);
    this.hop = hopFor(this.sampleRate);
    this.vocalTiming = { framesPerSecond: this.sampleRate / this.hop, envelopes: {} };
    const module = chimeraModule();
    const ports: MessagePort[] = [];
    const ends: number[] = [];
    const spawn = (i: number, cfg: SingerConfig | null, voice: MoppetVoice | null, pluck?: Float32Array, cue?: CueConfig, backing?: Backing) => {
      const worker = new Worker(new URL("./singer.worker.ts", import.meta.url), { type: "module" });
      workersAlive++;
      const channel = offline ? undefined : new MessageChannel();
      const transfers: Transferable[] = [];
      if (channel) {
        ports.push(channel.port1);
        transfers.push(channel.port2);
      }
      if (pluck) transfers.push(pluck.buffer);
      const init: ToSinger = { type: "init", module: cfg || cue ? module : null, port: channel?.port2, voiceIndex: i, config: cfg, cue, pluck, backing, paced: !offline, lookahead: LOOKAHEAD, reportProgress: !!offline?.progress };
      worker.onmessage = (e: MessageEvent<FromSinger>) => this.onSinger(e.data);
      worker.onerror = (e) => this.onError(voice, e.message);
      worker.onmessageerror = () => this.onError(voice, "Could not read render data.");
      const s: Singer = { worker, voice, index: i, rendered: 0, frames: this.frames, rtf: 0, tele: null, recordSize: 0, nArtic: 0, nPh: 0, nOr: 0, nScope: 0, edited: false };
      this.singers.push(s);
      ends.push(this.frames);
      worker.postMessage(init, transfers);
    };
    const plans = piece.tracks.map(track => {
      const voice = voices.find(v => v.id === track.id);
      if (!voice) throw new Error(`Missing voice for ${track.id}.`);
      return { voice, plan: track.events.length ? planTrack(track, piece, voice) : null };
    });
    try {
      plans.forEach(({ voice, plan }, i) => {
        if (!plan) {
          spawn(i, null, voice, new Float32Array(this.frames));
          return;
        }
        spawn(i, { sampleRate: this.sampleRate, frames: this.frames, hop: this.hop, voice,
          gestures: plan.gestures, firstF0: midiToHz(plan.firstMidi), envelopeOnly: !!offline }, voice);
        const envelope = new Array<number>(Math.ceil(this.frames / this.hop)).fill(0);
        this.singers[i].nativeEnvelope = envelope;
        this.vocalTiming.envelopes[voice.id] = envelope;
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
      this.gains = pieceGains(piece, MIX_LEVEL);
      if (!offline) {
        post({ type: "setup", ends, gains: this.gains, ports }, ports);
        post({ type: "voiceLevels", values: this.levels() });
      }
    } catch (error) {
      this.dispose();
      for (const port of ports) port.close();
      throw error;
    }
  }

  levels() {
    return this.piece.tracks.map(t => voiceLevel(t.id));
  }

  private onError(voice: MoppetVoice | null, message: string): void {
    if (this.disposed) return;
    const error = new Error(`${voice?.name ?? "Accompaniment"}: ${message}`);
    if (this.offline) this.offline.error(error);
    else if (session === this) fail(error.message);
  }

  private onSinger(m: FromSinger): void {
    if (this.disposed || (!this.offline && session !== this)) return;
    const s = this.singers[m.voiceIndex];
    switch (m.type) {
      case "progress":
        s.rendered = m.rendered;
        s.rtf = m.rtf;
        if (this.offline?.progress) {
          const fraction = this.singers.reduce((frames, singer) => frames + singer.rendered, 0) / (this.singers.length * this.frames);
          this.offline.progress(fraction);
        } else if (!this.offline) this.onProgress();
        break;
      case "telemetry":
        if (!this.offline && !s.tele) {
          s.recordSize = m.recordSize;
          const head = m.records;
          s.nArtic = head[TELE.nArtic];
          s.nPh = head[TELE.nPh];
          s.nOr = head[TELE.nOr];
          s.nScope = head[TELE.nScope];
          s.tele = new Float32Array(m.recordSize * Math.ceil(this.frames / this.hop));
        }
        s.tele?.set(m.records, m.from * m.recordSize);
        if (s.nativeEnvelope) {
          for (let i = 0; i < m.records.length / m.recordSize; i++) {
            s.nativeEnvelope[m.from + i] = m.records[i * m.recordSize + TELE.outRms];
          }
        }
        break;
      case "error":
        this.onError(s.voice, m.message);
        break;
      case "stem":
        if (s.nativeEnvelope && m.envelope) {
          for (let i = 0; i < m.envelope.length; i++) s.nativeEnvelope[i] = m.envelope[i];
        }
        this.offline?.stem(m.voiceIndex, m.pcm, this.singers.length);
        break;
    }
  }

  private onProgress(): void {
    const total = this.singers.length * this.frames;
    const done = this.singers.reduce((a, s) => a + s.rendered, 0);
    const progress = done / total;
    const rtf = Math.max(0, ...this.singers.filter((s) => s.voice).map((s) => s.rtf));
    set({ progress, rtf });

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
    const level = s?.voice && vocalLevelAt(this.vocalTiming, s.voice.id, hop * this.hop / this.sampleRate);
    if (typeof level === "number") {
      if (level === 0) return SILENT_POSE;
      return {...SILENT_POSE,singing:true,open:level,jaw:level,level,voicing:1,pressure:level,viseme:level>.35?4:1};
    }
    if (!s?.tele || !s.recordSize) return SILENT_POSE;
    const at = hop * s.recordSize;
    if (hop < 0 || at + s.recordSize > s.tele.length) return SILENT_POSE;
    return poseFromRecord(s.tele, at);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.singers) {
      s.worker.terminate();
      workersAlive--;
    }
  }
}

let resumeAt = 0;
let playFromFrame = 0;

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
  const ctx = audio.ctx;
  if (!pos || !ctx) return playFromFrame;
  if (!pos.playing) return pos.frame;
  const stamp = ctx.getOutputTimestamp?.();
  const outputTime = stamp?.contextTime && stamp.performanceTime
    ? stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000
    : ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
  const frame = pos.frame + outputTime * ctx.sampleRate - pos.contextFrame;
  return Math.max(playFromFrame, Math.min(frame, pos.frame + 2048));
}

function tick(): void {
  const s = session;
  if (!s) return;
  const st = get().status;
  if (st === "playing" || st === "paused") {
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

function beginPlaying(frame: number): void {
  if (!session) return;
  if (audio.ctx?.state !== "running") {
    resumeAt = frame;
    set({
      status: "paused",
      time: frame / session.sampleRate,
      howPlaying: "live",
      message: "Audio was interrupted. Press Play to resume.",
    });
    return;
  }
  playFromFrame = frame;
  pos = null;
  generation++;
  post({ type: "solo", voice: Math.max(0, session.indexOf(soloId)) });
  post({ type: "soloMix", voice: soloMixIndex() });
  post({ type: "play", generation, frame });
  for (const s of session.singers) {
    s.worker.postMessage({ type: "seek", frame, generation } satisfies ToSinger);
  }
  startTick();
  set({ status: "buffering", time: frame / session.sampleRate, howPlaying: "live", message: "Waiting for the singers…", progress: get().progress });
}

function finishPlaying(frame: number): void {
  const loop = get().loopRange;
  if (loop && session) {
    const startFrame = Math.max(0, Math.min(session.frames, Math.round(loop.startSec * session.sampleRate)));
    resumeAt = startFrame;
    set({ time: startFrame / session.sampleRate });
    beginPlaying(startFrame);
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
  cancelExport();
  playToken++;
  disposeSession();
  piece = next;
  set({ status: "idle", time: 0, duration: 0, progress: 0, message: "", howPlaying: null, underruns: 0, rtf: 0, peak: 0, loopRange: null });
}

let piece: Piece | null = null;
let voicesProvider: () => MoppetVoice[] = () => [];
export function setVoicesProvider(fn: () => MoppetVoice[]): void {
  voicesProvider = fn;
}

function disposeSession(): void {
  stopVisuals();
  post({ type: "clear", generation: ++generation });
  session?.dispose();
  session = null;
  pos = null;
  set({ vocalTiming: undefined });
}

/** Everything ready to start? (a session exists, with no edits waiting for a re-render) */
function sessionFresh(): boolean {
  return !!session && !session.singers.some((s) => s.edited);
}

export async function play(start: () => Promise<void>, startSec = 0): Promise<void> {
  const st = get().status;
  if (!piece || st === "preparing" || st === "rendering" || st === "buffering") return;
  if (st === "playing") return pause();
  if (st === "paused" && session) {
    const pausedSession = session;
    try {
      await start();
    } catch (error) {
      if (session === pausedSession && get().status === "paused")
        set({ message: `Could not resume audio: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (session === pausedSession && get().status === "paused") resume();
    return;
  }
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
  try {
    await ensureMixer(audio.ctx);
  } catch (error) {
    if (token === playToken) set({ status: "idle", message: `Could not start the mixer: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  if (token !== playToken) return;
  if (!sessionFresh() || session!.sampleRate !== audio.ctx.sampleRate) {
    disposeSession();
    try {
      session = new Session(piece, voicesProvider(), audio.ctx.sampleRate);
    } catch (error) {
      if (token !== playToken) return;
      session = null;
      set({ status: "idle", message: `Could not prepare the vocal: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    set({ duration: session.frames / session.sampleRate, progress: 0, vocalTiming: session.vocalTiming });
  }
  const active = session!;
  beginPlaying(Math.min(active.frames, Math.round(get().time * active.sampleRate)));
}
let playToken = 0;

export function pause(): void {
  if (get().status !== "playing" && get().status !== "buffering") return;
  const s = session;
  const time = get().time;
  if (s) resumeAt = Math.floor(get().status === "buffering" ? time * s.sampleRate : audibleFrame());
  post({ type: "pause" });
  set({ status: "paused", message: "Paused.", time: s ? resumeAt / s.sampleRate : time });
}

function resume(): void {
  beginPlaying(resumeAt);
}

/** Back to the top, keeping what was rendered. */
export function stop(): void {
  playToken++;
  post({ type: "pause" });
  stopVisuals();
  set({ status: "idle", time: 0, message: "", howPlaying: null, loopRange: null });
}

/** Abandon a render in progress. */
export function cancel(): void {
  cancelExport();
  playToken++;
  disposeSession();
  set({ status: "idle", time: 0, progress: 0, message: "Rendering cancelled. Nothing is playing.", howPlaying: null, loopRange: null });
}

export function seek(seconds: number): void {
  if (!piece) return;
  const time = Math.max(0, Math.min(pieceSeconds(piece), seconds));
  if (!session || get().status === "preparing") {
    set({ time });
    return;
  }
  const frame = Math.min(session.frames, Math.round(time * session.sampleRate));
  resumeAt = frame;
  set({ time: frame / session.sampleRate });
  const st = get().status;
  if (st === "playing" || st === "buffering") {
    // forward of the render head the singers race there; the shared timeline waits for them all
    beginPlaying(frame);
  }
}

/** Solo one Moppet in the main mix (or restore the full choir). */
export function setSoloMix(on: boolean): void {
  cancelExport();
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
    if (st === "paused") await play(start, range.startSec);
    return;
  }
  await play(start, range.startSec);
}

/** Choose which singer the instruments inspect. */
export function inspect(id: string): void {
  if (soloId !== id && get().soloMix) cancelExport();
  soloId = id;
  if (session) {
    post({ type: "solo", voice: Math.max(0, session.indexOf(id)) });
    post({ type: "soloMix", voice: soloMixIndex() });
  }
  tick();
}

/** A control moved: it reaches the singer's own engine at its render head. */
export function editVoice(id: string, edit: { source?: Partial<MoppetSource>; artic?: MoppetArtic; rerender?: boolean }): void {
  cancelExport();
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

interface WavOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  only?: number | string;
  soloId?: string;
}

interface WavRender {
  bytes: ArrayBuffer;
  peak: number;
  nonFinite: number;
  durationSec: number;
  vocalTiming: VocalTiming;
}

/** Render a score revision without opening the audio device or changing transport. */
export async function renderWav(piece: Piece, voices: MoppetVoice[], options: WavOptions = {}): Promise<WavRender> {
  const { signal, soloId, onProgress } = options;
  signal?.throwIfAborted();
  const score = structuredClone(piece);
  const cast = structuredClone(voices);
  const levels = score.tracks.map(({ id }) => voiceLevel(id));
  const band = bandEnabled();
  const only = typeof options.only === "string" ? score.tracks.findIndex(({ id }) => id === options.only) : options.only;
  const solo = soloId === undefined ? -1 : score.tracks.findIndex(({ id }) => id === soloId);
  if (only !== undefined && (!Number.isInteger(only) || !score.tracks[only])) throw new Error("That voice has no part in this score.");

  return new Promise((resolve, reject) => {
    let job: Session | undefined;
    const stems: Float32Array[] = [];
    let remaining: number | undefined;
    let finished = false;
    const cleanup = () => {
      finished = true;
      signal?.removeEventListener("abort", abort);
      job?.dispose();
    };
    const error = (cause: unknown) => {
      if (finished) return;
      cleanup();
      reject(cause);
    };
    const abort = () => error(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    void g2p.load().then(() => {
      if (finished) return;
      if (band !== bandEnabled()) throw new Error("Accompaniment changed. Prepare the mix again.");
      job = new Session(score, cast, 48000, {
        error,
        progress: onProgress && ((fraction) => {
          if (finished || fraction >= 1) return;
          try {
            onProgress(fraction);
          } catch (cause) {
            error(cause);
          }
        }),
        stem: (index, pcm, total) => {
          if (!job || finished || stems[index]) return;
          if (pcm.length !== job.frames) return error(new Error("A rendered stem is incomplete."));
          stems[index] = pcm;
          remaining ??= total;
          if (--remaining > 0) return;
          try {
            const selected = only ?? solo;
            const gains = job.gains.map((gain, index) => selected < 0 || index === selected ? gain : 0);
            const mix = mixStems(stems, gains, job.frames, levels);
            if (mix.nonFinite) throw new Error("CHIMERA produced invalid audio.");
            const stereo = only === undefined ? mix.samples : undefined;
            const bytes = wavBytes(mix.samples, job.sampleRate, stereo);
            const vocalTiming = job.vocalTiming;
            for (const [index, track] of score.tracks.entries()) {
              if (!gains[index] || levels[index] === 0) delete vocalTiming.envelopes[track.id];
            }
            const durationSec = job.frames / job.sampleRate;
            onProgress?.(1);
            if (finished) return;
            cleanup();
            resolve({ bytes, peak: mix.peak, nonFinite: mix.nonFinite, durationSec, vocalTiming });
          } catch (cause) {
            error(cause);
          }
        },
      });
      if (!job.singers.length) throw new Error("The score has no renderable parts.");
    }).catch(error);
  });
}

let exportRequest: AbortController | undefined;
function cancelExport(): void {
  exportRequest?.abort();
}

/** Download the current full mix, or the requested singer's stem. */
export async function exportWav(_start: () => Promise<void>, only?: number | string, signal?: AbortSignal): Promise<WavRender> {
  if (!piece) throw new Error("No score is selected.");
  cancelExport();
  const request = exportRequest = new AbortController();
  try {
    return await renderWav(piece, voicesProvider(), {
      only,
      soloId: get().soloMix ? soloId : undefined,
      signal: signal ? AbortSignal.any([request.signal, signal]) : request.signal,
    });
  } finally {
    if (exportRequest === request) exportRequest = undefined;
  }
}

export function ensembleDebug() {
  return { pos, workersAlive, sessionsMade, hasSession: !!session, singers: session?.singers.map((s) => ({ id: s.voice?.id ?? "pluck", rendered: s.rendered, frames: s.frames, rtf: s.rtf })) ?? [] };
}

/** Called when leaving Moppet mode: nothing keeps playing or running. */
export function leaveEnsemble(): void {
  cancelExport();
  playToken++;
  disposeSession();
  set({ status: "idle", time: 0, progress: 0, message: "", howPlaying: null });
}
