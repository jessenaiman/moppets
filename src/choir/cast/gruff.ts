import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Gruff: giant airway (`size: 1.52`) inheriting `MoppetCharacter` base. */
export const gruff = new MoppetCharacter({
  id: "gruff",
  name: "Gruff",
  role: "The gravelly monster",
  color: "#9c9bc9",
  size: 1.52,
  artic: { larynx: -0.75, velum: 0.05, root: -0.2, epilarynx: 0.2, ventricular: 0.35 },
  source: { tension: 0.36, breathiness: 0.22, roughness: 0.38, brightness: 0.15, pressure: 7.8, glide: 0.068, drift: 4.8, vibratoRate: 5.0 },
  vibrato: 14,
  register: [45, 62],
  octave: -12,
  level: 0.92,
  lyrics: introLyrics("gruff"),
  prop: "dial",
  seat: 2,
});
