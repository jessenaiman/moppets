/** Mix-bus arithmetic shared by the live mixer worklet and WAV export, so a download is what was heard. */
import { VocalBus, vocalPans } from "./vocalBus.ts";
import type { Piece } from "./music.ts";
import { bandFor } from "./band.ts";

/** Is there an accompaniment stem: the band (band.ts), or the original pluck when a piece has no band. */
const hasBand = (piece: Piece) => bandFor(piece).some((p) => p.notes.length > 0);
export const hasAccompaniment = (piece: Piece) => hasBand(piece) || !!piece.pluck;
/** The band sits under the voices: about 12 dB below the whole mix in an up-tempo song (measured with tools/choir-render.ts). */
export const BAND_LEVEL = 0.55;

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
  const pluckGain = (hasBand(piece) ? BAND_LEVEL : 1) / BUS_GAIN;
  if (hasAccompaniment(piece)) gains.push(piece.title === "Found Things" ? pluckGain * 0.8 : pluckGain);
  const extras = extraStems(piece);
  for (const e of extras) gains.push(e === "beat" ? 1 : 0.32);
  // A pair trading lines spends much of the song at solo density. Bring
  // the whole arrangement up together; the bus limiter catches harmony peaks.
  const singers = piece.stage?.filter(id => id !== "band");
  if (piece.kind === "motesong" && singers && singers.length >= 1 && singers.length <= 2 &&
      singers.length === piece.tracks.length && piece.tracks.every(track => singers.includes(track.id))) {
    for (let i = 0; i < gains.length; i++) gains[i] *= 0.8 / BUS_GAIN;
  }
  let section: GainSection | undefined;
  if (piece.kind === "intro") section = { frame: Math.floor((chorusAtSeconds - 0.25) * sampleRate), gains: [...piece.tracks.map((t) => (0.19 / BUS_GAIN) * (levels[t.id] ?? 1)), ...(hasAccompaniment(piece) ? [pluckGain] : []), ...extras.map((e) => (e === "beat" ? 1 : 0.32))] };
  return { gains, section };
}

/** A planned level change (the introduction's solo verses are louder than its massed chorus). */
export interface GainSection {
  frame: number;
  gains: number[];
}
/** Voices enter the stereo vocal strip. Instrumental, beat and cameo stems join at the limiter. */
export function mixStems(stems: readonly Float32Array[], gains: readonly number[], frames: number,
  voiceCount: number, rate: number, section?: GainSection, voiceLevels: readonly number[] = []) {
  const left = new Float32Array(frames), right = new Float32Array(frames), backing = new Float32Array(frames);
  const pans = vocalPans(voiceCount);
  let nonFinite = 0;
  stems.forEach((stem, v) => {
    const pan = pans[v];
    const n = Math.min(frames, stem.length);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(stem[i])) { nonFinite++; continue; }
      const gain = section && i >= section.frame ? section.gains[v] : gains[v];
      const value = stem[i] * gain * BUS_GAIN * (voiceLevels[v] ?? 1);
      if (pan) {
        left[i] += value * pan.left;
        right[i] += value * pan.right;
      } else backing[i] += value;
    }
  });
  const bus = new VocalBus(rate);
  bus.process(left,right,backing,frames);
  return {left, right, limited: bus.limited, peak: bus.peak, nonFinite};
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
