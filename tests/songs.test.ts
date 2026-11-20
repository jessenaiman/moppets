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
  const { EnglishG2P } = await import("@chimera/wasm/engine.ts");
  new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../public/data/cmudict.txt.gz", import.meta.url))).toString());
  songFile = await import("../src/choir/songFile.ts");
  songs = await import("../src/choir/songs.ts");
});

test("every lead sheet in songs/ is listed and serializes idempotently", () => {
  const onDisk = readdirSync("songs").filter((f) => f.endsWith(".song")).sort();
  expect(songs.SONG_FILES.length).toBe(onDisk.length);
  for (const name of onDisk) {
    const text = readFileSync(`songs/${name}`, "utf8");
    const canonical = songFile.printSongFile(songFile.parseSongFile(text, name));
    expect(songFile.printSongFile(songFile.parseSongFile(canonical, name))).toBe(canonical);
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

test("a hold (_) sings one syllable over several notes, and the editor's fixes make a line fit", async () => {
  const { checkSung, holdFix, splitFix } = await import("../src/choir/songCheck.ts");
  const { sungSyllables } = await import("../src/choir/plan.ts");
  const { shownWords } = await import("../src/choir/captions.ts");
  expect(sungSyllables("ma_ny cakes").map((s) => [s.text, !!s.melisma])).toEqual([["ma", false], ["~", true], ["ny", false], ["cakes", false]]);
  expect(checkSung({ words: "pancakes made__,", rhythm: [1, 1, 1, 1, 1] }).ok).toBe(true);
  expect(holdFix("pancakes made,", 2)).toBe("pancakes made__,");
  expect(splitFix({ degrees: [7, 6, 4], rhythm: [1, 1, 2] }, 1)).toEqual({ degrees: [7, 6, 4, 4], rhythm: [1, 1, 1, 1] });
  expect(shownWords("ma_ny cakes - made")).toBe("many cakes made");
  const { buildSong, SONGBOOK } = await import("../src/choir/songbook.ts");
  const { planTrack } = await import("../src/choir/plan.ts");
  const { CAST } = await import("../src/choir/voices.ts");
  const song = structuredClone(SONGBOOK[0].song);
  // the first line loses its last word, and holds the one before over the spare notes
  const first = song.sections[0].lines.find((l) => !("rest" in l)) as { words: string; rhythm: number[] };
  const shorter = first.words.split(" ").slice(0, -1).join(" ");
  first.words = holdFix(shorter, -checkSung({ words: shorter, rhythm: first.rhythm }).syllables.length + first.rhythm.length);
  expect(checkSung(first).ok).toBe(true);
  const piece = buildSong(song);
  const t = piece.tracks[0];
  expect(planTrack(t, piece, CAST.find((v) => v.id === t.id)!).gestures.length).toBeGreaterThan(0);
});

test("Studio 404 intro lyrics (Neon, Cue, etc.) plan cleanly in solo and introduction", async () => {
  const { voicesForMode, STUDIO_404_INTRO_LYRICS } = await import("../src/choir/studio404.ts");
  const { makeSolo, makeIntroduction } = await import("../src/choir/music.ts");
  const { planTrack } = await import("../src/choir/plan.ts");
  const { voices, CHIP } = await import("../src/choir/voices.ts");
  const s404Voices = voicesForMode(voices, true);
  const allS404Voices = voicesForMode([...voices, CHIP], true);
  for (const id of Object.keys(STUDIO_404_INTRO_LYRICS)) {
    const v = allS404Voices.find((x) => x.id === id)!;
    expect(v).toBeDefined();
    const solo = makeSolo(v);
    expect(() => planTrack(solo.tracks[0], solo, v)).not.toThrow();
  }
  const intro = makeIntroduction(s404Voices);
  for (const t of intro.tracks) {
    const v = s404Voices.find((x) => x.id === t.id)!;
    expect(() => planTrack(t, intro, v)).not.toThrow();
  }
});

test("authored notes reach the plug-in unchanged apart from the singer's octave register", async () => {
  const { SONGBOOK } = await import("../src/choir/songbook.ts");
  const { scalePitch } = await import("../src/choir/music.ts");
  const { instrumentPart } = await import("../src/choir/pluginScore.ts");
  const { CAST } = await import("../src/choir/voices.ts");
  for (const { song, make } of SONGBOOK) {
    const piece=make(), sections=[...new Set(song.sections)];
    for (const track of piece.tracks) {
      const part=instrumentPart(piece,track,CAST.find(v=>v.id===track.id)!);
      track.events.forEach((event,i)=>{
        if (!event.src) return;
        const [section,line,answer,note]=event.src;
        const phrase=sections[section].lines[line];
        if ("rest" in phrase) throw new Error("note attached to a rest");
        const degree=(answer<0?phrase:phrase.with![answer]).degrees[note];
        expect(Math.abs(part.notes[i][2]-scalePitch(degree,piece.key,piece.mode))%12).toBe(0);
      });
    }
  }
});

test("Found Things opens with Scribe's original keys-by-the-back-door phrase", async () => {
  const { SONGBOOK } = await import("../src/choir/songbook.ts");
  const piece = SONGBOOK.find(song => song.id === "found")!.make();
  const scribe = piece.tracks.find(track => track.id === "scribe")!;
  expect(scribe.phrases?.[0]).toBe("I was the keys by the back door");
  const notes = scribe.events.filter(event => event.line === 0);
  expect(notes.map(note => note.midi)).toEqual([67,71,74,74,71,69,64,64]);
  expect(notes.map(note => note.beats)).toEqual([1,.5,.5,1,1,1,1,2]);
});
