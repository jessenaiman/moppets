/**
 * Band animation clips. Each member's clips live in their own file (`./anim/thrum.json`, `clacker`,
 * `rattle`; see moppetAnim.ts). Engine-free so any UI or worker module can import it.
 */
import { clipSeconds, poseAt } from "./moppetAnim.ts";

export type BandClipName =
  | "thrum-pluck"
  | "clacker-play"
  | "rattle-kick"
  | "rattle-snare"
  | "rattle-hat"
  | "rattle-crash"
  | "rattle-beatbox";

export interface BandPose {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
}

/** A band clip is named `<member>-<move>`. */
const member = (name: BandClipName) => name.split("-")[0];

export const bandClipSeconds = (name: BandClipName) => clipSeconds(member(name), name);

/** Sample a clip at `t` seconds (or `loop: true` for repeating grooves like `rattle-beatbox`). */
export function bandPoseAt(name: BandClipName, t: number, scale = 1, loop = false): BandPose | null {
  return poseAt(member(name), name, t, scale, loop);
}
