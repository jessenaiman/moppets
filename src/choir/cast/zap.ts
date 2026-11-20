import type { Moppet } from "./moppet.ts";

/**
 * Zap, the early-90s universal remote (docs/briefs/moppet-world.md). A tiny airway with tight,
 * bright folds makes the small, tinny, clicky voice of S-5: a quick glide snaps between notes like
 * a button press, and the little roughness gives the click. Its LCD face lights per syllable.
 */
export const zap: Moppet = {
  voice: { id: "zap", name: "Zap", role: "The universal remote", color: "#7fd36b", body: { female: 0.5, child: 0.85 }, size: 0.62, artic: { larynx: 1.4, velum: 0.02, root: 0.4, epilarynx: 0.5, ventricular: 0 }, source: { tension: 0.75, breathiness: 0.08, roughness: 0.12, brightness: 0.85, pressure: 10, glide: 0.01, drift: 2, vibratoRate: 8 }, vibrato: 8, register: [64, 81], octave: 0, level: 1, lyrics: ["I am Zap I change the channel", "Every button means I'm sure"] },
  art: "cels",
  prop: "led",
  pad: "oo",
  seat: 7,
};
