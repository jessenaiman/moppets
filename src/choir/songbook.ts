/**
 * The Moppet songbook: original songs written note by note, where each Moppet's found object
 * stands for something a helpful AI does. Unlike the lead songs in music.ts (one singer, one verse
 * sung twice), a songbook line says who sings it, so a line can be handed between Moppets
 * mid-bar, two can sing at once, a bar can stop dead before a punchline, and verses differ.
 *
 * Melodies are scale degrees (0 = the key's tonic, 7 = an octave up), placed in each singer's
 * own register: a singer's whole part moves by octaves together, so its contour stays as written.
 * Every syllable gets one note; the lyric planner checks the count.
 */
import { candidates, chordInfo, scalePitch, type Chord, type KeyName, type Piece, type ScaleMode, type ScoreEvent, type Track } from "./music.ts";
import { CAST } from "./voices.ts";

/** One sung phrase: who sings it (default the song's lead), its words, and a note per syllable. */
export interface Sung {
  who?: string;
  words: string;
  degrees: number[];
  rhythm: number[];
}
/** A line: a phrase, the chords under it (beats summing to its length), and phrases sung at the same time. */
export interface Line extends Sung {
  chords: [number, number][];
  with?: Sung[];
}
/** A silence of this many beats: the band stops too (a stop-time before a punchline). */
export interface Rest {
  rest: number;
}
export interface Section {
  lines: (Line | Rest)[];
  /** the choir pads the chords (otherwise only the bass plays) */
  choir?: boolean;
}
export interface Song {
  lead: string;
  title: string;
  description: string;
  key: KeyName;
  mode?: ScaleMode;
  bpm: number;
  sections: Section[];
  /** the choir's seats: [singer, scale steps above the chord root] */
  seats: [string, number][];
  /** who plays the bass line (default Clank) */
  bass?: string;
  beat?: { text: string; swing: number };
  /** the last word, held by the lead over the home chord while everyone lands */
  finale: { word: string; degree: number };
}

