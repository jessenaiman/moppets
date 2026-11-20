import * as Slider from "@radix-ui/react-slider";
import * as Switch from "@radix-ui/react-switch";
import {padSwatch} from "./launchkey-colors";
import { setPadLights, midiSupported } from "./midi.ts";
import { setVoiceLevel, useVoiceLevels } from "../choir/voiceLevels.ts";
/**
 * Grandfather's Imaginative Walnut Organ + Launchkey Mini MK3 Console:
 * Mirrors the physical Novation Launchkey Mini MK3 overhead panel (Pitch/Mod capacitive touch
 * strips, Shift & Octave ±, Arp & Fixed Chord, Play/Stop/Capture transport, 8 rotary drawbar
 * knobs with rotating indicator notches & Arp labels, 2×8 backlit stop-pads + Scene/Mute column,
 * etched key-top Arp legends, and 25 layered ivory & ebony Swell manual keys), paired with a
 * stepped lower Great/Choir accompaniment manual inside a carved walnut & brass organ housing.
 */
import { useEffect, useRef, useState } from "react";
import { useAudio } from "../audio/audio.ts";
import {
  applyControl,
  CONTROLS,
  handleControl,
  controllerActions, triggerPad,
  touchControl,
  useController,
  type ControlKey,
} from "../choir/controller.ts";
import { play, stop } from "../choir/ensemble.ts";
import {
  auditionNote,
  liveNoteOff,
  liveNoteOn,
  MOUTH,
  moveMouth,

  useLive,
  type LiveMode,
} from "../choir/live.ts";
import { STUDIO_404_CAST, studio404Name } from "../choir/studio404.ts";
import { useMoppet } from "../choir/store.ts";
import type { MoppetVoice } from "../choir/voices.ts";

