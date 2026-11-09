/** The choir's engine path on the wasm build: score pitch, determinism, telemetry, controls. */
import { beforeAll, expect, test } from "bun:test";
import { initEngine, wasmModule } from "./harness.ts";
import type { EngineExports } from "../src/choir/singerCore.ts";

let SingerCore: typeof import("../src/choir/singerCore.ts").SingerCore;
let hopFor: typeof import("../src/choir/singerCore.ts").hopFor;
let TELE: typeof import("../src/choir/singerCore.ts").TELE;
let midiToHz: typeof import("../src/choir/singerCore.ts").midiToHz;
let shapeGesture: typeof import("../src/choir/character.ts").shapeGesture;
let music: typeof import("../src/choir/music.ts");
let plan: typeof import("../src/choir/plan.ts");
let voices: typeof import("../src/choir/voices.ts").voices;
let poseFromRecord: typeof import("../src/choir/pose.ts").poseFromRecord;

const FS = 48000;
const inst = () => new WebAssembly.Instance(wasmModule, {}).exports as unknown as EngineExports;

beforeAll(async () => {
  await initEngine();
  ({ SingerCore, hopFor, TELE, midiToHz } = await import("../src/choir/singerCore.ts"));
  ({ shapeGesture } = await import("../src/choir/character.ts"));
  music = await import("../src/choir/music.ts");
  plan = await import("../src/choir/plan.ts");
  ({ voices } = await import("../src/choir/voices.ts"));
  ({ poseFromRecord } = await import("../src/choir/pose.ts"));
  const { EnglishG2P } = await import("../src/wasm/engine.ts");
  new EnglishG2P().setDictionaryText(new TextDecoder().decode(Bun.gunzipSync(await Bun.file(new URL("../public/data/cmudict.txt.gz", import.meta.url)).bytes())));
});

function renderTrack(id: string, piece = music.compose({ seed: 7, bpm: 120 }), seconds = 3, edit?: (s: InstanceType<typeof SingerCore>) => void) {
  const v = voices.find((x) => x.id === id)!;
  const track = piece.tracks.find((t) => t.id === id)!;
  const tp = plan.planTrack(track, piece, v);
  const frames = Math.ceil(seconds * FS);
  const core = new SingerCore(inst(), { sampleRate: FS, frames, hop: hopFor(FS), voice: v, gestures: tp.gestures, nasal: tp.nasal, firstF0: midiToHz(tp.firstMidi) });
  edit?.(core);
  while (core.rendered < frames) core.step();
  return core;
}

test("a singer's pitch comes from the score, even when its character changes", () => {
  const piece = music.compose({ seed: 7, bpm: 120 });
  for (const id of ["gruff", "tabby"]) {
    const core = renderTrack(id, piece, 2);
    const ev = piece.tracks.find((t) => t.id === id)!.events[0];
    // mid-way through the first note, measured by the engine's own pitch telemetry
    const hop = hopFor(FS), at = Math.round(((plan.LEAD_IN + (ev.beats * 30) / piece.bpm) * FS) / hop) * core.recordSize;
    const f0 = core.tele![at + TELE.f0], want = midiToHz(ev.midi);
    expect(Math.abs(1200 * Math.log2(f0 / want))).toBeLessThan(35); // inside the vibrato, on the written note
    core.dispose();
  }
});

test("the plan keeps consonant closures: no character velum on non-vowels, whole lyric syllables", () => {
  const pip = voices.find((v) => v.id === "pip")!;
  const piece = music.makeIntroduction();
  const tp = plan.planTrack(piece.tracks.find((t) => t.id === "pip")!, piece, pip);
  const shaped = tp.gestures.map((g) => shapeGesture(g, pip, tp.nasal));
  const vowelBiased = shaped.filter((g) => g.targets.velum === pip.artic.velum).length;
  expect(vowelBiased).toBeGreaterThan(5);
  // oral closures still shut the nose: any p/t/k/b/d/g gesture keeps velum closed or unset
  for (const g of tp.gestures) if (g.label && /^[ptkbdg]$/.test(g.label)) expect(g.targets.velum === undefined || g.targets.velum < 0.2).toBe(true);
  const pitches = new Set(tp.gestures.flatMap((g) => (g.targets.f0 !== undefined ? [Math.round(69 + 12 * Math.log2(g.targets.f0 / 440))] : [])));
  for (const p of pitches) expect(piece.tracks.find((t) => t.id === "pip")!.events.some((e) => e.midi === p)).toBe(true);
});

