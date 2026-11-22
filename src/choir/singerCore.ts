/**
 * One Moppet's engine instance, independent of where it runs (a Web Worker in the app, bun in
 * tests). Renders forward, keeps the stem, and records the engine's telemetry block every `hop`
 * frames so the puppets and instrument views can follow what was actually rendered.
 */
import { CONTROL_KEYS, writeGestures, writeSteps, fromUtf8, utf8 } from "@chimera/wasm/wire.ts";
import type { BeatStep } from "@chimera/wasm/types.ts";
import type { Gesture } from "@chimera/wasm/types.ts";
import { TELE_HEADER, telemetryLength } from "@chimera/worklet/telemetry.ts";
export { TELE_HEADER } from "@chimera/worklet/telemetry.ts";
import type { MoppetArtic, MoppetSource, MoppetVoice } from "./voices.ts";

type Fn = (...a: number[]) => number;
export type EngineExports = { memory: WebAssembly.Memory } & Record<string, Fn>;

export const ARTIC_KEYS: readonly string[] = CONTROL_KEYS.slice(0, 17);
export const SOURCE_KEYS = ["f0", "glide", "pressure", "breathiness", "tension", "fry", "roughness", "vibratoDepth", "vibratoRate", "drift", "voiced", "brightness"];
/** indices into a telemetry record */
export const TELE = { f0: 3, voicing: 4, pLung: 5, outRms: 6, gate: 9, clock: 10, nArtic: 11, nPh: 12, nOr: 13, nScope: 14 } as const;
/** engine state update rate for the views: every hop frames at ~60 Hz */
export const hopFor = (sampleRate: number) => Math.round(sampleRate / 60);
// Pinned CHIMERA limits documented in chimera/docs/rust-engine.md.
const MAX_SCHEDULE = 4000;
const SCORE_CAPACITY = 16384;

export interface SingerConfig {
  sampleRate: number;
  frames: number;
  hop: number;
  voice: MoppetVoice;
  gestures: Gesture[];
  firstF0: number;
}

const onset = (g: Gesture) => g.t0 - g.rampIn;
const releaseEnd = (g: Gesture) => g.t1 + g.rampOut + (g.releaseHold ?? 0);

export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Render in the same quanta as the upstream worklet. A telemetry hop can span several quanta. */
function renderBlock(x: EngineExports, handle: number, out: Float32Array, offset: number, frames: number): void {
  for (let i = 0; i < frames; i += 128) {
    const n = Math.min(128, frames - i);
    const p = x.engine_render(handle, n);
    out.set(new Float32Array(x.memory.buffer, p, n), offset + i);
  }
}

export class SingerCore {
  private readonly h: number;
  readonly stem: Float32Array;
  rendered = 0;
  /** one record per hop; allocated at the first snapshot (its size depends on the body) */
  tele: Float32Array | null = null;
  recordSize = 0;
  telePosted = 0;
  private readonly overflow: Gesture[];
  private nextGesture = 0;
  private scheduledEnds: number[] = [];

  constructor(private readonly x: EngineExports, private readonly cfg: SingerConfig) {
    const h = (this.h = x.engine_new(cfg.sampleRate));
    this.stem = new Float32Array(cfg.frames);
    x.engine_set_body(h, cfg.voice.body.female, cfg.voice.body.child);
    this.setCharacter(cfg.voice.artic);
    this.setSource(cfg.voice.source);
    // the pitch and breath the planner's gestures start from; every sung note sets its own f0
    this.patch(SOURCE_KEYS, { f0: cfg.firstF0, voiced: 1 });
    x.engine_set_source(h);
    if (cfg.gestures.length <= SCORE_CAPACITY) {
      this.overflow = [];
      this.schedule(cfg.gestures, x.engine_clock(h));
    } else {
      this.overflow = [...cfg.gestures].sort((a, b) => onset(a) - onset(b));
    }
  }

  private values(): Float64Array {
    return new Float64Array(this.x.memory.buffer, this.x.engine_values(this.h), 32).fill(NaN);
  }

  private patch(keys: readonly string[], values: Partial<Record<string, number>>): void {
    const v = this.values();
    for (const [k, val] of Object.entries(values)) {
      const i = keys.indexOf(k);
      if (i >= 0 && typeof val === "number") v[i] = val;
    }
  }

  private schedule(gestures: readonly Gesture[], clock: number): void {
    const { x, h } = this;
    for (let i = 0; i < gestures.length; i += MAX_SCHEDULE) {
      const batch = gestures.slice(i, i + MAX_SCHEDULE);
      const written = writeGestures(x.memory.buffer, x.engine_records(h), batch, MAX_SCHEDULE);
      // CHIMERA adds clock + lead. Cancel the offset to keep the written score's times.
      x.engine_schedule(h, written, -clock, 0);
    }
  }

