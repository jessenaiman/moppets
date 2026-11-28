/**
 * CHIMERA Superpowers Panel (`S-30` · `D-66`):
 *  1. Interactive CHIMERA Vowel Map (F1 / F2 IPA trapezoid touchpad) — pointer drag OR keyboard arrow keys.
 *  2. Live CHIMERA Mouth-Beatbox Pads — triggers CHIMERA's real Rust/WASM `engine_beat_hit`.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { BEAT_SOUNDS, VOWEL_TARGETS } from "@chimera/wasm/engine.ts";
import { chimeraModule } from "@chimera/wasm/chimera.ts";
import chimeraWorkletUrl from "@chimera/worklet/processor.ts?worker&url";
import { audio, useAudio } from "../audio/audio.ts";
import { auditionNote, moveMouth, useLive } from "../choir/live.ts";
import { useMoppet } from "../choir/store.ts";

let beatNode: AudioWorkletNode | null = null;
let beatLoading: Promise<AudioWorkletNode> | null = null;

async function ensureChimeraBeatbox(): Promise<AudioWorkletNode> {
  await useAudio.getState().start();
  if (beatNode) return beatNode;
  beatLoading ??= (async () => {
    const ctx = audio.ctx!;
    await ctx.audioWorklet.addModule(chimeraWorkletUrl);
    const node = new AudioWorkletNode(ctx, "chimera", {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { module: chimeraModule() },
    });
    const boost = ctx.createGain();
    boost.gain.value = 1.35;
    node.connect(boost);
    audio.connect(boost);
    beatNode = node;
    return node;
  })().finally(() => {
    beatLoading = null;
  });
  return beatLoading;
}

export async function triggerChimeraBeat(soundId: string): Promise<void> {
  const node = await ensureChimeraBeatbox();
  node.port.postMessage({ type: "beatHit", id: soundId, accent: 1 });
}

interface PlottedVowel {
  ipa: string;
  x: number;
  y: number;
  artic: Record<string, number>;
}

const F1_MIN = 250;
const F1_MAX = 960;
const F2_MIN = 750;
const F2_MAX = 2650;

function toPadXY(F1: number, F2: number): { x: number; y: number } {
  const u = (Math.log(F2_MAX) - Math.log(Math.max(F2_MIN, Math.min(F2_MAX, F2)))) / (Math.log(F2_MAX) - Math.log(F2_MIN));
  const v = (Math.log(Math.max(F1_MIN, Math.min(F1_MAX, F1))) - Math.log(F1_MIN)) / (Math.log(F1_MAX) - Math.log(F1_MIN));
  return { x: 12 + u * 76, y: 14 + v * 72 };
}

export function ChimeraTools() {
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const voice = voices[selected];
  const bodyKey = voice.body.child > 0.5 ? "child" : voice.body.female > 0.5 ? "female" : "male";

  const [cursor, setCursor] = useState<{ x: number; y: number; ipa: string }>({ x: 50, y: 52, ipa: "a" });
  const [litBeat, setLitBeat] = useState<string | null>(null);
  const [beatStatus, setBeatStatus] = useState("Tap any pad for CHIMERA mouth drums");
  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const vowels = useMemo<PlottedVowel[]>(() => {
    const table = VOWEL_TARGETS[bodyKey] ?? VOWEL_TARGETS.male ?? {};
    return Object.entries(table)
      .filter(([, entry]) => entry.formants && entry.formants.length >= 2)
      .slice(0, 11)
      .map(([ipa, entry]) => {
        const pt = toPadXY(entry.formants[0], entry.formants[1]);
        return { ipa, x: pt.x, y: pt.y, artic: entry.artic as Record<string, number> };
      });
  }, [bodyKey]);

  const applyVowelNormalized = useCallback(
    (nx: number, ny: number, audition: boolean) => {
      if (!vowels.length) return;
      const x = Math.max(6, Math.min(94, nx));
      const y = Math.max(6, Math.min(94, ny));

      let wSum = 0;
      let nearest = vowels[0];
      let bestDist = Infinity;
      const blended: Record<string, number> = { jaw: 0, tbX: 0, tbY: 0, lipAp: 0, lipProt: 0 };

      for (const v of vowels) {
        const d = Math.hypot(x - v.x, y - v.y);
        if (d < bestDist) {
          bestDist = d;
          nearest = v;
        }
        const w = 1 / Math.max(12, d * d);
        wSum += w;
        for (const k of Object.keys(blended)) {
          blended[k] += (v.artic[k] ?? 0) * w;
        }
      }

      setCursor({ x, y, ipa: nearest.ipa });

      if (useLive.getState().mode === "off") {
        void useLive.getState().setMode("puppet");
      }
      useLive.setState((s) => ({
        mouth: {
          ...s.mouth,
          jaw: blended.jaw / wSum,
          tbX: blended.tbX / wSum,
          tbY: blended.tbY / wSum,
          lipAp: blended.lipAp / wSum,
          lipProt: blended.lipProt / wSum,
        },
        last: `Vowel Map: /${nearest.ipa}/`,
      }));
      moveMouth("jaw", Math.max(0, Math.min(1, (blended.jaw / wSum) / 2.2)));

      if (audition) {
        const midMidi = Math.round((voice.register[0] + voice.register[1]) / 2);
        void auditionNote(voice, midMidi, nearest.ipa === "i" ? "ee" : nearest.ipa === "u" ? "oo" : "ah", 320);
      }
    },
    [vowels, voice],
  );

  const applyVowelAt = useCallback(
    (clientX: number, clientY: number, audition: boolean) => {
      const box = padRef.current?.getBoundingClientRect();
      if (!box) return;
      const x = ((clientX - box.left) / Math.max(1, box.width)) * 100;
      const y = ((clientY - box.top) / Math.max(1, box.height)) * 100;
      applyVowelNormalized(x, y, audition);
    },
    [applyVowelNormalized],
  );

  const hitBeat = (id: string, name: string) => {
    setLitBeat(id);
    setBeatStatus(`${name} (${id})`);
    void triggerChimeraBeat(id).catch((err) => {
      setBeatStatus(err instanceof Error ? err.message : "Could not trigger CHIMERA beatbox");
    });
    setTimeout(() => setLitBeat((cur) => (cur === id ? null : cur)), 180);
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="CHIMERA interactive vowel map and mouth beatbox">
      {/* 1. Interactive CHIMERA F1 / F2 Vowel Map Touchpad */}
      <div className="rounded-xl border border-[#283542] bg-[#182028] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-wide uppercase text-[#F1F5F9]">Vowel Map (F1 / F2)</span>
          <span className="font-mono text-xs text-[#34D399]">/{cursor.ipa}/ · Drag or Arrows</span>
        </div>
        <div
          ref={padRef}
          tabIndex={0}
          role="application"
          aria-label="CHIMERA F1 F2 Vowel Map touchpad. Use arrow keys to morph vowel and Enter or Space to audition."
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 5;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              applyVowelNormalized(cursor.x - step, cursor.y, false);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              applyVowelNormalized(cursor.x + step, cursor.y, false);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              applyVowelNormalized(cursor.x, cursor.y - step, false);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              applyVowelNormalized(cursor.x, cursor.y + step, false);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              applyVowelNormalized(cursor.x, cursor.y, true);
            }
          }}
          onPointerDown={(e) => {
            draggingRef.current = true;
            e.currentTarget.focus();
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
            applyVowelAt(e.clientX, e.clientY, true);
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) applyVowelAt(e.clientX, e.clientY, false);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          className="relative h-40 w-full cursor-crosshair select-none overflow-hidden rounded-lg border border-[#283542] bg-[#0A0D10]"
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon
              points="14,16 86,18 76,84 36,84"
              fill="rgba(52,211,153,0.06)"
              stroke="rgba(168,184,200,0.35)"
              strokeWidth="0.6"
            />
          </svg>

          {vowels.map((v) => (
            <button
              key={v.ipa}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                applyVowelNormalized(v.x, v.y, true);
              }}
              style={{ left: `${v.x}%`, top: `${v.y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 font-mono text-xs font-bold text-[#A8B8C8] hover:bg-[#34D399]/20 hover:text-[#F1F5F9] cursor-pointer"
            >
              {v.ipa}
            </button>
          ))}

          <span
            style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
            className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#34D399] bg-[#34D399]/30"
          />
        </div>
      </div>

      {/* 2. Live CHIMERA Articulatory Mouth-Beatbox Pads */}
      <div className="rounded-xl border border-[#283542] bg-[#182028] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-wide uppercase text-[#F1F5F9]">Mouth-Beatbox Pads</span>
          <span className="truncate text-xs text-[#A8B8C8]">{beatStatus}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="CHIMERA mouth beatbox pads">
          {BEAT_SOUNDS.slice(0, 8).map((s) => {
            const lit = litBeat === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => hitBeat(s.id, s.name)}
                className={`flex flex-col items-start justify-between rounded-lg border px-2.5 py-2 text-left cursor-pointer transition-colors ${
                  lit
                    ? "border-[#34D399] bg-[#34D399] text-[#041A12]"
                    : "border-[#283542] bg-[#11161C] text-[#F1F5F9] hover:border-[#34D399]"
                }`}
              >
                <span className={`font-mono text-sm font-extrabold ${lit ? "text-[#041A12]" : "text-[#34D399]"}`}>{s.id}</span>
                <span className="w-full truncate text-xs font-semibold">{s.name}</span>
                <span className={`text-xs uppercase ${lit ? "text-[#041A12]/80" : "text-[#A8B8C8]"}`}>{s.role}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
