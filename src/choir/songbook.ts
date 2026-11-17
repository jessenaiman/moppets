/**
 * The Moppet songbook: original songs written note by note (as lead sheets in songs/), where each Moppet's found object
 * stands for something a helpful AI does. Unlike the lead songs in music.ts (one singer, one verse
 * sung twice), a songbook line says who sings it, so a line can be handed between Moppets
 * mid-bar, two can sing at once, a bar can stop dead before a punchline, and verses differ.
 *
 * Melodies are scale degrees (0 = the key's tonic, 7 = an octave up), placed in each singer's
 * own register: a singer's whole part moves by octaves together, so its contour stays as written.
 * Every syllable gets one note; the lyric planner checks the count.
 */
import type { GestureName } from "./gestures.ts";
import { candidates, chordInfo, scalePitch, type Chord, type KeyName, type Piece, type ScaleMode, type ScoreEvent, type Track } from "./music.ts";
import { CAST } from "./voices.ts";
import { FINALE_SEATS, padOf } from "./cast/index.ts";
import { SONG_FILES } from "./songs.ts";

/** One sung phrase: who sings it (default the song's lead), its words, and a note per syllable. */
export interface Sung {
  who?: string;
  words: string;
  degrees: number[];
  rhythm: number[];
  /** beats into the line before this phrase starts (for a phrase sung `with` a line: an answer) */
  offset?: number;
  /** a gesture the singer makes as the phrase starts (see gestures.ts) */
  do?: GestureName;
  /** a gesture the previous phrase's singer makes as this one ends: a reaction to a punchline */
  react?: GestureName;
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
  /** who sings the bass line (default Clank; "none": the band's bass alone) */
  bass?: string;
  /** who is on stage ("band" for the band members); none: the whole cast */
  stage?: string[];
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
  const cues: NonNullable<Piece["cues"]> = [];
  let previous: string | null = null;
  const sing = (who: string, sung: Sung, at: number, spans: Span[], src?: [number, number, number]) => {
    if (sung.do) cues.push({ beat: at, who, gesture: sung.do });
    if (sung.react && previous && previous !== who) cues.push({ beat: at + sum(sung.rhythm) - 0.25, who: previous, gesture: sung.react });
    previous = who;
    if (sung.degrees.length !== sung.rhythm.length) throw new Error(`${s.title}: "${sung.words}" has ${sung.degrees.length} notes and ${sung.rhythm.length} lengths`);
    const p = part(who), line = p.phrases.push(sung.words) - 1;
    let beat = at;
    sung.degrees.forEach((d, j) => {
      p.events.push({ beat, beats: sung.rhythm[j], midi: scalePitch(fitChord(d, beat, sung.rhythm[j], spans), key, mode), text: "", line, ...(src ? { src: [...src, j] as [number, number, number, number] } : {}) });
      beat += sung.rhythm[j];
    });
    return beat - at;
  };
  const pad = (id: string, beat: number, degree: number, beats: number) => {
    const r = REGISTER[id], mid = (r[0] + r[1]) / 2;
    const midi = candidates([degree], key, mode, r).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
    part(id).pads.push({ beat, beats, midi, text: padOf(id) });
  };

  // a bar of groove so the song doesn't start cold
  chords.push({ ...chordInfo(0, key, mode), beat: 0, beats: BAR });
  if (bass !== "none") pad(bass, 0, 0, BAR);
  let at = BAR;
  const distinct = [...new Set(s.sections)];
  for (const section of s.sections) {
    const si = distinct.indexOf(section);
    for (const [li, l] of section.lines.entries()) {
      if (isRest(l)) {
        at += l.rest;
        continue;
      }
      const spans: Span[] = [];
      for (const [deg, beats] of l.chords) spans.push({ start: spans.length ? spans[spans.length - 1].end : at, end: (spans.length ? spans[spans.length - 1].end : at) + beats, deg });
      const length = sing(l.who ?? s.lead, l, at, spans, [si, li, -1]);
      const busy = new Set([l.who ?? s.lead]);
      for (const [ai, w] of (l.with ?? []).entries()) {
        busy.add(w.who ?? s.lead);
        if ((w.offset ?? 0) + sum(w.rhythm) > length + 1e-9) throw new Error(`${s.title}: "${w.words}" runs past its line`);
        sing(w.who ?? s.lead, w, at + (w.offset ?? 0), spans, [si, li, ai]);
      }
      if (Math.abs(sum(l.chords.map((c) => c[1])) - length) > 1e-9) throw new Error(`${s.title}: the chords under "${l.words}" last ${sum(l.chords.map((c) => c[1]))} beats, the line ${length}`);
      let t = at;
      for (const [deg, beats] of l.chords) {
        chords.push({ ...chordInfo(((deg % 7) + 7) % 7, key, mode), beat: t, beats });
        if (bass !== "none" && !busy.has(bass)) pad(bass, t, deg, beats);
        if (section.choir) for (const [id, offset] of s.seats) if (!busy.has(id) && id !== bass) pad(id, t, deg + offset, beats);
        t += beats;
      }
      at += length;
    }
  }
  // everyone lands on the home chord; the lead holds the last word
  chords.push({ ...chordInfo(0, key, mode), beat: at, beats: BAR });
  // everyone on stage lands on it (offstage Moppets stay quiet)
  for (const [id, d] of FINALE_SEATS) if (id !== s.lead && (!s.stage || s.stage.includes(id))) pad(id, at, d, BAR);
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
  return { kind: "motesong", title: s.title, key, mode, bpm: s.bpm, beats: at + BAR, chords, tracks, description: s.description, beat: s.beat, cues, ...(s.stage ? { stage: s.stage } : {}) };
}

// ---------------------------------------------------------------------------------- the songs

/**
 * Every Moppet original, in songbook order: the lesson id, the tab's label, and the score. The
 * songs themselves are lead sheets in songs/ (see songFile.ts and docs/writing-songs.md).
 */
export const SONGBOOK = SONG_FILES.flatMap((f) => (f.kind === "song" ? [{ id: f.id, tab: f.tab, song: f.song, make: () => buildSong(f.song) }] : []));
export type SongId = string;
