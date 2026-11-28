import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Deck: Studio 404 Master-Tape Logger & Timecode Archivist (vertical brushed-silver counter-deck). */
export const deck = new MoppetCharacter({
  id: "deck",
  name: "Deck",
  role: "Master-tape logger & timecode archivist",
  color: "#8e9a8c",
  body: { female: 0.05, child: 0 },
  size: 1.16,
  artic: { larynx: -0.25, velum: 0.02, root: 0.04, epilarynx: 0.4 },
  source: { tension: 0.66, breathiness: 0.04, roughness: 0.02, brightness: 0.48, pressure: 7.4, glide: 0.06, drift: 2.5, vibratoRate: 5.0 },
  vibrato: 8,
  register: [42, 58],
  octave: -12,
  lyrics: introLyrics("deck"),
  prop: "reels",
  pad: "bom",
});
