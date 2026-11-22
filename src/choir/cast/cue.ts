import type { Moppet } from "./moppet.ts";
import { introLyrics } from "../songs.ts";

export const cue: Moppet = {
  voice: {
    id: "cue", name: "Cue", role: "Scroll teleprompter", color: "#c9c2ae",
    register: [54, 69], octave: -12, size: 1.06, level: 1,
    body: { female: 0.26, child: 0.05 },
    artic: { larynx: 0.08, velum: 0.04, root: 0.08, epilarynx: 0.19, ventricular: 0.05 },
    source: { tension: 0.55, breathiness: 0.09, roughness: 0.13, brightness: 0.63, pressure: 9.6, glide: 0.028, drift: 3.3, vibratoRate: 5.1 },
    vibrato: 8, lyrics: introLyrics("cue"),
  },
  art: "cels", prop: "typewriter", pad: "oo",
};
