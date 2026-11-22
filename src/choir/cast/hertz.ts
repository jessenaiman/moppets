import type { Moppet } from "./moppet.ts";
import { introLyrics } from "../songs.ts";

export const hertz: Moppet = {
  voice: {
    id: "hertz", name: "Hertz", role: "CRT monitor", color: "#7be86b",
    register: [68, 82], octave: 12, size: 0.82, level: 1,
    body: { female: 0.67, child: 0.23 },
    artic: { larynx: 0.61, velum: 0.06, root: 0.12, epilarynx: 0.44, ventricular: 0.04 },
    source: { tension: 0.72, breathiness: 0.06, roughness: 0.17, brightness: 0.85, pressure: 8.8, glide: 0.026, drift: 4.4, vibratoRate: 6.1 },
    vibrato: 17, lyrics: introLyrics("hertz"),
  },
  art: "cels", prop: "scope", pad: "oo",
};
