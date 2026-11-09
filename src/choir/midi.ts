/** Multitrack standard MIDI export of a choir score (ported from Studio 404's school.js). */
import type { Piece } from "./music.ts";

export const PPQ = 480;

function variable(n: number): number[] {
  const bytes = [n & 127];
  while ((n >>= 7)) bytes.unshift((n & 127) | 128);
  return bytes;
}

/** Format 1: a tempo track, then one track per singer (one channel each). */
export function midiBytes(piece: Piece): Uint8Array {
  const encoder = new TextEncoder();
  const chunk = (tag: string, b: number[]) => [...encoder.encode(tag), (b.length >>> 24) & 255, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255, ...b];
  const tempo = Math.round(60000000 / piece.bpm);
  const tracks = [chunk("MTrk", [0, 255, 81, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255, 0, 255, 88, 4, 4, 2, 24, 8, 0, 255, 47, 0])];
  piece.tracks.forEach((track, i) => {
    const events: { tick: number; data: number[] }[] = [];
    for (const e of track.events) {
      events.push({ tick: Math.round(e.beat * PPQ), data: [0x90 + i, e.midi, 85] }, { tick: Math.round((e.beat + e.beats) * PPQ), data: [0x80 + i, e.midi, 0] });
    }
    // note-offs (0x80) sort before note-ons (0x90) at the same tick, so repeated pitches re-strike
    events.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
    let tick = 0;
    const name = encoder.encode(track.id);
    const body = [0, 255, 3, name.length, ...name];
    for (const e of events) {
      body.push(...variable(e.tick - tick), ...e.data);
      tick = e.tick;
    }
    body.push(0, 255, 47, 0);
    tracks.push(chunk("MTrk", body));
  });
  return new Uint8Array([...encoder.encode("MThd"), 0, 0, 0, 6, 0, 1, 0, tracks.length, 1, 224, ...tracks.flat()]);
}
