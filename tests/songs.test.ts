import { beforeAll, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { initEngine } from "./harness.ts";

/**
 * The lead sheets in songs/: each one reads and writes back unchanged, and every song can be sung,
 * one syllable per note by the pronouncing dictionary. A word edit that breaks the count fails here
 * (before songs/ it failed only when the song was played).
 */
let songFile: typeof import("../src/choir/songFile.ts");
let songs: typeof import("../src/choir/songs.ts");
beforeAll(async () => {
  await initEngine();
  const { EnglishG2P } = await import("../src/wasm/engine.ts");
  new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../public/data/cmudict.txt.gz", import.meta.url))).toString());
  songFile = await import("../src/choir/songFile.ts");
  songs = await import("../src/choir/songs.ts");
});

test("every lead sheet in songs/ is listed, and reads and writes back unchanged", () => {
  const onDisk = readdirSync("songs").filter((f) => f.endsWith(".song")).sort();
  expect(songs.SONG_FILES.length).toBe(onDisk.length);
  for (const name of onDisk) {
    const text = readFileSync(`songs/${name}`, "utf8");
    expect(songFile.printSongFile(songFile.parseSongFile(text, name))).toBe(text);
  }
});

test("every song plans: one syllable per note, every Moppet real, every gesture a clip", async () => {
  const { SONGBOOK } = await import("../src/choir/songbook.ts");
  const { SKITS, makeSkit } = await import("../src/choir/skits.ts");
  const { planTrack } = await import("../src/choir/plan.ts");
  const { CAST, CHIP } = await import("../src/choir/voices.ts");
  const { GESTURES } = await import("../src/choir/gestures.ts");
  const voices = [...CAST, CHIP];
  for (const s of SONGBOOK) {
    const piece = s.make();
    for (const t of piece.tracks) {
      const v = voices.find((x) => x.id === t.id);
      expect({ song: s.id, singer: t.id, known: !!v }).toEqual({ song: s.id, singer: t.id, known: true });
      expect(() => planTrack(t, piece, v!)).not.toThrow();
    }
    for (const c of piece.cues ?? []) expect(GESTURES).toContain(c.gesture);
  }
  for (const k of SKITS) {
    const piece = makeSkit(k, voices);
    for (const t of piece.tracks) expect(planTrack(t, piece, voices.find((x) => x.id === t.id)!).gestures.length).toBeGreaterThan(0);
  }
});

test("a lead-sheet mistake names its file and line", () => {
  const bad = 'title: X\nid: x\nlead: pip\nkey: G\nbpm: 100\nfinale: "Hm" on 0\n\n[verse]\n"two words" = 1 2 | Z 4\n';
  expect(() => songFile.parseSongFile(bad, "songs/x.song")).toThrow('songs/x.song:9: "Z" is not a chord (I to VII)');
});

test("the words check counts syllables against notes and spots a word sung against its stress", async () => {
  const { checkSung, songProblems } = await import("../src/choir/songCheck.ts");
  const { SONGBOOK } = await import("../src/choir/songbook.ts");
  const long = checkSung({ words: "pancakes were made", rhythm: [1, 1, 2] });
  expect(long.syllables).toEqual(["pan", "cakes", "were", "made"]);
  expect(long.problem).toBe("1 syllable too many: 4 for 3 notes");
  expect(checkSung({ words: "made", rhythm: [1, 1] }).problem).toBe("1 syllable short: 1 for 2 notes");
  expect(checkSung({ words: "banana", rhythm: [1, 0.5, 0.5] }, 0).hint).toBe(""); // NA on the beat
  expect(checkSung({ words: "banana", rhythm: [0.5, 1, 1] }, 0).hint).toContain("ba·NA·na"); // NA between beats
  for (const s of SONGBOOK) expect(songProblems(s.song)).toEqual([]);
});
