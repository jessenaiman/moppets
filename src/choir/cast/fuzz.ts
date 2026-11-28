import { MoppetCharacter } from "./moppet.ts";

/** Fuzz: Spare Parts glowing vacuum-tube amp & yardstick-guitar shredder. */
export const fuzz = new MoppetCharacter({
  id: "fuzz",
  name: "Fuzz",
  role: "Spare Parts tube-amp lead guitarist",
  color: "#dfaa75",
  body: { female: 0.05, child: 0 },
  size: 1.12,
  artic: { larynx: -0.28, velum: 0.05, root: -0.1, epilarynx: 0.44, ventricular: 0.34 },
  source: { tension: 0.62, breathiness: 0.08, roughness: 0.38, brightness: 0.48, pressure: 8, glide: 0.06, drift: 4.8, vibratoRate: 5.9 },
  vibrato: 18,
  register: [44, 62],
  octave: -12,
  lyrics: [
    "Twin warm tubes glow bright up on ten",
    "Yardstick neck rings out loud again",
    "Plum wool coat holds the vintage hiss",
    "No new cloud ever sounds like this",
  ],
  prop: "lamps",
  pad: "oo",
});
