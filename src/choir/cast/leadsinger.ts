import { MoppetCharacter } from "./moppet.ts";

/** LeadSinger: Spare Parts bare-chassis cassette-chest vocalist. */
export const leadsinger = new MoppetCharacter({
  id: "leadsinger",
  name: "LeadSinger",
  role: "Spare Parts BareChassis lead vocalist",
  color: "#f28c6a",
  body: { female: 0.45, child: 0.05 },
  size: 1.02,
  artic: { larynx: 0.08, root: 0.04, epilarynx: 0.34, ventricular: 0.24 },
  source: { tension: 0.56, breathiness: 0.14, roughness: 0.3, brightness: 0.44, pressure: 7.6, glide: 0.062, vibratoRate: 6.1 },
  vibrato: 22,
  register: [55, 74],
  octave: 0,
  level: 1.05,
  lyrics: [
    "Red deck spins in my open chest",
    "Chrome cans shine when I sing my best",
    "Twin E Q eyes light up the floor",
    "Four oh four asks for one song more",
  ],
  prop: "reels",
  pad: "oo",
});
