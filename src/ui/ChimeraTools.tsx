/**
 * Untapped CHIMERA Superpowers Panel (`S-30` · `D-66`):
 *  1. Interactive CHIMERA Vowel Map (F1 / F2 IPA trapezoid touchpad) — drag to live-morph
 *     the selected Moppet's tongue, jaw, and lips directly via CHIMERA vowel calibration.
 *  2. Live CHIMERA Mouth-Beatbox Pads — triggers CHIMERA's real Rust/WASM `engine_beat_hit`
 *     articulatory mouth percussion (Kick, Snare, Hi-Hat, Lip Buzz, Tongue Click, Ejective)
 *     straight through the shared Master Volume AudioContext.
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
  const [beatStatus, setBeatStatus] = useState("Tap any pad for live CHIMERA mouth-physics drums");
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

  const applyVowelAt = useCallback(
    (clientX: number, clientY: number, audition: boolean) => {
      const box = padRef.current?.getBoundingClientRect();
      if (!box || !vowels.length) return;
      const x = Math.max(6, Math.min(94, ((clientX - box.left) / Math.max(1, box.width)) * 100));
      const y = Math.max(6, Math.min(94, ((clientY - box.top) / Math.max(1, box.height)) * 100));

      // Inverse-distance weighted blend of the nearest CHIMERA calibrated vowels
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
      // Apply interpolated mouth posture directly into live CHIMERA worklet
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

  const hitBeat = (id: string, name: string) => {
    setLitBeat(id);
    setBeatStatus(`CHIMERA mouth drum: ${name} (${id})`);
    void triggerChimeraBeat(id).catch((err) => {
      setBeatStatus(err instanceof Error ? err.message : "Could not trigger CHIMERA beatbox");
    });
    setTimeout(() => setLitBeat((cur) => (cur === id ? null : cur)), 180);
  };

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="CHIMERA interactive vowel map and mouth beatbox">
      {/* 1. Interactive CHIMERA F1 / F2 Vowel Map Touchpad */}
      <div className="rounded-xl border border-[#4fb6f2]/35 bg-[#091520]/95 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold tracking-wider uppercase text-[#5cebf7]">CHIMERA Vowel Map (F1 / F2)</span>
          <span className="font-mono text-xs text-[#5be381]">/{cursor.ipa}/ · Drag to morph</span>
        </div>
        <div
          ref={padRef}
          role="application"
          aria-label="CHIMERA F1 F2 Vowel Map touchpad"
          onPointerDown={(e) => {
            draggingRef.current = true;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
            applyVowelAt(e.clientX, e.clientY, true);
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) applyVowelAt(e.clientX, e.clientY, false);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          className="relative h-44 w-full cursor-crosshair select-none overflow-hidden rounded-lg border border-[#4fb6f2]/30 bg-[#050d14]"
        >
          {/* Phonetician's Vowel Trapezoid SVG guide */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon
              points="14,16 86,18 76,84 36,84"
              fill="rgba(79,182,242,0.06)"
              stroke="rgba(79,182,242,0.45)"
              strokeWidth="0.6"
            />
          </svg>

          {vowels.map((v) => (
            <button
              key={v.ipa}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                applyVowelAt(e.clientX, e.clientY, true);
              }}
              style={{ left: `${v.x}%`, top: `${v.y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 font-mono text-xs font-bold text-[#c7e4f5] hover:bg-[#4fb6f2]/25 hover:text-white"
            >
              {v.ipa}
            </button>
          ))}

          {/* Live glowing phosphor cursor */}
          <span
            style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}
            className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#5be381] bg-[#5be381]/30 shadow-[0_0_14px_#5be381]"
          />
        </div>
      </div>

      {/* 2. Live CHIMERA Articulatory Mouth-Beatbox Pads */}
      <div className="rounded-xl border border-[#e3bd7f]/35 bg-[#1b130e]/95 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-wider uppercase text-[#e3bd7f]">CHIMERA Mouth-Beatbox Pads</span>
          <span className="truncate text-[11px] text-[#c7b194]">{beatStatus}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="CHIMERA mouth beatbox pads">
          {BEAT_SOUNDS.slice(0, 8).map((s) => {
            const lit = litBeat === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => hitBeat(s.id, s.name)}
                className={`flex flex-col items-start justify-between rounded-lg border px-2.5 py-2 text-left cursor-pointer ${
                  lit
                    ? "border-[#50cfad] bg-[#50cfad]/30 text-white shadow-[0_0_14px_rgba(80,207,173,0.45)]"
                    : "border-[#745438]/70 bg-[#271b13] text-[#f8efe2] hover:border-[#e3bd7f]"
                }`}
              >
                <span className="font-mono text-sm font-extrabold text-[#50cfad]">{s.id}</span>
                <span className="truncate text-[11px] font-semibold">{s.name}</span>
                <span className="text-[9px] uppercase tracking-wider text-[#c7b194]">{s.role}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
