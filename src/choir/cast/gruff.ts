import type { Moppet } from "./moppet.ts";

/** Gruff. His belly dial warms up the longer he sings. */
export const gruff: Moppet = {
  voice: { id: "gruff", name: "Gruff", role: "The gravelly monster", color: "#9c9bc9", body: { female: 0, child: 0 }, size: 1.5, artic: { larynx: -1, velum: 0.1, root: -0.2, epilarynx: 0.3, ventricular: 0.75 }, source: { tension: 0.3, breathiness: 0.28, roughness: 0.72, brightness: 0.25, pressure: 10, glide: 0.04, drift: 5 }, vibrato: 12, register: [45, 62], octave: -12, level: 0.85, lyrics: ["I am Babel I speak all tongues", "My radio warms up my lungs"] },
  art: "cels",
  prop: "dial",
  pad: "oo",
  seat: 2,
};
