/**
 * The cast, in stage order. A new Moppet is one file in this folder and one entry here (see
 * moppet.ts).
 */
import type { Moppet, MoppetVoice } from "./moppet.ts";
import { vee } from "./vee.ts";
import { scribe } from "./scribe.ts";
import { clank } from "./clank.ts";
import { pip } from "./pip.ts";
import { gruff } from "./gruff.ts";
import { tabby } from "./tabby.ts";
import { chip } from "./chip.ts";

export type { Moppet, MoppetArtic, MoppetSource, MoppetVoice, PropEffect } from "./moppet.ts";

export const MOPPETS: readonly Moppet[] = [vee, scribe, clank, pip, gruff, tabby, chip];

const byId = new Map(MOPPETS.map((m) => [m.voice.id, m]));
/** A Moppet by id (a voice id that isn't one, such as a guest's, gets "oo" and no seat). */
export function moppet(id: string): Moppet | undefined {
  return byId.get(id);
}
/** What a singer hums when it backs a song. */
export const padOf = (id: string) => moppet(id)?.pad ?? "oo";
/** Everyone's place in the last chord: [id, scale steps above home]. */
export const FINALE_SEATS: readonly [string, number][] = MOPPETS.flatMap((m) => (m.seat === undefined ? [] : [[m.voice.id, m.seat] as [string, number]]));

/** The cast's voices (the recipes), in stage order. */
export const CAST: readonly MoppetVoice[] = MOPPETS.map((m) => m.voice);
