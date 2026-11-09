/**
 * One Moppet's engine instance, independent of where it runs (a Web Worker in the app, bun in
 * tests). Renders forward, keeps the stem, and records the engine's telemetry block every `hop`
 * frames so the puppets and instrument views can follow what was actually rendered.
 */
import { writeGestures, writeSteps, fromUtf8, utf8 } from "../wasm/wire.ts";
import type { BeatStep } from "../wasm/types.ts";
import type { Gesture } from "../wasm/types.ts";
import { CHARACTER_TAG, characterGesture, shapeGesture } from "./character.ts";
import type { MoppetArtic, MoppetSource, MoppetVoice } from "./voices.ts";

type Fn = (...a: number[]) => number;
export type EngineExports = { memory: WebAssembly.Memory } & Record<string, Fn>;

const ARTIC_KEYS = ["jaw", "tbX", "tbY", "ttX", "ttY", "ttCurl", "root", "lipAp", "lipProt", "lipWidth", "labiodental", "velum", "larynx", "epilarynx", "ventricular", "lateral", "dorsum"];
const SOURCE_KEYS = ["f0", "glide", "pressure", "breathiness", "tension", "fry", "roughness", "vibratoDepth", "vibratoRate", "drift", "voiced", "brightness"];
export const TELE_HEADER = 16;
/** indices into a telemetry record */
export const TELE = { f0: 3, voicing: 4, outRms: 6, gate: 9, clock: 10, nArtic: 11, nPh: 12, nOr: 13, nScope: 14 } as const;
/** engine state update rate for the views: every hop frames at ~60 Hz */
export const hopFor = (sampleRate: number) => Math.round(sampleRate / 60);
const MAX_RECORDS = 4000;
/**
 * Gestures reach the engine this far ahead of the clock. Blending walks every scheduled gesture
 * each control step, so handing over a whole round at once cost more than real time.
 */
const SCHEDULE_AHEAD = 0.5;

export interface SingerConfig {
  sampleRate: number;
  frames: number;
  hop: number;
  voice: MoppetVoice;
  /** the score's gestures, before this voice colours them */
  gestures: Gesture[];
  firstF0: number;
  /** let the velum recipe colour the vowels (solo-voiced pieces) */
  nasal?: boolean;
}

/** Ring-out after a singer's last gesture before the engine may be parked (and how soon before an onset it wakes). */
const REST_TAIL = 0.8, REST_LEAD = 0.25;
const REST_MIN = 1.5;

/** Merged spans when a singer sounds, not counting the held character posture. Rests shorter than REST_MIN stay rendered. */
function busyIntervals(gestures: Gesture[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const g of gestures) {
    if (g.label === "character") continue;
    const a = g.t0 - g.rampIn - REST_LEAD, b = g.t1 + g.rampOut + (g.releaseHold ?? 0) + REST_TAIL;
    const last = spans[spans.length - 1];
    if (last && a <= last[1] + REST_MIN) last[1] = Math.max(last[1], b);
    else spans.push([a, b]);
  }
  return spans;
}

export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

export class SingerCore {
  private readonly h: number;
  readonly stem: Float32Array;
  rendered = 0;
  /** one record per hop; allocated at the first snapshot (its size depends on the body) */
  tele: Float32Array | null = null;
  recordSize = 0;
  telePosted = 0;
  private charTag = CHARACTER_TAG;
  private voice: MoppetVoice;
  /** gestures not yet given to the engine, soonest first */
  private pending: Gesture[];
  private nextPending = 0;
  /** intervals when this singer is making sound (gesture onsets to ring-out), for skipping long rests */
  private busy: [number, number][];
  private busyAt = 0;

  constructor(private readonly x: EngineExports, private readonly cfg: SingerConfig) {
    const h = (this.h = x.engine_new(cfg.sampleRate));
    this.voice = cfg.voice;
    this.stem = new Float32Array(cfg.frames);
    x.engine_set_body(h, cfg.voice.body.female, cfg.voice.body.child);
    this.patch(ARTIC_KEYS, { ...cfg.voice.artic } as Record<string, number>);
    x.engine_set_artic(h, 2);
    this.setSource(cfg.voice.source);
    // the pitch and breath the planner's gestures start from; every sung note sets its own f0
    this.patch(SOURCE_KEYS, { f0: cfg.firstF0, voiced: 1 });
    x.engine_set_source(h);
    this.pending = [characterGesture(cfg.voice, 0, cfg.frames / cfg.sampleRate, CHARACTER_TAG), ...cfg.gestures].sort((a, b) => a.t0 - a.rampIn - (b.t0 - b.rampIn));
    this.busy = busyIntervals(this.pending);
  }

  private values(): Float64Array {
    return new Float64Array(this.x.memory.buffer, this.x.engine_values(this.h), 32).fill(NaN);
  }

  private patch(keys: string[], values: Partial<Record<string, number>>): void {
    const v = this.values();
    for (const [k, val] of Object.entries(values)) {
      const i = keys.indexOf(k);
      if (i >= 0 && typeof val === "number") v[i] = val;
    }
  }

