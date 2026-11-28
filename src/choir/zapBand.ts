import type { Piece } from "./music.ts";
import { BAND_SETUP, CRASH, HAT, KICK, OPEN_HAT, SNARE, type BandNote, type BandPart } from "./band.ts";
import buttons from "../../moppets/zap/buttons.json";

/** Legacy washboard strokes kept for fallback compatibility. */
export const WASH_STROKES = [
  { beat: 0, beats: 0.88, midi: 74, vel: 106 },
  { beat: 1, beats: 0.82, midi: 73, vel: 93 },
  { beat: 2, beats: 0.16, midi: 75, vel: 105 },
  { beat: 2.5, beats: 0.16, midi: 75, vel: 95 },
];

export interface XylophoneStep {
  readonly offset: number;
  readonly duration: number;
  readonly buttonIndex: number;
  readonly vel: number;
}

/**
 * 8-bar (32-beat) 28-Button Xylophone Grand Finale pattern.
 * Drives `zapBand.ts` audio so every rosewood strike hits the exact matching
 * button `0..27` in `moppets/zap/buttons.json`.
 */
export const XYLOPHONE_RUN: readonly XylophoneStep[] = (() => {
  const steps: XylophoneStep[] = [];
  const push = (offset: number, duration: number, buttonIndex: number, vel: number) => {
    steps.push({ offset, duration, buttonIndex: Math.max(0, Math.min(buttons.length - 1, buttonIndex)), vel });
  };

  // Bars 1-2 (0..8): Rapid ascending 28-button glissando hitting every key 0..27 + top flourish
  for (let i = 0; i < 28; i++) {
    push(i * 0.25, 0.24, i, 92 + Math.round((i / 27) * 28));
  }
  push(7.0, 0.22, 26, 108);
  push(7.25, 0.22, 27, 114);
  push(7.5, 0.22, 25, 106);
  push(7.75, 0.22, 27, 118);

  // Bars 3-4 (8..16): Bouncing showtune C-major xylophone melody & D-pad call/response
  const bar34: readonly [number, number, number, number][] = [
    [8.0, 0.4, 8, 104],
    [8.5, 0.4, 12, 100],
    [9.0, 0.4, 15, 108],
    [9.5, 0.4, 20, 112],
    [10.0, 0.4, 24, 116],
    [10.5, 0.4, 27, 120],
    [11.0, 0.4, 24, 108],
    [11.5, 0.4, 20, 102],
    [12.0, 0.35, 13, 116],
    [12.5, 0.35, 15, 110],
    [13.0, 0.35, 17, 112],
    [13.5, 0.35, 27, 122],
    [14.0, 0.35, 5, 108],
    [14.5, 0.35, 3, 104],
    [15.0, 0.35, 7, 108],
    [15.5, 0.35, 1, 116],
  ];
  for (const [o, d, b, v] of bar34) push(o, d, b, v);

  // Bars 5-6 (16..24): Rapid descending cascade 27..0 + D-pad compass spin
  for (let i = 0; i < 28; i++) {
    push(16 + i * 0.25, 0.24, 27 - i, 118 - Math.round((i / 27) * 24));
  }
  push(23.0, 0.22, 3, 106);
  push(23.25, 0.22, 6, 110);
  push(23.5, 0.22, 7, 112);
  push(23.75, 0.22, 4, 116);

  // Bars 7-8 (24..32): Rocket sweep 0..27 + sparkling C-major finale build
  for (let i = 0; i < 28; i++) {
    push(24 + i * 0.25, 0.24, i, 96 + Math.round((i / 27) * 30));
  }
  push(31.0, 0.24, 8, 112);
  push(31.25, 0.24, 12, 116);
  push(31.5, 0.24, 20, 120);
  push(31.75, 0.3, 27, 126);

  return steps;
})();

const near = (pc: number, centre: number) => {
  const base = centre - ((((centre - pc) % 12) + 12) % 12);
  return centre - base > 6 ? base + 12 : base;
};