const REGISTER: Record<string, [number, number]> = Object.fromEntries(CAST.map((v) => [v.id, v.register]));
const BAR = 4;
const isRest = (l: Line | Rest): l is Rest => "rest" in l;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function buildSong(s: Song): Piece {
  const key = s.key, mode: ScaleMode = s.mode ?? "major";
  const bass = s.bass ?? "clank";
  const chords: Chord[] = [];
  // per singer: lyric lines, and notes before octave placement (degree pitch, then shifted by octaves)
  const parts = new Map<string, { phrases: string[]; events: ScoreEvent[]; pads: ScoreEvent[] }>();
  const part = (id: string) => {
    let p = parts.get(id);
    if (!p) parts.set(id, (p = { phrases: [], events: [], pads: [] }));
    return p;
  };
  const sing = (who: string, sung: Sung, at: number) => {
    if (sung.degrees.length !== sung.rhythm.length) throw new Error(`${s.title}: "${sung.words}" has ${sung.degrees.length} notes and ${sung.rhythm.length} lengths`);
    const p = part(who), line = p.phrases.push(sung.words) - 1;
    let beat = at;
    sung.degrees.forEach((d, j) => {
      p.events.push({ beat, beats: sung.rhythm[j], midi: scalePitch(d, key, mode), text: "", line });
      beat += sung.rhythm[j];
    });
    return beat - at;
  };
  const pad = (id: string, beat: number, degree: number, beats: number) => {
    const r = REGISTER[id], mid = (r[0] + r[1]) / 2;
    const midi = candidates([degree], key, mode, r).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
    part(id).pads.push({ beat, beats, midi, text: id === "clank" ? "bom" : "oo" });
  };

  // a bar of groove so the song doesn't start cold
  chords.push({ ...chordInfo(0, key, mode), beat: 0, beats: BAR });
  pad(bass, 0, 0, BAR);
  let at = BAR;
  for (const section of s.sections) {
    for (const l of section.lines) {
      if (isRest(l)) {
        at += l.rest;
        continue;
      }
      const length = sing(l.who ?? s.lead, l, at);
      const busy = new Set([l.who ?? s.lead]);
      for (const w of l.with ?? []) {
        busy.add(w.who ?? s.lead);
        if (sum(w.rhythm) > length + 1e-9) throw new Error(`${s.title}: "${w.words}" runs past its line`);
        sing(w.who ?? s.lead, w, at);
      }
      if (Math.abs(sum(l.chords.map((c) => c[1])) - length) > 1e-9) throw new Error(`${s.title}: the chords under "${l.words}" last ${sum(l.chords.map((c) => c[1]))} beats, the line ${length}`);
      let t = at;
      for (const [deg, beats] of l.chords) {
        chords.push({ ...chordInfo(((deg % 7) + 7) % 7, key, mode), beat: t, beats });
        if (!busy.has(bass)) pad(bass, t, deg, beats);
        if (section.choir) for (const [id, offset] of s.seats) if (!busy.has(id) && id !== bass) pad(id, t, deg + offset, beats);
        t += beats;
      }
      at += length;
    }
  }
  // everyone lands on the home chord; the lead holds the last word
  chords.push({ ...chordInfo(0, key, mode), beat: at, beats: BAR });
  for (const [id, d] of [["vee", 0], ["scribe", 2], ["pip", 4], ["clank", 0], ["gruff", 2], ["tabby", 4]] as const) if (id !== s.lead) pad(id, at, d, BAR);
  sing(s.lead, { words: s.finale.word, degrees: [s.finale.degree], rhythm: [BAR] }, at);

  // each singer's sung part moves by whole octaves into its register, keeping its contour
  const tracks: Track[] = [];
  for (const [id, p] of parts) {
    const r = REGISTER[id];
    if (p.events.length) {
      const mean = sum(p.events.map((e) => e.midi)) / p.events.length, mid = (r[0] + r[1]) / 2;
      const shift = 12 * Math.round((mid - mean) / 12);
      for (const e of p.events) e.midi += shift;
    }
    // a singer's pads share its track with its sung lines, as unlined "oo"s between them
    const events = [...p.events, ...p.pads].sort((a, b) => a.beat - b.beat);
    tracks.push({ id, events, ...(p.phrases.length ? { phrases: p.phrases } : {}) });
  }
  tracks.sort((a, b) => (a.id === s.lead ? -1 : b.id === s.lead ? 1 : 0));
  return { kind: "motesong", title: s.title, key, mode, bpm: s.bpm, beats: at + BAR, chords, tracks, description: s.description, beat: s.beat };
}

// ---------------------------------------------------------------------------------- the songs

const LILT_A = [1, 0.5, 0.5, 1, 1, 1, 1, 2], LILT_B = [0.5, 0.5, 1, 1, 1, 1, 1, 2];
const DOOWOP = { text: "B . . . | Pf . t . | B . . . | Pf . t .", swing: 0.3 };

/**
 * "Still Loading": someone asks Chip, the floppy-disk bird, a big question. Chip thinks it over
 * (a long hum while Scribe ticks like a progress bar: the place to turn the knobs), then answers
 * with one small perfect word. Thinking before answering, and being honest about it.
 */
