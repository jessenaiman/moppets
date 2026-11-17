import type { Moppet } from "./moppet.ts";

/** Tabby. Her screen traces her glottal flow. */
export const tabby: Moppet = {
  voice: { id: "tabby", name: "Tabby", role: "The patchwork soprano", color: "#2fbfa0", body: { female: 0.9, child: 0.1 }, artic: { larynx: 0.3, velum: 0.05, root: 0.1, epilarynx: 0.15, ventricular: 0 }, source: { tension: 0.55, breathiness: 0.22, roughness: 0.04, brightness: 0.6, pressure: 10, glide: 0.03, drift: 4, vibratoRate: 6.5 }, vibrato: 30, register: [65, 81], octave: 0, level: 1.3, lyrics: ["I am Tabby stitched from old cloth", "My screen purrs soft and keeps you warm"] },
  art: "cels",
  prop: "scope",
  pad: "oo",
  seat: 4,
};
