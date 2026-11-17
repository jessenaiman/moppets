/**
 * The Moppets' state: the cast's recipes (saved locally), who is on the workbench, and the choice
 * of performance. Selecting a Moppet makes it the one the stage's views follow.
 */
import { create } from "zustand";
import { DEFAULT_INVENTION, invent, KEYS, makeIntroduction, makeChipSong, makeGruffShanty, makeTabbySong, makeRound, makeSolo, SCALES, type KeyName, type Piece, type RoundLyrics, type RoundLyricsId, type ScaleMode } from "./music.ts";
import { roundProblems } from "./roundCheck.ts";
import { buildSong, SONGBOOK, type SongId } from "./songbook.ts";
import { fileOf, SONG_SOURCES } from "./songs.ts";
import { parseSongFile, printSongFile, type SongFile } from "./songFile.ts";
import { songProblems } from "./songCheck.ts";
import { parseMidi, scoreFromMidi } from "./midi.ts";
import { setBandEnabled } from "./band.ts";
import { makeSkit, SKITS, skitProblems, type Skit, type SkitId } from "./skits.ts";
import { inspect, loadPiece, setVoicesProvider } from "./ensemble.ts";
import { CAST as defaults, type MoppetVoice } from "./voices.ts";
import { g2p } from "../audio/g2p.ts";

export type Lesson = "intro" | "school" | "round" | "chip" | "tabby" | "gruff" | SongId | SkitId | "newskit";
/**
 * Saved recipes override the cast, and an edit saves every Moppet. Bump the version when the cast
 * itself is retuned, or anyone who once touched a knob keeps hearing the old voices.
 * v2: the cartoon-range cast (airway size).
 */
const STORAGE_KEY = "moppet-voices-v2";

function loadSaved(): MoppetVoice[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    // only the voice recipe is the user's: names, roles, lyrics and parts always come from the cast
    if (Array.isArray(saved) && saved.length >= 6 && saved.every((v, i) => v.id === defaults[i].id && v.artic && v.source && v.body))
      return defaults.map((d, i) => ({ ...structuredClone(d), body: { ...d.body, ...saved[i]?.body }, artic: { ...d.artic, ...saved[i]?.artic }, source: { ...d.source, ...saved[i]?.source }, vibrato: saved[i]?.vibrato ?? d.vibrato, size: saved[i]?.size ?? d.size })) as MoppetVoice[];
  } catch {
    // no saved voices
  }
  return structuredClone(defaults) as MoppetVoice[];
}

interface MoppetState {
  voices: MoppetVoice[];
  selected: number;
  lesson: Lesson;
  piece: Piece;
  key: KeyName;
  mode: ScaleMode;
  bpm: number;
  repeats: number;
  /** which words the round sings: a written set, all three at once, or Claude's latest */
  roundLyrics: RoundLyricsId | "fresh";
  /** the words Claude wrote last (dev server only) */
  freshRound: RoundLyrics | null;
  /** edited lead sheets by file name (the words editor), kept until saved or reverted */
  songEdits: Record<string, string>;
  /** change the open song's or skit's lead sheet; the score follows once every line can be sung */
  editSongFile: (change: (f: SongFile) => void) => void;
  revertSongFile: () => void;
  /** write the open lead sheet into songs/ (dev server), or download it */
  saveSongFile: () => Promise<void>;
  /** the backing band (bass, electric piano, drums) under every song */
  band: boolean;
  setBand: (on: boolean) => void;
  /** the skit Claude wrote last (dev server only) */
  freshSkit: Skit | null;
  writing: boolean;
  /** have Claude write a new skit for the cast, check it, and stage it */
  writeSkit: () => Promise<void>;
  /** have Claude write a new round, check it fits the tune, and sing it */
  writeRound: () => Promise<void>;
  seed: number;
  progression: string;
  groove: string;
  palette: string;
  soul: boolean;
  /** the score drawn differs from what would play (settings moved, nothing rendered yet) */
  status: string;
  select: (i: number) => void;
  setLesson: (l: Lesson) => void;
  setSettings: (s: Partial<Pick<MoppetState, "key" | "mode" | "bpm" | "repeats" | "roundLyrics" | "seed" | "progression" | "groove" | "palette" | "soul">>) => void;
  invent: () => void;
  rehearse: () => void;
  singSolo: () => void;
  edit: (fn: (v: MoppetVoice) => void) => void;
  reset: () => void;
  savePreset: () => void;
  loadPreset: (file: File) => Promise<void>;
  /** sing the current score on a MIDI file's notes (edited in SoundCraft, say); words stay */
  singMidi: (bytes: Uint8Array) => void;
}

