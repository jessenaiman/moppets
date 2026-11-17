import type { Moppet } from "./moppet.ts";

/** Clank. His drive bay lights with the breath behind his voice. */
export const clank: Moppet = {
  voice: { id: "clank", name: "Clank", role: "The robot tenor", color: "#7f9a8c", body: { female: 0, child: 0 }, size: 1.5, artic: { larynx: 0, velum: 0.03, root: 0, epilarynx: 0.65, ventricular: 0 }, source: { tension: 0.92, breathiness: 0, roughness: 0, brightness: 0.7, pressure: 10, glide: 0.002, drift: 0 }, vibrato: 0, register: [38, 50], octave: -24, level: 1, lyrics: ["I am Clank I hold the whole room", "My big old heart is made of boom"] },
  art: "cels",
  prop: "lamps",
  pad: "bom",
  seat: 0,
};
