/**
 * Each Moppet's animation is its own file in `./anim/<id>.json` (made by `tools/gen-moppet-anim.ts`
 * from AniCraft). To swap one, replace its file, or change its import below. Engine-free.
 */
import chip from "./anim/chip.json";
import clacker from "./anim/clacker.json";
import clank from "./anim/clank.json";
import gruff from "./anim/gruff.json";
import pip from "./anim/pip.json";
import rattle from "./anim/rattle.json";
import scribe from "./anim/scribe.json";
import tabby from "./anim/tabby.json";
import thrum from "./anim/thrum.json";
import vee from "./anim/vee.json";

export interface AnimFile {
  moppet: string;
  source: string;
  fps: number;
  /** dx, dy (fractions of the sprite's height, +y down), sx, sy (factors), rot (degrees), then headRot if the file has it. */
  columns: string[];
  clips: Record<string, number[][]>;
}

export const ANIMATIONS: Record<string, AnimFile> = { chip, clacker, clank, gruff, pip, rattle, scribe, tabby, thrum, vee };

export interface MoppetPose {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
  headRot: number;
}

export const clipNames = (id: string): string[] => Object.keys(ANIMATIONS[id]?.clips ?? {});

export function clipSeconds(id: string, clip: string): number {
  const a = ANIMATIONS[id];
  return (a?.clips[clip]?.length ?? 0) / (a?.fps || 24);
}

/** Interpolate a raw clip table `[dx, dy, sx, sy, rot, headRot?]` at `t` seconds. */
export function samplePoseRows(rows: readonly number[][] | undefined, fps: number, t: number, scale = 1, loop = false): MoppetPose | null {
  if (!rows || rows.length < 2 || t < 0) return null;
  const dur = (rows.length - 1) / fps;
  const local = loop ? ((t % dur) + dur) % dur : t;
  if (!loop && local >= dur) return null;
  const f = local * fps;
  const i = Math.min(rows.length - 2, Math.floor(f));
  const p = rows[i], q = rows[i + 1], k = f - i;
  const mix = (j: number) => (p[j] ?? 0) + ((q[j] ?? 0) - (p[j] ?? 0)) * k;
  return { dx: mix(0) * scale, dy: mix(1) * scale, sx: 1 + (mix(2) - 1) * scale, sy: 1 + (mix(3) - 1) * scale, rot: mix(4) * scale, headRot: mix(5) * scale };
}

/** Sample `clip` of a Moppet at `t` seconds; null before it starts or (unless `loop`) after it ends. `scale` softens it. */
export function poseAt(id: string, clip: string, t: number, scale = 1, loop = false): MoppetPose | null {
  const a = ANIMATIONS[id];
  return a ? samplePoseRows(a.clips[clip], a.fps, t, scale, loop) : null;
}
