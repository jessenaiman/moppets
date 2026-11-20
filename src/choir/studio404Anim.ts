/**
 * Studio 404 cast + balcony critics animation sampler (from `tools/moppets/studio404.anicraft`,
 * sampled into `./anim/studio404.json`). Pure and engine-free.
 */
import data from "./anim/studio404.json";
import { samplePoseRows } from "./moppetAnim.ts";

export interface Studio404Pose {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
}

const CLIPS = data.clips as Record<string, number[][]>;
const FPS = data.fps || 24;

export const STUDIO_404_CLIP_NAMES = Object.keys(CLIPS);

const VOICE_DANCE: Record<string, string> = {
  vee: "neon-dance",
  scribe: "cue-dance",
  clank: "clank-dance",
  pip: "watt-dance",
  gruff: "gruff-dance",
  tabby: "tabby-dance",
  chip: "chip-dance",
};

export function studio404ClipSeconds(clip: string): number {
  return (CLIPS[clip]?.length ?? 0) / FPS;
}

/** Sample `clip` at `t` seconds; returns null before t = 0 or after end unless `loop` is true. */
export function studio404PoseAt(clip: string, t: number, scale = 1, loop = false): Studio404Pose | null {
  return samplePoseRows(CLIPS[clip], FPS, t, scale, loop);
}

/** Expressive Studio 404 character dance on the 2-beat bar pulse. */
export function studio404DanceAt(
  voiceId: string,
  beat: number,
  singing: boolean,
  level: number,
  still = false,
): Studio404Pose | null {
  if (still) return null;
  const clip = VOICE_DANCE[voiceId];
  if (!clip) return null;
  const dur = studio404ClipSeconds(clip);
  if (dur <= 0) return null;
  const phase = (((beat % 2) + 2) % 2) / 2;
  const t = phase * ((CLIPS[clip].length - 1) / FPS);
  const scale = singing ? 0.65 + 0.55 * Math.min(1, Math.max(0, level)) : 0.36;
  return studio404PoseAt(clip, t, scale, true);
}

/** Independent comedic duet animation state for Tracking (tall VCR) & Hertz (squat CRT). */
export interface DuetActorState {
  singing: boolean;
  mouthOpen: boolean;
  cel: number;
  pose: Studio404Pose | null;
}

export function duetCriticsStateAt(
  beat: number,
  playing: boolean,
  still = false,
): { tracking: DuetActorState; hertz: DuetActorState } {
  if (!playing || still) {
    return {
      tracking: { singing: false, mouthOpen: false, cel: 7, pose: null },
      hertz: { singing: false, mouthOpen: false, cel: 7, pose: null },
    };
  }
  const phase = ((beat % 16) + 16) % 16;
  const trackingSing = (phase >= 4 && phase < 7.5) || (phase >= 11 && phase < 15.5);
  const hertzSing = (phase >= 7.5 && phase < 15.5);
  const trackingOpen = trackingSing && Math.sin(beat * Math.PI * 3.1) > -0.15;
  const hertzOpen = hertzSing && Math.sin(beat * Math.PI * 3.4 + 1.1) > -0.15;
  const trackingCel = Math.floor(Math.max(0, beat) * 2) % 8;
  const hertzCel = Math.floor(Math.max(0, beat) * 2 + 2) % 8;

  const trackingPose = studio404PoseAt(
    trackingSing ? "critics-tracking" : "critics-idle",
    Math.max(0, beat) * 0.42,
    trackingSing ? 0.85 : 0.45,
    true,
  );
  const hertzPose = studio404PoseAt(
    hertzSing ? "critics-hertz" : "critics-idle",
    Math.max(0, beat) * 0.48 + 0.35,
    hertzSing ? 0.92 : 0.5,
    true,
  );

  return {
    tracking: { singing: trackingSing, mouthOpen: trackingOpen, cel: trackingCel, pose: trackingPose },
    hertz: { singing: hertzSing, mouthOpen: hertzOpen, cel: hertzCel, pose: hertzPose },
  };
}

/** Tracking & Hertz balcony animation state across a 16-beat cycle. */
export function criticsStateAt(
  beat: number,
  playing: boolean,
  still = false,
): { art: "rest" | "tracking" | "hertz"; pose: Studio404Pose | null } {
  if (!playing || still) return { art: "rest", pose: null };
  const phase = ((beat % 16) + 16) % 16;
  if (phase >= 6 && phase < 9) {
    return { art: "tracking", pose: studio404PoseAt("critics-tracking", (phase - 6) * 0.45, 0.85, true) };
  }
  if (phase >= 13 && phase < 15.5) {
    return { art: "hertz", pose: studio404PoseAt("critics-hertz", (phase - 13) * 0.5, 0.9, true) };
  }
  return { art: "rest", pose: studio404PoseAt("critics-idle", Math.max(0, beat) * 0.35, 0.7, true) };
}
