/**
 * A Web Worker hosting one singer: its own wasm engine instance renders ahead of the shared
 * timeline. Audio goes straight to the mixer worklet over a MessagePort; telemetry goes to the
 * main thread in batches. Rendering yields between hops so controls and seeks land promptly.
 */
import { CueCore, SingerCore, type CueConfig, type EngineExports, type SingerConfig } from "./singerCore.ts";
import type { MoppetArtic, MoppetSource } from "./voices.ts";
import type { MixerIn } from "../worklet/mixerProtocol.ts";

export type ToSinger =
  | { type: "init"; module: WebAssembly.Module | null; port: MessagePort; voiceIndex: number; config: SingerConfig | null; cue?: CueConfig; pluck?: Float32Array; paced: boolean; lookahead: number }
  | { type: "pace"; paced: boolean }
  | { type: "seek"; frame: number; generation: number }
  | { type: "source"; values: Partial<MoppetSource> }
  | { type: "character"; artic: MoppetArtic }
  | { type: "stem" };

export type FromSinger =
  | { type: "progress"; voiceIndex: number; rendered: number; frames: number; rtf: number }
  | { type: "telemetry"; voiceIndex: number; recordSize: number; from: number; records: Float32Array }
  | { type: "stem"; voiceIndex: number; pcm: Float32Array }
  | { type: "error"; voiceIndex: number; message: string };

const scope = self as unknown as { postMessage(m: FromSinger, t?: Transferable[]): void; onmessage: ((e: MessageEvent<ToSinger>) => void) | null };

/** How much audio is sent to the mixer ahead of the playhead (the mixer's own queue). */
const SEND_AHEAD = 1.0;
const TELE_BATCH = 12; // hops per telemetry message (~200 ms at 60 Hz)

let core: SingerCore | CueCore | null = null;
let pluck: Float32Array | null = null;
let port: MessagePort;
let voiceIndex = 0;
let frames = 0;
let hop = 800;
let sampleRate = 48000;
let paced = true;
let lookahead = 0.3;
let generation = 0;
let playhead = 0;
let sent = 0;
let renderMs = 0;
let scheduled = false;
let lastProgress = 0;

function rendered(): number {
  return core ? core.rendered : frames;
}

function fail(err: unknown): void {
  scope.postMessage({ type: "error", voiceIndex, message: err instanceof Error ? err.message : String(err) });
}

function postTelemetry(force: boolean): void {
  if (!core || !core.tele) return;
  const done = Math.floor(core.rendered / hop);
  if (!force && done - core.telePosted < TELE_BATCH) return;
  if (done <= core.telePosted) return;
  const from = core.telePosted;
  const records = core.tele.slice(from * core.recordSize, done * core.recordSize);
  core.telePosted = done;
  scope.postMessage({ type: "telemetry", voiceIndex, recordSize: core.recordSize, from, records }, [records.buffer]);
}

function postProgress(force: boolean): void {
  const now = performance.now();
  if (!force && now - lastProgress < 120) return;
  lastProgress = now;
  const r = rendered();
  scope.postMessage({ type: "progress", voiceIndex, rendered: r, frames, rtf: r > 0 ? renderMs / 1000 / (r / sampleRate) : 0 });
}

/** Send rendered audio to the mixer up to the send window (or to the end). */
function pump(): void {
  const stem = core ? core.stem : pluck;
  if (!stem) return;
  const limit = Math.min(rendered(), playhead + Math.round(SEND_AHEAD * sampleRate));
  // audio-thread messages are not free: send in blocks, never a hop at a time
  while (limit - sent >= (limit >= frames ? 1 : 2048) && sent < limit) {
    const n = Math.min(4096, limit - sent);
    const pcm = stem.slice(sent, sent + n);
    const m: MixerIn = { type: "chunk", voice: voiceIndex, generation, frame: sent, pcm };
    port.postMessage(m, [pcm.buffer]);
    sent += n;
  }
}

function work(): void {
  scheduled = false;
  try {
    if (core && core.rendered < frames) {
      const target = paced ? Math.min(frames, playhead + Math.round(lookahead * sampleRate)) : frames;
      const t0 = performance.now();
      let did = 0;
      // a slice of a few hops per turn keeps seeks and control messages prompt
      for (let i = 0; i < 6 && core.rendered < target; i++) did += core.step();
      if (did) renderMs += performance.now() - t0;
      postTelemetry(core.rendered >= frames);
    }
    pump();
    postProgress(rendered() >= frames);
    if (core && core.rendered < frames && (!paced || core.rendered < playhead + Math.round(lookahead * sampleRate))) schedule();
  } catch (err) {
    fail(err);
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(work, 0);
}

scope.onmessage = (e: MessageEvent<ToSinger>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case "init": {
        port = m.port;
        voiceIndex = m.voiceIndex;
        paced = m.paced;
        lookahead = m.lookahead;
        port.onmessage = (ev: MessageEvent<{ playhead: number }>) => {
          playhead = ev.data.playhead;
          schedule();
        };
        if (m.config) {
          const x = new WebAssembly.Instance(m.module!, {}).exports as unknown as EngineExports;
          core = new SingerCore(x, m.config);
          frames = m.config.frames;
          hop = m.config.hop;
          sampleRate = m.config.sampleRate;
        } else if (m.cue) {
          const x = new WebAssembly.Instance(m.module!, {}).exports as unknown as EngineExports;
          core = new CueCore(x, m.cue);
          frames = m.cue.frames;
          hop = m.cue.hop;
          sampleRate = m.cue.sampleRate;
        } else {
          pluck = m.pluck!;
          frames = pluck.length;
        }
        schedule();
        break;
      }
      case "pace":
        paced = m.paced;
        schedule();
        break;
      case "seek":
        generation = m.generation;
        playhead = m.frame;
        sent = m.frame;
        schedule();
        break;
      case "source":
        if (core instanceof SingerCore) core.setSource(m.values);
        break;
      case "character":
        if (core instanceof SingerCore) core.setCharacter(m.artic);
        break;
      case "stem": {
        const stem = core ? core.stem : pluck!;
        const pcm = stem.slice(0, rendered());
        scope.postMessage({ type: "stem", voiceIndex, pcm }, [pcm.buffer]);
        break;
      }
    }
  } catch (err) {
    fail(err);
  }
};
