import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Chip. His floppy's drive light blinks on each syllable. */
export const chip = new MoppetCharacter({
  id: "chip",
  name: "Chip",
  role: "The floppy-disk bird",
  color: "#d6b53a",
  body: { female: 0.45, child: 0.68 },
  size: 0.98,
  artic: { larynx: 0.62, velum: 0.02, root: 0.2, epilarynx: 0.16, ventricular: 0.14 },
  source: { tension: 0.46, breathiness: 0.2, roughness: 0.08, brightness: 0.22, pressure: 7.1, glide: 0.06, drift: 3.5, vibratoRate: 6.5 },
  vibrato: 16,
  register: [60, 76],
  octave: 0,
  lyrics: introLyrics("chip"),
  prop: "led",
  pad: "oo",
});
