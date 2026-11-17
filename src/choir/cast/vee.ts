import type { Moppet } from "./moppet.ts";

/** Vee. Her tape reels turn with the air she pushes out. */
export const vee: Moppet = {
  voice: { id: "vee", name: "Vee", role: "The tape-deck fox", color: "#c9662e", body: { female: 0, child: 0 }, artic: { larynx: -0.1, velum: 0.05, root: 0.05, epilarynx: 0.15, ventricular: 0 }, source: { tension: 0.5, breathiness: 0.14, roughness: 0.08, brightness: 0.35, pressure: 9, glide: 0.05, drift: 14 }, vibrato: 10, register: [50, 67], octave: -12, level: 0.91, lyrics: ["I am Vee my teeth keep the beat", "I bite the tape and tap my feet"] },
  art: "solo",
  prop: "reels",
  pad: "oo",
  seat: 0,
};
