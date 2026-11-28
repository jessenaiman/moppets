import { MoppetCharacter } from "./moppet.ts";

/** Thrum: Spare Parts brushed-steel dual VU-meter reel-to-reel tape echo. */
export const thrum = new MoppetCharacter({
  id: "thrum",
  name: "Thrum",
  role: "Spare Parts reel-to-reel tape echo",
  color: "#83c7c3",
  body: { female: 0.04, child: 0 },
  size: 1.24,
  artic: { larynx: -0.5, root: -0.18, epilarynx: 0.14, ventricular: 0.04 },
  source: { tension: 0.48, breathiness: 0.05, roughness: 0.05, brightness: 0.16, pressure: 7.5, glide: 0.065, drift: 4.2, vibratoRate: 5.0 },
  vibrato: 12,
  register: [39, 55],
  octave: -12,
  lyrics: [
    "Orange loop feeds back to my chest",
    "Warm V U eyes glow through the test",
    "Silver tape holds the room's low hum",
    "Each warm echo comes back as Thrum",
  ],
  prop: "reels",
  pad: "bom",
});
