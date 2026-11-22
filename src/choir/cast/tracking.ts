import type { Moppet } from "./moppet.ts";
import { introLyrics } from "../songs.ts";

export const tracking: Moppet = {
  voice: {
    id: "tracking", name: "Tracking", role: "VHS deck", color: "#8e9a8c",
    register: [38, 53], octave: -12, size: 1.32, level: 1,
    body: { female: 0.08, child: 0 },
    artic: { larynx: -0.72, velum: 0.09, root: -0.12, epilarynx: 0.36, ventricular: 0.14 },
    source: { tension: 0.47, breathiness: 0.11, roughness: 0.37, brightness: 0.36, pressure: 10.2, glide: 0.047, drift: 5.8, vibratoRate: 4.4 },
    vibrato: 9, lyrics: introLyrics("tracking"),
  },
  art: "cels", prop: "reels", pad: "oo",
};