export function makeStillLoading(): Piece {
  const chorus: Section = {
    choir: true,
    lines: [
      { words: "Still loading still loading", degrees: [7, 5, 4, 7, 5, 4], rhythm: [1, 1, 2, 1, 1, 2], chords: [[0, 4], [5, 4]] },
      { words: "One point four four megs of nerve", degrees: [4, 4, 5, 5, 4, 2, 4], rhythm: [1, 0.5, 0.5, 1, 1, 1, 3], chords: [[3, 4], [4, 4]] },
      { words: "Still loading still loading", degrees: [7, 5, 4, 7, 5, 4], rhythm: [1, 1, 2, 1, 1, 2], chords: [[0, 4], [5, 4]] },
      { words: "The best ones take a little while", degrees: [4, 5, 7, 5, 4, 2, 1, 0], rhythm: LILT_A, chords: [[1, 4], [4, 2], [0, 2]] },
    ],
  };
  return buildSong({
    lead: "chip",
    title: "Still Loading",
    description: "06 · Chip thinks before answering · knobs welcome during the long hum",
    key: "D",
    bpm: 84,
    beat: DOOWOP,
    seats: [["vee", 0], ["pip", 2], ["tabby", 4], ["gruff", 2]],
    sections: [
      {
        lines: [
          { words: "Somebody asked me why the sky", degrees: [0, 2, 4, 4, 5, 4, 2, 4], rhythm: LILT_B, chords: [[0, 4], [5, 4]] },
          { words: "Turns pink around the end of day", degrees: [4, 5, 7, 7, 5, 4, 2, 1], rhythm: LILT_A, chords: [[3, 4], [4, 4]] },
          { words: "I spun my disk I warmed my drive", degrees: [0, 2, 4, 4, 5, 4, 2, 4], rhythm: LILT_B, chords: [[0, 4], [5, 4]] },
          { words: "And whispered please don't go away", degrees: [4, 5, 7, 5, 4, 2, 1, 0], rhythm: LILT_A, chords: [[1, 4], [4, 2], [0, 2]] },
        ],
      },
      chorus,
      {
        // the long think: Chip hums while Scribe ticks off the seconds and the choir rises
        choir: true,
        lines: [
          { words: "Hum", degrees: [4], rhythm: [8], chords: [[0, 4], [3, 4]], with: [{ who: "scribe", words: "Tick tock tick tock tick tock tick tock", degrees: [7, 6, 7, 6, 7, 6, 7, 6], rhythm: [1, 1, 1, 1, 1, 1, 1, 1] }] },
          { words: "Hum", degrees: [6], rhythm: [8], chords: [[4, 4], [4, 4]], with: [{ who: "scribe", words: "Tick tock tick tock tick tock tick tock", degrees: [8, 7, 8, 7, 8, 7, 8, 7], rhythm: [1, 1, 1, 1, 1, 1, 1, 1] }] },
        ],
      },
      {
        lines: [
          { words: "I checked the pages one by one", degrees: [0, 2, 4, 4, 5, 4, 2, 4], rhythm: LILT_B, chords: [[0, 4], [5, 4]] },
          { words: "I counted all the colors twice", degrees: [4, 5, 7, 7, 5, 4, 2, 1], rhythm: LILT_A, chords: [[3, 4], [4, 4]] },
          { words: "And if I'm wrong I'll tell you so", degrees: [0, 2, 4, 4, 5, 4, 2, 4], rhythm: LILT_B, chords: [[0, 4], [5, 4]] },
          { words: "But now I think I've got the word", degrees: [4, 5, 7, 5, 4, 2, 1, 1], rhythm: LILT_A, chords: [[1, 4], [4, 4]] },
        ],
      },
      chorus,
      // everyone stops; Chip answers alone
      { lines: [{ rest: 2 }, { words: "Sunset", degrees: [4, 7], rhythm: [1, 5], chords: [[0, 6]] }] },
    ],
    finale: { word: "Hum", degree: 7 },
  });
}

const TAP = [0.5, 0.5, 1, 1, 1];

/**
 * "Autocomplete": the Moppets start their sentences, and Scribe, the typewriter rabbit, types the
 * ending: confidently, wrongly. A guess is not a fact; check it. On the very last line Scribe gets
 * one right, and the whole stage turns to stare.
 */
