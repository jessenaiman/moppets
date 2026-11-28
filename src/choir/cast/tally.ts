import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Tally: Studio 404 Stage Manager Owl with red tally beacon & clothespin beak. */
export const tally = new MoppetCharacter({
  id: "tally",
  name: "Tally",
  role: "Stage manager owl · clothespin beak",
  color: "#e06a4f",
  body: { female: 0.72, child: 0.25 },
  size: 0.89,
  artic: { larynx: 0.24, velum: 0.05, root: 0.08, epilarynx: 0.26, ventricular: 0.14 },
  source: { breathiness: 0.22, roughness: 0.14, brightness: 0.28, glide: 0.06, drift: 3.8 },
  vibrato: 16,
  register: [60, 77],
  octave: 0,
  lyrics: introLyrics("tally"),
  prop: "led",
  pad: "oo",
});
