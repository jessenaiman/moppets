/**
 * Pure-TS `.song` + `.mid` loader and syllable-to-MIDI planner for Moppets.
 * Keeps `songs/*.song` + `songs/*.mid` as the single editable source of truth.
 */
import { lyricsToSyllables, type Syllable } from "../wasm/engine.ts";

export type CameraPreset = "wide" | "closeup" | "reaction" | "low-angle";
export type MopAction = "idle" | "sing" | "belt" | "chuckle" | "walk" | "toast" | "bow";

export interface SongPhrase {
  index: number;
  section: string;
  words: string;
  degrees: number[];
  rhythm: number[];
  startBeat: number;
  beats: number;
  /** Parsed cues from `; do ... ; take ... ; move ... ; jump ; dance ; celebrate ; cam ...` */
  doGesture?: string;
  take?: string;
  moveTarget?: string;
  jump?: boolean;
  dance?: boolean;
  celebrate?: boolean;
  cam?: CameraPreset;
  /** Matched MIDI notes for this phrase (one note per syllable) */
  notes: { beat: number; beats: number; midi: number; vel: number; syl: Syllable }[];
}

export interface ParsedMopSong {
  id: string;
  title: string;
  about: string;
  lead: string;
  key: string;
  bpm: number;
  durationBeats: number;
  durationSec: number;
  phrases: SongPhrase[];
  finaleWord?: string;
}

export interface MidiTrackIn {
  name: string;
  channel?: number;
  notes: { beat: number; beats: number; midi: number; vel: number }[];
}

export function parseMidi(bytes: Uint8Array): { bpm: number | null; tracks: MidiTrackIn[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "MThd") throw new Error("Not a MIDI file");
  const division = v.getUint16(12);
  if (!division || (division & 0x8000)) throw new Error("Unsupported MIDI time division");
  let at = 8 + v.getUint32(4);
  let bpm: number | null = null;
  const tracks: MidiTrackIn[] = [];
  while (at + 8 <= bytes.length) {
    const len = v.getUint32(at + 4);
    const end = at + 8 + len;
    if (end > bytes.length) break;
    if (tag(at) !== "MTrk") {
      at = end;
      continue;
    }
    let p = at + 8;
    let tick = 0;
    let status = 0;
    let name = "";
    let channel: number | undefined;
    const open = new Map<number, number[]>();
    const notes: MidiTrackIn["notes"] = [];
    const varlen = () => {
      let n = 0;
      let b = 0;
      do {
        b = bytes[p++];
        n = (n << 7) | (b & 127);
      } while (b & 128);
      return n;
    };
    while (p < end) {
      tick += varlen();
      let s = bytes[p];
      if (s & 128) p++;
      else s = status;
      if (s === 0xff) {
        const type = bytes[p++];
        const n = varlen();
        if (type === 3 && !name) name = new TextDecoder().decode(bytes.subarray(p, p + n));
        if (type === 0x51 && n === 3) {
          const micros = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
          if (micros > 0) bpm = 60000000 / micros;
        }
        p += n;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) {
        p += varlen();
        continue;
      }
      status = s;
      const kind = s & 0xf0;
      const a = bytes[p++];
      const b = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[p++];
      if (kind === 0x90 && b > 0 && channel === undefined) channel = s & 15;
      const key = ((s & 15) << 8) | a;
      if (kind === 0x90 && b > 0) {
        open.set(key, [...(open.get(key) ?? []), tick * 128 + b]);
      } else if (kind === 0x80 || kind === 0x90) {
        const on = open.get(key)?.shift();
        if (on !== undefined) {
          const start = Math.floor(on / 128);
          notes.push({ beat: start / division, beats: Math.max(0.05, (tick - start) / division), midi: a, vel: on % 128 });
        }
      }
    }
    notes.sort((x, y) => x.beat - y.beat || y.midi - x.midi);
    tracks.push({ name, channel, notes });
    at = end;
  }
  return { bpm, tracks };
}

/** Expand `_` vowel-hold marks into melisma syllables matching CHIMERA's lyric planner. */
export function sungSyllables(text: string): Syllable[] {
  if (!text.includes("_")) return lyricsToSyllables(text);
  const syl = lyricsToSyllables(text.replace(/_/g, ""));
  const holds: number[] = [];
  let base = 0;
  for (const word of text.match(/[A-Za-z'][A-Za-z'\-_]*/g) ?? []) {
    const clean = word.replace(/_/g, "");
    const pieces = lyricsToSyllables(clean).map((s) => s.text.length);
    let letters = 0;
    for (const ch of word) {
      if (ch !== "_") {
        letters++;
        continue;
      }
      let k = 0;
      let end = pieces[0] ?? 0;
      while (k < pieces.length - 1 && end < letters) end += pieces[++k];
      holds.push(base + k);
    }
    base += pieces.length;
  }
  if (base !== syl.length) return syl;
  const out: Syllable[] = [];
  syl.forEach((s, i) => {
    const n = holds.filter((h) => h === i).length;
    out.push(n ? { ...s, phraseEnd: false } : s);
    for (let j = 0; j < n; j++) {
      out.push({
        text: "~",
        onset: [],
        nucleus: s.nucleus,
        coda: [],
        melisma: true,
        wordEnd: s.wordEnd,
        phraseEnd: j === n - 1 && s.phraseEnd,
      });
    }
  });
  return out;
}

const num = (s: string) => Number(s.startsWith(".") ? `0${s}` : s.startsWith("-.") ? `-0${s.slice(1)}` : s);

