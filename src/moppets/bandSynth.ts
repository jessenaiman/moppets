/**
 * Pure-JS Moppet backing band (`bass`, `keys`, `drums`, `xylophone`), ported directly from
 * `moppet-choir/src/choir/band.ts` + `bandSynth.ts`.
 *
 * Engine-free: plays MIDI `band *` tracks from `songs/*.mid` (or arranges chords from `.song`)
 * plus drum grooves from `beat: B . t K ...` into one mono Float32Array stem routed straight
 * into CHIMERA's single `AudioEngine.master` node.
 */

export type BandId = "bass" | "keys" | "drums" | "xylophone";

export interface BandNote {
  beat: number;
  beats: number;
  midi: number;
  vel: number;
}

export interface BandPart {
  id: BandId;
  notes: BandNote[];
}

export interface SongChord {
  beat: number;
  beats: number;
  tones: number[];
}

export const KICK = 36;
export const SNARE = 38;
export const HAT = 42;
export const OPEN_HAT = 46;
export const CRASH = 49;

const TABLE_SIZE = 8192;
const TABLE = Float32Array.from({ length: TABLE_SIZE + 1 }, (_, i) =>
  Math.sin((2 * Math.PI * i) / TABLE_SIZE),
);

function tsin(cycles: number): number {
  const x = (cycles - Math.floor(cycles)) * TABLE_SIZE;
  const i = x | 0;
  return TABLE[i] + (TABLE[i + 1] - TABLE[i]) * (x - i);
}

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2147483648) - 1;
}

const near = (pc: number, centre: number) => {
  const base = centre - ((((centre - pc) % 12) + 12) % 12);
  return centre - base > 6 ? base + 12 : base;
};

function chordAt(chords: readonly SongChord[], beat: number): SongChord | undefined {
  return chords.find((c) => beat >= c.beat - 1e-6 && beat < c.beat + c.beats - 1e-6);
}

