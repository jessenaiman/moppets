/**
 * Moppet mode's state: the six recipes (saved locally), who is on the workbench, and the choice
 * of performance. Selecting a Moppet loads its body and recipe into CHIMERA's own stores, so every
 * upstream view and control acts on that character.
 */
import { create } from "zustand";
import { useStore } from "../ui/store.ts";
import { DEFAULT_SOURCE, NEUTRAL, restTip, type HumanArtic, type VoiceSource } from "../wasm/engine.ts";
import { sameBody, type BodyMix } from "../ui/body.ts";
import { DEFAULT_INVENTION, invent, KEYS, makeIntroduction, makeChipSong, makeRound, makeSolo, SCALES, type KeyName, type Piece, type ScaleMode } from "./music.ts";
import { editVoice, inspect, leaveEnsemble, loadPiece, setVoicesProvider } from "./ensemble.ts";
import { CAST as defaults, type MoppetVoice } from "./voices.ts";
import { ensembleHooks } from "../ui/store.ts";

export type Lesson = "intro" | "school" | "round" | "chip";
const STORAGE_KEY = "moppet-voices";
const CHARACTER_KEYS = ["larynx", "velum", "root", "epilarynx", "ventricular"] as const;

function loadSaved(): MoppetVoice[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(saved) && saved.length >= 6 && saved.every((v, i) => v.id === defaults[i].id && v.artic && v.source && v.body)) return defaults.map((d, i) => ({ ...structuredClone(d), ...saved[i], artic: { ...d.artic, ...saved[i]?.artic }, source: { ...d.source, ...saved[i]?.source } })) as MoppetVoice[];
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
  seed: number;
  progression: string;
  groove: string;
  palette: string;
  soul: boolean;
  /** the score drawn differs from what would play (settings moved, nothing rendered yet) */
  status: string;
  select: (i: number) => void;
  setLesson: (l: Lesson) => void;
  setSettings: (s: Partial<Pick<MoppetState, "key" | "mode" | "bpm" | "repeats" | "seed" | "progression" | "groove" | "palette" | "soul">>) => void;
  invent: () => void;
  rehearse: () => void;
  singSolo: () => void;
  edit: (fn: (v: MoppetVoice) => void) => void;
  reset: () => void;
  savePreset: () => void;
  loadPreset: (file: File) => Promise<void>;
}

const SCHOOL_BPM = 112, ROUND_BPM = 108;

function scoreFor(s: Pick<MoppetState, "lesson" | "key" | "mode" | "bpm" | "repeats" | "seed" | "progression" | "groove" | "palette" | "soul">): Piece {
  if (s.lesson === "chip") return makeChipSong();
  if (s.lesson === "intro") return makeIntroduction(useMoppet.getState?.().voices ?? defaults);
  if (s.lesson === "round") return makeRound({ key: s.key, bpm: s.bpm, repeats: s.repeats });
  return invent({ seed: s.seed, key: s.key, mode: s.mode, progression: s.progression, groove: s.groove, palette: s.palette, soul: s.soul });
}

function persist(voices: MoppetVoice[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(voices));
  } catch {
    // private window
  }
}

/** A selection pushes a recipe into CHIMERA; its changes must not write straight back. */
let applying = false;

function applyToWorkbench(v: MoppetVoice): void {
  applying = true;
  const st = useStore.getState();
  if (!sameBody(st.body, v.body)) st.setBody(v.body);
  const artic: Partial<HumanArtic> = { ...v.artic };
  const tip = restTip(NEUTRAL.jaw, NEUTRAL.tbX, NEUTRAL.tbY);
  st.setArtic({ ...NEUTRAL, ttX: tip.x, ttY: tip.y, ...artic }, true);
  const source: Partial<VoiceSource> = { ...DEFAULT_SOURCE, ...v.source };
  delete source.f0;
  st.setSource(source);
  inspect(v.id);
  applying = false;
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
  repeats: 1,
  seed: 404,
  status: "",
  select: (i) => {
    set({ selected: i });
    applyToWorkbench(get().voices[i]);
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
    applyToWorkbench(voices[get().selected]);
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
    voices[i] = { ...voices[i], ...v };
    set({ voices, selected: i });
    persist(voices);
    applyToWorkbench(voices[i]);
    loadPiece(scoreFor(get()));
  },
}));

setVoicesProvider(() => useMoppet.getState().voices);

/** Moves of CHIMERA's own controls in Moppet mode belong to the selected Moppet. */
let prevBody: BodyMix = useStore.getState().body;
let prevArtic = useStore.getState().artic;
let prevSource = useStore.getState().source;
useStore.subscribe((st) => {
  const { body, artic, source, mode } = st;
  const bodyChanged = !sameBody(prevBody, body), articChanged = artic !== prevArtic, sourceChanged = source !== prevSource;
  prevBody = body;
  const oldArtic = prevArtic, oldSource = prevSource;
  prevArtic = artic;
  prevSource = source;
  if (mode !== "moppet" || applying || !(bodyChanged || articChanged || sourceChanged)) return;
  const m = useMoppet.getState();
  const v = m.voices[m.selected];
  if (bodyChanged) {
    m.edit((x) => {
      x.body = body;
    });
    editVoice(v.id, { rerender: true });
  }
  if (articChanged) {
    const moved = CHARACTER_KEYS.filter((k) => artic[k] !== oldArtic[k]);
    if (moved.length) {
      m.edit((x) => {
        for (const k of moved) x.artic[k] = artic[k];
      });
      const next = useMoppet.getState().voices[m.selected];
      editVoice(v.id, { artic: next.artic });
    }
  }
  if (sourceChanged) {
    const keys = Object.keys(source) as (keyof VoiceSource)[];
    const moved = keys.filter((k) => k !== "f0" && source[k] !== oldSource[k]);
    if (moved.length) {
      const values: Record<string, number> = {};
      for (const k of moved) values[k] = Number(source[k]);
      m.edit((x) => Object.assign(x.source, values));
      editVoice(v.id, { source: values });
    }
  }
});

ensembleHooks.leave = () => leaveEnsemble();
