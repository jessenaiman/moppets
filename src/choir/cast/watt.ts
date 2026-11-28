import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Watt: Studio 404 six-socket power strip. */
export const watt = new MoppetCharacter({
  id: "watt",
  name: "Watt",
  role: "Six-socket power strip",
  color: "#e06a4f",
  body: { female: 0.22, child: 0.08 },
  size: 1.18,
  artic: { larynx: -0.34, velum: 0.06, root: 0.08, epilarynx: 0.16, ventricular: 0.26 },
  source: { tension: 0.44, breathiness: 0.22, roughness: 0.34, brightness: 0.22, pressure: 7.6, glide: 0.06, drift: 4.0, vibratoRate: 5.2 },
  vibrato: 12,
  register: [55, 72],
  octave: 0,
  level: 1.04,
  lyrics: introLyrics("watt"),
  prop: "led",
  pad: "oo",
  seat: 4,
});
