import { MoppetCharacter } from "./moppet.ts";

/** Clacker: Spare Parts beige 1980s tactile keyboard & synth-chest Moppet. */
export const clacker = new MoppetCharacter({
  id: "clacker",
  name: "Clacker",
  role: "Spare Parts keyboard-chassis keys",
  color: "#a0cc88",
  body: { female: 0.22, child: 0.15 },
  size: 1.12,
  artic: { larynx: 0.2, velum: 0.02, root: 0.1, epilarynx: 0.44 },
  source: { tension: 0.68, breathiness: 0.04, roughness: 0.02, brightness: 0.49, pressure: 7.4, glide: 0.06, drift: 2, vibratoRate: 5.6 },
  vibrato: 6,
  register: [52, 70],
  octave: 0,
  lyrics: [
    "Keys click clean on my olive chest",
    "Pitch wheel spins while the band takes rest",
    "Amber keycaps blink when I play",
    "Four oh four keeps the beat all day",
  ],
  prop: "typewriter",
  pad: "oo",
});
