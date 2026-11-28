/**
 * The cast's voices and the introduction's shared words. Each Studio 404 character is defined in
 * src/choir/cast/ (1-to-1 with its Character Master Bible).
 */
import { CAST } from "./cast/index.ts";

export type { MoppetArtic, MoppetSource, MoppetVoice } from "./cast/index.ts";
export { CAST } from "./cast/index.ts";

import { introLyrics } from "./songs.ts";
export const CHORUS = introLyrics("chorus");

export const CHIP = CAST.find((v) => v.id === "chip")!;
/** Default ensemble core choir membership. */
export const choirIds = ["neon", "cue", "clank", "watt", "gruff", "tabby", "zap"];
export const voices = choirIds.map((id) => CAST.find((v) => v.id === id)!);
export const introIds = [...choirIds, "chip"];
export const ROUND_GROUPS: readonly (readonly string[])[] = [
  ["neon", "clank"],
  ["cue", "gruff"],
  ["watt", "tabby"],
];

/** Mix level per singer, by canonical Bible id. */
export const MIX_LEVEL: Record<string, number> = Object.fromEntries(CAST.map((v) => [v.id, v.level]));
