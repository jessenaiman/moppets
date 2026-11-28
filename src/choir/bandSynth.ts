/** The band's synths: finger bass, FM electric piano and a small kit, into one stem (see band.ts). */
import type { Piece } from "./music.ts";
import { LEAD_IN, beatSeconds } from "./timeline.ts";
import { bandFor, BRUSH, CRASH, KICK, OPEN_HAT, SIDE_STICK, SNARE, type BandNote } from "./band.ts";
import { renderPluck } from "./pluck.ts";

/** sin(2π·cycles) from a table: the band renders on the main thread before playback, so it must be quick. */
const TABLE_SIZE = 8192;
const TABLE = Float32Array.from({ length: TABLE_SIZE + 1 }, (_, i) => Math.sin((2 * Math.PI * i) / TABLE_SIZE));
function tsin(cycles: number): number {
  const x = (cycles - Math.floor(cycles)) * TABLE_SIZE, i = x | 0;
  return TABLE[i] + (TABLE[i + 1] - TABLE[i]) * (x - i);
}

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Deterministic noise, so a WAV is the same every time. */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2147483648) - 1;
}

/** Finger bass: a band-limited saw, darkening as it decays. Harmonics by the sine recurrence; envelopes as per-sample multipliers. */
function bassNote(out: Float32Array, start: number, n: BandNote, fs: number, len: number): void {
  const f = hz(n.midi), g = (n.vel / 127) * 0.16, release = Math.floor(0.03 * fs);
  len = Math.min(len, Math.floor(2.5 * fs)); // -48 dB by then
  const total = Math.min(out.length - start, len + release);
  const harmonics = Math.min(8, Math.floor(4000 / f));
  const kDecay = Math.exp(-2.2 / fs), kAttack = Math.exp(-400 / fs), kBright = Math.exp(-6 / fs);
  let decay = 1, attack = 1, brightDecay = 1;
  for (let j = 0; j < total; j++) {
    const t = j / fs;
    const env = (1 - attack) * decay * (j < len ? 1 : 1 - (j - len) / release);
    const bright = 0.35 + 0.65 * brightDecay;
    decay *= kDecay;
    attack *= kAttack;
    brightDecay *= kBright;
    const s1 = tsin(f * t), c2 = 2 * tsin(f * t + 0.25);
    let prev = 0, cur = s1, x = s1, w = 1;
    for (let h = 2; h <= harmonics; h++) {
      const next = c2 * cur - prev;
      prev = cur;
      cur = next;
      w *= bright;
      x += (cur / h) * w;
    }
    out[start + j] += x * env * g;
  }
}

/** Electric piano: two-operator FM (a tine), the bell fading faster than the body. */
function keysNote(out: Float32Array, start: number, n: BandNote, fs: number, len: number): void {
  const f = hz(n.midi), g = (n.vel / 127) * 0.07, release = Math.floor(0.12 * fs);
  len = Math.min(len, Math.floor(3 * fs)); // -42 dB by then
  const total = Math.min(out.length - start, len + release);
  const kBody = Math.exp(-1.6 / fs), kIndex = Math.exp(-5 / fs), kTine = Math.exp(-40 / fs), kRelease = Math.exp(-30 / fs);
  let body = 1, index = 1, tine = 0.08, rel = 1;
  for (let j = 0; j < total; j++) {
    const t = j / fs;
    if (j >= len) rel *= kRelease;
    const mod = ((1.6 * index + 0.25) * tsin(f * t)) / (2 * Math.PI);
    out[start + j] += (tsin(f * t + mod) + (tine > 1e-4 ? tsin(f * 14 * t) * tine : 0)) * body * rel * g;
    body *= kBody;
    index *= kIndex;
    tine *= kTine;
  }
}

