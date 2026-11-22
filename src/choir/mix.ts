/** Mix-bus arithmetic shared by the live mixer worklet and WAV export, so a download is what was heard. */
import type { Piece } from "./music.ts";
import { bandFor } from "./band.ts";

/** Is there an accompaniment stem: the band (band.ts), or the original pluck when a piece has no band. */
const hasBand = (piece: Piece) => bandFor(piece).some((p) => p.notes.length > 0);
export const hasAccompaniment = (piece: Piece) => hasBand(piece) || !!piece.pluck;
/** The band sits cleanly under the voices so CHIMERA lyrics stay clear and upfront. */
export const BAND_LEVEL = 0.42;

const VOCAL_HEADROOM = 0.5;
/** Stems beyond the singers and accompaniment: the beatbox, then each cameo creature, in spawn order. */
export function extraStems(piece: Piece): string[] {
  return [...(piece.beat ? ["beat"] : []), ...[...new Set((piece.cameos ?? []).map((c) => c.creature))]];
}

/** Each stem's fixed level in spawn order. */
export function pieceGains(piece: Piece, levels: Record<string, number>): number[] {
  const gains = piece.tracks.map(track => VOCAL_HEADROOM * (levels[track.id] ?? 1));
  const band = hasBand(piece);
  if (band || piece.pluck) gains.push(band ? BAND_LEVEL : 0.72);
  for (const extra of extraStems(piece)) gains.push(extra === "beat" ? 0.72 : 0.34);
  return gains;
}

export function mixStems(stems: readonly Float32Array[], gains: readonly number[], frames: number,
  voiceLevels: readonly number[] = []) {
  const samples = new Float32Array(frames);
  let nonFinite = 0;
  stems.forEach((stem, v) => {
    const gain = gains[v] * (voiceLevels[v] ?? 1);
    const n = Math.min(frames, stem.length);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(stem[i])) { nonFinite++; continue; }
      samples[i] += stem[i] * gain;
    }
  });
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return { samples, peak, nonFinite };
}

export function wavBytes(samples: Float32Array, sampleRate: number, right?: Float32Array): ArrayBuffer {
  const channels = right ? 2 : 1;
  const b = new ArrayBuffer(44 + samples.length * 2 * channels), d = new DataView(b);
  const str = (o: number, s: string) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  d.setUint32(4, b.byteLength - 8, true);
  str(8, "WAVEfmt ");
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true);
  d.setUint16(22, channels, true);
  d.setUint32(24, sampleRate, true);
  d.setUint32(28, sampleRate * 2 * channels, true);
  d.setUint16(32, 2 * channels, true);
  d.setUint16(34, 16, true);
  str(36, "data");
  d.setUint32(40, samples.length * 2 * channels, true);
  const pcm = (v: number) => Math.round(Math.max(-1, Math.min(1, v))*32767);
  for (let i=0; i<samples.length; i++) {
    const offset = 44+i*2*channels;
    d.setInt16(offset, pcm(samples[i]), true);
    if (right) d.setInt16(offset+2, pcm(right[i]), true);
  }
  return b;
}
