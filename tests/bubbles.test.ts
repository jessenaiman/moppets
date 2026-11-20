/**
 * Stage speech bubbles, all-formation choreography talk cues, and CHIMERA lyric-edit planning.
 */
import { beforeAll, expect, test } from "bun:test";
import { initEngine } from "./harness.ts";
import { groupStageBubbles, isPadOnlyText, stageTalkAt } from "../src/choir/bubbles.ts";
import { Choreographer } from "../src/choir/choreo.ts";

let music: typeof import("../src/choir/music.ts");
let plan: typeof import("../src/choir/plan.ts");
let songbook: typeof import("../src/choir/songbook.ts");
let songCheck: typeof import("../src/choir/songCheck.ts");
let skits: typeof import("../src/choir/skits.ts");
let CHIP: typeof import("../src/choir/voices.ts").CHIP;
let voices: typeof import("../src/choir/voices.ts").voices;

beforeAll(async () => {
  await initEngine();
  music = await import("../src/choir/music.ts");
  plan = await import("../src/choir/plan.ts");
  songbook = await import("../src/choir/songbook.ts");
  songCheck = await import("../src/choir/songCheck.ts");
  skits = await import("../src/choir/skits.ts");
  ({ CHIP, voices } = await import("../src/choir/voices.ts"));
  const { EnglishG2P } = await import("@chimera/wasm/engine.ts");
  new EnglishG2P().setDictionaryText(
    new TextDecoder().decode(Bun.gunzipSync(await Bun.file(new URL("../public/data/cmudict.txt.gz", import.meta.url)).bytes())),
  );
});

test("Choreographer passes talk bubbles in solo, duet, full choir, watcher, and still modes", () => {
  const ids = ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"];
  const c = new Choreographer(ids);
  const talk = ["Lead line", "Duet line", "Chorus line", "Answer", "Low line", "High line", "Outro"];

  // Solo (k = 1) + watcher bubble on non-featured actor 3
  let actors = c.step({
    playing: true,
    beat: 4,
    now: 1,
    featured: [true, false, false, false, false, false, false],
    singing: [true, false, false, true, false, false, false],
    poke: null,
    still: false,
    talk,
  }, 0.016);
  expect(actors[0].bubble).toBe("Lead line");
  expect(actors[3].bubble).toBe("Answer");

  // Duet (k = 2)
  actors = c.step({
    playing: true,
    beat: 5,
    now: 1.5,
    featured: [true, true, false, false, false, false, false],
    singing: [true, true, false, false, false, false, false],
    poke: null,
    still: false,
    talk,
  }, 0.016);
  expect(actors[0].bubble).toBe("Lead line");
  expect(actors[1].bubble).toBe("Duet line");

  // Full choir (k >= n - 1)
  actors = c.step({
    playing: true,
    beat: 6,
    now: 2,
    featured: [true, true, true, true, true, true, false],
    singing: [true, true, true, true, true, true, false],
    poke: null,
    still: false,
    talk,
  }, 0.016);
  expect(actors.slice(0, 6).map((a) => a.bubble)).toEqual(talk.slice(0, 6));

  // Reduced motion (still: true)
  actors = c.step({
    playing: true,
    beat: 7,
    now: 2.5,
    featured: [true, false, false, false, false, false, false],
    singing: [true, false, false, false, false, false, false],
    poke: null,
    still: true,
    talk,
  }, 0.016);
  expect(actors[0].bubble).toBe("Lead line");
});

