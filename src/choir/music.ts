/**
 * Moppet Choir scores, ported from Studio 404's music.js. Pure data: no engine, no DOM.
 * Seeded composition in scale degrees; all durations are quarter-note beats. The order of random()
 * calls is the seed contract: changing it changes what every saved seed sounds like.
 */
import { ROUND_GROUPS, voices as defaultVoices } from "./voices.ts";
import { buildSong } from "./songbook.ts";
import { withSongMidi } from "./songMidi.ts";
import { catalogSong, SONG_FILES } from "./songs.ts";
import { findGroove, findMode, findPalette, findProgression, CREATURE_CALLS } from "./theory.ts";

export type ScaleMode = "major" | "minor" | "aeolian" | "dorian" | "mixolydian" | "lydian" | "phrygian";
export const SCALES: Record<ScaleMode, number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 11], aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10] };
export const KEYS = { C: 0, "D♭": 1, D: 2, "E♭": 3, E: 4, F: 5, "F♯": 6, G: 7, "A♭": 8, A: 9, "B♭": 10, B: 11 } as const;
export type KeyName = keyof typeof KEYS;
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
/** The six parts in score order (Chip sings only his own song). */
export const RANGES: Record<string, [number, number]> = Object.fromEntries(defaultVoices.map((v) => [v.id, v.register]));
/**
 * Words for the round: four lines of eight one-syllable words (one per note), and the word everyone
 * lands on together. Any set fits the tune, so the Moppets can each sing a different one at once.
 */
