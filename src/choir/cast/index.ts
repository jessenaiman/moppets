/**
 * The canonical 20 Studio 404 characters, in stage order — 1-to-1 with the 20 Character Master Bibles.
 */
import { MoppetCharacter, type Moppet, type MoppetVoice } from "./moppet.ts";
import { neon } from "./neon.ts";
import { cue } from "./cue.ts";
import { clank } from "./clank.ts";
import { watt } from "./watt.ts";
import { gruff } from "./gruff.ts";
import { tabby } from "./tabby.ts";
import { chip } from "./chip.ts";
import { zap } from "./zap.ts";
import { folio } from "./folio.ts";
import { tracker } from "./tracker.ts";
import { hertz } from "./hertz.ts";
import { ozzi } from "./ozzi.ts";
import { deck } from "./deck.ts";
import { tally } from "./tally.ts";
import { clacker } from "./clacker.ts";
import { click } from "./click.ts";
import { fuzz } from "./fuzz.ts";
import { leadsinger } from "./leadsinger.ts";
import { moonbell } from "./moonbell.ts";
import { thrum } from "./thrum.ts";

export {
  neon,
  cue,
  clank,
  watt,
  gruff,
  tabby,
  chip,
  zap,
  folio,
  tracker,
  hertz,
  ozzi,
  deck,
  tally,
  clacker,
  click,
  fuzz,
  leadsinger,
  moonbell,
  thrum,
};
export {
  MoppetCharacter,
  MOPPET_STAGE_ACTIONS,
  type Moppet,
  type MoppetActionId,
  type MoppetArtic,
  type MoppetSource,
  type MoppetVoice,
  type PropEffect,
} from "./moppet.ts";

/** Every Studio 404 character instantiated through the single OO `MoppetCharacter` base class. */
export const MOPPETS: readonly MoppetCharacter[] = [
  neon,
  cue,
  clank,
  watt,
  gruff,
  tabby,
  chip,
  zap,
  folio,
  tracker,
  hertz,
  ozzi,
  deck,
  tally,
  clacker,
  click,
  fuzz,
  leadsinger,
  moonbell,
  thrum,
].map(MoppetCharacter.from);

const byId = new Map(MOPPETS.map((m) => [m.voice.id, m]));
export function moppet(id: string): Moppet | undefined {
  return byId.get(id);
}
export const padOf = (id: string) => moppet(id)?.pad ?? "oo";
export const FINALE_SEATS: readonly [string, number][] = MOPPETS.flatMap((m) =>
  m.seat === undefined ? [] : [[m.voice.id, m.seat] as [string, number]],
);

/** The cast's voices (the recipes), in canonical Studio 404 order. */
export const CAST: readonly MoppetVoice[] = MOPPETS.map((m) => m.voice);