const SCHOOL_BPM = 112, ROUND_BPM = 108;

function scoreFor(s: Pick<MoppetState, "lesson" | "key" | "mode" | "bpm" | "repeats" | "roundLyrics" | "freshRound" | "freshSkit" | "seed" | "progression" | "groove" | "palette" | "soul">): Piece {
  if (s.lesson === "chip") return makeChipSong();
  if (s.lesson === "tabby") return makeTabbySong();
  if (s.lesson === "gruff") return makeGruffShanty();
  // an edited song or skit (words editor) plays as edited, once every line can be sung
  const edited = editedFile(s.lesson);
  if (edited?.kind === "skit") return makeSkit(edited.skit, useMoppet.getState?.().voices ?? defaults);
  if (edited?.kind === "song" && !songProblems(edited.song).length) return buildSong(edited.song);
  const skit = s.lesson === "newskit" ? s.freshSkit : SKITS.find((x) => x.id === s.lesson);
  if (skit) return makeSkit(skit, useMoppet.getState?.().voices ?? defaults);
  const original = SONGBOOK.find((x) => x.id === s.lesson);
  if (original) return original.make();
  if (s.lesson === "intro") return makeIntroduction(useMoppet.getState?.().voices ?? defaults);
  if (s.lesson === "round") return makeRound({ key: s.key, bpm: s.bpm, repeats: s.repeats, lyrics: s.roundLyrics === "fresh" ? (s.freshRound ?? "jam") : s.roundLyrics });
  return invent({ seed: s.seed, key: s.key, mode: s.mode, progression: s.progression, groove: s.groove, palette: s.palette, soul: s.soul });
}

// ------------------------------------------------------------------------- the words editor

/** Edited lead sheets, by file name (songs/<file>), kept in this browser until saved or reverted. */
const EDITS_KEY = "moppet-song-edits-v1";
function loadEdits(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(EDITS_KEY) ?? "{}") as Record<string, string>;
    // an edit that now matches its file (saved since) is no edit
    return Object.fromEntries(Object.entries(saved).filter(([f, t]) => SONG_SOURCES.has(f) && SONG_SOURCES.get(f) !== t));
  } catch {
    return {};
  }
}
function persistEdits(edits: Record<string, string>): void {
  try {
    localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
  } catch {
    // private window
  }
}

/** The lead-sheet file behind a lesson, if it has one. */
export function lessonFile(lesson: string): string | null {
  if (SONGBOOK.some((x) => x.id === lesson)) return fileOf(lesson, "song");
  if (SKITS.some((x) => x.id === lesson)) return fileOf(lesson, "skit");
  return null;
}

/** A lesson's lead sheet as edited, or null when it has no edits. */
function editedFile(lesson: string): SongFile | null {
  const file = lessonFile(lesson);
  const text = file ? useMoppet.getState?.()?.songEdits[file] : undefined;
  if (!file || text === undefined) return null;
  try {
    return parseSongFile(text, `songs/${file}`);
  } catch {
    return null;
  }
}

/** A lesson's lead sheet as it stands: edited, or as loaded from songs/. */
export function currentFile(lesson: string): { file: string; parsed: SongFile; text: string; edited: boolean } | null {
  const file = lessonFile(lesson);
  if (!file) return null;
  const edits = useMoppet.getState().songEdits;
  const text = edits[file] ?? SONG_SOURCES.get(file)!;
  return { file, parsed: parseSongFile(text, `songs/${file}`), text, edited: file in edits };
}

function persist(voices: MoppetVoice[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(voices));
  } catch {
    // private window
  }
}