export function parseMopSong(songText: string, midiBytes: Uint8Array, leadId: string): ParsedMopSong {
  const meta = new Map<string, string>();
  let section = "Verse";
  // Intro bar (4 beats) matches Moppet Choir's lead-in bar in `buildSong`
  let cursorBeat = 4;
  const rawPhrases: Omit<SongPhrase, "notes">[] = [];

  for (const rawLine of songText.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1].trim();
      continue;
    }
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (kv && rawPhrases.length === 0) {
      meta.set(kv[1], kv[2]);
      continue;
    }
    const m = /^(?:([a-z]+):\s*)?"([^"]*)"\s*=\s*([^;]*)(.*)$/.exec(line);
    if (!m) continue;
    const words = m[2];
    const [notesPart] = m[3].split("|");
    const degrees: number[] = [];
    const rhythm: number[] = [];
    for (const tok of notesPart.trim().split(/\s+/).filter(Boolean)) {
      const [d, b] = tok.split("/");
      degrees.push(num(d));
      rhythm.push(b === undefined ? 1 : num(b));
    }
    const beats = rhythm.reduce((a, b) => a + b, 0);
    const phrase: Omit<SongPhrase, "notes"> = {
      index: rawPhrases.length,
      section,
      words,
      degrees,
      rhythm,
      startBeat: cursorBeat,
      beats,
    };
    for (const part of m[4].split(";").map((x) => x.trim()).filter(Boolean)) {
      const [k, v] = part.split(/\s+/);
      if (k === "do" && v) phrase.doGesture = v;
      else if (k === "take" && v) phrase.take = v;
      else if (k === "move" && v) phrase.moveTarget = v;
      else if (k === "jump") phrase.jump = true;
      else if (k === "dance") phrase.dance = true;
      else if (k === "celebrate") phrase.celebrate = true;
      else if (k === "cam" && v) phrase.cam = v as CameraPreset;
    }
    rawPhrases.push(phrase);
    cursorBeat += beats;
  }

  const midi = parseMidi(midiBytes);
  const bpm = midi.bpm ?? (Number(meta.get("bpm")) || 112);
  const track =
    midi.tracks.find((t) => t.name.trim().toLowerCase() === leadId.toLowerCase()) ??
    midi.tracks.find((t) => t.notes.length > 0 && !t.name.startsWith("band ") && !t.name.startsWith("beatbox "));
  const midiNotes = track?.notes ?? [];

  let noteIdx = 0;
  const phrases: SongPhrase[] = rawPhrases.map((p) => {
    const syls = sungSyllables(p.words);
    const notes: SongPhrase["notes"] = [];
    for (let i = 0; i < syls.length; i++) {
      const mn = midiNotes[noteIdx];
      if (mn) {
        notes.push({ beat: mn.beat, beats: mn.beats, midi: mn.midi, vel: mn.vel, syl: syls[i] });
        noteIdx++;
      } else {
        const dBeat = p.startBeat + p.rhythm.slice(0, i).reduce((a, b) => a + b, 0);
        notes.push({ beat: dBeat, beats: p.rhythm[i] ?? 1, midi: 62 + (p.degrees[i] ?? 0), vel: 90, syl: syls[i] });
      }
    }
    const startBeat = notes[0]?.beat ?? p.startBeat;
    const endBeat = notes.length ? Math.max(...notes.map((n) => n.beat + n.beats)) : p.startBeat + p.beats;
    return {
      ...p,
      startBeat,
      beats: endBeat - startBeat,
      notes,
    };
  });

  // Append finale note ("Mew") if present in MIDI track after main phrases
  const finaleMatch = /^"([^"]*)"/.exec(meta.get("finale") ?? "");
  const finaleWord = finaleMatch?.[1];
  if (finaleWord && noteIdx < midiNotes.length) {
    const syls = sungSyllables(finaleWord);
    const mn = midiNotes[noteIdx];
    phrases.push({
      index: phrases.length,
      section: "Finale",
      words: finaleWord,
      degrees: [0],
      rhythm: [mn.beats],
      startBeat: mn.beat,
      beats: mn.beats,
      cam: "wide",
      celebrate: true,
      notes: [{ beat: mn.beat, beats: mn.beats, midi: mn.midi, vel: mn.vel, syl: syls[0] }],
    });
  }

  const lastBeat = phrases.reduce((m, p) => Math.max(m, p.startBeat + p.beats), cursorBeat);
  const durationBeats = lastBeat + 2;
  return {
    id: meta.get("id") ?? `bible-${leadId}`,
    title: meta.get("title") ?? "Bible · Tabby",
    about: meta.get("about") ?? "",
    lead: meta.get("lead") ?? leadId,
    key: meta.get("key") ?? "D dorian",
    bpm,
    durationBeats,
    durationSec: (durationBeats * 60) / bpm + 0.35,
    phrases,
    finaleWord,
  };
}

export async function fetchTabbySong(): Promise<ParsedMopSong> {
  const [songRes, midRes] = await Promise.all([
    fetch("/moppets/tabby/bible-tabby.song"),
    fetch("/moppets/tabby/bible-tabby.mid"),
  ]);
  if (!songRes.ok || !midRes.ok) throw new Error("Failed to load Tabby song or MIDI score");
  const [songText, midBuf] = await Promise.all([songRes.text(), midRes.arrayBuffer()]);
  return parseMopSong(songText, new Uint8Array(midBuf), "tabby");
}
