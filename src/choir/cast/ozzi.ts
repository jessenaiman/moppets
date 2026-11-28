import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Ozzi: Goth-Rock Oscilloscope Mop (Prince of Patchbays — tribute to Ozzy Osbourne). */
export const ozzi = new MoppetCharacter({
  id: "ozzi",
  name: "Ozzi",
  role: "Goth-rock oscilloscope · Prince of Patchbays",
  color: "#8f6bff",
  body: { female: 0.12, child: 0 },
  size: 1.06,
  artic: { larynx: -0.2, velum: 0.09, root: -0.08, epilarynx: 0.44, ventricular: 0.28 },
  source: { tension: 0.62, breathiness: 0.08, roughness: 0.28, brightness: 0.5, pressure: 7.9, glide: 0.062, drift: 5.2, vibratoRate: 6.3 },
  vibrato: 24,
  register: [48, 66],
  octave: -12,
  lyrics: introLyrics("ozzi"),
  prop: "scope",
  pad: "oo",
});
