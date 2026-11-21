/**
 * How a Moppet's voice definition reaches its engine: the only place recipes turn into engine
 * values. Free of engine imports so the singer Workers can use it.
 */
import type { Gesture } from "@chimera/wasm/types.ts";
import type { MoppetSource, MoppetVoice } from "./voices.ts";

/** Tag of the held character posture; a live edit replaces it (see SingerCore.setCharacter). */
export const CHARACTER_TAG = 7001;
/** For pitched singing, keep the character's timbre but let the score own F0.
 * In CHIMERA, fry pulls the oscillator towards 45 Hz. Old saved recipes and
 * live edits must go through the same boundary as factory voices. */
export function singingSource(source: Partial<MoppetSource>): Partial<MoppetSource> {
  const result: Partial<MoppetSource> = { fry: 0 };
  if (Number.isFinite(source.glide)) result.glide = Math.min(.050, Math.max(.025, source.glide!));
  if (Number.isFinite(source.drift)) result.drift = Math.min(6, Math.max(3, source.drift!));
  for (const key of ["tension","breathiness","roughness","brightness","pressure","vibratoRate"] as const) {
    const n = source[key];
    if (typeof n === "number" && Number.isFinite(n)) result[key] = n;
  }
  return result;
}

/**
 * A vowel's gesture: its whole label is vowel symbols (a diphthong, a length mark). Unanchored, the
 * test matched the planner's other labels too ("velum", "aspiration", "voiced frication"), and the
 * recipe's velum replaced every nasal consonant's opening: /m n ŋ/ came out oral.
 */
const VOWEL = /^[aeiou\u0251\u0252\u00e6\u0259\u025a\u025b\u025c\u025d\u026a\u0254\u028a\u028c\u02d0]+$/;

/** The steady posture a singer holds over the whole song. */
export function characterGesture(v: MoppetVoice, t0: number, end: number, tag: number): Gesture {
  return { t0, t1: end + 3600, rampIn: 0.01, rampOut: 0.05, strength: 5, targets: { larynx: v.artic.larynx, epilarynx: v.artic.epilarynx, ventricular: v.artic.ventricular }, label: "character", tag };
}

/**
 * A planned gesture as this voice sings it: vowel posture and vibrato depth. Applied as gestures
 * are scheduled, so an edit reaches every note not yet sung. Consonant closures are left alone,
 * so the lyrics stay pronounceable, and no value here touches a pitch.
 * `nasal`: the velum recipe only colours solo-voiced pieces; on sustained choir parts it swallowed the voice.
 */
export function shapeGesture(g: Gesture, v: MoppetVoice, nasal: boolean, speech = false): Gesture {
  if (!speech && (g.label === "s" || g.label === "f" || g.label === "h")) {
    return {...g, targets: {...g.targets, abduction: Math.max(.45, g.targets.abduction ?? 0)}};
  }
  const vibrato = g.targets.vibrato;
  if ((!g.label || !VOWEL.test(g.label)) && vibrato === undefined) return g;
  const targets = { ...g.targets };
  if (vibrato !== undefined && !speech) targets.vibrato = v.vibrato;
  if (g.label && VOWEL.test(g.label)) {
    if (targets.root !== undefined) targets.root = Math.max(-1, Math.min(1, targets.root + (v.artic.root || 0)));
    if (nasal) targets.velum = v.artic.velum;
  }
  return { ...g, targets };
}
