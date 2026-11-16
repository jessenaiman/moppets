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
  /** beats into the line before this phrase starts (for a phrase sung `with` a line: an answer) */
  offset?: number;
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

/** A chord under a line, in absolute beats. */
interface Span {
  start: number;
  end: number;
  deg: number;
}
const chordTones = (deg: number) => new Set([0, 2, 4].map((k) => (((deg + k) % 7) + 7) % 7));

/**
 * A sung note on a strong beat (1 or 3 of the bar), one that lands on any beat and lasts one, or
 * one that is held, must be a tone of the chord under it; one held across a chord change must also fit the chords it lasts a beat into, where some
 * tone fits them all. Otherwise it moves a scale step (down first) to the nearest that does.
 * Shorter off-beat notes stay as written: they are the passing tones that make a melody move.
 * (The first hand-written songs held non-chord notes on the downbeat, 26 times in "Still
 * Loading" against none in "Chip Reads the Manual", and it sounded wrong.)
 */
function fitChord(d: number, beat: number, beats: number, spans: Span[]): number {
  const onBeat = Math.abs(beat - Math.round(beat)) < 1e-9, strong = onBeat && Math.round(beat) % 2 === 0;
  if (!strong && !(onBeat && beats >= 1) && beats < 1.5) return d;
  const covering = spans.filter((sp) => sp.end > beat + 1e-9 && sp.start < beat + beats - 1e-9);
  if (!covering.length) return d;
  const first = covering.find((sp) => sp.start <= beat + 1e-9) ?? covering[0];
  let allowed = chordTones(first.deg);
  for (const sp of covering) {
    if (sp === first || Math.min(sp.end, beat + beats) - Math.max(sp.start, beat) < 1) continue;
    const common = [...allowed].filter((x) => chordTones(sp.deg).has(x));
    if (common.length) allowed = new Set(common);
  }
  const fits = (x: number) => allowed.has(((x % 7) + 7) % 7);
  for (const step of [0, -1, 1, -2, 2]) if (fits(d + step)) return d + step;
  return d;
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
  const sing = (who: string, sung: Sung, at: number, spans: Span[]) => {
    if (sung.degrees.length !== sung.rhythm.length) throw new Error(`${s.title}: "${sung.words}" has ${sung.degrees.length} notes and ${sung.rhythm.length} lengths`);
    const p = part(who), line = p.phrases.push(sung.words) - 1;
    let beat = at;
    sung.degrees.forEach((d, j) => {
      p.events.push({ beat, beats: sung.rhythm[j], midi: scalePitch(fitChord(d, beat, sung.rhythm[j], spans), key, mode), text: "", line });
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
      const spans: Span[] = [];
      for (const [deg, beats] of l.chords) spans.push({ start: spans.length ? spans[spans.length - 1].end : at, end: (spans.length ? spans[spans.length - 1].end : at) + beats, deg });
      const length = sing(l.who ?? s.lead, l, at, spans);
      const busy = new Set([l.who ?? s.lead]);
      for (const w of l.with ?? []) {
        busy.add(w.who ?? s.lead);
        if ((w.offset ?? 0) + sum(w.rhythm) > length + 1e-9) throw new Error(`${s.title}: "${w.words}" runs past its line`);
        sing(w.who ?? s.lead, w, at + (w.offset ?? 0), spans);
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
  sing(s.lead, { words: s.finale.word, degrees: [s.finale.degree], rhythm: [BAR] }, at, [{ start: at, end: at + BAR, deg: 0 }]);

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
          { words: "Hum", degrees: [4], rhythm: [8], chords: [[0, 8]], with: [{ who: "scribe", words: "Tick tock tick tock tick tock tick tock", degrees: [7, 6, 7, 6, 7, 6, 7, 6], rhythm: [1, 1, 1, 1, 1, 1, 1, 1] }] },
          { words: "Hum", degrees: [6], rhythm: [8], chords: [[4, 8]], with: [{ who: "scribe", words: "Tick tock tick tock tick tock tick tock", degrees: [8, 7, 8, 7, 8, 7, 8, 7], rhythm: [1, 1, 1, 1, 1, 1, 1, 1] }] },
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

const SWING_BEAT = { text: "B . t . | Pf . t K | B . t . | Pf . t K", swing: 0.45 };
const MARCH_BEAT = { text: "B . t . | B . t . | B . tss . | B . t .", swing: 0 };
const BOSSA_BEAT = { text: "B . t K | . t B . | t B . K | . B t .", swing: 0.05 };
/** A line sung by several Moppets at once: `parts` are [who, scale steps from the melody]. */
const together = (l: Line, parts: [string, number][]): Line => ({ ...l, with: [...(l.with ?? []), ...parts.map(([who, steps]) => ({ who, words: l.words, degrees: l.degrees.map((d) => d + steps), rhythm: l.rhythm }))] });
/** A call and its answer: one line, the answer coming in partway through. */
const call = (who: string, words: string, degrees: number[], rhythm: number[], chords: [number, number][]): Line => ({ who, words, degrees, rhythm, chords });

/**
 * "Rewind, Be Kind": Vee the tape deck keeps the last few minutes crisp and chews up anything
 * older. A helper holds only so much: say the important parts again. In the bridge the tape gets
 * eaten, the band stops, and Vee wobbles back.
 */
export function makeRewind(): Piece {
  const verse = (w: string[]): Section => ({
    lines: [
      { words: w[0], degrees: [0, 0, 2, 4, 4, 5, 4, 2], rhythm: LILT_B, chords: [[0, 4], [5, 4]] },
      { words: w[1], degrees: [4, 4, 5, 7, 7, 5, 4, 4], rhythm: LILT_A, chords: [[3, 4], [4, 4]] },
      { words: w[2], degrees: [0, 0, 2, 4, 4, 5, 4, 2], rhythm: LILT_B, chords: [[0, 4], [5, 4]] },
      { words: w[3], degrees: [4, 5, 4, 2, 1, 2, 1, 0], rhythm: LILT_A, chords: [[1, 4], [4, 2], [0, 2]] },
    ],
  });
  const hook = { words: "Rewind be kind rewind", degrees: [2, 4, 5, 7, 5, 4], rhythm: [0.5, 1.5, 0.5, 1.5, 0.5, 3.5] };
  const chorus: Section = {
    choir: true,
    lines: [
      { ...hook, chords: [[0, 4], [4, 4]] },
      { words: "I hold what fits upon my reel", degrees: [4, 4, 5, 7, 5, 4, 2, 4], rhythm: LILT_B, chords: [[3, 4], [0, 4]] },
      { ...hook, chords: [[0, 4], [5, 4]] },
      { words: "Repeat the parts that matter most", degrees: [4, 5, 7, 5, 4, 2, 1, 0], rhythm: LILT_A, chords: [[1, 4], [4, 2], [0, 2]] },
    ],
  };
  return buildSong({
    lead: "vee",
    title: "Rewind, Be Kind",
    description: "08 · Vee remembers the last ten minutes perfectly, and the rest not at all",
    key: "F",
    bpm: 104,
    beat: SWING_BEAT,
    seats: [["pip", 2], ["tabby", 4], ["scribe", 0], ["gruff", 2]],
    sections: [
      verse(["I keep the last ten minutes near", "I play them back so crisp and clear", "But Tuesday's tape got wound too tight", "It sounds like soup and socks and night"]),
      chorus,
      // the tape gets eaten: everything stops, Vee slows to a groan, Tabby notices, Vee rewinds
      {
        lines: [
          { rest: 2 },
          { words: "Wub wub wub wub", degrees: [4, 3, 1, -1], rhythm: [1, 1, 2, 2], chords: [[0, 6]] },
          call("tabby", "Oh no the tape", [7, 5, 4, 2], [1, 1, 1, 1], [[5, 4]]),
          { words: "Hang on rewinding", degrees: [-1, 0, 2, 4, 7], rhythm: [0.5, 0.5, 0.5, 0.5, 2], chords: [[4, 4]] },
        ],
      },
      verse(["You told me that you like the blue", "You told me that you have a cat", "And way back when you said your name", "I think it might have been a spoon"]),
      chorus,
    ],
    finale: { word: "Kind", degree: 7 },
  });
}

/**
 * "Mainframe Blues": Clank fills a room to add up two. Huge, slow, glad to help; the choir answers
 * like backing singers. Mixolydian, so the seventh is flat and bluesy.
 */
export function makeMainframeBlues(): Piece {
  const ROLL = [0.5, 0.5, 1, 0.5, 0.5, 1, 1, 3];
  const doowah = (degrees: number[]): Sung[] => [
    { who: "tabby", words: "doo wah", degrees: degrees.map((d) => d + 2), rhythm: [1, 1], offset: 6 },
    { who: "pip", words: "doo wah", degrees, rhythm: [1, 1], offset: 6 },
    { who: "scribe", words: "doo wah", degrees: degrees.map((d) => d + 4), rhythm: [1, 1], offset: 6 },
  ];
  const verse = (w: string[]): Section => ({
    lines: [
      { words: w[0], degrees: [4, 4, 2, 0, 2, 4, 2, 0], rhythm: ROLL, chords: [[0, 4], [0, 4]], with: doowah([6, 4]) },
      { words: w[1], degrees: [4, 4, 2, 0, 2, 4, 6, 4], rhythm: ROLL, chords: [[3, 4], [3, 4]], with: doowah([5, 3]) },
      { words: w[2], degrees: w[2].split(" ").length === 7 ? [4, 4, 2, 0, 2, 4, 0] : [4, 4, 2, 0, 2, 4, 2, 0], rhythm: w[2].split(" ").length === 7 ? [0.5, 0.5, 1, 0.5, 0.5, 1, 4] : ROLL, chords: [[0, 4], [0, 4]], with: doowah([6, 4]) },
      { words: w[3], degrees: [4, 4, 6, 4, 2, 1, 0, 0], rhythm: [1, 0.5, 0.5, 1, 1, 1, 0.5, 2.5], chords: [[4, 4], [0, 4]], with: doowah([4, 4]) },
    ],
  });
  const chorus: Section = {
    choir: true,
    lines: [
      { words: "I've got the mainframe blues", degrees: [0, 2, 4, 6, 4, 4], rhythm: [0.5, 0.5, 1, 1, 1, 4], chords: [[0, 4], [3, 4]] },
      { words: "Too big to fit in your shoes", degrees: [4, 4, 2, 4, 2, 0, 0], rhythm: [1, 1, 1, 1, 1, 1, 2], chords: [[0, 4], [4, 4]] },
      { words: "But ask me anything at all", degrees: [0, 2, 4, 6, 6, 6, 4, 2], rhythm: LILT_B, chords: [[3, 4], [0, 4]] },
      { words: "I'll think it over down the hall", degrees: [4, 4, 2, 0, 2, 1, 0, 0], rhythm: LILT_A, chords: [[4, 4], [0, 4]] },
    ],
  };
  return buildSong({
    lead: "clank",
    title: "Mainframe Blues",
    description: "09 · Clank fills a room to add up two, with backing singers",
    key: "G",
    mode: "mixolydian",
    bpm: 70,
    beat: { text: "B . . . | t . . K | B . . . | t . K .", swing: 0.4 },
    bass: "vee",
    seats: [["pip", 2], ["tabby", 4], ["scribe", 2], ["gruff", 0]],
    sections: [
      verse(["I fill a room to add up two", "My fans all hum the whole night through", "You ask me what's three plus one", "Give me a week I'll get it done"]),
      chorus,
      verse(["They shrank me down into a phone", "But I still hum when I'm alone", "Now four plus four I know that's eight", "I worked it out but I was late"]),
      chorus,
    ],
    finale: { word: "Blues", degree: 0 },
  });
}

/**
 * "Static Lullaby": when Tabby's signal is weak she paints in what she thinks is there, and says
 * so. Honest uncertainty, as a lullaby.
 */
export function makeStaticLullaby(): Piece {
  const ROCK = [1.5, 0.5, 1, 1, 1.5, 0.5, 1, 1];
  const verse = (w: string[]): Section => ({
    lines: [
      { words: w[0], degrees: [4, 2, 0, 2, 4, 5, 4, 4], rhythm: ROCK, chords: [[0, 4], [3, 4]] },
      { words: w[1], degrees: [4, 5, 7, 7, 5, 4, 2, 1], rhythm: ROCK, chords: [[0, 4], [4, 4]] },
      { words: w[2], degrees: w[2].split(" ").length === 7 ? [4, 2, 0, 2, 4, 5, 4] : [4, 2, 0, 2, 4, 5, 4, 4], rhythm: w[2].split(" ").length === 7 ? [1.5, 0.5, 1, 1, 1.5, 0.5, 2] : ROCK, chords: [[0, 4], [3, 4]] },
      { words: w[3], degrees: [5, 4, 2, 4, 2, 1, 1, 0], rhythm: ROCK, chords: [[1, 4], [4, 2], [0, 2]] },
    ],
  });
  const sleep = { degrees: [7, 4, 5, 4, 2, 4], rhythm: [2, 2, 1, 1, 1, 1] };
  const chorus: Section = {
    choir: true,
    lines: [
      { words: "Sleep sleep the snow will fall", ...sleep, chords: [[0, 4], [5, 4]] },
      { words: "I might be dreaming ask again", degrees: [4, 5, 7, 5, 4, 2, 4, 2], rhythm: LILT_B, chords: [[3, 4], [4, 4]] },
      { words: "Sleep sleep I'll tell you true", ...sleep, chords: [[0, 4], [5, 4]] },
      { words: "When I'm not sure I'll say so too", degrees: [4, 5, 4, 2, 1, 2, 1, 0], rhythm: LILT_A, chords: [[1, 4], [4, 2], [0, 2]] },
    ],
  };
  return buildSong({
    lead: "tabby",
    title: "Static Lullaby",
    description: "10 · Tabby fills in the snow on her screen, and tells you when she's guessing",
    key: "F",
    bpm: 72,
    beat: { text: "B . . . | . . . . | t . . . | . . . .", swing: 0 },
    seats: [["vee", 0], ["pip", 2], ["scribe", 4], ["gruff", 2]],
    sections: [
      verse(["Hush now the screen is soft and gray", "The signal wanders far away", "I see a horse or just a chair", "I'll paint it in but check it's there"]),
      chorus,
      verse(["I filled the gaps in purple light", "A moon a sheep a kite at night", "Some are real and some I made", "So check the sky before I fade"]),
      chorus,
    ],
    finale: { word: "Sleep", degree: 7 },
  });
}

/**
 * "Ask Me Anything (But That)": Gruff the monster radio is big and scary outside, careful inside.
 * The others try silly requests; he turns each one into something kind, and says yes to the one
 * that is.
 */
export function makeAskMeAnything(): Piece {
  const ask = [4, 4, 5, 4, 2], yes: [number, number][] = [[0, 4]], hm: [number, number][] = [[4, 4]];
  const chorusHook = { words: "Ask me anything but that", degrees: [7, 7, 5, 4, 5, 4, 2], rhythm: [1, 0.5, 0.5, 1, 1, 1, 3] };
  const chorus: Section = {
    choir: true,
    lines: [
      { ...chorusHook, chords: [[0, 4], [3, 4]] },
      { words: "I'll help you build I'll help you mend", degrees: [4, 5, 7, 4, 4, 5, 7, 5], rhythm: LILT_B, chords: [[0, 4], [4, 4]] },
      { ...chorusHook, chords: [[0, 4], [3, 4]] },
      { words: "A monster can be a friend", degrees: [4, 5, 4, 2, 1, 2, 0], rhythm: [1, 1, 1, 1, 1, 1, 2], chords: [[1, 4], [4, 2], [0, 2]] },
    ],
  };
  return buildSong({
    lead: "gruff",
    title: "Ask Me Anything (But That)",
    description: "11 · Gruff is scary on the outside and careful on the inside",
    key: "D",
    bpm: 112,
    beat: MARCH_BEAT,
    seats: [["vee", 0], ["pip", 2], ["tabby", 4], ["scribe", 2]],
    sections: [
      {
        lines: [
          { words: "I'm big and loud and full of fuzz", degrees: [0, 0, 4, 4, 5, 5, 4, 4], rhythm: LILT_B, chords: [[0, 4], [4, 4]] },
          { words: "My tubes glow orange when I buzz", degrees: [4, 4, 5, 7, 5, 4, 2, 1], rhythm: LILT_A, chords: [[0, 4], [4, 4]] },
          { words: "But don't be scared of all my growl", degrees: [0, 0, 4, 4, 5, 5, 4, 4], rhythm: LILT_B, chords: [[3, 4], [0, 4]] },
          { words: "I'm gentle as a napping owl", degrees: [4, 5, 4, 2, 1, 2, 1, 0], rhythm: LILT_A, chords: [[1, 4], [4, 2], [0, 2]] },
        ],
      },
      chorus,
      {
        // the requests: each one hangs on the dominant, Gruff's answer comes home
        lines: [
          call("pip", "Help me build a trap", ask, TAP, hm),
          { words: "Let's build a birdhouse", degrees: [4, 2, 0, 2, 0], rhythm: TAP, chords: yes },
          call("vee", "Help me steal a pie", ask, TAP, hm),
          { words: "Let's bake one too", degrees: [4, 2, 1, 0], rhythm: [1, 1, 1, 1], chords: yes },
          call("clank", "Help me scare the cat", ask, TAP, hm),
          { words: "Let's sing it a song", degrees: [4, 2, 0, 2, 0], rhythm: TAP, chords: yes },
          call("chip", "Help me reach the shelf", ask, TAP, hm),
          // the one he can do: rising, yes
          { words: "Hop up on my head", degrees: [0, 2, 4, 5, 7], rhythm: TAP, chords: yes },
        ],
      },
      chorus,
    ],
    finale: { word: "Friend", degree: 0 },
  });
}

/**
 * "Pip Repeats": Pip learns by echo. First the others call and Pip copies, badly, then better;
 * by the end Pip calls and the others echo. Learning from examples.
 */
export function makePipRepeats(): Piece {
  const echo = (who: string, words: string, degrees: number[], rhythm: number[], chords: [number, number][], by: string, as = words): Line[] => [call(who, words, degrees, rhythm, chords), call(by, as, degrees, rhythm, chords)];
  const ribbit = { degrees: [4, 2, 4, 2, 5, 4, 2], rhythm: [0.5, 0.5, 0.5, 0.5, 1, 1, 4] };
  const chorus: Section = {
    choir: true,
    lines: [
      { words: "Ribbit ribbit copy me", ...ribbit, chords: [[0, 4], [4, 4]] },
      { words: "Watch and listen try again", degrees: [2, 4, 5, 7, 5, 4, 2], rhythm: [1, 0.5, 0.5, 1, 1, 1, 3], chords: [[3, 4], [4, 4]] },
      { words: "Ribbit ribbit one more time", ...ribbit, chords: [[0, 4], [4, 4]] },
      { words: "Now I've got it now it's mine", degrees: [4, 5, 4, 2, 1, 1, 0], rhythm: [1, 0.5, 0.5, 1, 1, 1, 3], chords: [[1, 4], [4, 2], [0, 2]] },
    ],
  };
  return buildSong({
    lead: "pip",
    title: "Pip Repeats",
    description: "12 · Pip learns by copying, until the others copy Pip",
    key: "A",
    bpm: 108,
    beat: BOSSA_BEAT,
    seats: [["vee", 0], ["tabby", 4], ["scribe", 2], ["gruff", 2]],
    sections: [
      {
        lines: [
          ...echo("tabby", "Hello there", [4, 5, 4], [1, 1, 2], [[0, 4]], "pip", "Jello there"),
          ...echo("vee", "Nice to meet you", [2, 4, 5, 4], [1, 1, 1, 1], [[3, 4]], "pip", "Ice to eat you"),
          ...echo("scribe", "Pass the butter", [7, 5, 4, 2], [1, 1, 1, 1], [[4, 4]], "pip"),
          ...echo("gruff", "Excellent frog", [0, 2, 4, 7], [1, 1, 1, 1], [[0, 4]], "pip"),
        ],
      },
      chorus,
      {
        lines: [
          ...echo("pip", "Lily pad", [4, 5, 7], [1, 1, 2], [[0, 4]], "vee"),
          ...echo("pip", "Splish splash splosh", [7, 5, 4], [1, 1, 2], [[4, 4]], "clank"),
          ...echo("pip", "Moppets rule", [4, 5, 7], [1, 1, 2], [[3, 4]], "tabby"),
          call("pip", "Thank you teachers", [7, 5, 4, 2], [1, 1, 1, 1], [[4, 4]]),
          call("gruff", "You're welcome Pip", [4, 2, 1, 0], [1, 1, 1, 1], [[0, 4]]),
        ],
      },
      chorus,
    ],
    finale: { word: "Croak", degree: 7 },
  });
}

/**
 * "Found Things": the finale. Each Moppet sings what it was before it was found, and as the next
 * one sings, the last adds its own sound; then everyone sings the chorus together, built from what
 * others left behind and thankful for it.
 */
export function makeFoundThings(): Piece {
  const A = { degrees: [0, 2, 4, 4, 5, 4, 2, 4], rhythm: LILT_B, chords: [[0, 4], [5, 4]] as [number, number][] };
  const B = { degrees: [4, 5, 7, 7, 5, 4, 2, 1], rhythm: LILT_A, chords: [[3, 4], [4, 4]] as [number, number][] };
  const sound = (who: string, words: string, degree: number): Sung => ({ who, words, degrees: [degree], rhythm: [1], offset: 7 });
  const sing = (parts: [string, number][], l: Line) => together(l, parts);
  const everyone: [string, number][] = [["tabby", 0], ["chip", 0], ["pip", 2], ["scribe", -2], ["gruff", 0]];
  const chorus: Section = {
    lines: [
      sing(everyone, { words: "We are the found things put to use", degrees: [4, 4, 5, 7, 7, 5, 4, 2], rhythm: LILT_B, chords: [[0, 4], [4, 4]] }),
      sing(everyone, { words: "Built from the bits that you let loose", degrees: [2, 2, 4, 5, 5, 4, 2, 1], rhythm: LILT_A, chords: [[5, 4], [4, 4]] }),
      sing(everyone, { words: "Thank you for all you left before", degrees: [4, 4, 5, 7, 8, 7, 5, 4], rhythm: LILT_B, chords: [[3, 4], [0, 4]] }),
      sing(everyone, { words: "At four oh four we all belong", degrees: [4, 5, 4, 2, 1, 2, 1, 0], rhythm: LILT_A, chords: [[1, 4], [4, 2], [0, 2]] }),
    ],
  };
  return buildSong({
    lead: "vee",
    title: "Found Things",
    description: "13 · The finale: everyone was something else once",
    key: "D",
    bpm: 96,
    beat: { text: "B . t . | Pf . t . | B . t . | Pf . t K", swing: 0.1 },
    seats: [],
    sections: [
      {
        lines: [
          { words: "I was a tape left in a drawer", ...A },
          { who: "scribe", words: "I was the keys by the back door", ...B, with: [sound("vee", "whirr", 4)] },
          { who: "clank", words: "I was a fridge sized thinking box", ...A, with: [sound("scribe", "ding", 7)] },
          { who: "tabby", words: "I was a screen that lost its glow", ...B, with: [sound("clank", "beep", 0)] },
          { who: "pip", words: "I was a frog of felt and thread", ...A, with: [sound("tabby", "hum", 4)] },
          { who: "gruff", words: "I was a box of tubes half dead", ...B, with: [sound("pip", "croak", 2)] },
          { who: "chip", words: "I was a disk beneath a bed", degrees: [4, 5, 7, 5, 4, 2, 1, 0], rhythm: LILT_A, chords: [[1, 4], [4, 2], [0, 2]], with: [sound("gruff", "buzz", 0)] },
        ],
      },
      chorus,
      chorus,
    ],
    finale: { word: "Home", degree: 7 },
  });
}

/** Every Moppet original, in songbook order: the lesson id, the tab's label, and the score. */
export const SONGBOOK = [
  { id: "loading", tab: "06 · Still Loading", make: makeStillLoading },
  { id: "autocomplete", tab: "07 · Autocomplete", make: makeAutocomplete },
  { id: "rewind", tab: "08 · Rewind, Be Kind", make: makeRewind },
  { id: "mainframe", tab: "09 · Mainframe Blues", make: makeMainframeBlues },
  { id: "lullaby", tab: "10 · Static Lullaby", make: makeStaticLullaby },
  { id: "askme", tab: "11 · Ask Me Anything", make: makeAskMeAnything },
  { id: "pip", tab: "12 · Pip Repeats", make: makePipRepeats },
  { id: "found", tab: "13 · Found Things", make: makeFoundThings },
] as const;
export type SongId = (typeof SONGBOOK)[number]["id"];
