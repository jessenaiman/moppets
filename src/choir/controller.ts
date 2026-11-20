import { studio404Name } from "./studio404.ts";
import { setVoiceLevel } from "./voiceLevels.ts";
/**
 * A MIDI controller on the Moppet workbench (made for a Launchkey Mini, works with any):
 *
 *  - knobs  turn the selected Moppet's voice controls. Out of the box, controllers 21..28 (the
 *           Launchkey Mini's eight knobs) drive character volume, larynx, nasal, tension, brightness, gravel,
 *           breath and false-fold rasp: all of them leave the sung pitch alone (fry does not, so it
 *           has no knob by default); Learn reassigns any control to whatever knob moves next. The map is
 *           kept in this browser.
 *  - pads select eight voices and trigger eight gestures in every mode. Both rows can be learned.
 *  - keys play the selected voice or enter notes in the staff editor.
 *
 * A turned knob is an edit like a slider's: it is saved to the Moppet at once, and Save preset
 * writes it to a file.
 */
import { create } from "zustand";
import { useAudio } from "../audio/audio.ts";
import { connectMidi, disconnectMidi, midiSupported, onMidiControl, type MidiControl, type MidiStatus } from "../ui/midi.ts";
import { useMoppet } from "./store.ts";
import { editVoice } from "./ensemble.ts";
import { liveNoteOff, liveNoteOn, MOUTH, moveMouth, offerStaffMidi, auditionNote, useLive } from "./live.ts";

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
  ["fry", "Vocal fry (drops the pitch)", 0, 1, 0.01, "", "source"],
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
  const m = useMoppet.getState();
  const id = m.voices[m.selected].id;
  if (group === "artic") {
    m.edit((v) => void (v.artic[key as keyof typeof v.artic] = n));
    editVoice(id, { artic: useMoppet.getState().voices[m.selected].artic });
  } else {
    m.edit((v) => void ((v.source as unknown as Record<string, number>)[key] = n));
    editVoice(id, { source: { [key]: n } });
  }
}

const REBUILD_MS = 120;
const pending = new Map<number,Map<ControlKey,number>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastRebuild = 0;
function rebuildLater(key: ControlKey, n: number): void {
  const index = useMoppet.getState().selected;
  const values = pending.get(index) ?? new Map<ControlKey,number>();
  values.set(key,n);
  pending.set(index,values);
  if (timer) return;
  const wait = Math.max(0, lastRebuild + REBUILD_MS - performance.now());
  timer = setTimeout(() => {
    timer = null;
    lastRebuild = performance.now();
    const changes = [...pending];
    pending.clear();
    // the airway is built with the singer's engine: heard from the next performance
    const m = useMoppet.getState();
    for (const [index, values] of changes) {
    m.edit((v) => {
      for (const [k, x] of values) {
        if (k === "size") v.size = x;
        else v.body = { ...v.body, [k]: x };
      }
    },index);
    editVoice(m.voices[index].id, { rerender: true });
    }
  }, wait);
}

/** Launchkey Mini's eight knobs send controllers 21..28 in its default mode. */
export const DEFAULT_MAP: Record<number, ControlKey> = { 22: "larynx", 23: "velum", 24: "tension", 25: "brightness", 26: "roughness", 27: "breathiness", 28: "ventricular" };
/** Initial pad mapping before the user teaches a custom layout. */
export const ACTIONS = ["nod", "tilt", "laugh", "shrug", "gasp", "bow", "cheer", "double nod"] as const;
const padStorage = "moppet-launchkey-pads";
function readPads(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(padStorage) || "null");
    if (Array.isArray(saved) && saved.length === 16 && new Set(saved).size === 16 && saved.every(x => typeof x === "string")) return saved;
  } catch { /* Browser storage is optional. */ }
  return Array.from({length:16}, (_,i) => "9/" + (36+i));
}
const MAP_STORAGE = "moppet-midi-map-v2"; // v2: knob 8 is rasp, not fry

function loadMap(): Record<number, ControlKey> {
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_STORAGE) ?? "null");
    if (saved && typeof saved === "object" && Object.values(saved).every((k) => byKey.has(k as ControlKey))) {
      // Older factory maps persisted CC21 as size. Keep explicit custom assignments.
      const factory = { ...DEFAULT_MAP, 21: "size" };
      if (Object.keys(saved).length === Object.keys(factory).length &&
          Object.entries(factory).every(([cc,key]) => saved[cc] === key)) return { ...DEFAULT_MAP };
      return saved;
    }
  } catch {
    // private window
  }
  return { ...DEFAULT_MAP };
}

interface ControllerState {
  padMap: string[];
  learningPads: string[] | null;
  gesture: {id:string; action:typeof ACTIONS[number]; at:number} | null;
  bend:number;
  mod:number;
  /** controller number → voice control */
  map: Record<number, ControlKey>;
  /** the control waiting for a knob to be turned */
  learning: ControlKey | null;
  /** what the controller did last, for the workbench to show */
  last: string;
  /** the control touched last (the Launchkey map lights it): knob 0-7, pad 0-7, or a key's MIDI note */
  touched: { what: "knob" | "pad" | "key"; n: number; at: number } | null;
  learn: (key: ControlKey | null) => void;
  resetMap: () => void;
  /** the browser's MIDI connection and the inputs it sees */
  midi: { status: MidiStatus; inputs: string[] };
  setMidi: (on: boolean) => void;
}

