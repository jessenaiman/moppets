/**
 * The live Moppet: one Moppet voice (CHIMERA's engine at the Moppet's body and posture) played as you go, for puppeteer mode and the keys.
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
import { ARTIC_KEYS, SOURCE_KEYS, TELE, TELE_HEADER } from "../choir/singerCore.ts";

declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const sampleRate: number;

export type ToLive =
  | { type: "voice"; body: { female: number; child: number }; artic: Record<string, number>; source: Record<string, number> }
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
  /** lip aperture and protrusion, jaw (cm): the face's mouth */
  lipAp: number;
  lipProt: number;
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
  private body = { female: 0, child: 0 };
  constructor(o: { processorOptions: { module: WebAssembly.Module } }) {
    super();
    this.x = new WebAssembly.Instance(o.processorOptions.module, {}).exports as unknown as X;
    this.h = this.x.engine_new(sampleRate);
    this.port.onmessage = (e: MessageEvent<ToLive>) => this.on(e.data);
  }

  private patch(keys: readonly string[], values: Record<string, number>): void {
    const v = new Float64Array(this.x.memory.buffer, this.x.engine_values(this.h), 32).fill(NaN);
    for (const [k, n] of Object.entries(values)) {
      const i = keys.indexOf(k);
      if (i >= 0 && Number.isFinite(n)) v[i] = n;
    }
  }

  private on(m: ToLive): void {
    const { x, h } = this;
    switch (m.type) {
      case "voice":
        if (m.body.female !== this.body.female || m.body.child !== this.body.child) {
          x.engine_set_body(h, m.body.female, m.body.child);
          this.body = m.body;
        }
        this.patch(ARTIC_KEYS, m.artic);
        x.engine_set_artic(h, 2);
        this.patch(SOURCE_KEYS, { ...m.source, voiced: 1 });
        x.engine_set_source(h);
        break;
      case "mouth":
        this.patch(ARTIC_KEYS, m.values);
        x.engine_set_artic(h, 2);
        break;
      case "source":
        this.patch(SOURCE_KEYS, m.values);
        x.engine_set_source(h);
        break;
      case "gate":
        x.engine_set_gate(h, m.level);
        break;
      case "schedule": {
        const n = writeGestures(x.memory.buffer, x.engine_records(h), m.gestures, 512);
        x.engine_schedule(h, n, 0.006, 0);
        break;
      }
      case "release":
        x.engine_release(h, m.tag);
        break;
    }
  }

  process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (!out) return true;
    const p = this.x.engine_render(this.h, out.length);
    out.set(new Float32Array(this.x.memory.buffer, p, out.length));
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    if (++this.quanta % POST_EVERY === 0) {
      const t = new Float64Array(this.x.memory.buffer, this.x.engine_telemetry(this.h), TELE_HEADER + 12);
      const a = TELE_HEADER; // the articulators, in ARTIC_KEYS order
      this.port.postMessage({ type: "pose", rms: t[TELE.outRms], voicing: t[TELE.voicing], pLung: t[TELE.pLung], jaw: t[a], lipAp: t[a + 7], lipProt: t[a + 8] } satisfies FromLive);
    }
    return true;
  }
}

registerProcessor("live-moppet", LiveMoppet);