/** Convert `.song` `beat: B . t K | . t B .` tokens into sixteenth-note drum kit hits across active bars. */
export function beatPatternToDrums(
  beatText: string | undefined,
  totalBeats: number,
  chords: readonly SongChord[],
): { notes: BandNote[]; swing: number } {
  if (!beatText) return { notes: [], swing: 0 };
  let swing = 0;
  const cleaned = beatText.replace(/\(swing\s+([0-9.]+)\)/i, (_, v: string) => {
    swing = Number(v) || 0;
    return "";
  });
  const tokens = cleaned
    .replace(/\|/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return { notes: [], swing };

  const notes: BandNote[] = [];
  const stepBeats = 0.25; // 16th-note grid (4 steps per beat)
  const totalSteps = Math.floor(totalBeats / stepBeats);
  let crashed = false;

  for (let step = 0; step < totalSteps; step++) {
    const baseBeat = step * stepBeats;
    if (chords.length > 0 && !chordAt(chords, baseBeat)) {
      crashed = false;
      continue;
    }
    const oddSub = step % 2 === 1 ? swing * 0.085 : 0;
    const beat = baseBeat + oddSub;
    if (!crashed && step % 16 === 0) {
      notes.push({ beat, beats: 1, midi: CRASH, vel: 58 });
      crashed = true;
    }
    const tok = tokens[step % tokens.length];
    if (tok === "." || tok === "-") continue;
    if (tok === "B" || tok === "b") {
      notes.push({ beat, beats: 0.35, midi: KICK, vel: tok === "B" ? 88 : 68 });
    } else if (tok === "K" || tok === "k" || tok === "P" || tok === "p") {
      notes.push({ beat, beats: 0.25, midi: SNARE, vel: tok === tok.toUpperCase() ? 76 : 56 });
    } else if (tok === "t") {
      notes.push({ beat, beats: 0.16, midi: HAT, vel: 48 });
    } else if (tok === "T" || tok === "s") {
      notes.push({ beat, beats: 0.32, midi: OPEN_HAT, vel: 44 });
    }
  }
  return { notes, swing };
}

/** Arrange bass, keys, and drums from `.song` chords when no MIDI band tracks are supplied. */
export function arrangeBandFromChords(
  chords: readonly SongChord[],
  bpm: number,
  beatSpec?: string,
): BandPart[] {
  if (!chords.length) return [];
  const end = Math.max(...chords.map((c) => c.beat + c.beats));
  const ballad = bpm < 92;
  const beatKit = beatPatternToDrums(beatSpec, end, chords);
  const off = 0.5 + beatKit.swing * 0.17;
  const bass: BandNote[] = [];
  const keys: BandNote[] = [];
  const drums: BandNote[] = [...beatKit.notes];

  for (const c of chords) {
    const root = near(c.tones[0], 38);
    const fifth = near(c.tones[2] ?? c.tones[0] + 7, root + 7);
    const voicing = c.tones.map((pc) => near(pc, 62)).sort((a, b) => a - b);
    if (ballad) {
      bass.push({ beat: c.beat, beats: c.beats * 0.95, midi: root, vel: 100 });
      for (const m of voicing) keys.push({ beat: c.beat, beats: c.beats * 0.95, midi: m, vel: 72 });
      continue;
    }
    for (let b = c.beat; b < c.beat + c.beats - 1e-6; b++) {
      const inBar = ((b % 4) + 4) % 4;
      const first = Math.abs(b - c.beat) < 1e-6;
      if (first || inBar === 0) bass.push({ beat: b, beats: 0.9, midi: root, vel: 94 });
      else if (inBar === 2) bass.push({ beat: b, beats: 0.9, midi: fifth, vel: 82 });
      const next = chordAt(chords, b + 1);
      if (inBar === 3 && next && next !== c) {
        bass.push({ beat: b + off, beats: 0.4, midi: near(next.tones[0], root) - 1, vel: 68 });
      }
      if (inBar === 1 || inBar === 3) {
        for (const m of voicing) keys.push({ beat: b, beats: 0.45, midi: m, vel: 60 });
      }
      if (inBar === 3) {
        for (const m of voicing) keys.push({ beat: b + off, beats: 0.3, midi: m, vel: 46 });
      }
    }
  }

  if (!drums.length) {
    let started = false;
    for (let b = 0; b < end - 1e-6; b++) {
      if (!chordAt(chords, b)) {
        started = false;
        continue;
      }
      const inBar = ((b % 4) + 4) % 4;
      if (!started) drums.push({ beat: b, beats: 1, midi: CRASH, vel: 64 });
      started = true;
      drums.push({ beat: b, beats: 0.5, midi: inBar % 2 ? SNARE : KICK, vel: inBar % 2 ? 74 : 88 });
      drums.push(
        { beat: b, beats: 0.4, midi: HAT, vel: 48 },
        { beat: b + off, beats: 0.4, midi: inBar === 3 ? OPEN_HAT : HAT, vel: 36 },
      );
    }
  }

  return [
    { id: "bass", notes: bass },
    { id: "keys", notes: keys },
    ...(drums.length ? [{ id: "drums" as const, notes: drums }] : []),
  ];
}

function bassNote(out: Float32Array, start: number, n: BandNote, fs: number, len: number): void {
  const f = hz(n.midi);
  const g = (n.vel / 127) * 0.145;
  const release = Math.floor(0.03 * fs);
  len = Math.min(len, Math.floor(2.5 * fs));
  const total = Math.min(out.length - start, len + release);
  const harmonics = Math.min(8, Math.floor(4000 / f));
  const kDecay = Math.exp(-2.2 / fs);
  const kAttack = Math.exp(-400 / fs);
  const kBright = Math.exp(-6 / fs);
  let decay = 1;
  let attack = 1;
  let brightDecay = 1;
  for (let j = 0; j < total; j++) {
    const t = j / fs;
    const env = (1 - attack) * decay * (j < len ? 1 : 1 - (j - len) / release);
    const bright = 0.35 + 0.65 * brightDecay;
    decay *= kDecay;
    attack *= kAttack;
    brightDecay *= kBright;
    const s1 = tsin(f * t);
    const c2 = 2 * tsin(f * t + 0.25);
    let prev = 0;
    let cur = s1;
    let x = s1;
    let w = 1;
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

function keysNote(out: Float32Array, start: number, n: BandNote, fs: number, len: number): void {
  const f = hz(n.midi);
  const g = (n.vel / 127) * 0.062;
  const release = Math.floor(0.12 * fs);
  len = Math.min(len, Math.floor(3 * fs));
  const total = Math.min(out.length - start, len + release);
  const kBody = Math.exp(-1.6 / fs);
  const kIndex = Math.exp(-5 / fs);
  const kTine = Math.exp(-40 / fs);
  const kRelease = Math.exp(-30 / fs);
  let body = 1;
  let index = 1;
  let tine = 0.08;
  let rel = 1;
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

function xylophoneNote(out: Float32Array, start: number, n: BandNote, fs: number, len: number): void {
  const f = hz(n.midi);
  const g = (n.vel / 127) * 0.12;
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
    const mallet =
      (includeClick ? tsin(f * 5.4 * t) * 0.28 : 0) * Math.exp(-t * 280) +
      tsin(2450 * t) * Math.exp(-t * 420) * 0.22;
    out[start + j] += (fund + bar + mallet) * attack * tail * g;
  }
}

function drumHit(out: Float32Array, start: number, n: BandNote, fs: number, rand: () => number): void {
  const g = n.vel / 127;
  const span = (s: number) => Math.min(out.length - start, Math.floor(s * fs));
  if (n.midi === KICK) {
    let phase = 0;
    for (let j = 0, m = span(0.35); j < m; j++) {
      const t = j / fs;
      phase += (2 * Math.PI * (45 + 90 * Math.exp(-t * 30))) / fs;
      out[start + j] += Math.sin(phase) * Math.exp(-t * 9) * g * 0.28;
    }
  } else if (n.midi === SNARE) {
    let lp = 0;
    for (let j = 0, m = span(0.22); j < m; j++) {
      const t = j / fs;
      const w = rand();
      lp += 0.5 * (w - lp);
      out[start + j] +=
        ((w - lp) * 0.9 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.5) *
        g *
        0.14;
    }
  } else {
    const decay = n.midi === CRASH ? 2.2 : n.midi === OPEN_HAT ? 9 : 40;
    const level = n.midi === CRASH ? 0.05 : 0.06;
    let lp = 0;
    for (let j = 0, m = span(n.midi === CRASH ? 1.6 : n.midi === OPEN_HAT ? 0.35 : 0.08); j < m; j++) {
      const w = rand();
      lp += 0.35 * (w - lp);
      out[start + j] += (w - lp) * Math.exp((-j / fs) * decay) * g * level;
    }
  }
}

/** Synthesize band parts into a mono stem aligned to `beat = 0` at sample `0`. */
export function renderBandStem(
  parts: readonly BandPart[],
  bpm: number,
  durationSec: number,
  sampleRate: number,
): Float32Array | null {
  if (!parts.some((p) => p.notes.length > 0)) return null;
  const frames = Math.max(1, Math.ceil((durationSec + 0.6) * sampleRate));
  const out = new Float32Array(frames);
  const beatSec = 60 / bpm;
  const rand = noise(404);

  for (const p of parts) {
    for (const n of p.notes) {
      const start = Math.floor(n.beat * beatSec * sampleRate);
      if (start < 0 || start >= frames) continue;
      const len = Math.max(1, Math.floor(n.beats * beatSec * sampleRate));
      if (p.id === "bass") bassNote(out, start, n, sampleRate, len);
      else if (p.id === "keys") keysNote(out, start, n, sampleRate, len);
      else if (p.id === "xylophone") xylophoneNote(out, start, n, sampleRate, len);
      else drumHit(out, start, n, sampleRate, rand);
    }
  }
  return out;
}