test("stageTalkAt keeps Music school bubble-free while surfacing lyrics on word songs and skits", () => {
  const ids = ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"];
  const school = music.invent();
  expect(stageTalkAt(school, ids, 6, true)).toBeUndefined();
  expect(stageTalkAt(music.makeChipSong(), ids, 6, false)).toBeUndefined();

  const intro = music.makeIntroduction(voices);
  const introTalk = stageTalkAt(intro, ids, 1, true);
  expect(introTalk?.[0]).toBeTruthy();
  expect(introTalk?.[1]).toBeNull();

  const round = music.makeRound();
  const roundTalk = stageTalkAt(round, ids, 1, true);
  expect(roundTalk?.[0]).toBe("Who put the jam in my top hat");
  expect(roundTalk?.[2]).toBe("Who put the jam in my top hat");
  expect(roundTalk?.[1]).toBeNull();

  const chipSong = music.makeChipSong();
  const chipVerseTalk = stageTalkAt(chipSong, ids, 5, true);
  expect(chipVerseTalk?.[6]).toBe("I am small and made of maybe");
  // Backing bass/pad Moppets sing "oo"/"bom", never speech bubbles
  expect(chipVerseTalk?.[2]).toBeNull();
  expect(chipVerseTalk?.[0]).toBeNull();

  // Songbook original (.song file) strips `_` melisma marks in bubbles
  const orig = songbook.SONGBOOK[0].make();
  const firstTrack = orig.tracks.find((t) => t.phrases?.length)!;
  const firstEvent = firstTrack.events.find((e) => e.line !== undefined)!;
  const origTalk = stageTalkAt(orig, [firstTrack.id], firstEvent.beat + 0.1, true);
  expect(origTalk?.[0]).toBeTruthy();
  expect(origTalk?.[0]?.includes("_")).toBe(false);

  const skit = skits.makeSkit(skits.SKITS[0], voices);
  const firstSkitTrack = skit.tracks.find((t) => t.events.length > 0)!;
  const skitEv = firstSkitTrack.events[0];
  const skitTalk = stageTalkAt(skit, [firstSkitTrack.id], skitEv.beat + 0.1, true);
  expect(skitTalk?.[0]).toBe(skitEv.text);

  expect(isPadOnlyText("oo")).toBe(true);
  expect(isPadOnlyText("bom")).toBe(true);
  expect(isPadOnlyText("doo")).toBe(true);
  expect(isPadOnlyText("Jam")).toBe(false);
});

test("groupStageBubbles merges simultaneous identical chorus lines and preserves simultaneous distinct lines", () => {
  const merged = groupStageBubbles([
    { x: 100, feet: 240, h: 160, bubble: "Who put the jam in my top hat" },
    { x: 300, feet: 240, h: 160, bubble: "Who put the jam in my top hat" },
    { x: 500, feet: 220, h: 150, bubble: "Pass me the toast and hide the cat" },
  ]);
  expect(merged).toHaveLength(2);
  expect(merged[0].text).toBe("Who put the jam in my top hat");
  expect(merged[0].anchorX).toBe(200);
  expect(merged[0].count).toBe(2);
  expect(merged[1].text).toBe("Pass me the toast and hide the cat");
  expect(merged[1].anchorX).toBe(500);
  expect(merged[1].count).toBe(1);
});

test("CHIMERA planTrack plans edited phrases cleanly on Chip's song and a converted round track", () => {
  // Chip's song phrase edit (multi-syllable words + holds via CHIMERA)
  const chipPiece = structuredClone(music.makeChipSong());
  const chipTrack = chipPiece.tracks.find((t) => t.id === "chip")!;
  const firstPassRhythm = (events: typeof chipTrack.events, lineIndex: number) => {
    const rhythm: number[] = [];
    let seen = false, prevEnd = -Infinity;
    for (const ev of events) {
      if (ev.line === lineIndex) {
        if (seen && ev.beat - prevEnd >= 4) break;
        seen = true;
        prevEnd = ev.beat + ev.beats;
        rhythm.push(ev.beats);
      } else if (seen) break;
    }
    return rhythm;
  };
  const chipRhythm = firstPassRhythm(chipTrack.events, 0);
  const chipEdited = "I am bright and made of maybe";
  expect(songCheck.checkSung({ words: chipEdited, rhythm: chipRhythm }).ok).toBe(true);
  chipTrack.phrases![0] = chipEdited;
  const chipPlan = plan.planTrack(chipTrack, chipPiece, CHIP);
  expect(chipPlan.gestures.length).toBeGreaterThan(0);

  // Round converted to `phrases` with edited words & melisma hold
  const roundPiece = structuredClone(music.makeRound({ repeats: 2 }));
  const veeTrack = roundPiece.tracks.find((t) => t.id === "vee")!;
  const roundPhrases = [...veeTrack.lines!];
  const line0Rhythm = firstPassRhythm(veeTrack.events, 0);
  const roundEdited = "Silver bells_ all ring at once";
  expect(plan.sungSyllables(roundEdited)).toHaveLength(line0Rhythm.length);
  roundPhrases[0] = roundEdited;
  veeTrack.phrases = roundPhrases;
  veeTrack.lines![0] = roundEdited;
  const roundPlan = plan.planTrack(veeTrack, roundPiece, voices.find((v) => v.id === "vee")!);
  expect(roundPlan.gestures.length).toBeGreaterThan(0);
});
