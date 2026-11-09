/** The held character posture, free of engine imports so the singer Workers can use it. */
import type { Gesture } from "../wasm/types.ts";
import type { MoppetVoice } from "./voices.ts";

/** Tag of the held character posture; a live edit replaces it (see SingerCore.setCharacter). */
export const CHARACTER_TAG = 7001;

export function characterGesture(v: MoppetVoice, t0: number, end: number, tag: number): Gesture {
  return { t0, t1: end + 3600, rampIn: 0.01, rampOut: 0.05, strength: 5, targets: { larynx: v.artic.larynx, epilarynx: v.artic.epilarynx, ventricular: v.artic.ventricular }, label: "character", tag };
}
