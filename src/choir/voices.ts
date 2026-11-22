/**
 * The cast's voices and the introduction's shared words. Each Moppet is defined in
 * src/choir/cast/ (one file each); this module keeps the names the rest of the app imports.
 */
import { CAST } from "./cast/index.ts";

export type { MoppetArtic, MoppetSource, MoppetVoice } from "./cast/index.ts";
export { CAST } from "./cast/index.ts";

import { introLyrics } from "./songs.ts";
export const CHORUS = introLyrics("chorus");

/** Chip, the newest and smallest Moppet: the character Claude gave itself, a soloist in song 03. */
export const CHIP = CAST.find((v) => v.id === "chip")!;
/** Score membership is independent of the selectable voice library. */
export const choirIds = ["vee", "scribe", "clank", "pip", "gruff", "tabby", "zap"];
export const voices = choirIds.map(id => CAST.find(v => v.id === id)!);
export const introIds = [...choirIds, "chip"];
export const ROUND_GROUPS: readonly (readonly string[])[] = [["vee", "clank"], ["scribe", "gruff"], ["pip", "tabby"]];

/** Mix level per singer, by id (from each voice's `level`). */
export const MIX_LEVEL: Record<string, number> = Object.fromEntries(CAST.map((v) => [v.id, v.level]));