export const useMoppet = create<MoppetState>((set, get) => ({
  voices: loadSaved(),
  selected: 0,
  lesson: "school",
  piece: invent(DEFAULT_INVENTION),
  progression: DEFAULT_INVENTION.progression,
  groove: DEFAULT_INVENTION.groove,
  palette: DEFAULT_INVENTION.palette,
  soul: DEFAULT_INVENTION.soul,
  key: "D",
  mode: "major",
  bpm: SCHOOL_BPM,
  repeats: 2,
  roundLyrics: "jam",
  freshRound: null,
  freshSkit: null,
  songEdits: loadEdits(),
  editSongFile: (change) => {
    const cur = currentFile(get().lesson);
    if (!cur) return;
    change(cur.parsed);
    const text = printSongFile(cur.parsed);
    const songEdits = { ...get().songEdits };
    if (text === SONG_SOURCES.get(cur.file)) delete songEdits[cur.file];
    else songEdits[cur.file] = text;
    persistEdits(songEdits);
    set({ songEdits });
    const problems = cur.parsed.kind === "song" ? songProblems(cur.parsed.song) : [];
    if (problems.length) return set({ status: `Not singable yet: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}. The score keeps the last version that fits.` });
    const piece = scoreFor(get());
    set({ piece, status: cur.parsed.kind === "song" ? "Edited: every line fits its notes." : "Edited." });
    loadPiece(piece);
  },
  revertSongFile: () => {
    const file = lessonFile(get().lesson);
    if (!file) return;
    const songEdits = { ...get().songEdits };
    delete songEdits[file];
    persistEdits(songEdits);
    set({ songEdits });
    const piece = scoreFor(get());
    set({ piece, status: `Back to songs/${file} as it was.` });
    loadPiece(piece);
  },
  saveSongFile: async () => {
    const cur = currentFile(get().lesson);
    if (!cur) return;
    if (cur.parsed.kind === "song" && songProblems(cur.parsed.song).length) return set({ status: "Fix the lines that don't fit before saving." });
    let saved = false;
    if (import.meta.env.DEV) {
      const r = await fetch("/__songs/save", { method: "POST", body: JSON.stringify({ file: cur.file, text: cur.text }) }).catch(() => null);
      if (r?.ok) saved = true;
      else if (r) return set({ status: `Couldn't save: ${await r.text()}` });
    }
    if (!saved) {
      const a = document.createElement("a");
      const u = URL.createObjectURL(new Blob([cur.text], { type: "text/plain" }));
      a.href = u;
      a.download = cur.file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    }
    if (!saved) return set({ status: `Downloaded ${cur.file}: put it in songs/ to keep it (the edit stays in this browser until then).` });
    // the file now holds this text: it is no longer an edit
    SONG_SOURCES.set(cur.file, cur.text);
    const songEdits = { ...get().songEdits };
    delete songEdits[cur.file];
    persistEdits(songEdits);
    set({ songEdits, status: `Saved songs/${cur.file}. Commit it to keep it.` });
  },
  band: true,
  setBand: (band) => {
    setBandEnabled(band);
    set({ band, status: band ? "The band is in." : "The band sits this one out." });
    loadPiece(get().piece); // re-render with or without it
  },
  writing: false,
  writeSkit: async () => {
    set({ writing: true, status: "Claude is writing a new skit…" });
    let feedback: string | undefined;
    try {
      await g2p.load(); // line lengths are timed from the dictionary's syllables
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch("/__claude/skit", { method: "POST", body: JSON.stringify({ feedback, cast: get().voices.map((v) => ({ id: v.id, name: v.name, role: v.role })) }) });
        if (!r.ok) throw new Error(await r.text());
        const w = (await r.json()) as Skit & { object?: string };
        const problems = skitProblems(w, get().voices);
        if (!problems.length) {
          const freshSkit: Skit = { id: "newskit", title: w.title, description: w.description || "Written by Claude", scenes: w.scenes };
          set({ freshSkit, lesson: "newskit" });
          const piece = scoreFor(get());
          set({ piece, status: `New skit${w.object ? ` about ${w.object}` : ""}, written by Claude${attempt ? ` (try ${attempt + 1})` : ""}.` });
          loadPiece(piece);
          return;
        }
        feedback = problems.join("; ");
        set({ status: `Claude's skit didn't fit (${feedback}). Asking again…` });
      }
      set({ status: `Claude couldn't write a usable skit in three tries (${feedback}).` });
    } catch (e) {
      set({ status: `Couldn't write a skit: ${e instanceof Error ? e.message : e}` });
    } finally {
      set({ writing: false });
    }
  },
  writeRound: async () => {
    set({ writing: true, status: "Claude is writing a new round…" });
    let feedback: string | undefined;
    try {
      await g2p.load(); // the syllable check needs the dictionary, not just the letter rules
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch("/__claude/round", { method: "POST", body: JSON.stringify({ feedback }) });
        if (!r.ok) throw new Error(await r.text());
        const w = (await r.json()) as RoundLyrics & { object?: string };
        const problems = roundProblems(w);
        if (!problems.length) {
          const freshRound = { id: "fresh", title: w.title, lines: w.lines.map((l) => l.trim()), last: w.last };
          set({ freshRound, roundLyrics: "fresh", lesson: "round" });
          const piece = scoreFor(get());
          set({ piece, status: `New round${w.object ? ` about ${w.object}` : ""}, written by Claude${attempt ? ` (try ${attempt + 1})` : ""}.` });
          loadPiece(piece);
          return;
        }
        feedback = problems.join("; ");
        set({ status: `Claude's words didn't fit the tune (${feedback}). Asking again…` });
      }
      set({ status: `Claude couldn't fit the tune in three tries (${feedback}). Kept the old words.` });
    } catch (e) {
      set({ status: `Couldn't write a round: ${e instanceof Error ? e.message : e}` });
    } finally {
      set({ writing: false });
    }
  },
  seed: 404,
  status: "",
  select: (i) => {
    set({ selected: i });
    inspect(get().voices[i].id);
  },
  setLesson: (lesson) => {
    const s = get();
    const bpm = lesson === "round" ? ROUND_BPM : SCHOOL_BPM;
    const next = { ...s, lesson, bpm, mode: lesson === "round" ? ("major" as ScaleMode) : s.mode };
    const piece = scoreFor(next);
    set({ lesson, bpm, mode: next.mode, piece, status: "" });
    loadPiece(piece);
  },
  setSettings: (changes) => {
    set(changes);
    if ("key" in changes && !(changes.key! in KEYS)) return;
    if ("mode" in changes && !(changes.mode! in SCALES)) return;
    const piece = scoreFor(get());
    set({ piece, status: "Settings changed: the score below is the new version." });
    loadPiece(piece);
  },
  invent: () => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    set({ seed });
    const piece = scoreFor({ ...get(), seed });
    set({ piece, status: `New invention, seed ${seed}.` });
    loadPiece(piece);
  },
  rehearse: () => {
    const piece = scoreFor(get());
    set({ piece, status: "Rehearsing the round from the top." });
    loadPiece(piece);
  },
  singSolo: () => {
    const v = get().voices[get().selected];
    const piece = makeSolo(v);
    set({ piece, status: "" });
    loadPiece(piece);
  },
  edit: (fn) => {
    const voices = structuredClone(get().voices);
    fn(voices[get().selected]);
    set({ voices });
    persist(voices);
  },
  reset: () => {
    const voices = structuredClone(get().voices);
    voices[get().selected] = structuredClone(defaults[get().selected]) as MoppetVoice;
    set({ voices });
    persist(voices);
    inspect(voices[get().selected].id);
    const s = get();
    if (s.piece.kind === "solo") loadPiece(s.piece);
    else loadPiece(scoreFor(s));
  },
  savePreset: () => {
    const v = get().voices[get().selected];
    const a = document.createElement("a");
    const u = URL.createObjectURL(new Blob([JSON.stringify(v, null, 2)], { type: "application/json" }));
    a.href = u;
    a.download = `moppet-${v.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  },
  loadPreset: async (file) => {
    const v = JSON.parse(await file.text()) as MoppetVoice;
    const i = get().voices.findIndex((x) => x.id === v.id);
    if (i < 0 || !v.artic || !v.source || !v.body) throw new Error("Not a Moppet preset");
    const voices = structuredClone(get().voices);
    voices[i] = { ...voices[i], body: { ...voices[i].body, ...v.body }, artic: { ...voices[i].artic, ...v.artic }, source: { ...voices[i].source, ...v.source }, vibrato: v.vibrato ?? voices[i].vibrato, size: v.size ?? voices[i].size };
    set({ voices, selected: i });
    persist(voices);
    inspect(voices[i].id);
    loadPiece(scoreFor(get()));
  },
  singMidi: (bytes) => {
    const { piece, changed, kept } = scoreFromMidi(get().piece, parseMidi(bytes));
    const name = (id: string) => get().voices.find((v) => v.id === id)?.name ?? id;
    const msg = [changed.length ? `Singing your notes for ${changed.map(name).join(", ")}.` : "No notes moved.", kept.length ? `Kept the old notes for ${kept.map((k) => k.replace(/^\w+/, name)).join("; ")}: each syllable needs one note.` : ""];
    set({ piece, status: msg.filter(Boolean).join(" ") });
    loadPiece(piece);
  },
}));

setVoicesProvider(() => useMoppet.getState().voices);
