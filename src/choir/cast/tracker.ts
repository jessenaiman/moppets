import { introLyrics } from "../songs.ts";
import { MoppetCharacter } from "./moppet.ts";

/** Tracker: Slim 12:00 90s VHS deck. */
export const tracker = new MoppetCharacter({
  id: "tracker",
  name: "Tracker",
  role: "Slim 12:00 90s VHS deck",
  color: "#57d3e8",
  body: { female: 0.08, child: 0 },
  size: 1.32,
  artic: { larynx: -0.58, velum: 0.05, root: -0.14, epilarynx: 0.24, ventricular: 0.2 },
  source: { tension: 0.44, breathiness: 0.14, roughness: 0.3, brightness: 0.2, pressure: 7.6, glide: 0.064, drift: 5, vibratoRate: 5.0 },
  vibrato: 11,
  register: [38, 53],
  octave: -12,
  lyrics: introLyrics("tracker"),
  prop: "reels",
  pad: "oo",
});
