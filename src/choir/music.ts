/**
 * Moppet Choir scores, ported from Studio 404's music.js. Pure data: no engine, no DOM.
 * Seeded composition in scale degrees; all durations are quarter-note beats. The order of random()
 * calls is the seed contract: changing it changes what every saved seed sounds like.
 */
import { CHORUS, INTRO_BPM, voices as defaultVoices } from "./voices.ts";
import { findGroove, findMode, findPalette, findProgression, CREATURE_CALLS } from "./theory.ts";

export type ScaleMode = "major" | "minor" | "aeolian" | "dorian" | "mixolydian" | "lydian" | "phrygian";
export const SCALES: Record<ScaleMode, number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 11], aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10] };
export const KEYS = { C: 0, "D♭": 1, D: 2, "E♭": 3, E: 4, F: 5, "F♯": 6, G: 7, "A♭": 8, A: 9, "B♭": 10, B: 11 } as const;
export type KeyName = keyof typeof KEYS;
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
/** The six parts in score order (Chip sings only his own song). */
export const RANGES: Record<string, [number, number]> = Object.fromEntries(defaultVoices.map((v) => [v.id, v.register]));
export const ROUND_LINES = ["Who put the jam in my top hat", "Pass me the toast and hide the cat", "My socks can dance my shoes can squeak", "We sing in rounds all through the week"];

