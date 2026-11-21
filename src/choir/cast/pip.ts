import { introLyrics } from "../songs.ts";
import type { Moppet } from "./moppet.ts";

/** Pip. His throat sac swells with lung pressure, as a frog's does. */
export const pip: Moppet = {
  voice: { id: "pip", name: "Pip", role: "The felted frog", color: "#8bbb83", body: { female: 0.55, child: 0.3 }, size: 0.92, artic: { larynx: -0.6, velum: 0.6, root: -0.5, epilarynx: 0.4, ventricular: 0.35 }, source: { tension: 0.6, breathiness: 0.1, roughness: 0.28, brightness: 0.4, pressure: 9, glide: 0.018, drift: 2 }, vibrato: 6, register: [57, 74], octave: 0, level: 1.2, lyrics: introLyrics("pip") },
  art: "cels",
  prop: "sac",
  pad: "oo",
  seat: 4,
};