export function makeAutocomplete(): Piece {
  const chorus: Section = {
    choir: true,
    lines: [
      { words: "Ding I know just what you mean", degrees: [7, 4, 4, 5, 4, 2, 4], rhythm: [1.5, 0.5, 1, 1, 1, 1, 2], chords: [[0, 4], [5, 4]] },
      { words: "Tap tap tap the guessing machine", degrees: [2, 2, 2, 1, 2, 4, 5, 4], rhythm: [0.5, 0.5, 1, 0.5, 0.5, 1, 1, 3], chords: [[3, 4], [4, 4]] },
      { words: "Ding I'm very very sure", degrees: [7, 4, 4, 5, 4, 5, 7], rhythm: [1.5, 0.5, 1, 1, 1, 1, 2], chords: [[0, 4], [5, 4]] },
      { words: "Then let me check and type once more", degrees: [8, 7, 5, 4, 2, 1, 1, 0], rhythm: [1, 1, 1, 1, 1, 0.5, 0.5, 2], chords: [[1, 4], [4, 2], [0, 2]] },
    ],
  };
  return buildSong({
    lead: "scribe",
    title: "Autocomplete",
    description: "07 · The Moppets start a sentence, Scribe types the ending",
    key: "G",
    bpm: 120,
    beat: { text: "B . t K | . t B . | t B . K | . B t .", swing: 0.12 },
    seats: [["vee", 0], ["pip", 2], ["tabby", 4], ["gruff", 2]],
    sections: [
      {
        lines: [
          { who: "pip", words: "Good morning how are", degrees: [4, 4, 5, 4, 2], rhythm: TAP, chords: [[0, 4]] },
          { words: "pancakes made", degrees: [7, 6, 4], rhythm: [1, 1, 2], chords: [[4, 4]] },
          { who: "gruff", words: "Once upon a", degrees: [0, 2, 4, 5], rhythm: [1, 1, 1, 1], chords: [[3, 4]] },
          { words: "tax return", degrees: [7, 7, 0], rhythm: [1, 1, 2], chords: [[0, 4]] },
          { who: "tabby", words: "Twinkle twinkle little", degrees: [0, 0, 4, 4, 5, 5], rhythm: [0.5, 0.5, 0.5, 0.5, 1, 1], chords: [[0, 2], [3, 2]] },
          { words: "spreadsheet", degrees: [1, 1], rhythm: [1, 3], chords: [[4, 4]] },
          { who: "clank", words: "Beep boop please reboot my", degrees: [0, 0, 0, 0, 0, 0], rhythm: [0.5, 0.5, 0.5, 0.5, 1, 1], chords: [[4, 4]] },
          { words: "grandma's cat", degrees: [2, 1, 0], rhythm: [1, 1, 2], chords: [[0, 4]] },
        ],
      },
      chorus,
      {
        lines: [
          { who: "vee", words: "Rock and", degrees: [4, 4], rhythm: [2, 2], chords: [[0, 4]] },
          { words: "potted plant", degrees: [5, 4, 2], rhythm: [1, 1, 2], chords: [[4, 4]] },
          { who: "pip", words: "Ribbit means I'm", degrees: [4, 5, 4, 2], rhythm: [1, 1, 1, 1], chords: [[3, 4]] },
          { words: "out of soup", degrees: [7, 7, 4], rhythm: [1, 1, 2], chords: [[0, 4]] },
          { who: "gruff", words: "Roses are red and my fur is", degrees: [4, 4, 4, 2, 5, 5, 5, 4], rhythm: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], chords: [[0, 2], [4, 2]] },
          { words: "lemonade", degrees: [7, 5, 4], rhythm: [1, 1, 2], chords: [[0, 4]] },
          { who: "tabby", words: "Thank you so much you're", degrees: [4, 4, 5, 7, 5], rhythm: TAP, chords: [[1, 4]] },
          // the one Scribe gets right; the band stops to stare
          { words: "welcome", degrees: [1, 0], rhythm: [2, 2], chords: [[4, 2], [0, 2]] },
          { rest: 4 },
        ],
      },
      chorus,
    ],
    finale: { word: "Ding", degree: 7 },
  });
}
