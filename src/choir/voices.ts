/**
 * The cast's voices and the introduction's shared words. Each Moppet is defined in
 * src/choir/cast/ (one file each); this module keeps the names the rest of the app imports.
 */
import { CAST } from "./cast/index.ts";

export type { MoppetArtic, MoppetSource, MoppetVoice } from "./cast/index.ts";
export { CAST } from "./cast/index.ts";

export const INTRO_BPM = 116;
export const CHORUS = ["We are the scraps that found a song", "At four oh four we all belong"];

/** Chip, the newest and smallest Moppet: the character Claude gave itself, a soloist in song 03. */
export const CHIP = CAST.find((v) => v.id === "chip")!;
/** The six who sing the introduction and the round (everyone but Chip). */
export const voices = CAST.filter((v) => v.id !== "chip");

/** Mix level per singer, by id (from each voice's `level`). */
export const MIX_LEVEL: Record<string, number> = Object.fromEntries(CAST.map((v) => [v.id, v.level]));
