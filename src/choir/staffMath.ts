/**
 * Pure notation & pitch math for VexFlow musical staff rendering and note editing.
 * Engine-free: imports only pure music/songbook modules (verified by tests/engine-free.test.ts).
 */
import { KEYS, scalePitch, type KeyName, type ScaleMode } from "./music.ts";

const MAJOR_SIGS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
const MINOR_SIGS = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "Abm", "Am", "Bbm", "Bm"] as const;

const SHARP_SPELLING: readonly [string, number][] = [
  ["c", 0], ["c", 1], ["d", 0], ["d", 1], ["e", 0], ["f", 0],
  ["f", 1], ["g", 0], ["g", 1], ["a", 0], ["a", 1], ["b", 0],
];
const FLAT_SPELLING: readonly [string, number][] = [
  ["c", 0], ["d", -1], ["d", 0], ["e", -1], ["e", 0], ["f", 0],
  ["g", -1], ["g", 0], ["a", -1], ["a", 0], ["b", -1], ["b", 0],
];

const SHARP_ORDER = ["f", "c", "g", "d", "a", "e", "b"] as const;
const FLAT_ORDER = ["b", "e", "a", "d", "g", "c", "f"] as const;

const SIG_ACCIDENTALS: Record<string, { type: "#" | "b"; num: number }> = {
  C: { type: "#", num: 0 }, Am: { type: "#", num: 0 },
  G: { type: "#", num: 1 }, Em: { type: "#", num: 1 },
  D: { type: "#", num: 2 }, Bm: { type: "#", num: 2 },
  A: { type: "#", num: 3 }, "F#m": { type: "#", num: 3 },
  E: { type: "#", num: 4 }, "C#m": { type: "#", num: 4 },
  B: { type: "#", num: 5 }, "G#m": { type: "#", num: 5 },
  "F#": { type: "#", num: 6 }, "D#m": { type: "#", num: 6 },
  "C#": { type: "#", num: 7 }, "A#m": { type: "#", num: 7 },
  F: { type: "b", num: 1 }, Dm: { type: "b", num: 1 },
  Bb: { type: "b", num: 2 }, Gm: { type: "b", num: 2 },
  Eb: { type: "b", num: 3 }, Cm: { type: "b", num: 3 },
  Ab: { type: "b", num: 4 }, Fm: { type: "b", num: 4 },
  Db: { type: "b", num: 5 }, Bbm: { type: "b", num: 5 },
  Gb: { type: "b", num: 6 }, Ebm: { type: "b", num: 6 },
  Cb: { type: "b", num: 7 }, Abm: { type: "b", num: 7 },
};

/** Map a piece key + mode to a valid VexFlow key signature string. */
export function vexKeySignature(key: KeyName, mode: ScaleMode): string {
  const pc = KEYS[key];
  if (mode === "minor" || mode === "aeolian") return MINOR_SIGS[pc];
  if (mode === "dorian") return MAJOR_SIGS[((pc - 2) % 12 + 12) % 12];
  if (mode === "mixolydian") return MAJOR_SIGS[((pc - 7) % 12 + 12) % 12];
  if (mode === "lydian") return MAJOR_SIGS[((pc - 5) % 12 + 12) % 12];
  if (mode === "phrygian") return MAJOR_SIGS[((pc - 4) % 12 + 12) % 12];
  return MAJOR_SIGS[pc];
}

/** Initial letter accidentals (+1 sharp, -1 flat, 0 natural) implied by a VexFlow key signature. */
export function keySigAccidentals(vexKeySig: string): Record<string, number> {
  const out: Record<string, number> = { c: 0, d: 0, e: 0, f: 0, g: 0, a: 0, b: 0 };
  const spec = SIG_ACCIDENTALS[vexKeySig];
  if (!spec || spec.num === 0) return out;
  const order = spec.type === "#" ? SHARP_ORDER : FLAT_ORDER;
  const val = spec.type === "#" ? 1 : -1;
  for (let i = 0; i < spec.num; i++) out[order[i]] = val;
  return out;
}

/** Spell a MIDI pitch for VexFlow (`letter/octave`) and compute its accidental relative to active bar state. */
export function midiToVexNote(
  midi: number,
  key: KeyName,
  mode: ScaleMode,
  activeAccidentals: Record<string, number>,
): { key: string; accidental: "#" | "b" | "n" | null } {
  const sig = vexKeySignature(key, mode);
  const spec = SIG_ACCIDENTALS[sig];
  const useFlats = spec ? spec.type === "b" : false;
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  const [letter, alter] = (useFlats ? FLAT_SPELLING : SHARP_SPELLING)[pc];
  const prev = activeAccidentals[letter] ?? 0;
  let accidental: "#" | "b" | "n" | null = null;
  if (alter !== prev) {
    accidental = alter === 1 ? "#" : alter === -1 ? "b" : "n";
    activeAccidentals[letter] = alter;
  }
  return { key: `${letter}/${octave}`, accidental };
}

/** Choose treble or bass clef from the track's sounding MIDI pitches (or voice register). */
export function clefForVoice(midis: number[], register?: [number, number]): "treble" | "bass" {
  const mean = midis.length
    ? midis.reduce((a, b) => a + b, 0) / midis.length
    : register
      ? (register[0] + register[1]) / 2
      : 64;
  return mean < 57 ? "bass" : "treble";
}

/** Quantize beat length to VexFlow duration code + dot count. */
export function beatsToVexDuration(beats: number): { duration: "w" | "h" | "q" | "8" | "16"; dots: number } {
  if (beats >= 3.75) return { duration: "w", dots: 0 };
  if (beats >= 2.75) return { duration: "h", dots: 1 };
  if (beats >= 1.75) return { duration: "h", dots: 0 };
  if (beats >= 1.25) return { duration: "q", dots: 1 };
  if (beats >= 0.875) return { duration: "q", dots: 0 };
  if (beats >= 0.625) return { duration: "8", dots: 1 };
  if (beats >= 0.375) return { duration: "8", dots: 0 };
  return { duration: "16", dots: 0 };
}

/** Map a target MIDI pitch back to the nearest integer scale degree for a lead-sheet note. */
export function midiToScaleDegree(
  targetMidi: number,
  refEventMidi: number,
  refDegree: number,
  key: KeyName,
  mode: ScaleMode,
): number {
  const octaveShift = 12 * Math.round((refEventMidi - scalePitch(refDegree, key, mode)) / 12);
  let best = refDegree;
  let bestDist = Infinity;
  for (let d = refDegree - 14; d <= refDegree + 14; d++) {
    const dist = Math.abs(scalePitch(d, key, mode) + octaveShift - targetMidi);
    if (dist < bestDist || (dist === bestDist && Math.abs(d - refDegree) < Math.abs(best - refDegree))) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/** Shift a raw MIDI pitch by `steps` scale degrees (for non-lead-sheet pieces). */
export function shiftMidiByScaleSteps(midi: number, steps: number, key: KeyName, mode: ScaleMode): number {
  let d0 = 0;
  let bestDist = Infinity;
  for (let d = -21; d <= 28; d++) {
    const dist = Math.abs(scalePitch(d, key, mode) - midi);
    if (dist < bestDist) {
      bestDist = dist;
      d0 = d;
    }
  }
  const shifted = scalePitch(d0 + steps, key, mode);
  return Math.max(36, Math.min(92, shifted));
}
