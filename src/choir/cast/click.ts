import { MoppetCharacter } from "./moppet.ts";

/** Click: Spare Parts quartz metronome drummer. */
export const click = new MoppetCharacter({
  id: "click",
  name: "Click",
  role: "Spare Parts quartz metronome drummer",
  color: "#f4c96b",
  body: { female: 0.35, child: 0.52 },
  size: 0.92,
  artic: { larynx: 0.48, velum: 0.02, root: 0.18, epilarynx: 0.44 },
  source: { tension: 0.68, breathiness: 0.04, roughness: 0.02, brightness: 0.5, pressure: 7.4, glide: 0.06, drift: 1.8 },
  vibrato: 4,
  register: [58, 76],
  octave: 0,
  lyrics: [
    "Quartz clock ticks on the suitcase snare",
    "Count four beats in the warm booth air",
    "Red lights flash on my tempo strip",
    "Tight downbeat never lets me slip",
  ],
  prop: "led",
  pad: "oo",
});
