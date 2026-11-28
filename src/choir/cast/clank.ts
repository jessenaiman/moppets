import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Clank: giant robot bass/tenor (`size: 1.46`) inheriting `MoppetCharacter` base. */
export const clank = new MoppetCharacter({
  id: "clank",
  name: "Clank",
  role: "The robot tenor",
  color: "#7f9a8c",
  size: 1.46,
  artic: { velum: 0.02, epilarynx: 0.44 },
  source: { tension: 0.68, breathiness: 0.04, roughness: 0.02, brightness: 0.5, pressure: 7.6, glide: 0.06, drift: 1.5 },
  vibrato: 0,
  register: [38, 50],
  octave: -24,
  lyrics: introLyrics("clank"),
  prop: "lamps",
  pad: "bom",
  seat: 0,
});
