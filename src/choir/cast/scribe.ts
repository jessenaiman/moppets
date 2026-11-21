import { introLyrics } from "../songs.ts";
import type { Moppet } from "./moppet.ts";

/** Scribe. Her typewriter types the line she is singing. */
export const scribe: Moppet = {
  voice: { id: "scribe", name: "Scribe", role: "The typewriter rabbit", color: "#c98a8e", body: { female: 0.3, child: 0.9 }, size: 0.95, artic: { larynx: 0.5, velum: 0.5, root: 0.2, epilarynx: 0.55, ventricular: 0 }, source: { tension: 0.78, breathiness: 0.04, roughness: 0.06, brightness: 0.85, pressure: 10, glide: 0.008, drift: 1 }, vibrato: 3, register: [62, 79], octave: 0, level: 0.91, lyrics: introLyrics("scribe") },
  art: "cels",
  prop: "typewriter",
  pad: "oo",
  seat: 2,
};
