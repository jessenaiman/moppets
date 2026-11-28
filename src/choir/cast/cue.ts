import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Cue: Studio 404 brass-hood teleprompter & stage director. */
export const cue = new MoppetCharacter({
  id: "cue",
  name: "Cue",
  role: "Brass-hood teleprompter & stage director",
  color: "#c9c2ae",
  body: { female: 0.35, child: 0.62 },
  size: 0.91,
  artic: { larynx: 0.28, velum: 0.04, root: 0.12, epilarynx: 0.34, ventricular: 0.28 },
  source: { tension: 0.54, breathiness: 0.22, roughness: 0.38, brightness: 0.4, pressure: 7.4, glide: 0.06, drift: 3.2, vibratoRate: 6.0 },
  vibrato: 8,
  register: [60, 77],
  octave: 0,
  level: 0.96,
  lyrics: introLyrics("cue"),
  prop: "typewriter",
  pad: "oo",
  seat: 2,
});