/** Backing band for Zap's `"Every Button"`: bouncy comedy showtune + 28-button wooden xylophone finale. */
export function zapBand(piece: Piece): BandPart[] {
  const bass: BandNote[] = [];
  const keys: BandNote[] = [];
  const drums: BandNote[] = [];
  const xylophone: BandNote[] = [];

  const sections = piece.sections ?? [];
  const xyloSection = sections.find((s) => s.name === "xylophone");
  const xyloStart = xyloSection?.beat ?? Infinity;
  const xyloEnd = xyloStart + 32;

  let prevSection: string | undefined;
  for (const chord of piece.chords) {
    const section = sections.filter((s) => s.beat <= chord.beat).at(-1)?.name;
    const bridge = section === "bridge";
    const chorus = section === "chorus";
    const finale = section === "Finale";
    const inXylo = section === "xylophone" || (chord.beat >= xyloStart - 1e-6 && chord.beat < xyloEnd - 1e-6);

    const root = near(chord.tones[0], 38);
    const fifth = near(chord.tones[2], root + 7);
    const voicing = chord.tones.map((pc) => near(pc, 62)).sort((a, b) => a - b);

    if (finale) {
      bass.push({ beat: chord.beat, beats: Math.max(2, chord.beats - 0.2), midi: root, vel: 108 });
      for (const m of voicing) keys.push({ beat: chord.beat, beats: Math.max(2, chord.beats - 0.2), midi: m, vel: 88 });
      drums.push({ beat: chord.beat, beats: 1.5, midi: CRASH, vel: 94 });
      drums.push({ beat: chord.beat, beats: 0.5, midi: KICK, vel: 104 });
      // Rolled celebratory xylophone C-major chime on the final button hit
      const chordButtons = [0, 2, 4, 8, 12, 15, 20, 27];
      chordButtons.forEach((btnIdx, j) => {
        xylophone.push({
          beat: chord.beat + j * 0.06,
          beats: 1.4,
          midi: buttons[btnIdx]?.midi ?? 72,
          vel: 98 + j * 3,
        });
      });
      prevSection = section;
      continue;
    }

    if (bridge) {
      bass.push({ beat: chord.beat, beats: Math.min(chord.beats * 0.9, 2.2), midi: root, vel: 74 });
      for (const m of voicing) keys.push({ beat: chord.beat, beats: Math.min(chord.beats * 0.9, 2.6), midi: m, vel: 54 });
      for (let b = chord.beat; b < chord.beat + chord.beats - 1e-6; b += 2) {
        drums.push({ beat: b, beats: 0.3, midi: HAT, vel: 40 });
      }
      prevSection = section;
      continue;
    }

    if (section !== prevSection && (chorus || inXylo)) {
      drums.push({ beat: chord.beat, beats: 1.0, midi: CRASH, vel: inXylo ? 88 : 74 });
    }
    prevSection = section;

    for (let b = chord.beat; b < chord.beat + chord.beats - 1e-6; b++) {
      const inBar = ((b % 4) + 4) % 4;
      if (inBar === 0 || Math.abs(b - chord.beat) < 1e-6) {
        bass.push({ beat: b, beats: 0.72, midi: root, vel: inXylo ? 102 : 94 });
      } else if (inBar === 2) {
        bass.push({ beat: b, beats: 0.72, midi: fifth, vel: inXylo ? 94 : 84 });
      }

      if (inXylo || inBar === 1 || inBar === 3) {
        for (const m of voicing) {
          keys.push({
            beat: b + (inXylo ? 0.5 : 0),
            beats: 0.24,
            midi: m,
            vel: inXylo ? 68 : chorus ? 70 : 60,
          });
        }
      }

      drums.push({
        beat: b,
        beats: 0.35,
        midi: inBar % 2 ? SNARE : KICK,
        vel: inBar % 2 ? (inXylo ? 86 : 78) : inXylo ? 98 : 92,
      });
      drums.push({ beat: b, beats: 0.25, midi: HAT, vel: 50 });
      drums.push({
        beat: b + 0.5,
        beats: 0.25,
        midi: inBar === 3 ? OPEN_HAT : HAT,
        vel: inBar === 3 ? 52 : 38,
      });
    }
  }

  // Cheerful xylophone intro pickup (beat 3..4)
  if (sections.some((s) => s.name === "Intro")) {
    [0, 2, 4, 8].forEach((idx, j) => {
      xylophone.push({ beat: 3 + j * 0.25, beats: 0.24, midi: buttons[idx]?.midi ?? 60, vel: 76 + j * 6 });
    });
  }

  // 28-button Xylophone Grand Finale ([xylophone])
  if (xyloSection) {
    for (const step of XYLOPHONE_RUN) {
      const b = buttons[step.buttonIndex];
      if (!b) continue;
      xylophone.push({
        beat: xyloSection.beat + step.offset,
        beats: step.duration,
        midi: b.midi,
        vel: step.vel,
      });
      // Subtle rubber-key click accent on every 4th rapid hit / downbeat strike
      if (Math.abs((step.offset * 2) - Math.round(step.offset * 2)) < 1e-4) {
        drums.push({
          beat: xyloSection.beat + step.offset,
          beats: 0.12,
          midi: 75,
          vel: Math.min(92, Math.round(step.vel * 0.62)),
        });
      }
    }
  }

  // Rubber-key button clacks on "Click click" lyrics
  for (const track of piece.tracks) {
    for (const event of track.events) {
      if (event.line !== undefined && track.phrases?.[event.line]?.toLowerCase().includes("click click")) {
        drums.push({ beat: event.beat, beats: 0.14, midi: 75, vel: 86 });
      }
    }
  }

  // Legacy washboard support if any custom draft still uses [washboard]
  const wash = sections.find((s) => s.name === "washboard");
  if (wash) {
    for (const stroke of WASH_STROKES) drums.push({ ...stroke, beat: wash.beat + stroke.beat });
  }

  return [
    { id: "bass", channel: BAND_SETUP.bass.channel, program: BAND_SETUP.bass.program, notes: bass },
    { id: "keys", channel: BAND_SETUP.keys.channel, program: BAND_SETUP.keys.program, notes: keys },
    { id: "drums", channel: BAND_SETUP.drums.channel, program: BAND_SETUP.drums.program, notes: drums },
    { id: "xylophone", channel: BAND_SETUP.xylophone.channel, program: BAND_SETUP.xylophone.program, notes: xylophone },
  ];
}