export interface RoundLyrics {
  id: string;
  title: string;
  lines: readonly string[];
  last: string;
}
/** A round's words as the notes sing them: no punctuation, so each word is one syllable to plan. */
export const roundWords = (line: string) => line.replace(/[^A-Za-z' ]+/g, " ").trim().split(/\s+/);
/** The round's written word sets, from songs/round.song; "mixed" gives each part the next set. */
export const ROUND_LYRICS: readonly RoundLyrics[] = SONG_FILES.flatMap((f) => (f.kind === "round" ? f.sets : []));
export type RoundLyricsId = string;
export const ROUND_LINES = ROUND_LYRICS[0].lines;

export interface ScoreEvent {
  beat: number;
  beats: number;
  midi: number;
  text: string;
  strong?: boolean;
  vel?: number;
  /** lyric line this note belongs to (a key into the track's `phrases`) */
  line?: number;
  /**
   * Where a lead sheet wrote this note: [section (each distinct section once, in order), line,
   * answer (-1: the line itself), note]. A repeated section's notes share it. The note editor
   * edits the lead sheet through it.
   */
  src?: [number, number, number, number];
}
export interface Track {
  channel?: number;
  program?: number;
  id: string;
  /** beat of this singer's first note in a round */
  entrance?: number;
  events: ScoreEvent[];
  /** whole lyric lines, sung through the lyric planner so words keep their stress and syllables */
  phrases?: string[];
  /** lyric lines for display only, by event `line`, when the notes carry their own words (the round) */
  lines?: string[];
}
export interface Chord {
  degree: number;
  tones: number[];
  name: string;
  roman: string;
  beat: number;
  beats: number;
}
export type PieceKind = "intro" | "school" | "round" | "solo" | "motesong" | "skit";
export interface BeatNote { id:string; beat:number; beats:number; midi:number; vel:number }
export interface Piece {
  /** Source SMF for this rehearsal; lyric alignment issues are shown on the score. */
  midiFile?: string;
  midiNotice?: string;
  meter?: string;
  meterChanges?: import("./meter").MeterChange[];
  kind: PieceKind;
  sections?: {name:string; beat:number}[];
  title: string;
  seed?: number;
  key: KeyName;
  mode: ScaleMode;
  bpm: number;
  repeats?: number;
  beats: number;
  chords: Chord[];
  tracks: Track[];
  description: string;
  /** MIDI roots of the plucked accompaniment, one per beat (null: none) */
  pluck?: (number | null)[];
  /** the backing band's own parts (otherwise band.ts arranges one from the chords) */
  band?: import("./band.ts").BandPart[];
  /** CHIMERA's beatbox stem for this piece */
  beat?: { text: string; swing: number; notes?: BeatNote[] };
  /** gestures on the stage (AniCraft clips, see gestures.ts): who does what, from which beat */
  cues?: { beat: number; who: string; gesture: import("./gestures.ts").GestureName }[];
  /** who is on the stage for this piece ("band": the band members too); none: the whole cast */
  stage?: string[];
  /** a skit's scenes: who is downstage together, in beats */
  scenes?: { beat: number; beats: number; cast: string[] }[];
  /** creature calls answering the singers, on the beat grid */
  cameos?: { creature: string; call: string; beat: number }[];
}

export function rng(seed: number): () => number {
  let n = Number(seed) >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scalePitch(degree: number, key: KeyName = "D", mode: ScaleMode = "major"): number {
  const scale = SCALES[mode], oct = Math.floor(degree / 7), d = ((degree % 7) + 7) % 7;
  return 60 + KEYS[key] + scale[d] + 12 * oct;
}

function scaleName(degree: number, key: KeyName, mode: ScaleMode): string {
  const letters = ["C", "D", "E", "F", "G", "A", "B"], natural = [0, 2, 4, 5, 7, 9, 11];
  const i = (letters.indexOf(key[0]) + degree) % 7, pc = scalePitch(degree, key, mode) % 12;
  let d = (pc - natural[i] + 12) % 12;
  if (d > 6) d -= 12;
  return letters[i] + (d > 0 ? "♯".repeat(d) : "♭".repeat(-d));
}

export function noteName(n: number, key: KeyName = "C", mode: ScaleMode = "major"): string {
  const degree = SCALES[mode].findIndex((v) => (v + KEYS[key]) % 12 === n % 12);
  return (degree >= 0 ? scaleName(degree, key, mode) : NAMES[((n % 12) + 12) % 12]) + (Math.floor(n / 12) - 1);
}

export function candidates(degrees: number[], key: KeyName, mode: ScaleMode, range: [number, number]): number[] {
  const pcs = new Set(degrees.map((d) => scalePitch(d, key, mode) % 12));
  return Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i).filter((n) => pcs.has(n % 12));
}

function pickNear(choices: number[], prev: number, random: () => number, maxLeap = 7): number {
  const near = choices.filter((n) => Math.abs(n - prev) <= maxLeap);
  const pool = near.length ? near : choices;
  const weights = pool.map((n) => 1 / (1 + Math.abs(n - prev) * 0.55));
  let x = random() * weights.reduce((a, b) => a + b, 0);
  return pool.find((_, i) => (x -= weights[i]) <= 0) ?? pool[pool.length - 1];
}

export function chordInfo(degree: number, key: KeyName, mode: ScaleMode): Omit<Chord, "beat" | "beats"> {
  const midi = [degree, degree + 2, degree + 4].map((d) => scalePitch(d, key, mode));
  const a = midi[1] - midi[0], b = midi[2] - midi[0];
  const quality = b === 6 ? "dim" : b === 8 ? "aug" : a === 3 ? "m" : "";
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII"][degree];
  return { degree, tones: midi.map((n) => n % 12), name: scaleName(degree, key, mode) + quality, roman: (a === 3 ? roman.toLowerCase() : roman) + (b === 6 ? "°" : b === 8 ? "+" : "") };
}

const RHYTHMS = [[1, 1, 0.5, 0.5, 1], [0.5, 0.5, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 1, 2], [0.5, 0.5, 0.5, 0.5, 1, 1]];

export function compose({ seed = 404, key = "D" as KeyName, mode = "major" as ScaleMode, bpm = 112 } = {}): Piece {
  if (!(key in KEYS) || !(mode in SCALES) || !Number.isFinite(bpm) || bpm < 60 || bpm > 180) throw Error("Invalid music settings");
  const random = rng(seed);
  const progressions = [[0, 5, 3, 4, 0, 3, 4, 0], [0, 3, 1, 4, 5, 3, 4, 0], [0, 5, 1, 4, 3, 1, 4, 0]];
  const progression = progressions[Math.floor(random() * progressions.length)];
  const chords = progression.map((d, bar) => ({ ...chordInfo(d, key, mode), beat: bar * 4, beats: 4 }));
  const tracks: Track[] = ["vee", "scribe", "clank", "pip", "gruff", "tabby"].map((id) => ({ id, events: [] }));
  const byId = Object.fromEntries(tracks.map((t) => [t.id, t]));
  const lead = byId.scribe;
  let previous = scalePitch(0, key, mode);
  const syllables = ["la", "doo", "bop", "wah"];
  for (let bar = 0; bar < 8; bar++) {
    const degree = progression[bar], triad = [degree, degree + 2, degree + 4];
    const rhythm = bar === 7 ? [1, 1, 2] : RHYTHMS[Math.floor(random() * RHYTHMS.length)];
    let beat = 0;
    for (let j = 0; j < rhythm.length; j++) {
      const dur = rhythm[j], last = bar === 7 && j === rhythm.length - 1;
      const strong = beat % 2 === 0;
      const degrees = strong ? triad : [0, 1, 2, 3, 4, 5, 6];
      let pool = candidates(degrees, key, mode, RANGES.scribe);
      if (!strong) {
        const steps = pool.filter((n) => Math.abs(n - previous) <= 2);
        if (steps.length) pool = steps;
      }
      const midi = last ? candidates([0], key, mode, RANGES.scribe).sort((a, b) => Math.abs(a - previous) - Math.abs(b - previous))[0] : pickNear(pool, previous, random);
      lead.events.push({ beat: bar * 4 + beat, beats: dur, midi, text: syllables[Math.floor(random() * syllables.length)], strong });
      previous = midi;
      beat += dur;
    }
    // chord-tone accompaniment with smooth, independent voice leading
    for (const id of ["vee", "pip", "tabby", "gruff"]) {
      const t = byId[id], range = RANGES[id];
      const prior = t.events[t.events.length - 1]?.midi ?? (range[0] + range[1]) / 2;
      const duration = id === "gruff" ? 4 : 2;
      let prev = prior;
      for (let b = 0; b < 4; b += duration) {
        let pool = candidates(triad, key, mode, range);
        // spread the upper parts across chord members, then minimise motion
        const preferred = id === "tabby" ? triad[2] : id === "pip" ? triad[1] : triad[(bar + b / 2) % 3];
        const preferredPool = candidates([preferred], key, mode, range);
        if (random() < 0.75 && preferredPool.length) pool = preferredPool;
        const midi = pickNear(pool, prev, random, 5);
        t.events.push({ beat: bar * 4 + b, beats: duration, midi, text: id === "gruff" ? "bom" : id === "tabby" ? "oo" : "doo" });
        prev = midi;
      }
    }
    const bass = byId.clank, roots = candidates([degree], key, mode, RANGES.clank);
    const prior = bass.events[bass.events.length - 1]?.midi ?? 44;
    bass.events.push({ beat: bar * 4, beats: 4, midi: pickNear(roots, prior, random, 12), text: "bom" });
  }
  return { kind: "school", title: "A Small & Strange Invention", seed: Number(seed) >>> 0, key, mode, bpm, beats: 32, chords, tracks, description: `Eight bars · six parts · a new melody, chord-tone harmonies and bass · V–${mode === "minor" ? "i" : "I"} cadence` };
}

// The four phrases share the same eight-beat harmonic skeleton: I, IV, V, I.
// Any eight-beat delay therefore preserves every vertical chord alignment.
const ROUND_DEGREES = [[0, 2, 3, 5, 4, 6, 2, 0], [2, 4, 5, 7, 6, 8, 4, 2], [4, 2, 7, 5, 8, 6, 7, 4], [7, 4, 3, 7, 4, 8, 4, 7]];
const ROUND_OCTAVES: Record<string, number> = Object.fromEntries(defaultVoices.map((v) => [v.id, v.octave]));

/**
 * The round's three parts: each a pair of Moppets singing the tune together (in their own octaves),
 * the parts entering eight beats apart, as a three-part round is sung by three groups.
 */
export { ROUND_GROUPS };

/**
 * `lyrics`: one set for everyone (by id, or new words), or "mixed": each group sings the next set.
 * `repeats`: times through the tune per group.
 */
export function makeRound({ key = "D" as KeyName, bpm = 108, repeats = 2, lyrics = "jam" as RoundLyricsId | RoundLyrics, sets = ROUND_LYRICS } = {}): Piece {
  if (!(key in KEYS) || ![1, 2, 3].includes(repeats) || bpm < 60 || bpm > 180) throw Error("Invalid round settings");
  const chosen: RoundLyrics | undefined = typeof lyrics === "object" ? lyrics : sets.find((l) => l.id === lyrics);
  if (!chosen && lyrics !== "mixed") throw Error("Invalid round lyrics");
  if (chosen && (chosen.lines.length !== 4 || chosen.lines.some((l) => roundWords(l).length !== 8))) throw Error("A round needs four lines of eight words");
  const lastEnd = (ROUND_GROUPS.length - 1) * 8 + 32 * repeats, finale = lastEnd + 2;
  // everyone lands together on the last word, spread over the tonic chord
  const FINAL_DEGREE: Record<string, number> = { vee: 0, scribe: 2, clank: 0, pip: 4, gruff: 0, tabby: 2 };
  const tracks: Track[] = ROUND_GROUPS.flatMap((group, g) =>
    group.map((id) => {
      const set: RoundLyrics = chosen ?? sets[g % sets.length];
      const events: ScoreEvent[] = [];
      for (let r = 0; r < repeats; r++)
        for (let phrase = 0; phrase < 4; phrase++) {
          const words = roundWords(set.lines[phrase]);
          for (let j = 0; j < 8; j++) events.push({ beat: g * 8 + r * 32 + phrase * 8 + j, beats: 1, midi: scalePitch(ROUND_DEGREES[phrase][j], key, "major") + ROUND_OCTAVES[id], text: words[j], line: phrase });
        }
      events.push({ beat: finale, beats: 4, midi: scalePitch(FINAL_DEGREE[id] ?? 0, key, "major") + ROUND_OCTAVES[id], text: roundWords(set.last)[0], line: 4 });
      return { id, entrance: g * 8, events, lines: [...set.lines, `${roundWords(set.last)[0]}!`] };
    }),
  );
  const chords: Chord[] = [];
  for (let b = 0; b < lastEnd; b += 2) chords.push({ ...chordInfo([0, 3, 4, 0][Math.floor(b / 2) % 4], key, "major"), beat: b, beats: 2 });
  chords.push({ ...chordInfo(0, key, "major"), beat: finale, beats: 4 });
  const title = chosen ? chosen.title : "Three Rounds at Once";
  const description = chosen ? "A three-part round · three pairs of Moppets · each pair enters eight beats after the last · I–IV–V–I" : "A three-part round with three sets of words: each pair sings its own, and everyone lands on their own last word together";
  return { kind: "round", title, key, mode: "major", bpm, repeats, beats: finale + 4, chords, tracks, description };
}

/** Cast-specific introductions also serve solo auditions and offline render callers. */
export function makeIntroduction(verses: readonly {id: string; lyrics: readonly string[]}[] = defaultVoices): Piece {
  return buildSong(catalogSong("intro"), {verses});
}

export function makeSolo(v: {id: string; name: string; lyrics: readonly string[]}): Piece {
  const piece = buildSong(catalogSong("intro"), {verses: [v], solo: true});
  return {...piece, kind: "solo", title: `${v.name}’s introduction`, description: `${v.name} alone, in this voice’s current settings`};
}

// ------------------------------------------------------------------ inventions from named ideas

/** Moppet-y words the "soul" sections sing instead of scat (one syllable each, for the planner). */
const MOPPET_WORDS = ["jam", "hat", "sock", "toast", "stitch", "felt", "thread", "lamp", "key", "spool", "bow", "star", "friend", "song", "red", "door", "squeak", "hum", "dust", "shine"];

export interface InventOptions {
  seed: number;
  key: KeyName;
  mode: ScaleMode;
  progression: string;
  groove: string;
  palette: string;
  /** Claude's arrangement pass: answer phrases in words, bridge, tag */
  soul: boolean;
}
export const DEFAULT_INVENTION: InventOptions = { seed: 404, key: "D", mode: "major", progression: "doowop", groove: "bossa", palette: "beatband", soul: true };

function bars(degrees: number[], approach: number): number[] {
  return [...degrees, approach, 0];
}

/** One passage of `degrees` bars starting at bar `at`, every part from the chord tones of its bar. */
function inventPassage(random: () => number, tracks: Record<string, Track>, degrees: number[], o: InventOptions, at: number, words: boolean, leadId = "scribe"): Chord[] {
  const { key, mode } = o;
  const groove = findGroove(o.groove);
  const chords: Chord[] = [];
  const lead = tracks[leadId];
  let previous = scalePitch(0, key, mode) + (leadId === "scribe" ? 12 : 0);
  degrees.forEach((degree, b) => {
    const bar = at + b;
    const triad = [degree, degree + 2, degree + 4];
    chords.push({ ...chordInfo(degree, key, mode), beat: bar * 4, beats: 4 });
    const lastBar = b === degrees.length - 1;
    const rhythm = lastBar ? [1, 1, 2] : groove.cells[Math.floor(random() * groove.cells.length)];
    let beat = 0;
    rhythm.forEach((dur, j) => {
      const atBeat = beat;
      const strong = Math.abs(atBeat % 2) < 1e-9;
      const last = lastBar && j === rhythm.length - 1;
      let pool = candidates(strong ? triad : [0, 1, 2, 3, 4, 5, 6], key, mode, RANGES[leadId]);
      if (!strong) {
        const near = pool.filter((n) => Math.abs(n - previous) <= 2);
        if (near.length) pool = near;
      }
      const midi = last ? candidates([0], key, mode, RANGES[leadId]).sort((a, c) => Math.abs(a - previous) - Math.abs(c - previous))[0] : pickNear(pool, previous, random);
      const text = words ? MOPPET_WORDS[Math.floor(random() * MOPPET_WORDS.length)] : groove.scat[Math.floor(random() * groove.scat.length)];
      lead.events.push({ beat: bar * 4 + atBeat, beats: dur, midi, text, strong });
      previous = midi;
      beat += dur;
    });
    const pad = groove.pad;
    const seats: [string, number][] = [["vee", triad[0]], ["pip", triad[1]], ["tabby", triad[2]], ["gruff", triad[(b + 1) % 3]]];
    for (const [id, member] of seats) {
      if (id === leadId) continue;
      const t = tracks[id], range = RANGES[id];
      for (let p = 0; p < 4; p += pad) {
        const prior = t.events[t.events.length - 1]?.midi ?? (range[0] + range[1]) / 2;
        const midi = pickNear(candidates([member], key, mode, range), prior, random, 7);
        t.events.push({ beat: bar * 4 + p, beats: pad, midi, text: id === "gruff" ? "bom" : id === "tabby" ? "oo" : "doo" });
      }
    }
    const bass = tracks.clank, roots = candidates([degree], key, mode, RANGES.clank), fifths = candidates([degree + 4], key, mode, RANGES.clank);
    let b2 = 0;
    groove.bass.forEach((dur, i) => {
      const pool = i % 2 === 1 && fifths.length ? fifths : roots;
      const prior = bass.events[bass.events.length - 1]?.midi ?? 44;
      bass.events.push({ beat: bar * 4 + b2, beats: dur, midi: pickNear(pool, prior, random, 12), text: "bom" });
      b2 += dur;
    });
  });
  return chords;
}

/** An invention built from the named concepts; the seed picks the small choices inside them. */
export function invent(options: Partial<InventOptions> = {}): Piece {
  const o: InventOptions = { ...DEFAULT_INVENTION, ...options };
  const groove = findGroove(o.groove), mode = findMode(o.mode), progression = findProgression(o.progression), palette = findPalette(o.palette);
  const random = rng(o.seed);
  const degrees = bars(progression.degrees, mode.approach);
  const tracks: Record<string, Track> = Object.fromEntries(Object.keys(RANGES).map((id) => [id, { id, events: [] }]));
  const chords = inventPassage(random, tracks, degrees, o, 0, false);
  let barsUsed = 8;
  if (o.soul) {
    // Claude's pass: Honk answers the theme in words, Wisp takes a bridge, everyone brings it home and lands together.
    chords.push(...inventPassage(random, tracks, degrees, o, barsUsed, true, "pip"));
    barsUsed += 8;
    const bridge = [3, mode.approach, 3, 0];
    chords.push(...inventPassage(random, tracks, bridge, o, barsUsed, true, "tabby"));
    barsUsed += 4;
    chords.push(...inventPassage(random, tracks, degrees, o, barsUsed, false));
    barsUsed += 8;
    const tag = barsUsed * 4;
    chords.push({ ...chordInfo(mode.approach, o.key, o.mode), beat: tag, beats: 2 }, { ...chordInfo(0, o.key, o.mode), beat: tag + 2, beats: 6 });
    for (const [id, deg] of [["scribe", 0], ["vee", 2], ["pip", 4], ["tabby", 7], ["gruff", 4], ["clank", 0]] as [string, number][]) {
      const midi = candidates([deg], o.key, o.mode, RANGES[id]).pop()!;
      tracks[id].events.push({ beat: tag + 2, beats: 6, midi, text: "Jam" });
    }
    barsUsed += 2;
  }
  const beats = barsUsed * 4;
  const cameos: Piece["cameos"] = [];
  palette.creatures.forEach((creature, i) => {
    const calls = CREATURE_CALLS[creature] ?? [];
    for (let bar = 7 + i * 2; bar < barsUsed - 2; bar += 8) cameos.push({ creature, call: calls[Math.floor(random() * calls.length)], beat: bar * 4 + 2 });
  });
  const mood = `${progression.label.split(" · ")[0]} in ${o.key} ${mode.label} · ${groove.label} · ${palette.label}${o.soul ? " · Moppet-soul arrangement" : ""}`;
  return { kind: "school", title: "A Small & Strange Invention", seed: o.seed >>> 0, key: o.key, mode: o.mode, bpm: groove.bpm, beats, chords, tracks: Object.keys(RANGES).map((id) => tracks[id]), description: mood, beat: palette.beatbox ? groove.beat : undefined, cameos: cameos.length ? cameos : undefined };
}

// Public score factories also used by the offline render tools.
export const makeChipSong = () => withSongMidi("chip", buildSong(catalogSong("chip")));
export const makeTabbySong = () => withSongMidi("tabby", buildSong(catalogSong("tabby")));
export const makeGruffShanty = () => withSongMidi("gruff", buildSong(catalogSong("gruff")));