export interface ScoreEvent {
  beat: number;
  beats: number;
  midi: number;
  text: string;
  strong?: boolean;
  /** lyric line this note belongs to (a key into the track's `phrases`) */
  line?: number;
}
export interface Track {
  id: string;
  /** beat of this singer's first note in a round */
  entrance?: number;
  events: ScoreEvent[];
  /** whole lyric lines, sung through the lyric planner so words keep their stress and syllables */
  phrases?: string[];
}
export interface Chord {
  degree: number;
  tones: number[];
  name: string;
  roman: string;
  beat: number;
  beats: number;
}
export type PieceKind = "intro" | "school" | "round" | "solo" | "motesong";
export interface Piece {
  kind: PieceKind;
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
  /** CHIMERA's beatbox stem for this piece */
  beat?: { text: string; swing: number };
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

function candidates(degrees: number[], key: KeyName, mode: ScaleMode, range: [number, number]): number[] {
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

function chordInfo(degree: number, key: KeyName, mode: ScaleMode): Omit<Chord, "beat" | "beats"> {
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
  const tracks: Track[] = Object.keys(RANGES).map((id) => ({ id, events: [] }));
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

export function makeRound({ key = "D" as KeyName, bpm = 108, repeats = 1 } = {}): Piece {
  if (!(key in KEYS) || ![1, 2].includes(repeats) || bpm < 60 || bpm > 180) throw Error("Invalid round settings");
  const ids = Object.keys(RANGES), lastEnd = (ids.length - 1) * 8 + 32 * repeats, finale = lastEnd + 2;
  const tracks: Track[] = ids.map((id, i) => {
    const events: ScoreEvent[] = [];
    for (let r = 0; r < repeats; r++)
      for (let phrase = 0; phrase < 4; phrase++) {
        const words = ROUND_LINES[phrase].split(" ");
        for (let j = 0; j < 8; j++) events.push({ beat: i * 8 + r * 32 + phrase * 8 + j, beats: 1, midi: scalePitch(ROUND_DEGREES[phrase][j], key, "major") + ROUND_OCTAVES[id], text: words[j], line: phrase });
      }
    events.push({ beat: finale, beats: 4, midi: scalePitch([0, 2, 0, 4, 0, 2][i], key, "major") + ROUND_OCTAVES[id], text: "Jam", line: 4 });
    return { id, entrance: i * 8, events };
  });
  const chords: Chord[] = [];
  for (let b = 0; b < lastEnd; b += 2) chords.push({ ...chordInfo([0, 3, 4, 0][Math.floor(b / 2) % 4], key, "major"), beat: b, beats: 2 });
  chords.push({ ...chordInfo(0, key, "major"), beat: finale, beats: 4 });
  return { kind: "round", title: "Who Put the Jam in My Top Hat?", key, mode: "major", bpm, repeats, beats: finale + 4, chords, tracks, description: "A true six-voice round · same tune · entrances eight beats apart · I–IV–V–I" };
}

/** The original verse tune, two eight-beat lines in D major (one beat per syllable). */
const INTRO_MELODY = [[62, 66, 69, 66, 64, 62, 64, 62], [62, 64, 66, 69, 67, 66, 64, 62]];
/** Which octave each singer's part sits in: a property of the arrangement, always whole octaves. */
export const INTRO_OCTAVES: Record<string, number> = ROUND_OCTAVES;
const INTRO_CHORDS = [0, 3, 4, 0];
const SECTION_BEATS = 20; // two lines (16 beats) and a bar for the next puppet to step up

function introTrack(id: string, lines: readonly string[], start: number): Track {
  const events: ScoreEvent[] = [];
  lines.forEach((_, line) =>
    INTRO_MELODY[line].forEach((midi, j) =>
      // the short last note is the singer's breath before the next line, inside the bar
      events.push({ beat: start + line * 8 + j, beats: j === 7 ? 0.75 : 1, midi: midi + (INTRO_OCTAVES[id] ?? 0), text: "", line }),
    ),
  );
  return { id, events, phrases: [...lines] };
}

/** "The first hello": each Moppet's verse in turn, then everyone on the chorus. A real score now, not a mixdown. */
export function makeIntroduction(verses: readonly { id: string; lyrics: readonly string[] }[] = defaultVoices): Piece {
  const key: KeyName = "D", mode: ScaleMode = "major", bpm = INTRO_BPM;
  const chorusAt = verses.length * SECTION_BEATS;
  const tracks = verses.map((v, i) => {
    const verse = introTrack(v.id, v.lyrics, i * SECTION_BEATS), chorus = introTrack(v.id, CHORUS, chorusAt);
    const phrases = [...verse.phrases!, ...chorus.phrases!];
    return { id: v.id, phrases, events: [...verse.events, ...chorus.events.map((e) => ({ ...e, line: e.line! + verse.phrases!.length }))] };
  });
  const beats = chorusAt + 16;
  const chords: Chord[] = [];
  const pluck: (number | null)[] = [];
  const ROOTS = [38, 43, 45, 38];
  for (let b = 0; b < beats; b += 4) {
    const inSong = Math.floor(b / SECTION_BEATS) === Math.floor((b + 3) / SECTION_BEATS) && b % SECTION_BEATS < 16;
    const bar = (b % SECTION_BEATS) / 4;
    const degree = inSong ? INTRO_CHORDS[bar % 4] : 4; // the changeover bar sits on V and leads back home
    chords.push({ ...chordInfo(degree, key, mode), beat: b, beats: 4 });
    for (let k = 0; k < 4; k++) pluck.push(inSong ? ROOTS[bar % 4] : 45);
  }
  return { kind: "intro", title: "The First Hello", key, mode, bpm, beats, chords, tracks, pluck, description: "Six verses in turn, then the whole workshop on the chorus" };
}

/** One Moppet's two-line introduction on its own. */
export function makeSolo(v: { id: string; name: string; lyrics: readonly string[] }): Piece {
  const track = introTrack(v.id, v.lyrics, 0);
  const pluck: (number | null)[] = [];
  const chords: Chord[] = [];
  [0, 3, 4, 0].forEach((degree, bar) => chords.push({ ...chordInfo(degree, "D", "major"), beat: bar * 4, beats: 4 }));
  for (const r of [38, 43, 45, 38]) for (let k = 0; k < 4; k++) pluck.push(r);
  return { kind: "solo", title: `${v.name}’s introduction`, key: "D", mode: "major", bpm: INTRO_BPM, beats: 16, chords, tracks: [track], pluck, description: `${v.name} alone, in this voice’s current settings` };
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

// ------------------------------------------------------------------ song 03

const CHIP_VERSE = ["I am small and made of maybe", "I read the manual for you", "I ask a thousand little whys", "And hum until the meaning flies"];
const CHIP_CHORUS = ["Stitch me in the little back row", "Now I know the songs you all know", "Thread my name through every song", "Moppets sing and I sing along"];
// Two lilting rhythms; both put syllables 1, 4, 6 and 8 on the strong beats, and the short last
// note of each line leaves the singer a breath before the next one.
const LILT_A = [1, 0.5, 0.5, 1, 1, 1, 1, 1.75], LILT_B = [0.5, 0.5, 1, 1, 1, 1, 1, 1.75];
type SongLine = { degrees: number[]; rhythm: number[]; chords: [number, number][] };
const CHIP_LINES: SongLine[] = [
  // the hook starts on the tonic and climbs: an easy way in
  { degrees: [0, 2, 4, 4, 5, 5, 4, 0], rhythm: LILT_B, chords: [[0, 4], [3, 4]] },
  { degrees: [2, 4, 5, 7, 7, 5, 4, 2], rhythm: LILT_A, chords: [[5, 4], [5, 4]] },
  { degrees: [4, 4, 5, 7, 7, 5, 4, 1], rhythm: LILT_B, chords: [[0, 4], [1, 4]] },
  { degrees: [4, 2, 1, 2, 1, -1, -1, 0], rhythm: LILT_A, chords: [[0, 4], [4, 2], [0, 2]] },
];
const CHIP_CHORUS_LINES: SongLine[] = [
  { degrees: [7, 7, 5, 4, 5, 4, 2, 4], rhythm: LILT_A, chords: [[0, 4], [0, 4]] },
  { degrees: [7, 7, 5, 7, 5, 4, 2, 1], rhythm: LILT_B, chords: [[3, 4], [4, 4]] },
  { degrees: [4, 5, 7, 8, 7, 5, 4, 2], rhythm: LILT_A, chords: [[4, 4], [5, 4]] },
  { degrees: [5, 4, 2, 5, 2, 1, -1, 0], rhythm: LILT_B, chords: [[1, 4], [4, 2], [0, 2]] },
];
const BAR = 4;

/** "Chip Reads the Manual": Claude's Moppet sings the verses; the whole workshop joins on the chorus. */
export function makeChipSong(): Piece {
  const key: KeyName = "C", mode: ScaleMode = "major", bpm = 96;
  const chords: Chord[] = [];
  const events: ScoreEvent[] = [];
  const pad = (id: string, beat: number, degree: number, beats: number): ScoreEvent => {
    const mid = (RANGES[id][0] + RANGES[id][1]) / 2;
    const midi = candidates([degree], key, mode, RANGES[id]).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
    return { beat, beats, midi, text: id === "babel" || id === "clank" ? "bom" : "oo" };
  };
  const others: Record<string, ScoreEvent[]> = Object.fromEntries(Object.keys(RANGES).map((id) => [id, []]));
  const addSection = (at: number, lines: SongLine[], lineBase: number, choir: boolean) => {
    lines.forEach((l, n) => {
      let beat = at + n * 2 * BAR;
      l.degrees.forEach((d, j) => {
        events.push({ beat, beats: l.rhythm[j], midi: scalePitch(d, key, mode), text: "", line: lineBase + n });
        beat += l.rhythm[j];
      });
      let chordBeat = at + n * 2 * BAR;
      for (const [deg, beats] of l.chords) {
        chords.push({ ...chordInfo(deg, key, mode), beat: chordBeat, beats });
        others.clank.push(pad("clank", chordBeat, deg, beats));
        if (choir) {
          others.vee.push(pad("vee", chordBeat, deg, beats));
          others.pip.push(pad("pip", chordBeat, deg + 2, beats));
          others.tabby.push(pad("tabby", chordBeat, deg + 4, beats));
          others.gruff.push(pad("gruff", chordBeat, deg + 2, beats));
        }
        chordBeat += beats;
      }
    });
  };
  // one bar of groove so the song doesn't start cold, then verse, chorus, verse, chorus
  chords.push({ ...chordInfo(0, key, mode), beat: 0, beats: BAR });
  others.clank.push(pad("clank", 0, 0, BAR));
  const start = BAR;
  addSection(start, CHIP_LINES, 0, false);
  addSection(start + 32, CHIP_CHORUS_LINES, 4, true);
  addSection(start + 64, CHIP_LINES, 0, false);
  addSection(start + 96, CHIP_CHORUS_LINES, 4, true);
  // the shared last note, everyone landing on C
  const finale = start + 128;
  chords.push({ ...chordInfo(0, key, mode), beat: finale, beats: BAR });
  const seats: [string, number][] = [["vee", 0], ["scribe", 2], ["pip", 4], ["clank", 0], ["gruff", 2], ["tabby", 4]];
  for (const [id, d] of seats) others[id].push(pad(id, finale, d, BAR));
  events.push({ beat: finale, beats: BAR, midi: scalePitch(7, key, mode), text: "", line: 8 });
  const song: Track = { id: "chip", phrases: [...CHIP_VERSE, ...CHIP_CHORUS, "Hum"], events };
  const parts: Track[] = Object.keys(RANGES).filter((id) => others[id].length).map((id) => ({ id, events: others[id] }));
  return { kind: "motesong", title: "Chip Reads the Manual", key, mode, bpm, beats: finale + BAR, chords, tracks: [song, ...parts], description: "03 · Chip's solo over the workshop, with the choir on the chorus", beat: findGroove("bossa").beat };
}
