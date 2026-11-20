import { expect, test } from "bun:test";
import { KEYS, scalePitch, SCALES, type KeyName, type ScaleMode } from "../src/choir/music.ts";
import {
  beatsToVexDuration,
  clefForVoice,
  keySigAccidentals,
  midiToScaleDegree,
  midiToVexNote,
  shiftMidiByScaleSteps,
  stepLeadSheetDegree,
  vexKeySignature,
} from "../src/choir/staffMath.ts";
import { KeySignature } from "vexflow";

test("vexKeySignature maps every app key and scale mode to a valid VexFlow key signature", () => {
  const keys = Object.keys(KEYS) as KeyName[];
  const modes = Object.keys(SCALES) as ScaleMode[];
  for (const k of keys) {
    for (const m of modes) {
      const sig = vexKeySignature(k, m);
      expect(() => new KeySignature(sig)).not.toThrow();
    }
  }
  expect(vexKeySignature("G", "major")).toBe("G");
  expect(vexKeySignature("D", "minor")).toBe("Dm");
  expect(vexKeySignature("B♭", "major")).toBe("Bb");
});

test("midiToVexNote tracks bar accidentals and picks sharp vs flat spelling by key", () => {
  const gAcc = keySigAccidentals("G");
  // F#4 (MIDI 66) is already in G major's key signature -> no accidental glyph
  expect(midiToVexNote(66, "G", "major", gAcc)).toEqual({ key: "f/4", accidental: null });
  // F4 natural (MIDI 65) in G major needs natural sign, and a second F4 in the same bar needs none
  expect(midiToVexNote(65, "G", "major", gAcc)).toEqual({ key: "f/4", accidental: "n" });
  expect(midiToVexNote(65, "G", "major", gAcc)).toEqual({ key: "f/4", accidental: null });

  const fAcc = keySigAccidentals("F");
  // Bb4 (MIDI 70) in F major uses flat spelling and needs no accidental
  expect(midiToVexNote(70, "F", "major", fAcc)).toEqual({ key: "b/4", accidental: null });
});

test("clefForVoice picks bass for low voices and treble for higher voices", () => {
  expect(clefForVoice([43, 45, 48])).toBe("bass");
  expect(clefForVoice([64, 67, 71])).toBe("treble");
  expect(clefForVoice([], [38, 50])).toBe("bass");
  expect(clefForVoice([], [62, 79])).toBe("treble");
});

test("beatsToVexDuration quantizes whole, dotted-half, half, dotted-quarter, quarter, eighth, sixteenth", () => {
  expect(beatsToVexDuration(4)).toEqual({ duration: "w", dots: 0 });
  expect(beatsToVexDuration(3)).toEqual({ duration: "h", dots: 1 });
  expect(beatsToVexDuration(2)).toEqual({ duration: "h", dots: 0 });
  expect(beatsToVexDuration(1.5)).toEqual({ duration: "q", dots: 1 });
  expect(beatsToVexDuration(1)).toEqual({ duration: "q", dots: 0 });
  expect(beatsToVexDuration(0.75)).toEqual({ duration: "8", dots: 1 });
  expect(beatsToVexDuration(0.5)).toEqual({ duration: "8", dots: 0 });
  expect(beatsToVexDuration(0.25)).toEqual({ duration: "16", dots: 0 });
});

test("midiToScaleDegree and shiftMidiByScaleSteps preserve key contour", () => {
  // In G major, degree 4 = D5 (74); with -12 octave shift for bass -> 62
  const deg4 = scalePitch(4, "G", "major"); // 74
  expect(midiToScaleDegree(deg4 + 2 - 12, deg4 - 12, 4, "G", "major")).toBe(5);
  expect(shiftMidiByScaleSteps(67, 1, "G", "major")).toBe(69);
  expect(shiftMidiByScaleSteps(67, -1, "G", "major")).toBe(66);
});

test("stepLeadSheetDegree jumps over strong-beat fitChord snaps so Up/Down always moves pitch", () => {
  // Strong beat 0 under I chord (tones 0, 2, 4). Degree 0 fitted = 0; degree 1 snaps back to 0!
  const next = stepLeadSheetDegree(0, 1, 4, 1, [[0, 4]], 4);
  expect(next).toBe(2);
  const down = stepLeadSheetDegree(2, -1, 4, 1, [[0, 4]], 4);
  expect(down).toBe(0);
});
