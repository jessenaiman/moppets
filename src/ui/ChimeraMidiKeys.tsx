/**
 * Playable 2-Octave Vintage Synth Keyboard (`C3–C5`) wired to CHIMERA WASM & Web MIDI/MPE.
 * Includes left Pitch & Slide wheels, single-line Syllable Prompt, mode selector, and Oct -/+.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAudio } from "../audio/audio.ts";
import { touchControl, useController } from "../choir/controller.ts";
import { useEnsemble } from "../choir/ensemble.ts";
import {
  auditionNote,
  liveNoteOff,
  liveNoteOn,
  setLivePitchBend,
  setLiveSlide,
  useLive,
  type LiveMode,
} from "../choir/live.ts";
import { noteName } from "../choir/music.ts";
import { useMoppet } from "../choir/store.ts";
import { studio404Name } from "../choir/studio404.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import type { MoppetVoice } from "../choir/voices.ts";
import { midiSupported } from "./midi.ts";

const KEYMAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16,
};
const SEMIS_TO_KEY: Readonly<Record<number, string>> = {
  0: "A", 1: "W", 2: "S", 3: "E", 4: "D", 5: "F", 6: "T", 7: "G", 8: "Y", 9: "H", 10: "U", 11: "J",
  12: "K", 13: "O", 14: "L", 15: "P", 16: ";",
};
const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const noteLabel = (m: number) => `${KEY_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function isTypingTarget(target: EventTarget | null): boolean {
  const el = (target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

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
            : "Connected"
          : "MIDI";

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setMidi(!on)}
      title={on && midi.inputs.length ? `Connected MIDI: ${midi.inputs.join(", ")}` : "Connect Web MIDI / MPE keyboard"}
      className={`inline-flex h-9 max-w-[170px] items-center gap-1.5 truncate rounded-lg border px-2.5 text-xs font-semibold cursor-pointer transition-colors ${
        on
          ? "border-[#34D399]/70 bg-[#1F2A24] text-[#F4EFE6]"
          : "border-[#3B362E] bg-[#121110] text-[#B7AEA0] hover:border-[#D9A75C] hover:text-[#F4EFE6]"
      }`}
    >
      <span className={`size-2 shrink-0 rounded-full ${on ? "bg-[#34D399]" : "bg-[#6A6359]"}`} />
      <span className="truncate">{on ? `MIDI · ${status}` : "MIDI"}</span>
    </button>
  );
}

function ModWheelStrip({
  label,
  ariaLabel,
  value,
  bipolar = false,
  accent = "#D9A75C",
  onChange,
  onRelease,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  bipolar?: boolean;
  accent?: string;
  onChange: (next: number) => void;
  onRelease?: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pct = clamp(bipolar ? (value + 1) / 2 : value, 0, 1) * 100;

  const updateFromClientY = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = clamp(1 - (clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    onChange(bipolar ? ratio * 2 - 1 : ratio);
  };

  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={bipolar ? -100 : 0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.2 : 0.08;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault();
            onChange(clamp(value + step, bipolar ? -1 : 0, 1));
          } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            onChange(clamp(value - step, bipolar ? -1 : 0, 1));
          }
        }}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.focus();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          updateFromClientY(e.clientY);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) updateFromClientY(e.clientY);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
          onRelease?.();
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          onRelease?.();
        }}
        className="relative h-24 w-7 cursor-ns-resize touch-none select-none overflow-hidden rounded-md border border-[#3B362E] bg-[#0D0C0A]"
      >
        <div className="pointer-events-none absolute inset-x-1.5 inset-y-2 flex flex-col justify-between opacity-35">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="h-px w-full bg-[#B7AEA0]" />
          ))}
        </div>
        {bipolar && <span className="pointer-events-none absolute inset-x-1 top-1/2 h-px bg-[#B7AEA0]/60" />}
        <span
          className="pointer-events-none absolute inset-x-1 h-2 -translate-y-1/2 rounded-xs"
          style={{ bottom: `calc(${pct}% - 4px)`, backgroundColor: accent }}
        />
      </div>
      <span className="text-xs font-medium text-[#B7AEA0] whitespace-nowrap">{label}</span>
    </div>
  );
}

export function ChimeraMidiKeys({
  onClose,
}: {
  nextStepLabel?: string;
  onNextStep?: () => void;
  onClose?: () => void;
} = {}) {
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const studio404 = useMoppet((s) => s.studio404);
  const curVoice: MoppetVoice = voices[selected];
  const name = studio404 ? studio404Name(curVoice.id, curVoice.name) : curVoice.name;

  const mode = useLive((s) => s.mode);
  const setMode = useLive((s) => s.setMode);
  const syllables = useLive((s) => s.syllables);
  const next = useLive((s) => s.next);
  const heldNotes = useLive((s) => s.heldNotes);
  const liveLast = useLive((s) => s.last);
  const bend = useController((s) => s.bend);
  const slide = useController((s) => s.slide);
  const stageTime = useEnsemble((s) => s.time);

  const octaveRef = useRef(0);
  const [octave, setOctave] = useState(0);
  const byPointer = useRef(new Map<number, number>());
  const baseMidi = 48 + octave * 12;

  const startNote = (midi: number, velocity = 96) => {
    void useAudio.getState().start();
    touchControl("key", midi);
    if (useLive.getState().mode === "off") {
      void auditionNote(curVoice, midi, "la", 320);
    } else {
      liveNoteOn(midi, velocity, 0);
    }
  };

  useEffect(() => {
    const down = new Map<string, number>();
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
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

  const syllablePrompt = useMemo(() => {
    const track = piece.tracks.find((t) => t.id === curVoice.id) ?? piece.tracks[0];
    const bs = beatSeconds(piece);
    const beat = Math.max(0, (stageTime - LEAD_IN) / bs);
    const nextEv = track?.events.find((ev) => ev.beat + ev.beats > beat) ?? track?.events[0];
    const nextSyl = syllables[next];
    if (mode === "words" && nextSyl) {
      const sylLabel = nextSyl.melisma ? "– (hold)" : `"${nextSyl.text}"`;
      const pitchLabel = nextEv ? `${noteName(nextEv.midi, piece.key, piece.mode)} · ` : "";
      return `Next: ${pitchLabel}${sylLabel}`;
    }
    if (mode === "puppet") return `${name} · Mouth (${liveLast || "hold keys"})`;
    if (nextEv && piece.kind !== "skit") {
      return `Next: ${noteName(nextEv.midi, piece.key, piece.mode)}${nextEv.text ? ` · "${nextEv.text}"` : ""}`;
    }
    return `${name} · ${noteLabel(baseMidi)}–${noteLabel(baseMidi + 24)}`;
  }, [piece, curVoice.id, stageTime, syllables, next, mode, name, liveLast, baseMidi]);

  const uiMode = mode === "edit" ? "words" : mode;

  return (
    <section
      className="flex flex-col gap-2.5 rounded-xl border border-[#34302A] bg-[#181614] p-3 text-[#F4EFE6]"
      aria-label="CHIMERA MIDI and keyboard controller"
    >
      {/* Single Concise Keyboard Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[#322E28] bg-[#11100E] px-3 py-1.5">
          <span className="size-2 shrink-0 rounded-full bg-[#D9A75C]" />
          <span className="truncate text-xs font-semibold text-[#F4EFE6]" data-testid="midi-teleprompter">
            {syllablePrompt}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={uiMode}
            onValueChange={(val) => {
              if (val) void setMode(val as LiveMode);
            }}
            size="sm"
            aria-label="MIDI key mode"
            className="rounded-lg border border-[#322E28] bg-[#11100E] p-0.5"
          >
            <ToggleGroupItem
              value="words"
              className="h-7 px-2.5 text-xs text-[#B7AEA0] data-[state=on]:bg-[#D9A75C] data-[state=on]:text-[#14110D]"
            >
              Sing Lyrics
            </ToggleGroupItem>
            <ToggleGroupItem
              value="puppet"
              className="h-7 px-2.5 text-xs text-[#B7AEA0] data-[state=on]:bg-[#D9A75C] data-[state=on]:text-[#14110D]"
            >
              Mouth
            </ToggleGroupItem>
            <ToggleGroupItem
              value="off"
              className="h-7 px-2.5 text-xs text-[#B7AEA0] data-[state=on]:bg-[#D9A75C] data-[state=on]:text-[#14110D]"
            >
              La
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="flex items-center gap-1 rounded-lg border border-[#322E28] bg-[#11100E] px-1.5 py-0.5 text-xs tabular-nums">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label="Octave down"
              onClick={() => {
                octaveRef.current = clamp(octave - 1, -2, 2);
                setOctave(octaveRef.current);
              }}
              className="h-6 px-1.5 text-[#F4EFE6] hover:bg-[#28241E] hover:text-[#F4EFE6]"
            >
              Oct −
            </Button>
            <span className="px-1 text-[#B7AEA0]">
              {noteLabel(baseMidi)}–{noteLabel(baseMidi + 24)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label="Octave up"
              onClick={() => {
                octaveRef.current = clamp(octave + 1, -2, 2);
                setOctave(octaveRef.current);
              }}
              className="h-6 px-1.5 text-[#F4EFE6] hover:bg-[#28241E] hover:text-[#F4EFE6]"
            >
              Oct +
            </Button>
          </div>

          {onClose && (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Hide MIDI keyboard dock"
              onClick={onClose}
              className="size-8 border-[#3B362E] bg-[#121110] text-[#B7AEA0] hover:text-[#F4EFE6]"
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      {/* Pitch & Slide Wheels + 2-Octave Ivory & Ebony Manual */}
      <div className="flex items-stretch gap-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-[#322E28] bg-[#121110] px-3 py-2">
          <ModWheelStrip
            label="Pitch"
            ariaLabel="Pitch bend"
            value={bend}
            bipolar
            accent="#D9A75C"
            onChange={(v) => {
              setLivePitchBend(v, 0);
              useController.setState({ bend: v });
            }}
            onRelease={() => {
              setLivePitchBend(0, 0);
              useController.setState({ bend: 0 });
            }}
          />
          <ModWheelStrip
            label="Slide"
            ariaLabel="CC 74 brightness slide"
            value={slide}
            accent="#34D399"
            onChange={(v) => {
              setLiveSlide(v, 0);
              useController.setState({ slide: v });
            }}
          />
        </div>

        <div
          className="relative min-h-[104px] flex-1 select-none touch-none overflow-hidden rounded-lg border border-[#3B362E] bg-[#0D0C0A]"
          style={{ touchAction: "none" }}
          data-layout="layered"
          role="group"
          aria-label="25-key MIDI manual"
        >
          <div className="flex h-full w-full touch-none">
            {whites.map((m) => {
              const label = noteLabel(m);
              const semi = m - baseMidi;
              const keyCap = SEMIS_TO_KEY[semi];
              const active = heldNotes.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  aria-label={`Key ${label}${keyCap ? ` (${keyCap})` : ""}`}
                  style={{ touchAction: "none" }}
                  onPointerDown={(e) => {
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                      /* ignore */
                    }
                    byPointer.current.set(e.pointerId, m);
                    startNote(m, 96);
                  }}
                  className={`relative flex flex-1 flex-col items-center justify-end border-r border-[#C9BEA8] pb-1.5 text-xs font-bold cursor-pointer transition-colors ${
                    active
                      ? "bg-[#D9A75C] text-[#1A140B]"
                      : "bg-[#FAF5E8] text-[#2A241D] hover:bg-white"
                  }`}
                >
                  {keyCap && (
                    <span className="pointer-events-none mb-0.5 text-xs font-semibold opacity-75">
                      {keyCap}
                    </span>
                  )}
                  {m % 12 === 0 && (
                    <span className="pointer-events-none text-xs font-semibold opacity-70">{label}</span>
                  )}
                </button>
              );
            })}
          </div>
          {whites.map((m, i) => {
            const b = m + 1;
            if (!isBlack(b) || i >= whites.length - 1) return null;
            const label = noteLabel(b);
            const semi = b - baseMidi;
            const keyCap = SEMIS_TO_KEY[semi];
            const active = heldNotes.includes(b);
            return (
              <button
                key={b}
                type="button"
                aria-label={`Key ${label}${keyCap ? ` (${keyCap})` : ""}`}
                onPointerDown={(e) => {
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    /* ignore */
                  }
                  byPointer.current.set(e.pointerId, b);
                  startNote(b, 96);
                }}
                style={{
                  left: `calc(${((i + 1) / whites.length) * 100}% - 1.55%)`,
                  width: "3.1%",
                  touchAction: "none",
                }}
                className={`absolute top-0 flex h-[60%] items-end justify-center rounded-b-md border border-[#0B0A09] pb-1.5 text-xs font-bold cursor-pointer transition-colors ${
                  active
                    ? "bg-[#34D399] text-[#051A12]"
                    : "bg-[#23201C] text-[#E6DDD0] hover:bg-[#322E28]"
                }`}
              >
                {keyCap && <span className="pointer-events-none leading-none">{keyCap}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
