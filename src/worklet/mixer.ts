/**
 * The choir's mixer: one AudioWorklet node on the app's single AudioContext. Stems arrive from
 * the singer Workers tagged with their absolute frame on the shared timeline, so every voice is
 * sample-aligned by construction. If any stem has not arrived the timeline waits (silence, counted
 * as an underrun) instead of letting voices drift apart.
 * Output 0: the mix. Output 1: the inspected Moppet alone, for the analysers.
 */
import { BUS_GAIN, Limiter, type GainSection } from "../choir/mix.ts";
import type { MixerIn, MixerOut } from "./mixerProtocol.ts";

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

interface Chunk {
  frame: number;
  pcm: Float32Array;
}

const POST_EVERY = 8; // quanta between position messages to the main thread (~21 ms)
const TELL_EVERY = 32; // quanta between playhead notices to each singer (~85 ms): each one costs audio-thread time

class MixerProcessor extends AudioWorkletProcessor {
  private generation = 0;
  /** chunks tagged with a generation whose "play" has not arrived yet (ports are unordered across threads) */
  private early: { voice: number; generation: number; chunk: Chunk }[] = [];
  private queues: Chunk[][] = [];
  private ends: number[] = [];
  private gains: number[] = [];
  private section: GainSection | undefined;
  private ports: MessagePort[] = [];
  private playing = false;
  private frame = 0;
  private solo = 0;
  private underruns = 0;
  private underrunFrames = 0;
  private buffering = false;
  /** which stem last made the timeline wait */
  private missing = -1;
  private quanta = 0;
  private load = 0;
  private limiter = new Limiter();
  private mix = new Float32Array(128);
  private soloBuf = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<MixerIn>) => this.handle(e.data);
  }

  private handle(m: MixerIn): void {
    switch (m.type) {
      case "setup":
        this.queues = m.ends.map(() => []);
        this.ends = m.ends;
        this.gains = m.gains;
        this.section = m.section;
        for (const p of this.ports) p.close();
        this.ports = m.ports;
        m.ports.forEach((p) => {
          p.onmessage = (ev: MessageEvent<MixerIn>) => this.handle(ev.data);
        });
        this.limiter = new Limiter();
        this.early.length = 0;
        this.playing = false;
        this.frame = 0;
        this.underruns = this.underrunFrames = 0;
        break;
      case "chunk":
        if (m.voice >= this.queues.length || m.generation < this.generation) break;
        if (m.generation > this.generation) this.early.push({ voice: m.voice, generation: m.generation, chunk: { frame: m.frame, pcm: m.pcm } });
        else this.queues[m.voice].push({ frame: m.frame, pcm: m.pcm });
        break;
      case "play":
        this.generation = m.generation;
        this.frame = m.frame;
        this.queues.forEach((q) => (q.length = 0));
        for (const e of this.early) if (e.generation === m.generation) this.queues[e.voice].push(e.chunk);
        this.early.length = 0;
        this.playing = true;
        this.buffering = true;
        this.tellPlayhead();
        break;
      case "pause":
        this.playing = false;
        this.post();
        break;
      case "clear":
        this.playing = false;
        this.generation = m.generation;
        this.early.length = 0;
        this.queues.forEach((q) => (q.length = 0));
        break;
      case "gains":
        this.gains = m.gains;
        break;
      case "solo":
        this.solo = m.voice;
        break;
    }
  }

  private tellPlayhead(): void {
    for (const p of this.ports) p.postMessage({ playhead: this.frame });
  }

  private post(): void {
    const m: MixerOut = { type: "pos", frame: this.frame, contextFrame: currentFrame, playing: this.playing, underruns: this.underruns, underrunFrames: this.underrunFrames, load: this.load, limited: this.limiter.limited, peak: this.limiter.peak, buffering: this.buffering, missing: this.missing };
    this.port.postMessage(m);
  }

  /** Is every sounding stem's audio here for [frame, frame+128)? */
  private ready(): boolean {
    const from = this.frame, to = from + 128;
    for (let v = 0; v < this.queues.length; v++) {
      if (from >= this.ends[v]) continue;
      const q = this.queues[v];
      while (q.length && q[0].frame + q[0].pcm.length <= from) q.shift();
      let at = from;
      for (const c of q) {
        if (c.frame > at) break;
        at = c.frame + c.pcm.length;
        if (at >= to || at >= this.ends[v]) break;
      }
      if (at < to && at < this.ends[v]) {
        this.missing = v;
        return false;
      }
    }
    return true;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0], soloOut = outputs[1];
    if (!out || !out[0] || !this.playing) {
      for (const o of outputs) for (const ch of o) ch.fill(0);
      return true;
    }
    if (!this.ready()) {
      if (!this.buffering) {
        this.underruns++;
        this.buffering = true;
      }
      this.underrunFrames += out[0].length;
      for (const o of outputs) for (const ch of o) ch.fill(0);
      if (++this.quanta % POST_EVERY === 0) this.post();
      if (this.quanta % TELL_EVERY === 0) this.tellPlayhead();
      return true;
    }
    this.buffering = false;
    const t0 = Date.now();
    const n = out[0].length;
    const mix = this.mix, solo = this.soloBuf;
    mix.fill(0);
    solo.fill(0);
    for (let v = 0; v < this.queues.length; v++) {
      if (this.frame >= this.ends[v]) continue;
      const g = (this.section && this.frame >= this.section.frame ? this.section.gains[v] : this.gains[v]) * BUS_GAIN, isSolo = v === this.solo;
      const q = this.queues[v];
      let i = 0, f = this.frame;
      for (let c = 0; c < q.length && i < n; c++) {
        const { frame, pcm } = q[c];
        const off = f - frame;
        if (off >= pcm.length) continue;
        const take = Math.min(n - i, pcm.length - off);
        for (let k = 0; k < take; k++) {
          const s = pcm[off + k];
          if (s === s) {
            mix[i + k] += s * g;
            if (isSolo) solo[i + k] = s;
          }
        }
        i += take;
        f += take;
      }
      while (q.length && q[0].frame + q[0].pcm.length <= this.frame + n) q.shift();
    }
    this.limiter.run(mix, n);
    for (const ch of out) ch.set(mix);
    if (soloOut) for (const ch of soloOut) ch.set(solo);
    this.frame += n;
    const dt = Date.now() - t0;
    this.load += 0.05 * (dt / ((n / sampleRate) * 1000) - this.load);
    if (++this.quanta % POST_EVERY === 0) this.post();
    if (this.quanta % TELL_EVERY === 0) this.tellPlayhead();
    const total = this.ends.length ? Math.max(...this.ends) : 0;
    if (this.frame >= total) {
      this.playing = false;
      const m: MixerOut = { type: "ended", frame: this.frame, underruns: this.underruns, underrunFrames: this.underrunFrames };
      this.port.postMessage(m);
    }
    return true;
  }
}

registerProcessor("choir-mixer", MixerProcessor);