  /** Hand over gestures now due inside the schedule window. Times stay absolute on the timeline. */
  private drip(): void {
    const clock = this.timeline;
    const from = this.nextPending;
    while (this.nextPending < this.pending.length && this.pending[this.nextPending].t0 - this.pending[this.nextPending].rampIn < clock + SCHEDULE_AHEAD && this.nextPending - from < MAX_RECORDS) this.nextPending++;
    const n = this.nextPending - from;
    if (n === 0) return;
    // engine_schedule places times relative to the voice clock
    const part = this.pending.slice(from, this.nextPending).map((raw) => {
      // the character posture is a live gesture of its own (setCharacter)
      const g = raw.label === "character" ? raw : shapeGesture(raw, this.voice, !!this.cfg.nasal);
      return { ...g, t0: g.t0 - clock, t1: g.t1 - clock };
    });
    const written = writeGestures(this.x.memory.buffer, this.x.engine_records(this.h), part, MAX_RECORDS);
    this.x.engine_schedule(this.h, written, 0, from === 0 ? 1 : 0);
  }

  /** Breathiness, roughness and friends: take effect at the render head. */
  setSource(s: Partial<MoppetSource>): void {
    this.patch(SOURCE_KEYS, s as Record<string, number>);
    this.x.engine_set_source(this.h);
  }

  /** Swap the held larynx/epilarynx/false-fold posture at the render head (the old one ramps out). */
  setCharacter(artic: MoppetArtic): void {
    const now = this.x.engine_clock(this.h);
    const old = this.charTag;
    this.charTag = old + 1;
    this.voice = { ...this.voice, artic };
    // relative to the voice clock, which engine_schedule adds
    const g = characterGesture(this.voice, 0, this.cfg.frames / this.cfg.sampleRate - now, this.charTag);
    const n = writeGestures(this.x.memory.buffer, this.x.engine_records(this.h), [g], 1);
    this.x.engine_schedule(this.h, n, 0, 0);
    this.x.engine_release(this.h, old);
  }

  private get timeline(): number {
    return this.rendered / this.cfg.sampleRate;
  }

  /** In a long rest, between phrases: the airway has decayed, and rendering its silence costs a lot. */
  private resting(): boolean {
    const t = this.timeline;
    while (this.busyAt < this.busy.length && this.busy[this.busyAt][1] < t) this.busyAt++;
    const next = this.busy[this.busyAt];
    return !next || t < next[0];
  }

  /** Render the next chunk (at most one hop) into the stem and record its telemetry. Returns frames rendered. */
  step(): number {
    const { hop, frames } = this.cfg;
    const n = Math.min(hop, frames - this.rendered);
    if (n <= 0) return 0;
    const resting = this.resting();
    // gestures are placed relative to the voice clock, and it stands still while the engine rests,
    // so they are handed over only once it runs again (or the entrance would arrive that much late)
    if (!resting && this.nextPending < this.pending.length) this.drip();
    if (this.tele && resting) {
      // skip the engine: the stem stays exactly silent, and the views hold their last pose, not singing
      this.rendered += n;
      this.restRecord(this.rendered / hop - 1);
      return n;
    }
    const p = this.x.engine_render(this.h, n);
    this.stem.set(new Float32Array(this.x.memory.buffer, p, n), this.rendered);
    this.rendered += n;
    this.record(this.rendered / hop - 1);
    return n;
  }

  private record(index: number): void {
    if (index % 1) return; // the short final chunk carries no telemetry slot of its own
    const x = this.x, p = x.engine_telemetry(this.h);
    const head = new Float64Array(x.memory.buffer, p, TELE_HEADER);
    const nArtic = head[TELE.nArtic], nPh = head[TELE.nPh], nOr = head[TELE.nOr], nScope = head[TELE.nScope];
    const size = TELE_HEADER + nArtic + 3 * (nPh + nOr) + 2 * nScope;
    if (!this.tele) {
      this.recordSize = size;
      this.tele = new Float32Array(size * Math.ceil(this.cfg.frames / this.cfg.hop));
    }
    if (size !== this.recordSize) throw new Error(`telemetry layout changed: ${size} != ${this.recordSize}`);
    this.tele.set(new Float64Array(x.memory.buffer, p, size), index * size);
  }

  private restRecord(index: number): void {
    if (index % 1 || !this.tele) return;
    const r = this.recordSize, at = index * r;
    this.tele.copyWithin(at, at - r, at);
    this.tele[at + TELE.outRms] = 0;
    this.tele[at + TELE.voicing] = 0;
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
    // a creature's silent airway decays into denormals: skip the engine between calls
    if (this.cfg.creature && !this.calls.some((c) => this.rendered + n >= c.frame - hop && this.rendered < c.frame + 6 * sampleRate)) {
      this.rendered += n;
      return n;
    }
    const p = this.x.engine_render(this.h, n);
    this.stem.set(new Float32Array(this.x.memory.buffer, p, n), this.rendered);
    this.rendered += n;
    return n;
  }

  dispose(): void {
    this.x.engine_free(this.h);
  }
}