/** The kit: a pitched-down sine kick, a noisy snare, hats of high noise. */
function drumHit(out: Float32Array, start: number, n: BandNote, fs: number, rand: () => number, len: number): void {
  const g = n.vel / 127;
  const span = (s: number) => Math.min(out.length - start, Math.floor(s * fs));
  if (n.midi >= 73 && n.midi <= 75) {
    // Two directions of a rubber-key scrape and a single bottoming-out clack.
    const taps = n.midi === 75 ? 1 : 9;
    const length = Math.min(len, span(0.6));
    for (let i = 0; i < taps; i++) {
      const at = start + Math.floor(length * i / taps);
      const height = n.midi === 73 ? taps-i : i;
      const freq = 760 + height*105;
      for(let j=0; j<Math.min(out.length-at,fs*.042); j++){
        const t=j/fs;
        out[at+j] += g * Math.exp(-t*130) * (.16*tsin(freq*t)+.065*rand()*Math.exp(-t*280));
      }
    }
  } else if (n.midi === KICK) {
    let phase = 0;
    for (let j = 0, m = span(0.35); j < m; j++) {
      const t = j / fs;
      phase += (2 * Math.PI * (45 + 90 * Math.exp(-t * 30))) / fs;
      out[start + j] += Math.sin(phase) * Math.exp(-t * 9) * g * 0.32;
    }
  } else if (n.midi === SIDE_STICK) {
    // Soft felt-tipped wooden rim pulse: warm two-mode wood resonance with muted attack.
    let lp = 0;
    for (let j = 0, m = span(0.11); j < m; j++) {
      const t = j / fs, w = rand();
      lp += 0.22 * (w - lp);
      const attack = 1 - Math.exp(-t * 700);
      const body = tsin(410 * t) * Math.exp(-t * 58) + tsin(980 * t) * Math.exp(-t * 95) * 0.32;
      const tap = lp * Math.exp(-t * 140) * 0.22;
      out[start + j] += (body * 0.8 + tap) * attack * g * 0.14;
    }
  } else if (n.midi === BRUSH) {
    // Warm jazz-brush snare sweep: soft rise time and band-shaped noise without metallic sizzle.
    let lpHi = 0, lpLo = 0;
    for (let j = 0, m = span(0.18); j < m; j++) {
      const t = j / fs, w = rand();
      lpHi += 0.42 * (w - lpHi);
      lpLo += 0.11 * (w - lpLo);
      const env = (1 - Math.exp(-t * 90)) * Math.exp(-t * 22);
      out[start + j] += (lpHi - lpLo) * env * g * 0.11;
    }
  } else if (n.midi === SNARE) {
    let lp = 0;
    for (let j = 0, m = span(0.22); j < m; j++) {
      const t = j / fs, w = rand();
      lp += 0.5 * (w - lp);
      out[start + j] += ((w - lp) * 0.9 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.5) * g * 0.16;
    }
  } else {
    // hats and the crash: noise minus its own smoothing, so only the highs ring
    const decay = n.midi === CRASH ? 2.2 : n.midi === OPEN_HAT ? 9 : 40, level = n.midi === CRASH ? 0.06 : 0.07;
    let lp = 0;
    for (let j = 0, m = span(n.midi === CRASH ? 1.6 : n.midi === OPEN_HAT ? 0.35 : 0.08); j < m; j++) {
      const w = rand();
      lp += 0.35 * (w - lp);
      out[start + j] += (w - lp) * Math.exp((-j / fs) * decay) * g * level;
    }
  }
}

/** Wooden xylophone: crisp rosewood mallet attack click + bright 1.0*f fundamental + 3.0*f wooden bar harmonic. */
export function xylophoneNote(out: Float32Array, start: number, n: BandNote, fs: number, len: number): void {
  const f = hz(n.midi);
  const g = (n.vel / 127) * 0.14;
  const ring = Math.min(Math.floor(0.45 * fs), Math.max(len + Math.floor(0.14 * fs), Math.floor(0.28 * fs)));
  const total = Math.min(out.length - start, ring);
  if (total <= 0) return;
  const release = Math.max(1, Math.floor(0.006 * fs));
  const includeHarmonic = f * 3 < fs * 0.45;
  const includeClick = f * 5.4 < fs * 0.45;
  for (let j = 0; j < total; j++) {
    const t = j / fs;
    const attack = t < 0.0008 ? t / 0.0008 : 1;
    const tail = j > total - release ? (total - j) / release : 1;
    const fund = tsin(f * t) * Math.exp(-t * 14);
    const bar = includeHarmonic ? tsin(f * 3 * t) * Math.exp(-t * 52) * 0.48 : 0;
    const mallet = (includeClick ? tsin(f * 5.4 * t) * 0.28 : 0) * Math.exp(-t * 280) + tsin(2450 * t) * Math.exp(-t * 420) * 0.22;
    out[start + j] += (fund + bar + mallet) * attack * tail * g;
  }
}

/** The band as one stem on the shared timeline (beat 0 at LEAD_IN), or null when there is none. */
export function renderBand(piece: Piece, sampleRate: number, frames: number): Float32Array | null {
  const parts = bandFor(piece);
  if (!parts.some((p) => p.notes.length)) return null;
  const out = new Float32Array(frames);
  const beat = beatSeconds(piece), rand = noise(404);
  for (const p of parts)
    for (const n of p.notes) {
      const start = Math.floor((LEAD_IN + n.beat * beat) * sampleRate);
      if (start < 0 || start >= frames) continue;
      const len = Math.floor(n.beats * beat * sampleRate);
      if (p.id === "bass") bassNote(out, start, n, sampleRate, len);
      else if (p.id === "keys") keysNote(out, start, n, sampleRate, len);
      else if (p.id === "xylophone") xylophoneNote(out, start, n, sampleRate, len);
      else drumHit(out, start, n, sampleRate, rand, len);
    }
  return out;
}

/** The accompaniment stem: the band, or the original pluck when a piece has no band. */
export function renderAccompaniment(piece: Piece, sampleRate: number, frames: number): Float32Array | null {
  return renderBand(piece, sampleRate, frames) ?? (piece.pluck ? renderPluck(piece, sampleRate, frames) : null);
}