function saveMap(map: Record<number, ControlKey>): void {
  try {
    localStorage.setItem(MAP_STORAGE, JSON.stringify(map));
  } catch {
    // private window
  }
}

const heldAuditions = new Map<number,AbortController>();
export const useController = create<ControllerState>((set, get) => ({
  padMap:readPads(), learningPads:null, gesture:null, bend:0, mod:0,
  map: loadMap(),
  learning: null,
  last: "",
  touched: null,
  learn: (key) => set({ learning: get().learning === key ? null : key }),
  resetMap: () => {
    saveMap(DEFAULT_MAP);
    set({ map: { ...DEFAULT_MAP }, learning: null, last: "Knobs back to the Launchkey layout." });
  },
  midi: { status: "off", inputs: [] },
  setMidi: (on) => {
    if (!on) {
      disconnectMidi();
      set({ midi: { status: "off", inputs: [] } });
      return;
    }
    if (!midiSupported()) {
      set({ midi: { status: "unsupported", inputs: [] } });
      return;
    }
    set({ midi: { status: "connecting", inputs: [] } });
    // the click that connects is also the gesture that may start audio
    void useAudio.getState().start();
    connectMidi({
      // staff step-input gets first claim when a staff note is selected; otherwise keys play the live Moppet
      noteOn: (n, v) => {
        touchControl("key", n);
        if (offerStaffMidi(n, v)) return;
        const m = useMoppet.getState();
        set({last: m.voices[m.selected].name + " · MIDI " + n});
        if (useLive.getState().mode === "off") {
          const key = new AbortController();
          heldAuditions.set(n,key);
          void auditionNote(m.voices[m.selected], n, "la", 280,key.signal);
        }
        else liveNoteOn(n, v);
      },
      noteOff: (n) => {
        heldAuditions.get(n)?.abort();
        heldAuditions.delete(n);
        liveNoteOff(n);
      },
      inputs: (names) => set({ midi: { status: "on", inputs: names } }),
    }).catch(() => {
      if (get().midi.status === "connecting") set({ midi: { status: "denied", inputs: [] } });
    });
  },
}));

/** The controller number a voice control answers to, if any. */
export const ccFor = (map: Record<number, ControlKey>, key: ControlKey): number | undefined => {
  const cc = Object.keys(map).find((k) => map[Number(k)] === key);
  return cc === undefined ? undefined : Number(cc);
};

export const touchControl = (what: "knob" | "pad" | "key", n: number) => useController.setState({ touched: { what, n, at: performance.now() } });

export function triggerPad(i: number) {
  const m = useMoppet.getState();
  touchControl("pad", i);
  if (i < 8 && m.voices[i]) {
    m.select(i);
    useController.setState({last: "Selected " + m.voices[i].name});
  } else if (ACTIONS[i-8]) {
    const v = m.voices[m.selected], action = ACTIONS[i-8];
    useController.setState({gesture:{id:v.id, action, at:performance.now()}, last:v.name + " · " + action});
  }
}

export function handleControl(c: MidiControl): boolean {
  if (c.kind === "cc" && c.number >= 21 && c.number <= 28) touchControl("knob", c.number - 21);
  const ctl = useController.getState();
  if (c.kind === "bend") {
    useController.setState({bend:c.value, last:"Pitch monitor " + Math.round(c.value * 100) + "%"});
    return true;
  }
  if (c.kind === "note") {
    const address = c.channel + "/" + c.number;
    if (ctl.learningPads) {
      if (c.value && !ctl.learningPads.includes(address)) {
        const next = [...ctl.learningPads, address];
        if (next.length === 16) {
          try {localStorage.setItem(padStorage, JSON.stringify(next))} catch {}
          useController.setState({padMap:next, learningPads:null, last:"16 pads mapped"});
        } else useController.setState({learningPads:next});
      }
      return true;
    }
    const index = ctl.padMap.indexOf(address);
    if (index < 0) return false;
    if (c.value) triggerPad(index);
    return true;
  }
  if (!ctl.learning && (c.number === 7 || c.number === 21) && !ctl.map[c.number]) {
    const m = useMoppet.getState();
    const singer = m.voices[m.selected];
    const value = c.value / 127;
    setVoiceLevel(singer.id,value);
    const name = m.studio404 ? studio404Name(singer.id, singer.name) : singer.name;
    useController.setState({last: name + " volume · " + Math.round(value*100) + "%"});
    return true;
  }
  if (c.number === 1) useController.setState({mod:c.value,last:"Mod CC1 · " + c.value});
  if (!ctl.learning && useLive.getState().mode === "puppet" && c.number >= 21 && c.number < 21 + MOUTH.length) {
    moveMouth(MOUTH[c.number - 21][0], c.value / 127);
    return true;
  }
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
  return false;
}

onMidiControl(handleControl);