test("every lyric line plans with the dictionary: the round and the introduction", () => {
  const round = music.makeRound();
  for (const t of round.tracks) expect(plan.planTrack(t, round, voices.find((v) => v.id === t.id)!).gestures.length).toBeGreaterThan(100);
  const intro = music.makeIntroduction();
  for (const t of intro.tracks) expect(plan.planTrack(t, intro, voices.find((v) => v.id === t.id)!).gestures.length).toBeGreaterThan(100);
  for (const v of voices) {
    const solo = music.makeSolo(v);
    expect(plan.planTrack(solo.tracks[0], solo, v).gestures.length).toBeGreaterThan(50);
  }
});

test("the same seed and character render identical samples", () => {
  const a = renderTrack("vee"), b = renderTrack("vee");
  expect(Buffer.compare(new Uint8Array(a.stem.buffer), new Uint8Array(b.stem.buffer))).toBe(0);
  a.dispose();
  b.dispose();
});

test("every Moppet sings: finite, not silent, not clipped raw", () => {
  const piece = music.compose({ seed: 3, bpm: 132 });
  for (const v of voices) {
    const core = renderTrack(v.id, piece, 2.5);
    let peak = 0, sum = 0;
    for (const s of core.stem) {
      if (!Number.isFinite(s)) throw Error(`${v.id} produced non-finite audio`);
      peak = Math.max(peak, Math.abs(s));
      sum += s * s;
    }
    expect(peak).toBeGreaterThan(0.02);
    expect(Math.sqrt(sum / core.stem.length)).toBeGreaterThan(0.005);
    expect(peak).toBeLessThan(1);
    core.dispose();
  }
});

test("telemetry tracks what the voice did: the mouth closes for /m/ while the voice keeps sounding", () => {
  const piece = music.makeSolo(voices[0]);
  const core = renderTrack("vee", piece, 7);
  const n = Math.floor(core.rendered / hopFor(FS));
  const poses = Array.from({ length: n }, (_, i) => poseFromRecord(core.tele!, i * core.recordSize));
  // the lead-in is silent, then the mouth moves a lot while singing
  expect(poses.slice(0, 15).every((p) => !p.singing)).toBe(true);
  const singing = poses.filter((p) => p.singing);
  expect(singing.length).toBeGreaterThan(n * 0.6);
  const opens = singing.map((p) => p.open);
  expect(Math.max(...opens)).toBeGreaterThan(0.5);
  expect(Math.min(...opens)).toBeLessThan(0.1); // closures shut the lips while the singer is still singing
  core.dispose();
});

test("a character edit reaches this singer's engine instance at the render head", () => {
  const seconds = 2.2;
  const plain = renderTrack("gruff", undefined, seconds);
  const edited = renderTrack("gruff", undefined, seconds, (core) => {
    for (let i = 0; i < 90; i++) core.step();
    core.setSource({ roughness: 0.9, breathiness: 0.5 });
    core.setCharacter({ larynx: 1, velum: 0, root: 0, epilarynx: 0.8, ventricular: 0.9 });
  });
  const f = 90 * hopFor(FS);
  // nothing rendered before the edit moved
  expect(Buffer.compare(new Uint8Array(plain.stem.buffer, 0, f * 4), new Uint8Array(edited.stem.buffer, 0, f * 4))).toBe(0);
  // and the singing after it did
  let diff = 0;
  for (let i = f; i < plain.stem.length; i++) diff += Math.abs(plain.stem[i] - edited.stem[i]);
  expect(diff / (plain.stem.length - f)).toBeGreaterThan(1e-3);
  plain.dispose();
  edited.dispose();
});

