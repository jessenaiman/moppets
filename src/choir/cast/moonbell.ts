import { MoppetCharacter } from "./moppet.ts";

/** Moonbell: Studio 404 guest phosphor bell-dome voice. */
export const moonbell = new MoppetCharacter({
  id: "moonbell",
  name: "Moonbell",
  role: "Guest phosphor voice",
  color: "#9be7ff",
  body: { female: 0.85, child: 0.18 },
  size: 1.04,
  artic: { larynx: 0.32, root: 0.14, epilarynx: 0.02, ventricular: 0.28 },
  source: { tension: 0.38, breathiness: 0.22, roughness: 0.32, brightness: 0.17, pressure: 7.1, glide: 0.06, drift: 3.8, vibratoRate: 6.3 },
  vibrato: 26,
  register: [60, 75],
  octave: 0,
  lyrics: [
    "Soft pale glow fills the quiet night",
    "Follow spot drifts left then goes right",
    "Golden bell rings above the floor",
    "Who lit dark? I lit four oh four",
  ],
  prop: "lamps",
  pad: "oo",
});
