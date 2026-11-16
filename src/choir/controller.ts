/**
 * A MIDI controller on the Moppet workbench (made for a Launchkey Mini, works with any):
 *
 *  - knobs  turn the selected Moppet's voice controls. Out of the box, controllers 21..28 (the
 *           Launchkey Mini's eight knobs) drive size, larynx, nasal, tension, brightness, gravel,
 *           breath and fry; Learn reassigns any control to whatever knob moves next. The map is
 *           kept in this browser.
 *  - pads   on MIDI channel 10 (the Launchkey's drum pads): notes 36..42 pick Moppets 1..7 and
 *           43 sings the picked Moppet's introduction. Pads never play the voice.
 *  - keys   play the inspected voice, as anywhere in CHIMERA.
 *
 * A turned knob is an edit like a slider's: it is saved to the Moppet at once, and Save preset
 * writes it to a file.
 */
import { create } from "zustand";
import { useStore } from "../ui/store.ts";
import { onMidiControl, type MidiControl } from "../ui/midi.ts";
import { useMoppet } from "./store.ts";
import { play } from "./ensemble.ts";

/** The voice recipe, grouped the way CHIMERA builds a voice: size and body, airway posture, then the folds. */
export const CONTROLS = [
  ["size", "Airway size: tiny → giant", 0.6, 1.6, 0.01, "×", "size"],
  ["child", "Body: grown → child", 0, 1, 0.01, "", "body"],
  ["female", "Body shape: male → female", 0, 1, 0.01, "", "body"],
  ["larynx", "Larynx height", -1.6, 1.6, 0.05, "cm", "artic"],
  ["velum", "Nasal opening", 0, 1.4, 0.02, "cm²", "artic"],
  ["root", "Tongue root (back ↔ forward)", -1, 1, 0.05, "", "artic"],
  ["ventricular", "False-fold narrowing", 0, 1, 0.01, "", "artic"],
  ["tension", "Fold tension", 0, 1, 0.01, "", "source"],
  ["brightness", "Brightness", 0, 1, 0.01, "", "source"],
  ["roughness", "Gravel / roughness", 0, 1, 0.01, "", "source"],
  ["breathiness", "Breathiness", 0, 0.8, 0.01, "", "source"],
  ["fry", "Vocal fry", 0, 1, 0.01, "", "source"],
] as const;
export type ControlKey = (typeof CONTROLS)[number][0];
export type ControlGroup = (typeof CONTROLS)[number][6];
const byKey = new Map(CONTROLS.map((c) => [c[0] as ControlKey, c]));

/**
 * Set one voice control on the selected Moppet. A body or size rebuilds the voice's airway, so a
 * knob sweeping one is applied at most every 120 ms (its last value always lands).
 */
export function applyControl(key: ControlKey, n: number): void {
  const c = byKey.get(key);
  if (!c) return;
  const group = c[6];
  if (group === "body" || group === "size") return rebuildLater(key, n);
  const st = useStore.getState();
  if (group === "artic") st.setArtic({ [key]: n });
  else st.setSource({ [key]: n });
}

const REBUILD_MS = 120;
const pending = new Map<ControlKey, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastRebuild = 0;
function rebuildLater(key: ControlKey, n: number): void {
  pending.set(key, n);
  if (timer) return;
  const wait = Math.max(0, lastRebuild + REBUILD_MS - performance.now());
  timer = setTimeout(() => {
    timer = null;
    lastRebuild = performance.now();
    const changes = [...pending];
    pending.clear();
    const st = useStore.getState();
    const v = useMoppet.getState().voices[useMoppet.getState().selected];
    let body = v.body;
    for (const [k, x] of changes) {
      if (k === "size") {
        // the airway is built with the singer's engine; the inspected voice resizes now
        useMoppet.getState().edit((m) => void (m.size = x));
        st.setSize(x);
      } else body = { ...body, [k]: x };
    }
    if (body !== v.body) st.setBody(body);
  }, wait);
}

/** Launchkey Mini's eight knobs send controllers 21..28 in its default mode. */
export const DEFAULT_MAP: Record<number, ControlKey> = { 21: "size", 22: "larynx", 23: "velum", 24: "tension", 25: "brightness", 26: "roughness", 27: "breathiness", 28: "fry" };
/** Drum pads: MIDI channel 10, notes 36..43. */
export const PAD_CHANNEL = 9, PAD_FIRST = 36, PAD_AUDITION = 43;
const MAP_STORAGE = "moppet-midi-map-v1";

function loadMap(): Record<number, ControlKey> {
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_STORAGE) ?? "null");
    if (saved && typeof saved === "object" && Object.values(saved).every((k) => byKey.has(k as ControlKey))) return saved;
  } catch {
    // private window
  }
  return { ...DEFAULT_MAP };
}

interface ControllerState {
  /** controller number → voice control */
  map: Record<number, ControlKey>;
  /** the control waiting for a knob to be turned */
  learning: ControlKey | null;
  /** what the controller did last, for the workbench to show */
  last: string;
  learn: (key: ControlKey | null) => void;
  resetMap: () => void;
}

function saveMap(map: Record<number, ControlKey>): void {
  try {
    localStorage.setItem(MAP_STORAGE, JSON.stringify(map));
  } catch {
    // private window
  }
}

export const useController = create<ControllerState>((set, get) => ({
  map: loadMap(),
  learning: null,
  last: "",
  learn: (key) => set({ learning: get().learning === key ? null : key }),
  resetMap: () => {
    saveMap(DEFAULT_MAP);
    set({ map: { ...DEFAULT_MAP }, learning: null, last: "Knobs back to the Launchkey layout." });
  },
}));

/** The controller number a voice control answers to, if any. */
export const ccFor = (map: Record<number, ControlKey>, key: ControlKey): number | undefined => {
  const cc = Object.keys(map).find((k) => map[Number(k)] === key);
  return cc === undefined ? undefined : Number(cc);
};

export function handleControl(c: MidiControl): boolean {
  if (useStore.getState().mode !== "moppet") return false;
  const ctl = useController.getState();
  if (c.kind === "cc") {
    if (ctl.learning) {
      const map = { ...ctl.map };
      for (const k of Object.keys(map)) if (map[Number(k)] === ctl.learning) delete map[Number(k)];
      map[c.number] = ctl.learning;
      saveMap(map);
      useController.setState({ map, learning: null, last: `Knob CC ${c.number} → ${byKey.get(ctl.learning)![1]}` });
      return true;
    }
    const key = ctl.map[c.number];
    if (!key) return false;
    const [, label, min, max, step] = byKey.get(key)!;
    const n = Math.round((min + ((max - min) * c.value) / 127) / step) * step;
    applyControl(key, +n.toFixed(4));
    useController.setState({ last: `${label}: ${+n.toFixed(2)}` });
    return true;
  }
  if (c.channel !== PAD_CHANNEL || c.number < PAD_FIRST || c.number > PAD_AUDITION) return false;
  if (c.value === 0) return true; // a pad's release
  const m = useMoppet.getState();
  if (c.number === PAD_AUDITION) {
    m.singSolo();
    void play(useStore.getState().start);
    useController.setState({ last: `${m.voices[m.selected].name} sings` });
  } else if (c.number - PAD_FIRST < m.voices.length) {
    m.select(c.number - PAD_FIRST);
    useController.setState({ last: `Picked ${m.voices[c.number - PAD_FIRST].name}` });
  }
  return true;
}

onMidiControl(handleControl);
