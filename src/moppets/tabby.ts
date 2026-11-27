/**
 * Tabby (Mop #1): canonical Studio 404 character definition within CHIMERA's calibrated
 * `DEFAULT_SOURCE` and `chimera-midi-vocals` bounds.
 */
import type { BodyMix, Gesture } from "../wasm/types.ts";

export interface MoppetVoice {
  id: string;
  name: string;
  role: string;
  color: string;
  body: BodyMix;
  artic: {
    larynx: number;
    velum: number;
    root: number;
    epilarynx: number;
    ventricular: number;
  };
  source: {
    tension: number;
    breathiness: number;
    roughness: number;
    brightness: number;
    pressure: number;
    glide: number;
    drift: number;
    fry: number;
    vibratoRate: number;
  };
  vibrato: number;
  register: [number, number];
  octave: number;
  level: number;
}

export const TABBY_VOICE: MoppetVoice = {
  id: "tabby",
  name: "Tabby",
  role: "The patchwork soprano",
  color: "#2fbfa0",
  body: { female: 0.9, child: 0.1 },
  artic: {
    larynx: 0.2,
    velum: 0.03,
    root: 0.08,
    epilarynx: 0.14,
    ventricular: 0,
  },
  source: {
    tension: 0.52,
    breathiness: 0.15,
    roughness: 0.03,
    brightness: 0.32,
    pressure: 7.3,
    glide: 0.06,
    drift: 4.5,
    fry: 0,
    vibratoRate: 6.1,
  },
  vibrato: 28,
  register: [60, 75],
  octave: 0,
  level: 1.0,
};

export const CHARACTER_GESTURE_TAG = 7001;

/** Gentle held posture colouring Tabby's timbre without pinning CHIMERA's per-vowel articulators. */
export function tabbyCharacterGesture(t0: number, end: number): Gesture {
  return {
    t0,
    t1: end + 3600,
    rampIn: 0.02,
    rampOut: 0.05,
    strength: 1.2,
    targets: {
      larynx: TABBY_VOICE.artic.larynx,
      epilarynx: TABBY_VOICE.artic.epilarynx,
      ventricular: TABBY_VOICE.artic.ventricular,
    },
    label: "character",
    tag: CHARACTER_GESTURE_TAG,
  };
}
