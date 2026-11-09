/** The original quiet plucked accompaniment (sine partials), one per beat, on the shared timeline. */
import type { Piece } from "./music.ts";
import { LEAD_IN, beatSeconds } from "./plan.ts";

export function renderPluck(piece: Piece, sampleRate: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  const beat = beatSeconds(piece);
  piece.pluck?.forEach((root, b) => {
    if (root === null) return;
    const start = Math.floor((LEAD_IN + b * beat) * sampleRate);
    for (const [m, g] of [[root, 0.025], [root + 12, 0.014], [root + 19, 0.01]]) {
      const f = 440 * 2 ** ((m - 69) / 12);
      const n = Math.min(Math.floor(sampleRate * 0.28), frames - start);
      for (let j = 0; j < n; j++) out[start + j] += Math.sin((2 * Math.PI * f * j) / sampleRate) * Math.exp((-j / sampleRate) * 15) * g;
    }
  });
  return out;
}
