import type { Piece } from "./music.ts";
import type { BandNote, BandPart } from "./band.ts";

/** The two mitts rake down and up, then tap twice. Beat four is silent. */
export const WASH_STROKES = [
  { beat: 0, beats: 0.88, midi: 74, vel: 106 },
  { beat: 1, beats: 0.82, midi: 73, vel: 93 },
  { beat: 2, beats: 0.16, midi: 75, vel: 105 },
  { beat: 2.5, beats: 0.16, midi: 75, vel: 95 },
];

export function zapBand(piece: Piece): BandPart[] {
  const bass: BandNote[] = [],
    keys: BandNote[] = [],
    drums: BandNote[] = [];
  const sections = piece.sections ?? [];
  for (const chord of piece.chords) {
    const section = sections.filter((s) => s.beat <= chord.beat).at(-1)?.name;
    const bridge = section === "bridge",
      chorus = section === "chorus";
    const root = chord.tones[0];
    // The game-show calls hang above a tonic pedal. Leave the holds to the singer.
    const tonic = piece.chords[0].tones[0];
    bass.push({
      beat: chord.beat,
      midi: 36 + (chorus ? tonic : root),
      beats: Math.min(chord.beats, bridge ? 2 : 0.65),
      vel: bridge ? 66 : 86,
    });
    for (const pc of chord.tones)
      keys.push({
        beat: chord.beat,
        midi: 60 + pc,
        beats: Math.min(chord.beats, bridge ? 2.7 : 0.23),
        vel: bridge ? 42 : 61,
      });
    if (bridge || chorus || section === "Finale") continue;
    for (let t = chord.beat; t < chord.beat + chord.beats; t++) {
      drums.push({
        beat: t,
        beats: 0.2,
        midi: t % 2 ? 38 : 36,
        vel: t % 2 ? 52 : 69,
      });
    }
  }
  const wash = sections.find((s) => s.name === "washboard");
  if (wash)
    for (const stroke of WASH_STROKES)
      drums.push({ ...stroke, beat: wash.beat + stroke.beat });
  for (const track of piece.tracks)
    for (const event of track.events) {
      if (
        event.line !== undefined &&
        track.phrases?.[event.line]?.toLowerCase() === "click click"
      )
        drums.push({ beat: event.beat, beats: 0.14, midi: 75, vel: 81 });
    }
  return [
    { id: "bass", channel: 10, program: 33, notes: bass },
    { id: "keys", channel: 11, program: 4, notes: keys },
    { id: "drums", channel: 9, program: 0, notes: drums },
  ];
}
