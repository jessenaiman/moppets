/**
 * How a Moppet's voice definition reaches its engine: the only place recipes turn into engine
 * values. Free of engine imports so the singer Workers can use it.
 */
import type { Gesture } from "@chimera/wasm/types.ts";
import type { MoppetSource, MoppetVoice } from "./voices.ts";

/** Tag of the held character posture; a live edit replaces it (see SingerCore.setCharacter). */
export const CHARACTER_TAG = 7001;

/**
 * For pitched singing, keep the character's timbre near CHIMERA's calibrated DEFAULT_SOURCE
 * while letting the MIDI score own F0 (fry pulls CHIMERA's oscillator toward 45 Hz).
 */
export function singingSource(source: Partial<MoppetSource>): Partial<MoppetSource> {
  const result: Partial<MoppetSource> = { fry: 0 };
  if (Number.isFinite(source.glide)) result.glide = Math.min(0.075, Math.max(0.06, source.glide!));
  if (Number.isFinite(source.drift)) result.drift = Math.min(6.5, Math.max(1.5, source.drift!));
  for (const key of ["tension", "breathiness", "roughness", "brightness", "pressure", "vibratoRate"] as const) {
    const n = source[key];
    if (typeof n === "number" && Number.isFinite(n)) result[key] = n;
  }
  return result;
}

/**
 * A vowel's gesture: its whole label is vowel symbols (a diphthong, a length mark). Anchored so
 * it never matches the planner's "velum", "aspiration", or "voiced frication" labels.
 */
const VOWEL = /^[aeiou\u0251\u0252\u00e6\u0259\u025a\u025b\u025c\u025d\u026a\u0254\u028a\u028c\u02d0]+$/;

/**
 * Gentle character posture held over the song: strength 1.2 colours the timbre without pinning
 * larynx/epilarynx against CHIMERA's calibrated per-vowel targets (strength 5 fought the planner).
 */
export function characterGesture(v: MoppetVoice, t0: number, end: number, tag: number): Gesture {
  return {
    t0,
    t1: end + 3600,
    rampIn: 0.02,
    rampOut: 0.05,
    strength: 1.2,
    targets: { larynx: v.artic.larynx, epilarynx: v.artic.epilarynx, ventricular: v.artic.ventricular },
    label: "character",
    tag,
  };
}

/**
 * A planned gesture as this voice sings it: subtle vowel root colour and recipe vibrato depth.
 * Consonant closures, fricatives (/s z f h/ fixed natively in upstream CHIMERA 0885014 & 54f8b74),
 * and pitches are owned cleanly by CHIMERA's planner.
 */
export function shapeGesture(g: Gesture, v: MoppetVoice, nasal: boolean, speech = false): Gesture {
  const vibrato = g.targets.vibrato;
  if ((!g.label || !VOWEL.test(g.label)) && vibrato === undefined) return g;
  const targets = { ...g.targets };
  if (vibrato !== undefined && !speech) targets.vibrato = v.vibrato;
  if (g.label && VOWEL.test(g.label)) {
    if (targets.root !== undefined) targets.root = Math.max(-1, Math.min(1, targets.root + (v.artic.root || 0) * 0.5));
    if (nasal && v.artic.velum > 0) targets.velum = Math.min(0.16, v.artic.velum);
  }
  return { ...g, targets };
}
