import type { Moppet } from "./moppet.ts";
import { introLyrics } from "../songs.ts";

export const neon: Moppet = {
  voice: {
    id: "neon", name: "Neon", role: "Twin-tube neon sign", color: "#57d3e8",
    register: [62, 76], octave: 0, size: 0.94, level: 1,
    body: { female: 0.48, child: 0.08 },
    artic: { larynx: 0.25, velum: 0.05, root: -0.14, epilarynx: 0.3, ventricular: 0.03 },
    source: { tension: 0.64, breathiness: 0.055, roughness: 0.1, brightness: 0.78, pressure: 9, glide: 0.034, drift: 4, vibratoRate: 5.6 },
    vibrato: 14, lyrics: introLyrics("neon"),
  },
  art: "cels", prop: "lamps", pad: "oo",
};
