/**
 * CHIMERA MIDI & MPE Controller Router:
 * Connects `@chimera/ui/midi.ts` (noteOn/noteOff with MPE channel, bend, channel/poly pressure,
 * CC 74 slide, CC 7 singer gain, CC 21–28 encoders) directly to `LiveMoppetSinger` and
 * `stageActionBus` 3D character actions.
 */
import { create } from "zustand";
import { useAudio } from "../audio/audio.ts";
import {
  connectMidi,
  disconnectMidi,
  midiSupported,
  onMidiControl,
  type MidiControl,
  type MidiStatus,
} from "../ui/midi.ts";
import { MOPPET_STAGE_ACTIONS } from "./cast/moppet.ts";
import { editVoice } from "./ensemble.ts";
import {
  auditionNote,
  liveNoteOff,
  liveNoteOn,
  MOUTH,
  moveMouth,
  offerStaffMidi,
  setLiveKeyPressure,
  setLivePitchBend,
  setLivePressure,
  setLiveSlide,
  useLive,
} from "./live.ts";
import { triggerCharacterAction } from "./stageActionBus.ts";
import { useMoppet } from "./store.ts";
import { studio404Name } from "./studio404.ts";
import { setVoiceLevel } from "./voiceLevels.ts";

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
  ["fry", "Spoken vocal fry", 0, 1, 0.01, "", "source"],
] as const;

export type ControlKey = (typeof CONTROLS)[number][0];
export type ControlGroup = (typeof CONTROLS)[number][6];
const byKey = new Map(CONTROLS.map((c) => [c[0] as ControlKey, c]));

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
const pending = new Map<number, Map<ControlKey, number>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastRebuild = 0;

function rebuildLater(key: ControlKey, n: number): void {
  const index = useMoppet.getState().selected;
  const values = pending.get(index) ?? new Map<ControlKey, number>();
  values.set(key, n);
  pending.set(index, values);
  if (timer) return;
  const wait = Math.max(0, lastRebuild + REBUILD_MS - performance.now());
  timer = setTimeout(() => {
    timer = null;
    lastRebuild = performance.now();
    const changes = [...pending];
    pending.clear();
    const m = useMoppet.getState();
    for (const [idx, vals] of changes) {
      m.edit((v) => {
        for (const [k, x] of vals) {
          if (k === "size") v.size = x;
          else v.body = { ...v.body, [k]: x };
        }
      }, idx);
      editVoice(m.voices[idx].id, { rerender: true });
    }
  }, wait);
}

export const DEFAULT_MAP: Record<number, ControlKey> = {
  21: "size",
  22: "larynx",
  23: "velum",
  24: "tension",
  25: "brightness",
  26: "roughness",
  27: "breathiness",
  28: "ventricular",
};

export const ACTIONS = ["idle", "sing", "walk", "jump", "spin", "bow", "nod", "cheer"] as const;
const MAP_STORAGE = "moppet-midi-map-v2";

function loadMap(): Record<number, ControlKey> {
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_STORAGE) ?? "null");
    if (saved && typeof saved === "object" && Object.values(saved).every((k) => byKey.has(k as ControlKey))) {
      return { ...DEFAULT_MAP, ...saved };
    }
  } catch {
    // ignore storage block
  }
  return { ...DEFAULT_MAP };
}

function saveMap(map: Record<number, ControlKey>): void {
  try {
    localStorage.setItem(MAP_STORAGE, JSON.stringify(map));
  } catch {
    // ignore storage block
  }
}

interface ControllerState {
  gesture: { id: string; action: string; at: number } | null;
  bend: number;
  slide: number;
  map: Record<number, ControlKey>;
  learning: ControlKey | null;
  last: string;
  touched: { what: "knob" | "pad" | "key"; n: number; at: number } | null;
  learn: (key: ControlKey | null) => void;
  resetMap: () => void;
  midi: { status: MidiStatus; inputs: string[] };
  setMidi: (on: boolean) => void;
}

const heldAuditions = new Map<number, AbortController>();