test("a singer resting before its entrance costs nothing and stays exactly silent", () => {
  const round = music.makeRound();
  const seconds = 7;
  const v = voices.find((x) => x.id === "scribe")!;
  const track = round.tracks.find((t) => t.id === "scribe")!;
  const tp = plan.planTrack(track, round, v);
  const frames = seconds * FS;
  const core = new SingerCore(inst(), { sampleRate: FS, frames, hop: hopFor(FS), voice: v, gestures: tp.gestures, nasal: tp.nasal, firstF0: midiToHz(tp.firstMidi) });
  const t0 = performance.now();
  while (core.rendered < 4 * FS) core.step();
  const restMs = performance.now() - t0;
  expect(restMs / 1000 / 4).toBeLessThan(0.15); // well under the ~0.25 of a sounding voice
  let peak = 0;
  for (let i = hopFor(FS); i < 4 * FS; i++) peak = Math.max(peak, Math.abs(core.stem[i]));
  expect(peak).toBe(0);
  while (core.rendered < frames) core.step();
  let late = 0;
  for (let i = 5 * FS; i < 7 * FS; i++) late = Math.max(late, Math.abs(core.stem[i]));
  expect(late).toBeGreaterThan(0.05); // the entrance still arrives on time
  core.dispose();
});

test("every voice of the round enters on its written beat, eight beats apart", () => {
  const round = music.makeRound();
  const beat = plan.beatSeconds(round);
  const entries: number[] = [];
  for (const t of round.tracks) {
    const v = voices.find((x) => x.id === t.id)!;
    const first = t.events[0].beat;
    const want = plan.LEAD_IN + first * beat;
    const tp = plan.planTrack(t, round, v);
    const frames = Math.round((want + 1.2) * FS);
    const core = new SingerCore(inst(), { sampleRate: FS, frames, hop: hopFor(FS), voice: v, gestures: tp.gestures, nasal: tp.nasal, firstF0: midiToHz(tp.firstMidi) });
    while (core.rendered < frames) core.step();
    let onset = -1;
    for (let i = Math.round((want - 0.2) * FS); i < frames; i++)
      if (Math.abs(core.stem[i]) > 1e-3) {
        onset = i / FS;
        break;
      }
    entries.push(onset);
    expect(Math.abs(onset - want)).toBeLessThan(0.15); // consonants land just before the beat; nothing drifts
    core.dispose();
  }
  for (let i = 1; i < entries.length; i++) expect(Math.abs(entries[i] - entries[i - 1] - 8 * beat)).toBeLessThan(0.12);
});

test("every cameo names a real CHIMERA call, and palette stems render", async () => {
  const { CREATURE_CALLS } = await import("../src/choir/theory.ts");
  const { CREATURES, parseBeat, beatReady } = await import("../src/wasm/engine.ts");
  const { CueCore } = await import("../src/choir/singerCore.ts");
  for (const [id, calls] of Object.entries(CREATURE_CALLS)) {
    const c = CREATURES.find((x) => x.id === id)!;
    expect(c).toBeDefined();
    for (const call of calls) expect(c.calls.some((x) => x.id === call)).toBe(true);
  }
  const frames = FS * 3;
  const beat = new CueCore(inst(), { sampleRate: FS, frames, hop: hopFor(FS), beat: { steps: parseBeat("B . t . | Pf . t . | B . t . | Pf . t ."), bpm: 100, swing: 0, startSeconds: 0.4, ready: { ...beatReady({ female: 0, child: 0 }) } as Record<string, number> } });
  while (beat.rendered < frames) beat.step();
  let p1 = 0;
  for (const s of beat.stem) p1 = Math.max(p1, Math.abs(s));
  expect(p1).toBeGreaterThan(0.05);
  const bird = new CueCore(inst(), { sampleRate: FS, frames, hop: hopFor(FS), creature: { id: "songbird", calls: [{ id: "trill", seconds: 0.5 }] } });
  while (bird.rendered < frames) bird.step();
  let p2 = 0;
  for (const s of bird.stem) p2 = Math.max(p2, Math.abs(s));
  expect(p2).toBeGreaterThan(0.01);
});

