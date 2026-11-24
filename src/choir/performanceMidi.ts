import { BEAT_SOUNDS, parseBeat } from "@chimera/wasm/engine.ts";
import { midiBytes as encodeMidi } from "./midi";
import type { BeatNote, Piece } from "./music";

/** Print the native mouth-percussion sequence into editable MIDI tracks, including swing. */
export function midiBytes(piece: Piece) {
  if (!piece.beat || piece.beat.notes) return encodeMidi(piece);
  const steps = parseBeat(piece.beat.text);
  const notes: BeatNote[] = [];
  const stepLength = piece.bpm / Math.max(40, Math.min(240, piece.bpm)) / 4;
  for (let i = 0; steps.length && i * stepLength < piece.beats; i++) {
    const step = steps[i % steps.length];
    if (!step) continue;
    const beat = (i + (i % 2 ? Math.max(0, Math.min(0.6, piece.beat.swing)) * 0.5 : 0)) * stepLength;
    if (beat >= piece.beats) break;
    let length = 1;
    while (length < steps.length && !steps[(i + length) % steps.length]) length++;
    const role = BEAT_SOUNDS.find((s) => s.id === step.id)?.role;
    const midi =
      step.note ?? (role === "kick" ? 36 : role === "snare" ? 38 : role === "hat" ? 42 : role === "bass" ? 43 : 39);
    notes.push({
      beat,
      beats: Math.min(length * stepLength, piece.beats - beat),
      id: step.id,
      midi,
      vel: Math.max(1, Math.min(127, Math.round((step.accent ?? 1) * 96))),
    });
  }
  return encodeMidi({ ...piece, beat: { ...piece.beat, notes } });
}
