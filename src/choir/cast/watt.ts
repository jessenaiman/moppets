import type { Moppet } from "./moppet.ts";
import { introLyrics } from "../songs.ts";

export const watt: Moppet = {
  voice: {
    id: "watt", name: "Watt", role: "Six-socket power strip", color: "#e06a4f",
    register: [47, 62], octave: -12, size: 1.17, level: 1,
    body: { female: 0.18, child: 0.06 },
    artic: { larynx: -0.34, velum: 0.07, root: 0.17, epilarynx: 0.25, ventricular: 0.1 },
    source: { tension: 0.6, breathiness: 0.065, roughness: 0.24, brightness: 0.53, pressure: 10.8, glide: 0.039, drift: 4.8, vibratoRate: 4.8 },
    vibrato: 11, lyrics: introLyrics("watt"),
  },
  art: "cels", prop: "led", pad: "oo",
};
