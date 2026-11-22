import type { BandNote, BandPart } from "./band.ts";
import type { Piece } from "./music.ts";

/** A walking duet with a glassy answer. The bridge clears out underneath the voice. */
export function neonBand(piece: Piece): BandPart[] {
  const bass: BandNote[] = [],
    keys: BandNote[] = [],
    drums: BandNote[] = [];
  const bassPitch = (pc: number) => 34 + ((pc - 34 + 48) % 12);
  const part = piece.tracks.find((t) => t.id === "vee");
  for (const [i, chord] of piece.chords.entries()) {
    const section = piece.sections
      ?.filter((s) => s.beat <= chord.beat)
      .at(-1)?.name;
    const hush = section === "the dark",
      end = section === "Finale";
    const [root, third, fifth] = chord.tones;
    const low = bassPitch(root),
      next = piece.chords[i + 1];
    if (
      !hush ||
      chord.beat === piece.sections?.find((s) => s.name === "the dark")?.beat
    )
      bass.push({
        beat: chord.beat,
        midi: low,
        beats: end ? 3.8 : hush ? 2 : 0.82,
        vel: 77,
      });
    if (hush) continue;
    if (end) {
      const sung = part?.events.at(-1)?.midi;
      if (sung !== undefined)
        keys.push({ beat: chord.beat, midi: sung + 4, beats: 3.8, vel: 85 });
      continue;
    }
    if (chord.beats >= 3) {
      bass.push(
        { beat: chord.beat + 1, midi: bassPitch(third), beats: 0.78, vel: 62 },
        { beat: chord.beat + 2, midi: bassPitch(fifth), beats: 0.84, vel: 71 },
      );
      if (chord.beats >= 4 && next)
        bass.push({
          beat: chord.beat + 3,
          midi: bassPitch(next.tones[0]) - 1,
          beats: 0.7,
          vel: 62,
        });
    }
    // Short upper-register thirds answer after the attack. Leave all written rests clear.
    for (const pc of [third, fifth])
      keys.push({
        beat: chord.beat + 0.67,
        midi: 60 + pc,
        beats: 0.27,
        vel: 56,
      });
    // Keep the kit on the bar grid, including across short chord changes.
    // Chord gaps and the quiet bridge retain their written rests.
    for (let beat = Math.ceil(chord.beat); beat < chord.beat + chord.beats; beat++) {
      if (beat % 4 === 0) drums.push({ beat, beats: 0.25, midi: 36, vel: 84 });
      if (beat % 4 === 2) drums.push({ beat, beats: 0.2, midi: 38, vel: 76 });
      if (beat % 2 === 1) drums.push({ beat, beats: 0.15, midi: 42, vel: 57 });
    }
  }
  return [
    { id: "bass", channel: 10, program: 33, notes: bass },
    { id: "keys", channel: 11, program: 4, notes: keys },
    { id: "drums", channel: 9, program: 0, notes: drums },
  ];
}
