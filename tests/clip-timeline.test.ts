import { expect, test } from "bun:test";
import { buildCharacterClipSegments, manifestForCharacter } from "../src/choir/clipTimeline.ts";
import { midiBytes, parseMidi, scoreFromMidi } from "../src/choir/midi.ts";
import { makeRound, type Piece } from "../src/choir/music.ts";
import { CAST } from "../src/choir/voices.ts";

test("manifestForCharacter resolves Neon and Cue in Studio 404 mode", () => {
  const manifest = manifestForCharacter("vee", true);
  expect(manifest).not.toBeNull();
  expect(manifest?.artKey).toBe("neon");
  expect(manifest?.clips.idle).toBe("/clips/neon/idle.webm");
  expect(manifest?.clips.sing).toBe("/clips/neon/sing.webm");
  expect(manifest?.clips.belt).toBe("/clips/neon/belt.webm");
  expect(manifest?.clips.chuckle).toBe("/clips/neon/chuckle.webm");

  const cue = manifestForCharacter("scribe", true);
  expect(cue).not.toBeNull();
  expect(cue?.artKey).toBe("cue");
  expect(cue?.clips.idle).toBe("/clips/cue/idle.webm");
  expect(cue?.clips.sing).toBe("/clips/cue/sing.webm");
  expect(cue?.clips.belt).toBe("/clips/cue/belt.webm");
  expect(cue?.clips.chuckle).toBe("/clips/cue/chuckle.webm");

  const watt = manifestForCharacter("pip", true);
  expect(watt).not.toBeNull();
  expect(watt?.artKey).toBe("watt");
  expect(watt?.clips.idle).toBe("/clips/watt/idle.webm");
  expect(watt?.clips.sing).toBe("/clips/watt/sing.webm");
  expect(watt?.clips.belt).toBe("/clips/watt/belt.webm");
  expect(watt?.clips.chuckle).toBe("/clips/watt/chuckle.webm");

  const gruff = manifestForCharacter("gruff", true);
  expect(gruff).not.toBeNull();
  expect(gruff?.artKey).toBe("gruff");
  expect(gruff?.clips.idle).toBe("/clips/gruff/idle.webm");
  expect(gruff?.clips.sing).toBe("/clips/gruff/sing.webm");
  expect(gruff?.clips.belt).toBe("/clips/gruff/belt.webm");
  expect(gruff?.clips.chuckle).toBe("/clips/gruff/chuckle.webm");

  const clank = manifestForCharacter("clank", true);
  expect(clank).not.toBeNull();
  expect(clank?.artKey).toBe("clank");
  expect(clank?.clips.idle).toBe("/clips/clank/idle.webm");
  expect(clank?.clips.sing).toBe("/clips/clank/sing.webm");
  expect(clank?.clips.belt).toBe("/clips/clank/belt.webm");
  expect(clank?.clips.chuckle).toBe("/clips/clank/chuckle.webm");

  const tabby = manifestForCharacter("tabby", true);
  expect(tabby).not.toBeNull();
  expect(tabby?.artKey).toBe("tabby");
  expect(tabby?.clips.idle).toBe("/clips/tabby/idle.webm");
  expect(tabby?.clips.sing).toBe("/clips/tabby/sing.webm");
  expect(tabby?.clips.belt).toBe("/clips/tabby/belt.webm");
  expect(tabby?.clips.chuckle).toBe("/clips/tabby/chuckle.webm");

  const chip = manifestForCharacter("chip", true);
  expect(chip).not.toBeNull();
  expect(chip?.artKey).toBe("chip");
  expect(chip?.clips.idle).toBe("/clips/chip/idle.webm");
  expect(chip?.clips.sing).toBe("/clips/chip/sing.webm");
  expect(chip?.clips.belt).toBe("/clips/chip/belt.webm");
  expect(chip?.clips.chuckle).toBe("/clips/chip/chuckle.webm");

  expect(manifestForCharacter("vee", false)).toBeNull();
  expect(manifestForCharacter("scribe", false)).toBeNull();
  expect(manifestForCharacter("pip", false)).toBeNull();
  expect(manifestForCharacter("gruff", false)).toBeNull();
  expect(manifestForCharacter("clank", false)).toBeNull();
  expect(manifestForCharacter("tabby", false)).toBeNull();
  expect(manifestForCharacter("chip", false)).toBeNull();
});

test("buildCharacterClipSegments compiles idle -> sing -> belt and responds to MIDI peak transposition", () => {
  const base = makeRound();
  const veeTrack = base.tracks.find((t) => t.id === "vee");
  expect(veeTrack).toBeDefined();

  // Construct a piece with flat low pitches (no belt initially), then push a phrase via MIDI round-trip
  const flatPiece: Piece = {
    ...base,
    tracks: base.tracks.map((t) =>
      t.id === "vee"
        ? {
            ...t,
            events: [
              { id: 1, beat: 0, beats: 1, midi: 60, vowel: "a", text: "Glow", line: 0 },
              { id: 2, beat: 1, beats: 1, midi: 61, vowel: "o", text: "on", line: 0 },
              { id: 3, beat: 2, beats: 1, midi: 61, vowel: "i", text: "stage", line: 0 },
            ],
          }
        : t,
    ),
  };

  const before = buildCharacterClipSegments(flatPiece, "vee", 30, 8);
  expect(before[0].kind).toBe("idle");
  expect(before.some((s) => s.kind === "sing")).toBe(true);
  expect(before.some((s) => s.kind === "belt")).toBe(false);

  // Round-trip through real MIDI file encode -> peak pitch edit (+12 st on beat 2) -> scoreFromMidi
  const parsed = parseMidi(midiBytes(flatPiece));
  const veeMidi = parsed.tracks.find((t) => t.name.trim().toLowerCase() === "vee" && t.notes.length > 0);
  expect(veeMidi).toBeDefined();
  const lastNote = veeMidi!.notes[veeMidi!.notes.length - 1];
  lastNote.midi += 12;

  const updated = scoreFromMidi(flatPiece, parsed).piece;
  const after = buildCharacterClipSegments(updated, "vee", 30, 8);
  expect(after[0].kind).toBe("idle");
  expect(after.some((s) => s.kind === "sing")).toBe(true);
  expect(after.some((s) => s.kind === "belt")).toBe(true);
  expect(CAST[0].id).toBe("vee");
});
