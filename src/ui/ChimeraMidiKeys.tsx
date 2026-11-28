/**
 * Clean CHIMERA MIDI, MPE & Computer-Keyboard Instrument (`@chimera/ui/components/Keys.tsx` + `SingPanel.tsx`):
 * Replaces the 759-line fake "Grandfather's Walnut Organ" with real CHIMERA capabilities:
 *  - Computer keyboard (`A W S E D F T G Y H U J K O L P ;`, `Z`/`X` octave shift)
 *  - Web MIDI + MPE Lower Zone toggle (`±48 st` note bend + `CC 74` slide vs `±2 st` wheel)
 *  - Working Pitch Bend (`setLivePitchBend`) & Brightness Slide (`CC 74` `setLiveSlide`) strips
 *  - Clickable syllable cursor strip (shows `-` melismas & `’` breaths + `From start` reset)
 *  - 8 live CHIMERA voice/mouth encoders + 3D character action triggers
 */
import { useEffect, useRef, useState } from "react";
import { useAudio } from "../audio/audio.ts";
import { MOPPET_STAGE_ACTIONS } from "../choir/cast/moppet.ts";
import {
  applyControl,
  CONTROLS,
  touchControl,
  useController,
  type ControlKey,
} from "../choir/controller.ts";
import {
  auditionNote,
  liveNoteOff,
  liveNoteOn,
  MOUTH,
  moveMouth,
  setLivePitchBend,
  setLiveSlide,
  useLive,
  type LiveMode,
} from "../choir/live.ts";
import { triggerCharacterAction } from "../choir/stageActionBus.ts";
import { useMoppet } from "../choir/store.ts";
import { studio404Name } from "../choir/studio404.ts";
import type { MoppetVoice } from "../choir/voices.ts";
import { midiSupported } from "./midi.ts";

const KEYMAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16,
};
const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const noteLabel = (m: number) => `${KEY_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const SHORT_CONTROL_LABELS: Readonly<Record<string, string>> = {
  size: "Airway",
  child: "Child",
  female: "Shape",
  larynx: "Larynx",
  velum: "Nasal",
  root: "Tongue",
  ventricular: "Fold",
  tension: "Tension",
  brightness: "Bright",
  roughness: "Gravel",
  breathiness: "Breath",
  fry: "Fry",
};

const SHORT_MOUTH_LABELS: Readonly<Record<string, string>> = {
  jaw: "Jaw",
  tbX: "Tongue X",
  tbY: "Tongue Y",
  lipAp: "Lips Open",
  lipProt: "Lip Round",
  velum: "Nasal",
  ttY: "Tip Up",
  labiodental: "Lip-Teeth",
};

export function MidiConnectButton() {
  const midi = useController((s) => s.midi);
  const setMidi = useController((s) => s.setMidi);
  if (!midiSupported()) return null;
  const on = midi.status === "on";
  const primaryPort = midi.inputs[0]?.replace(/\s+MIDI\s*\d*$/i, "").trim() ?? "";
  const extraCount = Math.max(0, midi.inputs.length - 1);
  const status =
    midi.status === "connecting"
      ? "Connecting…"
      : midi.status === "denied"
        ? "Blocked"
        : on
          ? primaryPort
            ? extraCount > 0
              ? `${primaryPort} (+${extraCount})`
              : primaryPort
            : "Waiting for MIDI"
          : "Connect MIDI";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setMidi(!on)}
      title={on && midi.inputs.length ? `Connected MIDI: ${midi.inputs.join(", ")}` : "Connect Web MIDI / MPE keyboard"}
      className={`max-w-[185px] truncate rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
        on
          ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-200"
          : "border-white/15 bg-[#12181c] text-slate-300 hover:text-white"
      }`}
    >
      MIDI: {status}
    </button>
  );
}

export function ChimeraMidiKeys() {
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const studio404 = useMoppet((s) => s.studio404);
  const curVoice: MoppetVoice = voices[selected];
  const name = studio404 ? studio404Name(curVoice.id, curVoice.name) : curVoice.name;

  const mode = useLive((s) => s.mode);
  const setMode = useLive((s) => s.setMode);
  const mpe = useLive((s) => s.mpe);
  const setMpe = useLive((s) => s.setMpe);
  const syllables = useLive((s) => s.syllables);
  const next = useLive((s) => s.next);
  const setCursor = useLive((s) => s.setCursor);
  const heldNotes = useLive((s) => s.heldNotes);
  const mouth = useLive((s) => s.mouth);

  const map = useController((s) => s.map);
  const bend = useController((s) => s.bend);
  const slide = useController((s) => s.slide);
  const last = useController((s) => s.last);

  const octaveRef = useRef(0);
  const [octave, setOctave] = useState(0);
  const byPointer = useRef(new Map<number, number>());
  const baseMidi = 48 + octave * 12; // C3..C5 at octave 0

  const startNote = (midi: number, velocity = 96) => {
    void useAudio.getState().start();
    touchControl("key", midi);
    if (useLive.getState().mode === "off") {
      void auditionNote(curVoice, midi, "la", 320);
    } else {
      liveNoteOn(midi, velocity, 0);
    }
  };

  // CHIMERA computer keyboard listener (`A`..`;`, `Z`/`X` octave shift)
  useEffect(() => {
    const down = new Map<string, number>();
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "SELECT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (target?.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") return;
      const k = e.key.toLowerCase();
      if (k === "z" || k === "x") {
        octaveRef.current = clamp(octaveRef.current + (k === "z" ? -1 : 1), -2, 2);
        setOctave(octaveRef.current);
        return;
      }
      if (!(k in KEYMAP) || down.has(k)) return;
      const midi = 48 + octaveRef.current * 12 + KEYMAP[k];
      down.set(k, midi);
      startNote(midi, 96);
      e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      const midi = down.get(e.key.toLowerCase());
      if (midi === undefined) return;
      down.delete(e.key.toLowerCase());
      liveNoteOff(midi);
    };
    const releaseAll = () => {
      for (const m of down.values()) liveNoteOff(m);
      down.clear();
    };
    const onPointerUp = (e: PointerEvent) => {
      const m = byPointer.current.get(e.pointerId);
      if (m === undefined) return;
      byPointer.current.delete(e.pointerId);
      liveNoteOff(m);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", releaseAll);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", releaseAll);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curVoice]);

  const notes = Array.from({ length: 25 }, (_, i) => baseMidi + i);
  const whites = notes.filter((m) => !isBlack(m));

  const encoders =
    mode === "puppet"
      ? MOUTH.map(([key, lo, hi, label], i) => {
          const val = mouth[key] ?? lo;
          return {
            key,
            label: SHORT_MOUTH_LABELS[key] ?? label,
            fullLabel: label,
            norm: clamp((val - lo) / Math.max(1e-6, hi - lo), 0, 1),
            text: val.toFixed(2),
            onChange: (n: number) => {
              moveMouth(key, n);
              touchControl("knob", i);
            },
          };
        })
      : Array.from({ length: 8 }, (_, i) => {
          const key = map[21 + i] as ControlKey | undefined;
          const spec = CONTROLS.find((x) => x[0] === key);
          if (!key || !spec) {
            return { key: `cc-${i}`, label: "Unassigned", fullLabel: "Unassigned", norm: 0.5, text: "—", onChange: () => {} };
          }
          const [, fullLabel, min, max, step, unit, group] = spec;
          const raw =
            group === "size"
              ? (curVoice.size ?? 1)
              : group === "artic"
                ? curVoice.artic[key as keyof MoppetVoice["artic"]]
                : group === "body"
                  ? curVoice.body[key as keyof MoppetVoice["body"]]
                  : (curVoice.source[key as keyof MoppetVoice["source"]] ?? 0);
          return {
            key,
            label: SHORT_CONTROL_LABELS[key] ?? fullLabel.split(/[:(]/)[0].trim(),
            fullLabel,
            norm: clamp((Number(raw) - min) / Math.max(1e-6, max - min), 0, 1),
            text: `${Number(raw).toFixed(2)}${unit}`,
            onChange: (n: number) => {
              const v = +(Math.round((min + clamp(n, 0, 1) * (max - min)) / step) * step).toFixed(4);
              applyControl(key, v);
              touchControl("knob", i);
            },
          };
        });

  return (
    <section className="rounded-xl border border-white/15 bg-[#0b1014] p-3 text-slate-100 space-y-3" aria-label="CHIMERA MIDI and keyboard controller">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
            {name} · CHIMERA Live MIDI
          </span>
          <MidiConnectButton />
          <button
            type="button"
            aria-pressed={mpe}
            onClick={() => setMpe(!mpe)}
            title="MPE Lower Zone: Ch 1 master ±2 st, Ch 2–16 per-note ±48 st + CC 74 slide"
            className={`rounded-lg border px-2 py-1 font-mono text-[11px] font-semibold cursor-pointer ${
              mpe ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200" : "border-white/15 bg-[#12181c] text-slate-400"
            }`}
          >
            MPE {mpe ? "ON" : "OFF"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="MIDI key mode">
          {(
            [
              ["words", "Sing Lyrics"],
              ["puppet", "Puppeteer Mouth"],
              ["edit", "Step-Edit"],
              ["off", "Audition"],
            ] as [LiveMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => void setMode(m)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                mode === m
                  ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                  : "border-white/10 bg-[#12181c] text-slate-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Syllable Cursor Strip (CHIMERA Sing mode parity) */}
      {mode === "words" && syllables.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#070b0e] p-2">
          {syllables.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCursor(i)}
              aria-current={i === next ? "step" : undefined}
              style={{ color: i === next ? "#04140e" : undefined }}
              className={`rounded px-1.5 py-0.5 font-mono text-xs cursor-pointer ${
                i === next
                  ? "bg-emerald-500 text-[#04140e] font-bold"
                  : i < next
                    ? "text-slate-500 hover:text-slate-200"
                    : "text-slate-200 hover:bg-white/10"
              }`}
            >
              {s.melisma ? "–" : s.text}
              {s.phraseEnd ? "’" : ""}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCursor(0)}
            className="ml-auto rounded border border-white/15 px-2 py-0.5 text-[11px] text-slate-300 hover:text-white cursor-pointer"
          >
            From start
          </button>
        </div>
      )}

      {/* Pitch Bend (±2 st), CC 74 Brightness Slide, Octave & 3D Actions */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[auto_1fr_auto] items-center">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#10161b] px-3 py-1.5">
          <label className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300">
            <span>Bend</span>
            <input
              aria-label="Pitch bend"
              type="range"
              min={-1}
              max={1}
              step={0.02}
              value={bend}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLivePitchBend(v, 0);
                useController.setState({ bend: v });
              }}
              onPointerUp={() => {
                setLivePitchBend(0, 0);
                useController.setState({ bend: 0 });
              }}
              className="w-20 accent-emerald-400"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300">
            <span>CC74</span>
            <input
              aria-label="CC 74 brightness slide"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={slide}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLiveSlide(v, 0);
                useController.setState({ slide: v });
              }}
              className="w-20 accent-cyan-400"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="3D character actions">
          {MOPPET_STAGE_ACTIONS.map((act) => (
            <button
              key={act}
              type="button"
              onClick={() => triggerCharacterAction(curVoice.id, act, { voiceId: curVoice.id })}
              className="rounded-md border border-white/15 bg-[#12181c] px-2.5 py-1 text-xs font-semibold capitalize text-slate-200 hover:border-emerald-400 hover:text-emerald-200 cursor-pointer"
            >
              {act}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 font-mono text-xs">
          <button
            type="button"
            aria-label="Octave down"
            onClick={() => {
              octaveRef.current = clamp(octave - 1, -2, 2);
              setOctave(octaveRef.current);
            }}
            className="rounded border border-white/15 bg-[#12181c] px-2 py-1 hover:text-white cursor-pointer"
          >
            Oct −
          </button>
          <span className="px-1.5 text-slate-300">{noteLabel(baseMidi)}–{noteLabel(baseMidi + 24)}</span>
          <button
            type="button"
            aria-label="Octave up"
            onClick={() => {
              octaveRef.current = clamp(octave + 1, -2, 2);
              setOctave(octaveRef.current);
            }}
            className="rounded border border-white/15 bg-[#12181c] px-2 py-1 hover:text-white cursor-pointer"
          >
            Oct +
          </button>
        </div>
      </div>

      {/* 8 CHIMERA Encoders (CC 21–28) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {encoders.map((enc) => (
          <label
            key={enc.key}
            title={enc.fullLabel}
            className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-[#10161b] px-2.5 py-2 text-[11px]"
          >
            <span className="flex items-baseline justify-between gap-2 font-semibold text-slate-200">
              <span className="whitespace-nowrap text-[11px] font-semibold text-slate-100">{enc.label}</span>
              <output className="shrink-0 font-mono text-[11px] text-emerald-300">{enc.text}</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={enc.norm}
              aria-label={`${enc.label} encoder`}
              onChange={(e) => enc.onChange(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
          </label>
        ))}
      </div>

      {/* 25-Key Piano Manual (Computer keys A..; + pointer capture) */}
      <div
        className="relative h-24 w-full select-none overflow-hidden rounded-lg border border-white/15 bg-[#050709]"
        data-layout="layered"
        role="group"
        aria-label="25-key MIDI manual (computer keys A to semicolon, Z and X shift octave)"
      >
        <div className="flex h-full w-full">
          {whites.map((m) => {
            const label = noteLabel(m);
            const active = heldNotes.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-label={`Key ${label}`}
                style={{ color: active ? "#052e16" : "#1c1917" }}
                onPointerDown={(e) => {
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    /* ignore */
                  }
                  byPointer.current.set(e.pointerId, m);
                  startNote(m, 96);
                }}
                className={`relative flex-1 border-r border-slate-300 font-mono text-[11px] font-bold flex items-end justify-center pb-1 cursor-pointer ${
                  active ? "bg-emerald-300 text-[#052e16]" : "bg-[#f6f1e7] text-[#1c1917] hover:bg-white"
                }`}
              >
                {m % 12 === 0 ? (
                  <span className="pointer-events-none font-mono text-[11px] font-bold leading-none text-[#1c1917]">
                    {label}
                  </span>
                ) : (
                  ""
                )}
              </button>
            );
          })}
        </div>
        {whites.map((m, i) => {
          const b = m + 1;
          if (!isBlack(b) || i >= whites.length - 1) return null;
          const label = noteLabel(b);
          const active = heldNotes.includes(b);
          return (
            <button
              key={b}
              type="button"
              aria-label={`Key ${label}`}
              onPointerDown={(e) => {
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* ignore */
                }
                byPointer.current.set(e.pointerId, b);
                startNote(b, 96);
              }}
              style={{ left: `calc(${((i + 1) / whites.length) * 100}% - 1.3%)`, width: "2.6%" }}
              className={`absolute top-0 h-[60%] rounded-b border border-black cursor-pointer ${
                active ? "bg-emerald-500" : "bg-[#15181c] hover:bg-slate-700"
              }`}
            />
          );
        })}
      </div>

      <output className="block font-mono text-[11px] text-slate-400">
        {last || "Computer keys A–; play CHIMERA notes · Z/X shift octave · Overlap keys for legato"}
      </output>
    </section>
  );
}
