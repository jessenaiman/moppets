/**
 * How a Moppet's voice definition reaches its engine: the only place recipes turn into engine
 * values. Free of engine imports so the singer Workers can use it.
 */
import type { Gesture } from "../wasm/types.ts";
import type { MoppetVoice } from "./voices.ts";

/** Tag of the held character posture; a live edit replaces it (see SingerCore.setCharacter). */
export const CHARACTER_TAG = 7001;
/** Vibrato the planner is asked for; each voice scales it to its own depth when it is scheduled. */
export const PLAN_VIBRATO = 12;
const VOWEL = /[aeiou\u0251\u0252\u00e6\u0259\u025b\u025c\u025d\u026a\u0254\u028a\u028c]/;

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
export function shapeGesture(g: Gesture, v: MoppetVoice, nasal: boolean): Gesture {
  const scale = v.vibrato / PLAN_VIBRATO;
  const vibrato = g.targets.vibrato;
  if ((!g.label || !VOWEL.test(g.label)) && vibrato === undefined) return g;
  const targets = { ...g.targets };
  if (vibrato !== undefined) targets.vibrato = vibrato * scale;
  if (g.label && VOWEL.test(g.label)) {
    if (targets.root !== undefined) targets.root = Math.max(-1, Math.min(1, targets.root + (v.artic.root || 0)));
    if (nasal && targets.velum !== undefined) targets.velum = v.artic.velum;
  }
  return { ...g, targets };
}
