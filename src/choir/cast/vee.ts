import { introLyrics } from "../songs.ts";
import type { Moppet } from "./moppet.ts";

/** Vee. Her tape reels turn with the air she pushes out. */
export const vee: Moppet = {
  voice: { id: "vee", name: "Vee", role: "The tape-deck fox", color: "#c9662e", body: { female: 0, child: 0 }, artic: { larynx: -0.1, velum: 0.05, root: 0.05, epilarynx: 0.15, ventricular: 0 }, source: { tension: 0.5, breathiness: 0.14, roughness: 0.035, brightness: 0.35, pressure: 9, glide: 0.009, drift: 1 }, vibrato: 4, register: [50, 67], octave: -12, level: 0.91, lyrics: introLyrics("vee") },
  art: "solo",
  prop: "reels",
  pad: "oo",
  seat: 0,
};
