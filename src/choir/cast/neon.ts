import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Neon: Studio 404 backstage dual-tube neon sign. */
export const neon = new MoppetCharacter({
  id: "neon",
  name: "Neon",
  role: "Backstage dual-tube neon sign",
  color: "#57d3e8",
  body: { female: 0.56, child: 0.08 },
  size: 1.02,
  artic: { larynx: 0.26, velum: 0.03, root: -0.06, epilarynx: 0.38 },
  source: { tension: 0.65, breathiness: 0.04, roughness: 0.04, brightness: 0.48, pressure: 7.3, glide: 0.06, drift: 3.8, vibratoRate: 5.8 },
  vibrato: 16,
  register: [54, 72],
  octave: -12,
  level: 0.98,
  lyrics: introLyrics("neon"),
  prop: "lamps",
  pad: "oo",
  seat: 0,
});