/** "Airway size: tiny → giant" → "Airway size" */
const short = (label: string) => label.split(/[:(]/)[0].trim();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const LIT = 700;
const BASE_MIDI = 48; // C3
const MIN_OCTAVE = -2;
const MAX_OCTAVE = 2;

const ARP_KNOB_TAGS = ["Tempo", "Swing", "Gate", "Mutate", "Deviate", "Tone", "Warmth", "Air"];

const BOTTOM_PAD_COLORS = ["#e8a849", "#57d3e8", "#a98fc4", "#3fbfa0", "#e06a4f", "#d9b440", "#c9c2ae", "#e0533c"];
const MODE_BUTTONS: [LiveMode, string][] = [
  ["off", "Off"],
  ["words", "Sing the words"],
  ["puppet", "Puppeteer"],
  ["edit", "Edit melody"],
];
const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
const noteLabel = (midi: number) => `${KEY_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

const KEY_LEGENDS: { title: string; sub: string }[] = [
  { title: "Arp Mode", sub: "Up · Down · Up/Down · Played · Random · Chord · Mutate" },
  { title: "Rate", sub: "1/4 · 1/8 · 1/16 · 1/32 · Triplet" },
  { title: "Octave", sub: "1 · 2 · 3 · 4" },
  { title: "Rhythm", sub: "• · •×• · •××• · Random · Deviate" },
  { title: "Latch", sub: "On/Off" },
];

function controlValue(v: MoppetVoice, key: ControlKey): { norm: number; text: string; setNorm: (next: number) => void } {
  const spec = CONTROLS.find((x) => x[0] === key);
  if (!spec) return { norm: 0.5, text: "—", setNorm: () => {} };
  const [, label, min, max, step, unit, group] = spec;
  const raw =
    group === "size"
      ? (v.size ?? 1)
      : group === "artic"
        ? v.artic[key as keyof MoppetVoice["artic"]]
        : group === "body"
          ? v.body[key as keyof MoppetVoice["body"]]
          : (v.source[key as keyof MoppetVoice["source"]] ?? 0);
  const norm = clamp((Number(raw) - min) / Math.max(1e-6, max - min), 0, 1);
  return {
    norm,
    text: `${Number(raw).toFixed(2)}${unit ? ` ${unit}` : ""}`,
    setNorm: (next: number) => {
      const clamped = clamp(next, 0, 1);
      const stepped = +(Math.round((min + clamped * (max - min)) / step) * step).toFixed(4);
      applyControl(key, stepped);
      useController.setState({ last: `${short(label)}: ${stepped.toFixed(2)}${unit ? ` ${unit}` : ""}` });
    },
  };
}

export function LaunchkeyConnect() {
  const midi = useController(s=>s.midi), connect = useController(s=>s.setMidi);
  const connected = midi.status === "on" && midi.inputs.length > 0;
  const label = connected ? midi.inputs.find(n=>/launchkey/i.test(n)) ?? midi.inputs[0]
    : !midiSupported() ? "MIDI unavailable" : midi.status === "connecting" ? "Awaiting permission…"
    : midi.status === "denied" ? "Retry MIDI connection" : midi.status === "on" ? "Waiting for device" : "Connect Launchkey";
  return <button type="button" className="midi-plug" data-connected={connected} aria-pressed={connected}
    title={connected ? "Disconnect MIDI" : label} disabled={!midiSupported() || midi.status === "connecting"}
    onClick={()=>connect(midi.status !== "on")}>
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 2v5m6-5v5M5 7h10v3a5 5 0 0 1-10 0zM10 15v4"/></svg>
    {label}
  </button>;
}

export function LaunchkeyMap() {
  const [keys, showKeys] = useState(()=>!matchMedia("(max-width:650px)").matches);
  useEffect(()=>{
    const media=matchMedia("(max-width:650px)");
    const resize=()=>showKeys(!media.matches);
    media.addEventListener("change",resize);
    return ()=>media.removeEventListener("change",resize);
  },[]);
  const [transpose,setTranspose]=useState(0);
  const [transposeMode,setTransposeMode]=useState(false);
  const learnPads = useController(s=>s.learningPads);
  const last = useController(s=>s.last);
  const mode = useLive((s) => s.mode);
  const setMode = useLive((s) => s.setMode);
  const mouth = useLive((s) => s.mouth);
  const words = useLive((s) => s.words);
  const next = useLive((s) => s.next);
  const map = useController((s) => s.map);
  const touched = useController((s) => s.touched);
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const studio404 = useMoppet((s) => s.studio404);
  const select = useMoppet((s) => s.select);
  const startAudio = useAudio((s) => s.start);

  const curVoice = voices[selected];
  const levels = useVoiceLevels(s => s.levels);
  const volume = levels[curVoice.id] ?? 1;
  const editingVoice = useController(s => s.voiceEditing);

  const pieceTitle = useMoppet(s=>s.piece.title);
  const guest = pieceTitle==="Borrowed Light";
  const labelFor = (v:MoppetVoice)=>guest && v.id==="vee" ? "Moonbeam" : studio404 ? studio404Name(v.id,v.name) : v.name;
  const name = labelFor(curVoice);

  // Interactive Launchkey Mini MK3 hardware state
  const [octave, setOctave] = useState(0);
  const [shift, setShift] = useState(false);
  const [arpOn, setArpOn] = useState(false);
  const [fixedChord, setFixedChord] = useState(false);
  const [learningChord,setLearningChord] = useState(false);
  const [chordShape,setChordShape] = useState([0,4,7]);
  const chordTaps = useRef<number[]>([]);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [pitchBend, setPitchBend] = [useController(s=>s.bend), (bend:number)=>useController.setState({bend})] as const;
  const [pitchDragging, setPitchDragging] = useState(false);
  const [modValue, setModValue] = [useController(s=>s.mod), (mod:number)=>useController.setState({mod})] as const;
  const [pressedMidis, setPressedMidis] = useState<number[]>([]);
  const [lastPlayedMidi, setLastPlayedMidi] = useState<number | null>(null);

  const down = useRef(new Set<number>());
  const soundingKeys = useRef(new Map<number,number>());
  const recentNotes = useRef<number[]>([]);

  const [, redraw] = useState(0);

  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(() => redraw((n) => n + 1), LIT);
    return () => clearTimeout(t);
  }, [touched]);

  const releaseAllKeys = () => {
    if (!down.current.size) return;
    for (const pitch of soundingKeys.current.values()) liveNoteOff(pitch);
    soundingKeys.current.clear();
    down.current.clear();
    setPressedMidis([]);
  };

  useEffect(() => {
    return () => {
      for (const pitch of soundingKeys.current.values()) liveNoteOff(pitch);
      soundingKeys.current.clear();
      down.current.clear();
    };
  }, []);

  const lit = (what: "knob" | "pad" | "key", n?: number) =>
    !!touched &&
    touched.what === what &&
    (n === undefined || touched.n === n) &&
    performance.now() - touched.at < LIT;

  const shiftOctave = (delta: number) => {
    const nextOct = clamp(octave + delta, MIN_OCTAVE, MAX_OCTAVE);
    if (nextOct === octave) return;
    releaseAllKeys();
    setOctave(nextOct);
    setLastPlayedMidi(null);
    const lo = noteLabel(BASE_MIDI + nextOct * 12);
    const hi = noteLabel(BASE_MIDI + nextOct * 12 + 24);
    useController.setState({ last: `Manual octave ${nextOct >= 0 ? `+${nextOct}` : nextOct} (${lo}–${hi})` });
  };

  const toggleShift = () => {
    const nextShift = !shift;
    setShift(nextShift);
    useController.setState({ last: nextShift ? "Shift active · secondary MK3 legends lit" : "Shift off" });
  };

  const toggleArp = () => {
    const nextArp = !arpOn;
    setArpOn(nextArp);
    useController.setState({ last: nextArp ? "Arp engaged · Up 1/8" : "Arp off" });
  };

  const toggleFixedChord = () => {
    if (learningChord) {
      const taps=chordTaps.current;
      if (taps.length) setChordShape(taps.map(n=>n-taps[0]));
      setLearningChord(false);
      setFixedChord(true);
      useController.setState({last: "Fixed chord saved"});
      return;
    }
    const nextChord = !fixedChord;
    setFixedChord(nextChord);
    useController.setState({ last: nextChord ? "Fixed Chord active · Major triad voicing" : "Fixed Chord off" });
  };

  const handleCapture = () => {
    setCaptureFlash(true);
    setTimeout(() => setCaptureFlash(false), 900);
    const recent = recentNotes.current;
    if (recent.length > 0) {
      const latest = recent[recent.length - 1];
      void auditionNote(curVoice, latest, words[next] ?? "la", 320);
      useController.setState({
        last: `Captured ${recent.length} note${recent.length === 1 ? "" : "s"}: ${recent.slice(-6).map(noteLabel).join(" ")}`,
      });
    } else {
      useController.setState({ last: `Capture ready · play ${name}'s Swell manual` });
    }
  };

  const knobs = !editingVoice ? voices.slice(0,8).map((v,i) => ({
    i, label: labelFor(v), norm: levels[v.id] ?? 1,
    text: Math.round((levels[v.id] ?? 1) * 100) + "%", setNorm: (n:number) => setVoiceLevel(v.id,n),
  })) : mode === "puppet"
      ? MOUTH.map(([key, lo, hi, label], i) => {
          const val = mouth[key] ?? lo;
          const norm = clamp((val - lo) / Math.max(1e-6, hi - lo), 0, 1);
          return {
            i,
            label,
            norm,
            text: val.toFixed(2),
            setNorm: (n: number) => {
              const clamped = clamp(n, 0, 1);
              moveMouth(key, clamped);
              touchControl("knob", i);
            },
          };
        })
      : Array.from({ length: 8 }, (_, i) => {
          const key = map[21 + i];
          const c = CONTROLS.find((x) => x[0] === key);
          const label = c ? short(c[1]) : "(free)";
          const ctrl = key ? controlValue(curVoice, key) : { norm: 0.5, text: "—", setNorm: () => {} };
          return {
            i,
            label,
            norm: ctrl.norm,
            text: ctrl.text,
            setNorm: (n: number) => {
              ctrl.setNorm(n);
              touchControl("knob", i);
            },
          };
        });

  const topPads = voices.slice(0,8).map(v => ({
    label: labelFor(v),
    ...padSwatch((studio404 && STUDIO_404_CAST[v.id]?.color) || v.color)
  }));
  const bottomPads = controllerActions(guest && curVoice.id==="vee"?"moonbeam":studio404?curVoice.id:"").map((label,i)=>({label,...padSwatch(BOTTOM_PAD_COLORS[i])}));
  const padPalette=[...topPads,...bottomPads].map(p=>p.index).join(",");
  useEffect(()=>{setPadLights(padPalette.split(",").map(Number))},[padPalette]);

  const keyGuidance =
    mode === "off"
      ? `${name} auditions each note — pick Sing the words or Puppeteer above`
      : mode === "puppet"
        ? `${name} shapes your mouth sliders at every held key`
        : words.length
          ? `${name} sings next: “${words[next]}”`
          : `${name} has no words in this piece`;

  const changeTranspose=(delta:number)=>{releaseAllKeys();setTranspose(t=>clamp(t+delta,-11,11));};
  const pressKey = (midi: number, active: boolean) => {
    if (active && learningChord) {
      if(!chordTaps.current.includes(midi)) chordTaps.current.push(midi);
      useController.setState({last: "Chord · " + chordTaps.current.map(noteLabel).join(" ")});
      return;
    }
    if (active) {
      if (down.current.has(midi)) return;
      down.current.add(midi);
      setPressedMidis([...down.current]);
      setLastPlayedMidi(midi);
      recentNotes.current = [...recentNotes.current.slice(-15), midi];
      touchControl("key", midi);
      if (mode === "off") {
        void auditionNote(curVoice, midi+transpose, "la", 280);
      } else {
        soundingKeys.current.set(midi,midi+transpose);
        liveNoteOn(midi+transpose, 100);
      }
      if (fixedChord) {
        useController.setState({
          last: `Fixed Chord · ${chordShape.map(offset=>noteLabel(midi+transpose+offset)).join(" · ")}`,
        });
      }
    } else if (down.current.delete(midi)) {
      setPressedMidis([...down.current]);
      const pitch = soundingKeys.current.get(midi);
      if(pitch!==undefined)liveNoteOff(pitch);
      soundingKeys.current.delete(midi);
    }
  };

  // Pitch / Mod capacitive touch strip helpers
  const updatePitchFromEvent = (el: HTMLDivElement, clientY: number) => {
    const rect = el.getBoundingClientRect();
    const ratio = clamp(1 - (clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const bend = ratio * 2 - 1;
    setPitchBend(bend);
    useController.setState({ last: `Pitch strip: ${bend >= 0 ? "+" : ""}${Math.round(bend * 100)}%` });
  };

  const updateModFromEvent = (el: HTMLDivElement, clientY: number) => {
    const rect = el.getBoundingClientRect();
    const ratio = clamp(1 - (clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const ccVal = Math.round(ratio * 127);
    setModValue(ccVal);
    const claimed = handleControl({ kind: "cc", channel: 0, number: 1, value: ccVal });
    if (!claimed) useController.setState({ last: `Mod CC #1: ${ccVal}` });
  };

  const baseMidi = BASE_MIDI + octave * 12;
  const rangeLabel = `${noteLabel(baseMidi)}–${noteLabel(baseMidi + 24)}`;
  const activeChordRoot = pressedMidis[pressedMidis.length - 1] ?? (fixedChord ? lastPlayedMidi : null);

  // Build 15 white keys and 10 seam-aligned black keys cleanly for data-layout="layered"
  const whiteKeys: { midi: number; label: string; isC: boolean }[] = [];
  const blackKeys: { midi: number; label: string; seam: number }[] = [];
  for (let i = 0; i < 25; i++) {
    const midi = baseMidi + i;
    const label = noteLabel(midi);
    if (isBlack(midi)) {
      blackKeys.push({ midi, label, seam: whiteKeys.length });
    } else {
      whiteKeys.push({ midi, label, isC: midi % 12 === 0 });
    }
  }

  const keyIsLit = (midi: number) => pressedMidis.includes(midi) || lit("key", midi);
  const keyIsChord = (midi: number) =>
    fixedChord &&
    activeChordRoot !== null &&
    midi !== activeChordRoot &&
    chordShape.includes(midi - activeChordRoot);

  return (
    <div className={`launchkey organ-console ${keys ? "show-keys" : "hide-keys"}`}>
      {mode === "off" ? (
        <div className="first-step organ-welcome">
          <p>
            <b>Seated at Grandfather’s Organ.</b> 1 · Pull a cast stop tab (pads 1–8 or Lower Manual).
            2 · Light <em>Sing the words</em>. 3 · Play the ivory manual and {name} sings.
          </p>
          <button type="button" className="primary" onClick={() => void setMode("words")}>
            ▶ Let {name} sing with the keys
          </button>
        </div>
      ) : (
        <p className="first-step organ-welcome">
          <span>
            <b>Organ Manual Active · {name}:</b> {keyGuidance}
          </span>
        </p>
      )}

      <div
        className={`lk-body organ-cabinet${shift ? " shift-lit" : ""}${arpOn ? " arp-lit" : ""}`}
        aria-label={`Grandfather's Walnut Organ & Launchkey Mini MK3: ${mode === "puppet" ? "puppeteer" : mode === "words" ? "singing the words" : mode === "edit" ? "edit melody" : "voice workbench"}`}
      >
        {/* Brass Crest Bar: Nameplate + Interactive MK3 Hardware Switches & Transport */}
        <div className="organ-crest">
          <div className="organ-crest-brand">
            <span className="organ-plaque-badge">Launchkey Mini · MK3</span>
            <span className="organ-crest-readout">
              {rangeLabel}{transpose!==0 ? ` · ${transpose>0?"+":""}${transpose} st` : ""}
              {arpOn ? " · Arp" : ""}
              {fixedChord ? " · Chord" : ""}
            </span>
          </div>
            <LaunchkeyConnect />
            <div className="performer-volume">
              <label><strong>{name} volume</strong>
                <input aria-label={name + " volume"} type="range" min="0" max="100" step="1"
                  value={Math.round(volume*100)} onChange={e=>setVoiceLevel(curVoice.id,Number(e.target.value)/100)} />
                <output>{Math.round(volume*100)}%</output>
              </label>
              <small>{!editingVoice ? "CC 7" : !map[21] ? "Encoder 1" : !map[7] ? "CC 7" : "On-screen fader"}</small>
            </div>
        </div>

        {/* Upper MK3 Hardware Deck: Left Pitch/Mod Touch Strips + Right 1×8 Knobs & 2×8 Pads */}
        <div className="organ-deck">
          <div className="organ-strips" aria-label="Pitch and modulation capacitive touch strips">
            <div className="organ-strip">
              <span className="organ-strip-label">Pitch</span>
              <div
                className={`organ-strip-track pitch${pitchDragging ? " dragging" : ""}`}
                role="slider"
                tabIndex={0}
                aria-label="Pitch bend touch strip"
                aria-valuemin={-100}
                aria-valuemax={100}
                aria-valuenow={Math.round(pitchBend * 100)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") setPitchBend(clamp(pitchBend + 0.25, -1, 1));
                  else if (e.key === "ArrowDown") setPitchBend(clamp(pitchBend - 0.25, -1, 1));
                  else if (e.key === "Escape" || e.key === "0") setPitchBend(0);
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setPitchDragging(true);
                  updatePitchFromEvent(e.currentTarget, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (pitchDragging) updatePitchFromEvent(e.currentTarget, e.clientY);
                }}
                onPointerUp={() => {
                  setPitchDragging(false);
                  setPitchBend(0);
                  useController.setState({ last: "Pitch strip: centered (0%)" });
                }}
                onPointerCancel={() => {
                  setPitchDragging(false);
                  setPitchBend(0);
                }}
              >
                <span className="strip-center-line" aria-hidden="true" />
                <span
                  className="strip-thumb"
                  aria-hidden="true"
                  style={{ bottom: `clamp(4px, ${((pitchBend + 1) / 2) * 100}%, calc(100% - 4px))` }}
                />
              </div>
              <span className="organ-strip-val">{pitchBend === 0 ? "0%" : `${pitchBend > 0 ? "+" : ""}${Math.round(pitchBend * 100)}%`}</span>
            </div>

            <div className="organ-strip">
              <span className="organ-strip-label">Mod</span>
              <div
                className="organ-strip-track mod"
                role="slider"
                tabIndex={0}
                aria-label="Modulation touch strip (CC 1)"
                aria-valuemin={0}
                aria-valuemax={127}
                aria-valuenow={modValue}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    const nextMod = clamp(modValue + 8, 0, 127);
                    setModValue(nextMod);
                    if (!handleControl({ kind: "cc", channel: 0, number: 1, value: nextMod })) {
                      useController.setState({ last: `Mod CC #1: ${nextMod}` });
                    }
                  } else if (e.key === "ArrowDown") {
                    const nextMod = clamp(modValue - 8, 0, 127);
                    setModValue(nextMod);
                    if (!handleControl({ kind: "cc", channel: 0, number: 1, value: nextMod })) {
                      useController.setState({ last: `Mod CC #1: ${nextMod}` });
                    }
                  }
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  updateModFromEvent(e.currentTarget, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (e.buttons) updateModFromEvent(e.currentTarget, e.clientY);
                }}
              >
                <span
                  className="strip-fill"
                  aria-hidden="true"
                  style={{ height: `${(modValue / 127) * 100}%` }}
                />
                <span
                  className="strip-thumb"
                  aria-hidden="true"
                  style={{ bottom: `clamp(4px, ${(modValue / 127) * 100}%, calc(100% - 4px))` }}
                />
              </div>
              <span className="organ-strip-val">CC1·{modValue}</span>
            </div>
          </div>

          <div className="desk-left-buttons">
            <button
              type="button"
              className={`hw-btn${shift ? " on" : ""}`}
              aria-pressed={shift}
              onClick={toggleShift}
              title="Toggle Shift — illuminates secondary Launchkey legends"
            >
              Shift
            </button>
            <button type="button" className={`hw-btn${transposeMode?" on":""}`} aria-pressed={transposeMode} onClick={()=>setTransposeMode(!transposeMode)}>Transpose</button>
            <div className="hw-oct-group" role="group" aria-label="Manual octave shift">
              <button
                type="button"
                className="hw-btn"
                disabled={transposeMode ? transpose<=-11 : octave <= MIN_OCTAVE}
                onClick={() => transposeMode ? changeTranspose(-1) : shiftOctave(-1)}
                aria-label={transposeMode?"Transpose down":"Octave down"}
                title={shift ? "Transpose / Program −" : "Shift manual down 1 octave"}
              >
                {transposeMode?"Semi −":"Oct −"}
              </button>
              <span className="hw-oct-val">{octave >= 0 ? `+${octave}` : octave}</span>
              <button
                type="button"
                className="hw-btn"
                disabled={transposeMode ? transpose>=11 : octave >= MAX_OCTAVE}
                onClick={() => transposeMode ? changeTranspose(1) : shiftOctave(1)}
                aria-label={transposeMode?"Transpose up":"Octave up"}
                title={shift ? "Transpose / Program +" : "Shift manual up 1 octave"}
              >
                {transposeMode?"Semi +":"Oct +"}
              </button>
            </div>
</div>
          <div className="organ-controls-bay">
            <div className="organ-drawbar-bank">
              {knobs.map((knob) => {
                const k = editingVoice && knob.i === 0 && !map[21] ? { ...knob, label: "Volume", norm:volume, text:Math.round(volume*100)+"%", setNorm:(v:number)=>setVoiceLevel(curVoice.id,v) } : knob;
                const deg = -135 + k.norm * 270;
                return (
                  <div
                    key={k.i}
                    className={`lk-knob organ-drawbar${lit("knob", k.i) ? " lit" : ""}`}
                    title={`${k.label}: ${k.text} (drag up/down to turn)`}
                  >
                    <small className="arp-tag">{editingVoice ? ARP_KNOB_TAGS[k.i] : k.text}</small>
                    <Slider.Root className="brass-encoder" orientation="vertical" min={0} max={127} step={1}
                      value={[Math.round(k.norm*127)]} onValueChange={([n])=>k.setNorm(n/127)}
                      style={{"--dial-angle":deg+"deg"} as React.CSSProperties}>
                      <Slider.Track className="encoder-track"/>
                      <Slider.Thumb className="encoder-thumb" aria-label={k.label+(editingVoice?" encoder":" volume encoder")} aria-valuetext={k.text}/>
                    </Slider.Root>
                    <span className="organ-knob-label">{k.label}</span>
                  </div>
                );
              })}
            </div>

            {/* Row 2: 2×8 Illuminated Stop-Pads + Scene/> & Stop/Mute Column */}
            <div className="desk-pad-modes" aria-label="Shift pad modes">{["Session","Drum","Custom","Device","Volume","Pan","Sends","Custom"].map((label,i)=><span key={i}>{label}</span>)}</div>
            <div className="organ-pad-matrix">
              <div className="organ-pad-grid">
                {topPads.map((pad, i) => (
                  <button
                    key={`top-${i}`}
                    type="button"
                    className={`lk-pad organ-stop${lit("pad", i) ? " lit" : ""}${i === selected ? " on" : ""}`}
                    style={{ "--pad-color": pad.color } as React.CSSProperties}
                    onClick={() => triggerPad(i)}
                  >
                    <span className="pad-led" aria-hidden="true" />
                    <span>{pad.label}</span>
                  </button>
                ))}
                {bottomPads.map((pad, i) => (
                  <button
                    key={`bot-${i}`}
                    type="button"
                    className={`lk-pad organ-stop sub${lit("pad", i+8) ? " lit" : ""}`}
                    style={{ "--pad-color": pad.color } as React.CSSProperties}
                    onClick={() => triggerPad(i+8)}
                  >
                    <span className="pad-led" aria-hidden="true" />
                    <span>{pad.label}</span>
                  </button>
                ))}
              </div>
              <div className="organ-scene-col">
                <button
                  type="button"
                  className="lk-pad organ-scene-btn"
                  aria-label="Play scene" title="Play scene"
                  onClick={() => void play(startAudio)}
                >
                  <span aria-hidden="true">▶</span>
                </button>
                <button
                  type="button"
                  className="lk-pad organ-scene-btn stop"
                  aria-label="Stop scene" title="Stop scene"
                  onClick={stop}
                >
                  <span aria-hidden="true">■</span>
                </button>
              </div>
            </div>
          </div>
<div className="desk-right-buttons">            <label className="organ-rocker"><Switch.Root aria-label="Arpeggiator" className="rocker-switch" checked={arpOn} onCheckedChange={toggleArp}><Switch.Thumb/></Switch.Root>Arp</label>
            <button
              type="button"
              className={`hw-btn${fixedChord ? " on" : ""}`}
              aria-pressed={fixedChord}
              onClick={toggleFixedChord}
              onDoubleClick={()=>{releaseAllKeys(); chordTaps.current=[]; setLearningChord(true); useController.setState({last:"Play the chord keys, then press Fixed Chord to save"});}}
              title="Show chord fingering. Double-click to enter a shape on the keys, then press again to save."
            >
              {learningChord?"Save chord":"Fixed Chord"}
            </button>


            <button
              type="button"
              className={`hw-btn capture${captureFlash ? " on" : ""}`}
              onClick={handleCapture}
              title="Capture MIDI — recall last manual notes"
            >
              ● Capture
            </button>
</div>
        </div>

        <div className={`organ-key-legends${arpOn ? " active" : ""}`} aria-label="Key-top Arp and Latch legends">
          {KEY_LEGENDS.map((leg) => (
            <div key={leg.title} className="legend-group">
              <b>{leg.title}</b>
              <span className="legend-sub">{leg.sub}</span>
            </div>
          ))}
        </div>

        {/* Crimson Keybed Felt + Layered 25-Key Organ Manual */}
        <div className="organ-manual-shell">
          <div className="organ-felt-strip" aria-hidden="true" />
          <div
            className="organ-keys"
            data-layout="layered"
            role="group"
            aria-label={`Upper manual 25 organ keys (${rangeLabel})`}
          >
            <div className="organ-white-keys">
              {whiteKeys.map(({ midi, label, isC }) => {
                const isActive = keyIsLit(midi);
                const isChord = keyIsChord(midi);
                return (
                  <button
                    key={midi}
                    type="button"
                    className={`organ-key white${isActive ? " lit" : ""}${isChord ? " chord-lit" : ""}`}
                    aria-label={`Key ${label}`}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      pressKey(midi, true);
                    }}
                    onPointerUp={() => pressKey(midi, false)}
                    onPointerCancel={() => pressKey(midi, false)}
                  >
                    {isC && <span className="organ-key-c">{label}</span>}
                  </button>
                );
              })}
            </div>
            {blackKeys.map(({ midi, label, seam }) => {
              const isActive = keyIsLit(midi);
              const isChord = keyIsChord(midi);
              return (
                <button
                  key={midi}
                  type="button"
                  className={`organ-key black${isActive ? " lit" : ""}${isChord ? " chord-lit" : ""}`}
                  style={{ "--seam": seam } as React.CSSProperties}
                  aria-label={`Key ${label}`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    pressKey(midi, true);
                  }}
                  onPointerUp={() => pressKey(midi, false)}
                  onPointerCancel={() => pressKey(midi, false)}
                />
              );
            })}
          </div>
        </div>

        {/* Mode Stop Strip & Etched Key-Top Legends right above the Upper Manual Felt */}
        <div className="organ-mode-rail">
          <button type="button" aria-expanded={keys} onClick={()=>{releaseAllKeys();showKeys(!keys)}}>{keys ? "Hide keys" : "Show keys"}</button>
          <button type="button" onClick={()=>useController.setState({learningPads:learnPads ? null : []})}>{learnPads ? "Cancel · press " + (learnPads.length < 8 ? "upper " : "lower ") + (learnPads.length % 8 + 1) : "Learn pads"}</button>
          <output>{last || name + " · MIDI ready"}</output>
          <div className="live-modes organ-mode-pills" role="radiogroup" aria-label="Upper manual mode">
            {MODE_BUTTONS.map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={mode === m ? "on" : ""}
                onClick={() => void setMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Stepped Carved Walnut & Brass Divider + Lower Manual (Great / Choir Coupler Tabs) */}
        <details><summary>Choir couplers</summary><div className="organ-divider-rail">
          <span>Lower Manual (Great · Choir Registration Couplers)</span>
        </div>
        <div className="organ-lower-manual" role="group" aria-label="Lower manual choir couplers">
          {voices.map((v, i) => {
            const p = studio404 ? STUDIO_404_CAST[v.id] : undefined;
            const vName = p?.name ?? v.name;
            const active = i === selected;
            return (
              <button
                key={v.id}
                type="button"
                className={`organ-coupler${active ? " on" : ""}`}
                aria-pressed={active}
                onClick={() => {
                  select(i);
                  void auditionNote(v, 55 + i * 2, "ah", 240);
                }}
              >
                <span className="coupler-led" style={{ background: p?.color ?? v.color }} />
                <b>{vName}</b>
              </button>
            );
          })}
          <button
            type="button"
            className="organ-coupler tutte"
            onClick={() => {
              useMoppet.getState().singSolo();
              void play(startAudio);
            }}
          >
            <span className="coupler-led brass" />
            <b>Solo Intro</b>
          </button>
        </div></details>
      </div>
    </div>
  );
}