test("every sung word in a generated song is one syllable, and every song 03 line is eight", async () => {
  const { GROOVES } = await import("../src/choir/theory.ts");
  const { lyricsToSyllables } = await import("../src/wasm/engine.ts");
  for (const g of GROOVES) for (const w of g.scat) expect(lyricsToSyllables(w).length).toBe(1);
  for (const w of ["jam", "hat", "sock", "toast", "stitch", "felt", "thread", "lamp", "key", "spool", "bow", "star", "friend", "song", "red", "door", "squeak", "hum", "dust", "shine", "oo", "bom", "doo"]) expect(lyricsToSyllables(w).length).toBe(1);
  const chip = music.makeChipSong();
  const moteVoice = (await import("../src/choir/voices.ts")).CHIP;
  expect(plan.planTrack(chip.tracks[0], chip, moteVoice).gestures.length).toBeGreaterThan(200);
});

test("the mouth shapes come from the articulators", async () => {
  const { visemeFrom, VISEME } = await import("../src/choir/pose.ts");
  expect(visemeFrom(1, 0, 0, 1.5, false)).toBe(VISEME.rest);
  expect(visemeFrom(0, 0, 0, 0.3, true)).toBe(VISEME.closed); // lips together: /m b p/
  expect(visemeFrom(0.5, 0.8, 0, 0.5, true)).toBe(VISEME.fv); // lip to teeth: /f v/
  expect(visemeFrom(0.6, 0, 0.9, 0.4, true)).toBe(VISEME.oo); // small and rounded
  expect(visemeFrom(1.6, 0, 0.8, 1.2, true)).toBe(VISEME.oh);
  expect(visemeFrom(1.9, 0, 0, 1.6, true)).toBe(VISEME.ah); // open jaw
  expect(visemeFrom(1.2, 0, 0, 0.8, true)).toBe(VISEME.ee);
});

test("a voice's vibrato and vowel posture reach only the notes still to come", () => {
  const piece = music.compose({ seed: 7, bpm: 120 });
  const v = voices.find((x) => x.id === "vee")!;
  const tp = plan.planTrack(piece.tracks.find((t) => t.id === "vee")!, piece, v);
  const vib = tp.gestures.find((g) => g.targets.vibrato !== undefined)!;
  const before = vib.targets.vibrato!;
  expect(shapeGesture(vib, { ...v, vibrato: v.vibrato * 2 }, false).targets.vibrato).toBeCloseTo(before * 2, 6);
  expect(vib.targets.vibrato).toBe(before); // the score itself is never edited
  const seconds = 2.2, cut = 90;
  const run = (edit?: (s: InstanceType<typeof SingerCore>) => void) => renderTrack("vee", piece, seconds, (core) => {
    for (let i = 0; i < cut; i++) core.step();
    edit?.(core);
  });
  const plain = run(), edited = run((core) => core.setCharacter({ ...v.artic, root: 0.9, velum: 0.8 }));
  const f = cut * hopFor(FS);
  expect(Buffer.compare(new Uint8Array(plain.stem.buffer, 0, f * 4), new Uint8Array(edited.stem.buffer, 0, f * 4))).toBe(0);
  let diff = 0;
  for (let i = f; i < plain.stem.length; i++) diff += Math.abs(plain.stem[i] - edited.stem[i]);
  expect(diff / (plain.stem.length - f)).toBeGreaterThan(1e-5); // a live tongue-root edit changes what is sung next
  plain.dispose();
  edited.dispose();
});
