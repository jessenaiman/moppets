/**
 * Pure Remotion video project model checks across score types, aspect ratios, and bubble layout.
 */
import { beforeAll, expect, test } from "bun:test";
import { initEngine } from "./harness.ts";
import { buildCharacterClipSegments } from "../src/choir/clipTimeline.ts";
import { midiBytes, parseMidi, scoreFromMidi } from "../src/choir/midi.ts";
import { makeChipSong, makeRound, ROUND_GROUPS } from "../src/choir/music.ts";
import { studio404Name } from "../src/choir/studio404.ts";
import { buildVideoProject } from "../src/choir/videoProject.ts";
import { CAST } from "../src/choir/voices.ts";

let skits: typeof import("../src/choir/skits.ts");

beforeAll(async () => {
  await initEngine();
  skits = await import("../src/choir/skits.ts");
  const { EnglishG2P } = await import("@chimera/wasm/engine.ts");
  new EnglishG2P().setDictionaryText(
    new TextDecoder().decode(Bun.gunzipSync(await Bun.file(new URL("../public/data/cmudict.txt.gz", import.meta.url)).bytes())),
  );
});

test("buildVideoProject deduplicates pair lines in rounds and staggers overlapping speech bubbles", () => {
  const project = buildVideoProject(makeRound(), CAST, true);
  expect(project.bubbles.length).toBeGreaterThan(4);
  for (const b of project.bubbles) {
    expect(b.x).toBeGreaterThanOrEqual(0.16);
    expect(b.x).toBeLessThanOrEqual(0.84);
    expect(b.y).toBeGreaterThanOrEqual(0.05);
    expect(b.y).toBeLessThanOrEqual(0.34);
    expect(b.durationSec).toBeGreaterThan(0);
  }
  // Early pair line deduplicated to 1 shared bubble for the first entering pair
  const firstPair = ROUND_GROUPS[0].map((id) => studio404Name(id, id)).join(" & ");
  expect(project.bubbles[0].text.trim().length).toBeGreaterThan(0);
  expect(project.bubbles[0].speaker).toBe(firstPair);
});

test("buildVideoProject extracts Chip's lead bubbles and skit speech lines", () => {
  const chipProj = buildVideoProject(makeChipSong(), CAST, true);
  expect(chipProj.cameraAutoFollow).toBe(true);
  expect(chipProj.bubbles.some((b) => b.speaker === studio404Name("chip", "Chip") && b.text.trim().length > 0)).toBe(true);

  const skitProj = buildVideoProject(skits.makeSkit(skits.SKITS[0], CAST), CAST, true);
  expect(skitProj.bubbles.length).toBeGreaterThan(0);
  expect(skitProj.bubbles[0].startSec).toBeGreaterThan(0);
});

test("MIDI transposition + edited lyrics round-trip updates VideoProject bubbles and Neon clip segments", () => {
  const base = makeRound();
  const parsed = parseMidi(midiBytes(base));
  const veeMidi = parsed.tracks.find((t) => t.name.trim().toLowerCase() === "vee" && t.notes.length > 0);
  expect(veeMidi).toBeDefined();
  if (veeMidi) {
    for (let i = 0; i < Math.min(2, veeMidi.notes.length); i++) {
      veeMidi.notes[i].midi += 5;
    }
  }
  const res = scoreFromMidi(base, parsed);
  const vee = res.piece.tracks.find((t) => t.id === "vee");
  expect(vee).toBeDefined();
  const editedPiece = {
    ...res.piece,
    tracks: res.piece.tracks.map((t) =>
      t.id === "vee"
        ? {
            ...t,
            lines: t.lines ? ["Neon shines on the stage tonight", ...t.lines.slice(1)] : ["Neon shines on the stage tonight"],
            events: t.events.map((ev, idx) =>
              idx === 0 ? { ...ev, line: 0, text: "Neon" } : idx === 1 ? { ...ev, line: 0, text: "shines" } : ev,
            ),
          }
        : t,
    ),
  };

  const proj = buildVideoProject(editedPiece, CAST, true);
  expect(proj.bubbles.some((b) => b.text.includes("Neon shines"))).toBe(true);
  const segs = buildCharacterClipSegments(editedPiece, "vee", proj.fps, proj.stageDurationSec);
  expect(segs.length).toBeGreaterThan(1);
});
