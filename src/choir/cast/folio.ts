import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Folio: Studio 404 scroll teleprompter with word-eyes. */
export const folio = new MoppetCharacter({
  id: "folio",
  name: "Folio",
  role: "Scroll teleprompter with word-eyes",
  color: "#d4b483",
  body: { female: 0.42, child: 0.05 },
  size: 0.94,
  artic: { larynx: 0.08, velum: 0.03, root: 0.06, epilarynx: 0.24 },
  source: { tension: 0.58, breathiness: 0.04, roughness: 0.03, brightness: 0.42, pressure: 7.3, glide: 0.06, drift: 3.2, vibratoRate: 5.4 },
  vibrato: 10,
  register: [54, 69],
  octave: -12,
  lyrics: introLyrics("folio"),
  prop: "typewriter",
  pad: "oo",
});