export const useController = create<ControllerState>((set, get) => ({
  gesture: null,
  bend: 0,
  slide: 0.5,
  map: loadMap(),
  learning: null,
  last: "",
  touched: null,
  learn: (key) => set({ learning: get().learning === key ? null : key }),
  resetMap: () => {
    saveMap(DEFAULT_MAP);
    set({ map: { ...DEFAULT_MAP }, learning: null, last: "Reset CC 21–28 encoders." });
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
    void useAudio.getState().start();
    const onMidiNote = (n: number, v: number, ch = 0) => {
      touchControl("key", n);
      if (offerStaffMidi(n, v)) return;
      const m = useMoppet.getState();
      set({ last: `${m.voices[m.selected].name} · MIDI ${n} (vel ${v})` });
      if (useLive.getState().mode === "off") {
        const ac = new AbortController();
        heldAuditions.set(n, ac);
        void auditionNote(m.voices[m.selected], n, "la", 320, ac.signal);
      } else {
        liveNoteOn(n, v, ch);
      }
    };
    connectMidi({
      noteOn: (n, v) => onMidiNote(n, v, 0),
      noteOnWithChannel: onMidiNote,
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

export const ccFor = (map: Record<number, ControlKey>, key: ControlKey): number | undefined => {
  const cc = Object.keys(map).find((k) => map[Number(k)] === key);
  return cc === undefined ? undefined : Number(cc);
};

export const touchControl = (what: "knob" | "pad" | "key", n: number) =>
  useController.setState({ touched: { what, n, at: performance.now() } });

export function triggerPad(i: number): void {
  const m = useMoppet.getState();
  touchControl("pad", i);
  if (i < 8 && m.voices[i]) {
    m.select(i);
    useController.setState({ last: `Selected ${m.voices[i].name}` });
    return;
  }
  const action = ACTIONS[i - 8];
  if (!action) return;
  const v = m.voices[m.selected];
  triggerCharacterAction(v.id, action, { voiceId: v.id });
  useController.setState({
    gesture: { id: v.id, action, at: performance.now() },
    last: `${v.name} · ${action}`,
  });
}

export function handleControl(c: MidiControl): boolean {
  if (c.kind === "cc" && c.number >= 21 && c.number <= 28) touchControl("knob", c.number - 21);
  const ctl = useController.getState();

  if (c.kind === "bend") {
    setLivePitchBend(c.value, c.channel);
    useController.setState({
      bend: c.value,
      last: `Pitch bend Ch ${c.channel + 1}: ${c.value >= 0 ? "+" : ""}${Math.round(c.value * 100)}%`,
    });
    return true;
  }
  if (c.kind === "pressure") {
    setLivePressure(c.value / 127, c.channel);
    useController.setState({ last: `Breath pressure: ${Math.round((c.value / 127) * 100)}%` });
    return true;
  }
  if (c.kind === "keyPressure") {
    setLiveKeyPressure(c.number, c.value / 127);
    return true;
  }
  if (c.kind === "note") {
    // MIDI channel 10 (0-based 9) notes 36..51 trigger cast selection (0..7) & 3D stage actions (8..15)
    if (c.channel === 9 && c.number >= 36 && c.number < 52) {
      if (c.value > 0) triggerPad(c.number - 36);
      return true;
    }
    return false;
  }
  if (c.kind === "cc") {
    if (!ctl.learning && c.number === 7) {
      const m = useMoppet.getState();
      const singer = m.voices[m.selected];
      const value = c.value / 127;
      setVoiceLevel(singer.id, value);
      const name = m.studio404 ? studio404Name(singer.id, singer.name) : singer.name;
      useController.setState({ last: `${name} volume · ${Math.round(value * 100)}%` });
      return true;
    }
    if (!ctl.learning && (c.number === 74 || c.number === 1)) {
      const norm = c.value / 127;
      setLiveSlide(norm, c.channel);
      useController.setState({
        slide: norm,
        last: `${c.number === 74 ? "Slide CC74" : "Mod CC1"} · ${Math.round(norm * 100)}%`,
      });
      return true;
    }
    if (!ctl.learning && useLive.getState().mode === "puppet" && c.number >= 21 && c.number < 21 + MOUTH.length) {
      moveMouth(MOUTH[c.number - 21][0], c.value / 127);
      return true;
    }
    if (ctl.learning) {
      const map = { ...ctl.map };
      for (const k of Object.keys(map)) if (map[Number(k)] === ctl.learning) delete map[Number(k)];
      map[c.number] = ctl.learning;
      saveMap(map);
      useController.setState({ map, learning: null, last: `CC ${c.number} → ${byKey.get(ctl.learning)![1]}` });
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

export function resetSelectedVocal(): void {
  pending.delete(useMoppet.getState().selected);
  useController.setState({ learning: null, bend: 0 });
  useMoppet.getState().reset();
}

export { MOPPET_STAGE_ACTIONS };