  /** Scores above native capacity hand over only gestures needed by the next render hop. */
  private scheduleOverflow(frames: number): void {
    const clock = this.x.engine_clock(this.h);
    const until = clock + frames / this.cfg.sampleRate;
    let next = this.nextGesture;
    while (next < this.overflow.length && onset(this.overflow[next]) <= until) next++;
    if (next === this.nextGesture) return;

    // Budget for the native 100 ms prune interval, 200 ms retention and a control block.
    const prunedBefore = clock - 0.3 - 128 / this.cfg.sampleRate;
    this.scheduledEnds = this.scheduledEnds.filter(end => end > prunedBefore);
    if (this.scheduledEnds.length + next - this.nextGesture > SCORE_CAPACITY) {
      throw new Error(`${this.cfg.voice.name}'s score exceeds CHIMERA's gesture capacity near ${clock.toFixed(2)} s`);
    }
    const batch = this.overflow.slice(this.nextGesture, next);
    this.schedule(batch, clock);
    this.scheduledEnds.push(...batch.map(releaseEnd));
    this.nextGesture = next;
  }

  /** Breathiness, roughness and friends: take effect at the render head. */
  setSource(s: Partial<MoppetSource>): void {
    this.patch(SOURCE_KEYS, { ...s });
    this.x.engine_set_source(this.h);
  }

  /** Update the character's base articulators at the render head. */
  setCharacter(artic: MoppetArtic): void {
    this.patch(ARTIC_KEYS, { ...artic });
    this.x.engine_set_artic(this.h, 2);
  }

  /** Render the next chunk (at most one hop) into the stem and record its telemetry. Returns frames rendered. */
  step(): number {
    const { hop, frames } = this.cfg;
    const n = Math.min(hop, frames - this.rendered);
    if (n <= 0) return 0;
    if (this.nextGesture < this.overflow.length) this.scheduleOverflow(n);
    renderBlock(this.x, this.h, this.stem, this.rendered, n);
    this.rendered += n;
    this.record(this.rendered / hop - 1);
    return n;
  }

  private record(index: number): void {
    if (index % 1) return; // the short final chunk carries no telemetry slot of its own
    const x = this.x, p = x.engine_telemetry(this.h);
    const head = new Float64Array(x.memory.buffer, p, TELE_HEADER);
    const size = telemetryLength(head);
    if (!this.tele) {
      this.recordSize = size;
      this.tele = new Float32Array(size * Math.ceil(this.cfg.frames / this.cfg.hop));
    }
    if (size !== this.recordSize) throw new Error(`telemetry layout changed: ${size} != ${this.recordSize}`);
    this.tele.set(new Float64Array(x.memory.buffer, p, size), index * size);
  }

  dispose(): void {
    this.x.engine_free(this.h);
  }
}

export interface CueConfig {
  sampleRate: number;
  frames: number;
  hop: number;
  /** a beatbox stem */
  beat?: { steps: (BeatStep | null)[]; bpm: number; swing: number; startSeconds: number; ready: Record<string, number> };
  /** a creature stem: `calls` fire on the timeline */
  creature?: { id: string; calls: { id: string; seconds: number }[] };
}

/** A beatbox or creature stem on the shared timeline, rendered like a singer (one hop per step). */
export class CueCore {
  private readonly h: number;
  readonly stem: Float32Array;
  rendered = 0;
  readonly tele: Float32Array | null = null;
  recordSize = 0;
  telePosted = 0;
  private started = false;
  private readonly calls: { index: number; frame: number }[] = [];

  constructor(private readonly x: EngineExports, private readonly cfg: CueConfig) {
    const h = (this.h = x.engine_new(cfg.sampleRate));
    this.stem = new Float32Array(cfg.frames);
    if (cfg.beat) {
      const v = new Float64Array(x.memory.buffer, x.engine_values(h), 32).fill(NaN);
      for (const [k, val] of Object.entries(cfg.beat.ready)) {
        const i = ARTIC_KEYS.indexOf(k);
        if (i >= 0) v[i] = val;
      }
      x.engine_set_artic(h, 2);
    }
    if (cfg.creature) {
      const bytes = utf8(JSON.stringify({ id: cfg.creature.id, params: {} }));
      const p = x.chimera_alloc(bytes.length);
      new Uint8Array(x.memory.buffer, p, bytes.length).set(bytes);
      const status = x.engine_set_creature(h, p, bytes.length);
      x.chimera_free(p, bytes.length);
      const info = JSON.parse(fromUtf8(new Uint8Array(x.memory.buffer, x.chimera_result_ptr(), x.chimera_result_len()))) as { calls: string[]; error?: string };
      if (status !== 0) throw new Error(info.error ?? "creature");
      for (const c of cfg.creature.calls) {
        const index = info.calls.indexOf(c.id);
        if (index < 0) throw new Error(`no call ${c.id} in ${cfg.creature.id}`);
        this.calls.push({ index, frame: Math.round(c.seconds * cfg.sampleRate) });
      }
    }
  }

  step(): number {
    const { hop, frames, sampleRate, beat } = this.cfg;
    const n = Math.min(hop, frames - this.rendered);
    if (n <= 0) return 0;
    if (beat && !this.started && this.rendered >= beat.startSeconds * sampleRate) {
      this.started = true;
      const c = writeSteps(this.x.memory.buffer, this.x.engine_records(this.h), beat.steps);
      this.x.engine_set_beat(this.h, 1, c, beat.bpm, beat.swing, 1);
    }
    for (const c of this.calls) if (c.frame >= this.rendered && c.frame < this.rendered + n) this.x.engine_play_call(this.h, c.index, NaN, NaN);
    renderBlock(this.x, this.h, this.stem, this.rendered, n);
    this.rendered += n;
    return n;
  }

  dispose(): void {
    this.x.engine_free(this.h);
  }
}
