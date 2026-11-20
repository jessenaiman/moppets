import {beatsPerBar} from "./meter";
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
  name?: string;
  lines: (Line | Rest)[];
  /** the choir pads the chords (otherwise only the bass plays) */
  choir?: boolean;
}
export interface Song {
  meter?: string;
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
  finale: { word: string; degree: number; notes?: Pick<Sung, "degrees" | "rhythm"> };
}

const REGISTER: Record<string, [number, number]> = Object.fromEntries(CAST.map((v) => [v.id, v.register]));

const isRest = (l: Line | Rest): l is Rest => "rest" in l;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function buildSong(s: Song): Piece {
  const barLength=beatsPerBar(s.meter);
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
  const sing = (who: string, sung: Sung, at: number, src?: [number, number, number]) => {
    if (sung.do) cues.push({ beat: at, who, gesture: sung.do });
    if (sung.react && previous && previous !== who) cues.push({ beat: at + sum(sung.rhythm) - 0.25, who: previous, gesture: sung.react });
    previous = who;
    if (sung.degrees.length !== sung.rhythm.length) throw new Error(`${s.title}: "${sung.words}" has ${sung.degrees.length} notes and ${sung.rhythm.length} lengths`);
    const p = part(who), line = p.phrases.push(sung.words) - 1;
    let beat = at;
    sung.degrees.forEach((d, j) => {
      p.events.push({ beat, beats: sung.rhythm[j], midi: scalePitch(d, key, mode), text: "", line, ...(src ? { src: [...src, j] as [number, number, number, number] } : {}) });
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
  chords.push({ ...chordInfo(0, key, mode), beat: 0, beats: barLength });
  if (bass !== "none") pad(bass, 0, 0, barLength);
  let at = barLength;
  const sections = [{name:"Intro",beat:0}];
  const distinct = [...new Set(s.sections)];
  for (const section of s.sections) {
    const si = distinct.indexOf(section);
    sections.push({name:section.name ?? "Section " + (si+1),beat:at});
    for (const [li, l] of section.lines.entries()) {
      if (isRest(l)) {
        at += l.rest;
        continue;
      }
      const length = sing(l.who ?? s.lead, l, at, [si, li, -1]);
      const busy = new Set([l.who ?? s.lead]);
      for (const [ai, w] of (l.with ?? []).entries()) {
        busy.add(w.who ?? s.lead);
        if ((w.offset ?? 0) + sum(w.rhythm) > length + 1e-9) throw new Error(`${s.title}: "${w.words}" runs past its line`);
        sing(w.who ?? s.lead, w, at + (w.offset ?? 0), [si, li, ai]);
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
  chords.push({ ...chordInfo(0, key, mode), beat: at, beats: barLength });
  // everyone on stage lands on it (offstage Moppets stay quiet)
  for (const [id, d] of FINALE_SEATS) if (id !== s.lead && (!s.stage || s.stage.includes(id))) pad(id, at, d, barLength);
  const finaleNotes = s.finale.notes ?? { degrees: [s.finale.degree], rhythm: [barLength] };
  if (Math.abs(sum(finaleNotes.rhythm) - barLength) > 1e-9) throw new Error(`${s.title}: the finale must fill one bar`);
  sing(s.lead, { words: s.finale.word, ...finaleNotes }, at);

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
  sections.push({name:"Finale",beat:at});
  return { kind: "motesong", sections, title: s.title, key, mode, bpm: s.bpm, ...(s.meter?{meter:s.meter}:{}), beats: at + barLength, chords, tracks, description: s.description, beat: s.beat, cues, ...(s.stage ? { stage: s.stage } : {}) };
}

// ---------------------------------------------------------------------------------- the songs

/**
 * Every Moppet original, in songbook order: the lesson id, the tab's label, and the score. The
 * songs themselves are lead sheets in songs/ (see songFile.ts and docs/writing-songs.md).
 */
export const SONGBOOK = SONG_FILES.flatMap((f) => (f.kind === "song" ? [{ id: f.id, tab: f.tab, song: f.song, make: () => buildSong(f.song) }] : []));
export type SongId = string;
