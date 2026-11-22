import type { BandNote, BandPart } from "./band.ts";
import type { Piece } from "./music.ts";

/** Four monophonic phrases. The opening contour returns before the last bar answers it. */
const hook = [
  [74, 77, 81, 77, 81, 79, 77, 74],
  [70, 74, 77, 74, 77, 75, 74, 70],
  [74, 79, 82, 79, 82, 81, 79, 74],
  [76, 79, 84, 79, 77, 76, 74, 72],
];
const entrances = [0, .5, 1, 1.75, 2, 2.5, 3, 3.5];

export function neonBand(piece: Piece): BandPart[] {
  const bass: BandNote[] = [];
  const lead: BandNote[] = [];
  const drums: BandNote[] = [];
  const bassPitch = (pc: number) => 36 + pc;
  const finaleBeat = piece.sections?.find(section => section.name === "Finale")?.beat;

  for (const chord of piece.chords) {
    const [root, , fifth] = chord.tones;
    const start = chord.beat;
    if (start === finaleBeat) {
      lead.push({ beat: start, beats: 2, midi: 74, vel: 88 });
      bass.push({ beat: start, beats: 2, midi: bassPitch(root), vel: 96 });
      drums.push({ beat: start, beats: .2, midi: 36, vel: 92 });
      continue;
    }
    const phrase = hook[Math.floor(start / 4) % hook.length];
    for (const [index, offset] of entrances.entries()) {
      if (offset >= chord.beats) break;
      lead.push({
        beat: start + offset, beats: Math.min(index === 2 ? .63 : .32, chord.beats - offset),
        midi: phrase[index], vel: index === 2 || index === 4 ? 103 : 87,
      });
    }
    for (const [offset, length, pitch, vel] of [[0, .62, root, 102], [1.5, .3, root, 78], [2, .55, fifth, 87], [3.5, .35, root, 91]]) {
      if (offset < chord.beats) bass.push({ beat: start + offset, beats: Math.min(length, chord.beats - offset), midi: bassPitch(pitch), vel });
    }
    for (const [offset, midi, vel] of [[0, 36, 94], [.5, 42, 47], [1, 38, 80], [1.5, 36, 72], [2.5, 42, 47], [3, 38, 82], [3.5, 36, 75]]) {
      if (offset < chord.beats) drums.push({ beat: start + offset, beats: .12, midi, vel });
    }
  }
  return [
    { id: "bass", channel: 10, program: 33, notes: bass },
    { id: "keys", channel: 11, program: 80, notes: lead },
    { id: "drums", channel: 9, program: 0, notes: drums },
  ];
}
