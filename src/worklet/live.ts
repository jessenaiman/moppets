/**
 * The live Moppet: one Moppet voice (CHIMERA's engine at the Moppet's body, size and posture,
 * through our wasm's moppet_* handle) played as you go, for puppeteer mode and the keys.
 *
 *  - `mouth`: articulator targets now (puppeteer mode: the knobs and pads move the mouth)
 *  - `source`: pitch, breath and the like now
 *  - `gate`: the breath on (1) or off (0)
 *  - `schedule`: planned gestures (the keys: a syllable's note-on), from now
 *  - `release`: end the gestures with this tag (a key let go)
 *
 * It sends back the mouth, level and voicing at ~60 Hz, so the puppet's face follows. Engine-free
 * at import: the wasm module arrives in the processor options.
 */
import { writeGestures } from "@chimera/wasm/wire.ts";
import type { Gesture } from "@chimera/wasm/types.ts";
import { ARTIC_KEYS, SOURCE_KEYS, TELE_HEADER } from "../choir/singerCore.ts";

declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const sampleRate: number;

export type ToLive =
  | { type: "dispose" }
  | { type: "voice"; body: { female: number; child: number }; size: number; artic: Record<string, number>; source: Record<string, number> }
  | { type: "mouth"; values: Record<string, number> }
  | { type: "source"; values: Record<string, number> }
  | { type: "gate"; level: number }
  | { type: "schedule"; gestures: Gesture[] }
  | { type: "release"; tag: number };
export interface FromLive {
  type: "pose";
  /** output RMS */
  rms: number;
  voicing: number;
  f0: number;
  /** lip aperture, protrusion, width, labiodental, jaw, and intra-oral pressure (cmH2O) */
  lipAp: number;
  lipProt: number;
  lipWidth: number;
  labiodental: number;
  mouthPressure: number;
  jaw: number;
  pLung: number;
}

type Fn = (...a: number[]) => number;
type X = { memory: WebAssembly.Memory } & Record<string, Fn>;
const POST_EVERY = 6; // quanta between poses (~16 ms)

class LiveMoppet extends AudioWorkletProcessor {
  private readonly x: X;
  private readonly h: number;
  private quanta = 0;
  private disposed = false;
  constructor(o: { processorOptions: { module: WebAssembly.Module } }) {
    super();
    this.x = new WebAssembly.Instance(o.processorOptions.module, {}).exports as unknown as X;
    this.h = this.x.moppet_new(sampleRate);
    this.port.onmessage = (e: MessageEvent<ToLive>) => this.on(e.data);
  }

  private patch(keys: readonly string[], values: Record<string, number>): void {
    const v = new Float64Array(this.x.memory.buffer, this.x.moppet_values(this.h), 32).fill(NaN);
    for (const [k, n] of Object.entries(values)) {
      const i = keys.indexOf(k);
      if (i >= 0 && Number.isFinite(n)) v[i] = n;
    }
  }

  private on(m: ToLive): void {
    const { x, h } = this;
    switch (m.type) {
      case "dispose":
        x.moppet_free(h);
        this.disposed = true;
        this.port.onmessage = null;
        break;
      case "voice":
        x.moppet_set_body(h, m.body.female, m.body.child, m.size);
        this.patch(ARTIC_KEYS, m.artic);
        x.moppet_set_artic(h, 2);
        this.patch(SOURCE_KEYS, { ...m.source, voiced: 1 });
        x.moppet_set_source(h);
        break;
      case "mouth":
        this.patch(ARTIC_KEYS, m.values);
        x.moppet_set_artic(h, 2);
        break;
      case "source":
        this.patch(SOURCE_KEYS, m.values);
        x.moppet_set_source(h);
        break;
      case "gate":
        x.moppet_set_gate(h, m.level);
        break;
      case "schedule": {
        const n = writeGestures(x.memory.buffer, x.moppet_records(h), m.gestures, 512);
        x.moppet_schedule(h, n, 0, 0);
        break;
      }
      case "release":
        x.moppet_release(h, m.tag);
        break;
    }
  }

  process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.disposed) return false;
    const out = outputs[0]?.[0];
    if (!out) return true;
    const p = this.x.moppet_render(this.h, out.length);
    out.set(new Float32Array(this.x.memory.buffer, p, out.length));
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    if (++this.quanta % POST_EVERY === 0) {
      const ptr = this.x.moppet_telemetry(this.h);
      const head = new Float64Array(this.x.memory.buffer, ptr, TELE_HEADER);
      const nArtic = Math.round(head[11] || 0);
      const nPh = Math.round(head[12] || 0);
      const nOr = Math.round(head[13] || 0);
      const need = TELE_HEADER + Math.max(12, nArtic) + 2 * (nPh + nOr);
      const t = new Float64Array(this.x.memory.buffer, ptr, need);
      const a = TELE_HEADER; // the articulators, in ARTIC_KEYS order
      let mouthPressure = 0;
      if (nArtic > 0 && nOr >= 3) {
        const pIdx = a + nArtic + 2 * (nPh + nOr) - 3;
        if (pIdx < t.length) mouthPressure = (t[pIdx] || 0) / 980.665;
      }
      this.port.postMessage({
        type: "pose",
        rms: t[6],
        voicing: t[4],
        f0: t[3],
        pLung: t[5],
        jaw: t[a],
        lipAp: t[a + 7],
        lipProt: t[a + 8],
        lipWidth: t[a + 9],
        labiodental: t[a + 10],
        mouthPressure,
      } satisfies FromLive);
    }
    return true;
  }
}

registerProcessor("live-moppet", LiveMoppet);
