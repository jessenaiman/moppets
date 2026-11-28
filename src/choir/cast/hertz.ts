import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Hertz: Tall 150 DU 90s wood-grain console CRT TV straight man. */
export const hertz = new MoppetCharacter({
  id: "hertz",
  name: "Hertz",
  role: "90s wood-grain console CRT TV",
  color: "#7be86b",
  body: { female: 0.54, child: 0.06 },
  size: 1.04,
  artic: { larynx: -0.22, velum: 0.12, root: -0.14, epilarynx: 0.02, ventricular: 0.16 },
  source: { tension: 0.38, breathiness: 0.12, roughness: 0.26, brightness: 0.15, pressure: 7.3, glide: 0.06, drift: 4.0, vibratoRate: 6.1 },
  vibrato: 18,
  register: [48, 64],
  octave: -12,
  lyrics: introLyrics("hertz"),
  prop: "scope",
  pad: "oo",
});
