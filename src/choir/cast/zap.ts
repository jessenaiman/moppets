import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Zap: Handheld 90s universal remote, self-appointed director (tiny clicky airway). */
export const zap = new MoppetCharacter({
  id: "zap",
  name: "Zap",
  role: "Universal remote, self-appointed director",
  color: "#7fd36b",
  body: { female: 0.5, child: 0.9 },
  size: 0.99,
  artic: { larynx: 0.82, velum: 0.02, root: 0.24, epilarynx: 0.42, ventricular: 0.14 },
  source: { tension: 0.64, breathiness: 0.04, roughness: 0.03, brightness: 0.48, pressure: 7.4, glide: 0.06, drift: 2.5, vibratoRate: 6.5 },
  vibrato: 10,
  register: [60, 75],
  octave: 0,
  lyrics: introLyrics("zap"),
  prop: "led",
  pad: "oo",
  seat: 7,
});
