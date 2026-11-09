/** Mix-bus arithmetic shared by the live mixer worklet and WAV export, so a download is what was heard. */
import type { Piece } from "./music.ts";

export const BUS_GAIN = 0.34;
/** Stems beyond the singers and accompaniment: the beatbox, then each cameo creature, in spawn order. */
export function extraStems(piece: Piece): string[] {
  return [...(piece.beat ? ["beat"] : []), ...[...new Set((piece.cameos ?? []).map((c) => c.creature))]];
}

/** Each stem's level for a piece (voices by id, then the accompaniment), and where the introduction's chorus sits back. */
export function pieceGains(piece: Piece, sampleRate: number, chorusAtSeconds: number, levels: Record<string, number>): { gains: number[]; section?: GainSection } {
  const solo = piece.kind === "intro" || piece.kind === "solo";
  const level = (id: string) => (solo ? 0.8 / BUS_GAIN : 1) * (levels[id] ?? 1);
  const gains = piece.tracks.map((t) => level(t.id));
  const pluckGain = 1 / BUS_GAIN;
  if (piece.pluck) gains.push(pluckGain);
  const extras = extraStems(piece);
  for (const e of extras) gains.push(e === "beat" ? 1 : 0.32);
  let section: GainSection | undefined;
  if (piece.kind === "intro") section = { frame: Math.floor((chorusAtSeconds - 0.25) * sampleRate), gains: [...piece.tracks.map((t) => (0.19 / BUS_GAIN) * (levels[t.id] ?? 1)), ...(piece.pluck ? [pluckGain] : []), ...extras.map((e) => (e === "beat" ? 1 : 0.32))] };
  return { gains, section };
}

/** A planned level change (the introduction's solo verses are louder than its massed chorus). */
export interface GainSection {
  frame: number;
  gains: number[];
}
const CEILING = 0.92;
const RELEASE = 0.9995; // per sample: about 40 ms back to unity at 48 kHz

/** A gain-riding limiter: the bus can never pass CEILING and no sample is ever waveshaped. */
export class Limiter {
  private gain = 1;
  /** how many samples were pulled down */
  limited = 0;
  peak = 0;
  run(buf: Float32Array, n: number): void {
    let g = this.gain, peak = this.peak, limited = this.limited;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(buf[i]);
      if (a * g > CEILING) g = CEILING / a;
      if (g < 1) {
        limited++;
        g = Math.min(1, g / RELEASE);
      }
      const v = buf[i] * g;
      buf[i] = v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    this.gain = g;
    this.peak = peak;
    this.limited = limited;
  }
}

/** Mix finished stems into one block of samples through the same bus as playback. */
export function mixStems(stems: readonly Float32Array[], gains: readonly number[], frames: number, section?: GainSection): { samples: Float32Array; limited: number; peak: number; nonFinite: number } {
  const samples = new Float32Array(frames);
  let nonFinite = 0;
  stems.forEach((s, v) => {
    const n = Math.min(frames, s.length);
    for (let i = 0; i < n; i++) {
      const g = (section && i >= section.frame ? section.gains[v] : gains[v]) * BUS_GAIN;
      if (Number.isFinite(s[i])) samples[i] += s[i] * g;
      else nonFinite++;
    }
  });
  const lim = new Limiter();
  lim.run(samples, frames);
  return { samples, limited: lim.limited, peak: lim.peak, nonFinite };
}

export function wavBytes(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const b = new ArrayBuffer(44 + samples.length * 2), d = new DataView(b);
  const str = (o: number, s: string) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  d.setUint32(4, b.byteLength - 8, true);
  str(8, "WAVEfmt ");
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true);
  d.setUint16(22, 1, true);
  d.setUint32(24, sampleRate, true);
  d.setUint32(28, sampleRate * 2, true);
  d.setUint16(32, 2, true);
  d.setUint16(34, 16, true);
  str(36, "data");
  d.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return b;
}
