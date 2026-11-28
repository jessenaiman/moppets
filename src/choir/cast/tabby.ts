import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Tabby: inherits `MoppetCharacter` base, overriding only her soprano recipe & scope prop. */
export const tabby = new MoppetCharacter({
  id: "tabby",
  name: "Tabby",
  role: "The patchwork soprano",
  color: "#2fbfa0",
  body: { female: 0.9, child: 0.1 },
  size: 1.02,
  artic: { larynx: 0.2, velum: 0.03, root: 0.08, epilarynx: 0.14 },
  source: { tension: 0.52, roughness: 0.03, brightness: 0.32, pressure: 7.3, glide: 0.06, drift: 4.5, vibratoRate: 6.1 },
  vibrato: 28,
  register: [60, 75],
  level: 1.1,
  lyrics: introLyrics("tabby"),
  prop: "scope",
  seat: 4,
});
