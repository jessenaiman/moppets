import { introLyrics } from "../songs.ts";
import type { Moppet } from "./moppet.ts";

/** Chip. His floppy's drive light blinks on each syllable. */
export const chip: Moppet = {
  voice: { id: "chip", name: "Chip", role: "The floppy-disk bird", color: "#d6b53a", body: { female: 0.35, child: 0.75 }, size: 0.88, artic: { larynx: 1.3, velum: 0.03, root: 0.3, epilarynx: 0.2, ventricular: 0 }, source: { tension: 0.6, breathiness: 0.3, roughness: 0.02, brightness: 0.6, pressure: 9, glide: 0.02, drift: 3, vibratoRate: 7.5 }, vibrato: 14, register: [60, 76], octave: 0, level: 1, lyrics: introLyrics("chip") },
  art: "cels",
  prop: "led",
  pad: "oo",
};
