/**
 * Gesture clips (laugh, shrug, gasp, nod, tilt, bow, cheer), animated in AniCraft
 * (tools/moppets/gestures.anicraft) and sampled per frame by tools/gen-gestures.ts. Any Moppet can
 * play any clip: a clip is a pose offset from rest, pivoting at the feet, so it rides on top of
 * the stage's walking, facing and dancing.
 */
import table from "./gestures.generated.json";

export type GestureName = "laugh" | "shrug" | "gasp" | "nod" | "tilt" | "bow" | "cheer";
export const GESTURES = Object.keys(table.clips) as GestureName[];

export interface GesturePose {
  /** offset from rest, as a fraction of the puppet's height (+y down) */
  dx: number;
  dy: number;
  /** scale factors */
  sx: number;
  sy: number;
  /** degrees, clockwise as the puppet faces right */
  rot: number;
  /** independent head rotation in degrees */
  headRot: number;
}

const clips = table.clips as Record<string, number[][]>;

/** Seconds a clip lasts. */
export const gestureSeconds = (name: GestureName) => (clips[name]?.length ?? 0) / table.fps;

/** The pose `t` seconds into a clip, or null before it starts and once it has ended. */
export function gestureAt(name: GestureName, t: number): GesturePose | null {
  const rows = clips[name];
  if (!rows || t < 0) return null;
  const f = t * table.fps;
  const i = Math.floor(f);
  if (i >= rows.length - 1) return null;
  const a = rows[i], b = rows[i + 1], k = f - i;
  const mix = (j: number) => (a[j] ?? 0) + ((b[j] ?? 0) - (a[j] ?? 0)) * k;
  return { dx: mix(0), dy: mix(1), sx: mix(2), sy: mix(3), rot: mix(4), headRot: mix(5) };
}
