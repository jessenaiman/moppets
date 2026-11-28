import { MoppetCharacter } from "./moppet.ts";

/** Latch: Studio 404 talkback foot-switch pedal. */
export const latch = new MoppetCharacter({
  id: "latch",
  name: "Latch",
  role: "Talkback pedal",
  color: "#f0ac65",
  body: { female: 0.2, child: 0.1 },
  size: 0.94,
  artic: { larynx: -0.15, velum: 0.06, root: -0.12, epilarynx: 0.14, ventricular: 0.16 },
  source: { tension: 0.44, breathiness: 0.22, roughness: 0.18, brightness: 0.16, glide: 0.06, drift: 3, vibratoRate: 5.4 },
  vibrato: 8,
  register: [49, 65],
  octave: -12,
  lyrics: [
    "Press my switch and the mic comes live",
    "Hold that lock while the singers drive",
    "One clean click gives the booth its cue",
    "After you, I am waiting too",
  ],
  prop: "led",
  pad: "oo",
});
