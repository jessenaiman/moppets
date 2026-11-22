/**
 * Unified 16:9 React Theatrical Stage (`ShotcraftStage`) shared by:
 *   1. Main Moppet Choir interactive stage (`src/ui/MoppetPanel.tsx`) — driven live at 60fps by
 *      CHIMERA physical voice telemetry, live MIDI/pad input, and click-to-poke choreography.
 *   2. Remotion `<Player>`, `VideoStudio`, `workbench.ts`, and on-demand export (`src/remotion/MoppetComposition.tsx`)
 *      — driven deterministically by `frame / fps` with 100% visual parity and zero `stage.mp4` capture hack.
 *
 * Implements tuned recipes from `video-shotcraft`:
 *   - `light-play-moves · spotlight-sweep` (`SpotlightSweepReveal.tsx` / `effects.webp`):
 *     dual-layer pleated velvet curtain (0.17 ambient + 0.95 lit copy revealed through radial spotlight masks),
 *     tungsten filament switch-on flicker, damped spotlight sweep, SVG blurred volumetric cones + clipped
 *     deterministic dust motes, dark timber stage apron + 2px specular lip + elliptical floor light pools,
 *     `<Vignette>` + SVG `feTurbulence` `<Grain>`.
 *   - Studio 404 Canon (`docs/briefs/moppet-world.md`):
 *     grounded upstage timber band riser (`Thrum`, `Clacker`, `Rattle`) and **Tracking & Hertz standing on the
 *     stage floor** beside the cast, tethered together by their sagging AV cable (no balcony box).
 *   - `glass-pill-dictation-typing` + `type-rhythm-sync · karaoke-fill-sync` + `voice-waveform-live`:
 *     self-luminous frosted-glass speech capsules in non-overlapping headroom lanes, feathered left-to-right
 *     word-locked vocal fill, retracting reading-finger underline, and live 20-bar voice waveform.
 *
 * Pure and engine-free (no `@chimera/wasm/engine.ts` runtime imports).
 */
import React, { useMemo, useState } from "react";
import "./shotcraft-stage.css";
import { zapCues, zapTake } from "./zapDirection.ts";
import { atlasStyle, WorkshopSolo, workshopTake, workshopSongs, type WorkshopSinger } from "./WorkshopSolo.tsx";
import { StageCord, cordExposure, PinnedBow, RehearsalActor } from "./RehearsalActor.tsx";
import { CuePromptStand } from "./CueSolo.tsx";
import { NeonSolo, neonScore, neonTake, RepairBayLights } from "./NeonSolo.tsx";
import { WorldsStage } from "./WorldsStage.tsx";
import { WORLD_LENSES, type WorldLens } from "./worlds.ts";
import { resolvePerformerIdentity, type CharacterFmvManifest } from "../choir/performer.ts";
import { useCastFmvManifests } from "./fmvManifest.ts";
import { ZapSolo, ZapTelevision, zapFrame } from "./ZapSolo.tsx";
import soloSets from "./soloSets.json";
import type { Piece } from "../choir/music.ts";
import { MOUTH_OPEN_THRESHOLD, type Pose } from "../choir/pose.ts";
import type { Actor } from "../choir/choreo.ts";
import { featuredAt, sceneFeatured } from "../choir/choreo.ts";
import { cuesFor } from "../choir/cues.ts";
import { gestureAt, gestureSeconds, type GesturePose } from "../choir/gestures.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import { STUDIO_404_CAST, STUDIO_404_CREW, studio404Name } from "../choir/studio404.ts";
import { duetCriticsStateAt, studio404DanceAt } from "../choir/studio404Anim.ts";
import { bandFor, CRASH, HAT, KICK, OPEN_HAT, SNARE, type BandNote, type BandPart } from "../choir/band.ts";
import { bandPoseAt, type BandClipName, type BandPose } from "../choir/bandAnim.ts";
import {
  isPadOnlyText,
  layoutStageCapsules,
  mapSkitWords,
  speechDetailForTrack,
  type KaraokeWordSpan,
  type PlacedSpeechCapsule,
  type StageCapsuleInput,
} from "../choir/bubbles.ts";
import type { VideoBubbleClip } from "../choir/videoProject.ts";
import solo from "../choir/vee-solo.json";
import { moppet } from "../choir/cast/index.ts";

// ───────────────────── Deterministic Polish Primitives (Polish.tsx / SpotlightSweepReveal.tsx) ─────────────────────

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function detHash(n: number): number {
  const s = Math.sin(n * 91.7 + 13.1) * 43758.5453;
  return s - Math.floor(s);
}

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseAt(x: number): number {
  const i = Math.floor(x);
  const fr = x - i;
  const a = mulberry32(i * 7919 + 13)();
  const b = mulberry32((i + 1) * 7919 + 13)();
  const s = fr * fr * (3 - 2 * fr);
  return a + (b - a) * s;
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  if (h.startsWith("rgb")) return [248, 239, 226];
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? [255, 230, 194] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbMix(a: [number, number, number], b: [number, number, number], k: number): string {
  const t = clamp01(k);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

// Velvet curtain pleat CSS directly adapted from video-shotcraft SpotlightSweepReveal.tsx (lines 83-86)
const VELVET_CURTAIN_IMAGE =
  "repeating-linear-gradient(90deg, rgba(0,0,0,0.56) 0%, rgba(0,0,0,0) 2.4%, rgba(255,210,200,0.10) 3.65%, rgba(0,0,0,0) 5.0%, rgba(0,0,0,0.56) 6.88%)," +
  "repeating-linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.30) 10.9%, rgba(0,0,0,0) 17.2%)," +
  "linear-gradient(180deg, #22080c 0%, #5a1622 55%, #43101a 100%)";

const WORKSHOP_CURTAIN_IMAGE =
  "repeating-linear-gradient(90deg, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0) 2.6%, rgba(255,226,184,0.08) 3.9%, rgba(0,0,0,0) 5.2%, rgba(0,0,0,0.52) 7.1%)," +
  "linear-gradient(180deg, #1d1510 0%, #3a291e 58%, #291d15 100%)";

const GRAIN_DATA_URI = (() => {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>` +
    `<filter id='g' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' seed='23' stitchTiles='stitch'/>` +
    `<feColorMatrix type='matrix' values='0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0.9 0'/>` +
    `</filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
})();

// Tungsten lamp warm-up flicker table from SpotlightSweepReveal.tsx (line 66)
const FLICKER_TABLE = [0.22, 0.65, 0.25, 0.85, 0.52, 1];
function tungstenFlicker(secSinceCue: number): number {
  if (secSinceCue < 0) return 1;
  const f = Math.floor(secSinceCue * 24);
  return f >= FLICKER_TABLE.length ? 1 : FLICKER_TABLE[Math.max(0, f)];
}

// ───────────────────── Types ─────────────────────

export interface StageVoiceInfo {
  id: string;
  name: string;
  color: string;
}

export interface LiveMidiSpeech {
  midi?: number;
  voiceId: string;
  text: string;
  roleLabel?: string;
  level: number;
}

export type StagePose = Pick<Pose, "singing" | "level" | "open" | "viseme">;

export interface ShotcraftStageProps {
  piece: Piece;
  voices: readonly StageVoiceInfo[];
  studio404: boolean;
  /** Current musical beat (quarter-note beats from LEAD_IN) */
  beat: number;
  /** Current clock in seconds (wall or timeline) */
  timeSec: number;
  /** Playing or paused on a score */
  performing: boolean;
  /** Actively advancing frames on the score */
  dancing: boolean;
  /** Reduced motion preference */
  still?: boolean;
  /** Selected Moppet index (for live MIDI & click highlight) */
  selectedIndex?: number;
  /** Subtle 2.5D stage framing follow on solo/duet singers */
  cameraFollow?: boolean;
  /** Optional live actor states from Choreographer (computed deterministically when omitted) */
  actors?: readonly Actor[];
  /** Optional live CHIMERA voice poses (computed deterministically from score when omitted) */
  poses?: readonly StagePose[];
  /** Optional live MIDI speech cue when playing keys/pads outside a song */
  liveMidiSpeech?: LiveMidiSpeech | null;
  /** Optional custom bubble overrides from VideoStudio / Workbench timeline */
  customBubbles?: readonly VideoBubbleClip[];
  /** Optional band parts cache */
  bandParts?: readonly BandPart[];
  /** Click handler on a Moppet (interactive mode); omitted in read-only Remotion Player */
  onSelectActor?: (index: number) => void;
  /** Optional render slot inside each puppet button for CHIMERA PropFx DOM overlays */
  renderPropFx?: (voiceId: string, index: number) => React.ReactNode;
  /** Optional button ref callback so live PropFx updater can address puppet DOM nodes */
  padGesture?: {id:string; action:import("../choir/gestures.ts").GestureName | "double nod"; at:number} | null;
  puppetRef?: (index: number, el: HTMLButtonElement | null) => void;
  /** Optional URL resolver (e.g. Remotion `staticFile` during headless rendering) */
  resolveAsset?: (path: string) => string;
  /** Whether viewer-interactive controls (world lens switcher, tilt/plate turns) are enabled */
  interactive?: boolean;
  /** Optional initial/controlled polymorphic world lens */
  neonLens?: WorldLens;
  /** Optional callback when the user switches world lens */
  onNeonLensChange?: (lens: WorldLens) => void;
  /** Whether to render the floating in-stage lens switcher (false when controlled by the locked Studio Stage Bar) */
  showInternalLensBar?: boolean;
  /** Optional S-27 keyed Flow FMV-cel manifest override */
  neonFmvManifest?: CharacterFmvManifest | null;
  /** Optional custom React element replacing the default puppet sprite (e.g. Remotion `<CharacterClip />`) */
  renderCharacterOverride?: (
    voiceId: string,
    artKey: string,
    spriteStyle: React.CSSProperties,
  ) => React.ReactNode | null;
}

// ───────────────────── Deterministic Fallbacks (for Remotion / Workbench) ─────────────────────

function deterministicPoses(piece: Piece, voices: readonly StageVoiceInfo[], beat: number, performing: boolean): StagePose[] {
  return voices.map((v, idx) => {
    if (!performing) {
      return { singing: false, level: 0, open: 0, viseme: 0 };
    }
    const track = piece.tracks.find((t) => t.id === v.id);
    const ev = track?.events.find((e) => beat >= e.beat && beat < e.beat + e.beats);
    if (!ev) {
      return { singing: false, level: 0, open: 0, viseme: 0 };
    }
    const noteProgress = (beat - ev.beat) / Math.max(0.1, ev.beats);
    const attack = clamp01(noteProgress * 6);
    const release = clamp01((1 - noteProgress) * 5);
    const vibrato = 0.82 + 0.18 * Math.sin(beat * Math.PI * 4 + idx);
    const level = clamp01(0.68 * attack * release * vibrato);
    const syllablePulse = 0.5 + 0.5 * Math.sin(beat * Math.PI * 3.2 + idx * 1.3);
    const open = level * (0.35 + 0.55 * syllablePulse);
    return {
      singing: true,
      level,
      open,
      viseme: open > 0.35 ? (Math.floor(beat * 4 + idx) % 6) + 1 : 0,
    };
  });
}

function deterministicActors(
  piece: Piece,
  voices: readonly StageVoiceInfo[],
  beat: number,
  performing: boolean,
  studio404: boolean,
  still: boolean,
): Actor[] {
  const n = Math.max(1, voices.length);
  const left = studio404 ? 0.075 : 0.09;
  const right = studio404 ? 0.72 : 0.91;
  const home = Array.from({ length: n }, (_, i) => (n === 1 ? 0.4 : left + ((right - left) * i) / (n - 1)));
  const ids = voices.map((v) => v.id);
  const featured = !performing
    ? ids.map(() => false)
    : piece.scenes
      ? sceneFeatured(piece.scenes, ids, beat)
      : featuredAt(piece.tracks, ids, beat);
  const featIdx = featured.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  const k = featIdx.length;

  return voices.map((v, i) => {
    const detail = performing ? speechDetailForTrack(piece, piece.tracks.find((t) => t.id === v.id), beat) : null;
    if (still || !performing || k === 0 || k >= n - 1) {
      const wavePhase = (((beat - i * 0.18) % 4) + 4) % 4;
      const hop = !still && performing && k > 0 && wavePhase < 0.5 ? Math.sin((Math.PI * wavePhase) / 0.5) * 0.45 : 0;
      return {
        x: home[i],
        depth: k > 0 ? 0.04 : 0.16,
        face: 1,
        hop,
        lean: 0,
        walking: false,
        bubble: detail?.text ?? null,
      };
    }
    const fPos = featIdx.indexOf(i);
    if (fPos >= 0) {
      const center = studio404 ? 0.4 : 0.5;
      const gap = Math.min(0.17, 0.56 / k);
      const x = k === 1 ? center : center - (gap * (k - 1)) / 2 + gap * fPos;
      const face = k === 2 ? (fPos === 0 ? 1 : -1) : 1;
      return {
        x,
        depth: 0,
        face,
        hop: 0,
        lean: face * 2.4,
        walking: false,
        bubble: detail?.text ?? null,
      };
    }
    return {
      x: home[i],
      depth: 0.64,
      face: home[i] < 0.4 ? 1 : -1,
      hop: 0,
      lean: 0,
      walking: false,
      bubble: detail?.text ?? null,
    };
  });
}

function gestureNow(piece: Piece, id: string, beat: number): GesturePose | null {
  let g: GesturePose | null = null;
  const bs = beatSeconds(piece);
  for (const c of cuesFor(piece)) {
    if (c.who !== id || c.beat > beat) continue;
    g = gestureAt(c.gesture, (beat - c.beat) * bs) ?? g;
  }
  return g;
}

// ───────────────────── Band Member Sampler (Grounded Upstage Riser) ─────────────────────

function latestBandNote(notes: readonly BandNote[] | undefined, beat: number, midis?: readonly number[]): BandNote | null {
  if (!notes?.length) return null;
  let best: BandNote | null = null;
  for (const n of notes) {
    if (n.beat > beat + 1e-4) continue;
    if (midis && !midis.includes(n.midi)) continue;
    if (!best || n.beat > best.beat || (n.beat === best.beat && n.vel > best.vel)) best = n;
  }
  return best;
}

function sampleBandState(parts: readonly BandPart[], beat: number, dancing: boolean, bpm: number) {
  if (!dancing || parts.length === 0) {
    return {
      thrum: { pose: null as BandPose | null, play: 0, flip: 1 },
      clacker: { pose: null as BandPose | null, play: 0, flip: 1 },
      rattle: { pose: null as BandPose | null, play: 0, flip: 1 },
    };
  }
  const secPerBeat = 60 / Math.max(30, bpm);

  const bassNotes = parts.find((p) => p.id === "bass")?.notes;
  const lastBass = latestBandNote(bassNotes, beat);
  const thrum = (() => {
    if (!lastBass) return { pose: null, play: 0, flip: 1 };
    const age = (beat - lastBass.beat) * secPerBeat;
    const sc = 0.55 + 0.55 * (lastBass.vel / 127);
    const flip = Math.floor(lastBass.beat) % 2 === 0 ? 1 : -1;
    const p = bandPoseAt("thrum-pluck", age, sc);
    const active = beat < lastBass.beat + Math.min(lastBass.beats, 0.45) ? 1 : 0;
    return { pose: p, play: p ? Math.max(active, 0.75) : active, flip };
  })();

  const keyNotes = parts.find((p) => p.id === "keys")?.notes;
  const lastKey = latestBandNote(keyNotes, beat);
  const soundingKeys = keyNotes?.some((n) => beat >= n.beat && beat < n.beat + n.beats) ?? false;
  const clacker = (() => {
    if (!lastKey) return { pose: null, play: 0, flip: 1 };
    const age = (beat - lastKey.beat) * secPerBeat;
    const sc = 0.5 + 0.55 * (lastKey.vel / 127);
    const flip = Math.floor(lastKey.beat) % 2 === 0 ? 1 : -1;
    const p = bandPoseAt("clacker-play", age, sc);
    return { pose: p, play: soundingKeys ? 1 : p ? 0.65 : 0, flip };
  })();

  const drumNotes = parts.find((p) => p.id === "drums")?.notes;
  const noDrums = parts.some((p) => p.notes.length > 0) && (!drumNotes || drumNotes.length === 0);
  const rattle = (() => {
    if (noDrums) {
      const p = bandPoseAt("rattle-beatbox", beat * secPerBeat, 0.9, true);
      return { pose: p, play: Math.floor(beat * 2) % 2 === 0 ? 0.35 : 0, flip: 1 };
    }
    const candidates: { clip: BandClipName; note: BandNote | null }[] = [
      { clip: "rattle-crash", note: latestBandNote(drumNotes, beat, [CRASH]) },
      { clip: "rattle-snare", note: latestBandNote(drumNotes, beat, [SNARE]) },
      { clip: "rattle-kick", note: latestBandNote(drumNotes, beat, [KICK]) },
      { clip: "rattle-hat", note: latestBandNote(drumNotes, beat, [HAT, OPEN_HAT]) },
    ];
    for (const c of candidates) {
      if (!c.note) continue;
      const age = (beat - c.note.beat) * secPerBeat;
      const sc = 0.55 + 0.55 * (c.note.vel / 127);
      const p = bandPoseAt(c.clip, age, sc);
      if (p) return { pose: p, play: age < 0.22 ? 1 : 0.45, flip: 1 };
    }
    return { pose: null, play: 0, flip: 1 };
  })();

  return { thrum, clacker, rattle };
}

// ───────────────────── KaraokeFillSync + GlassPill + VoiceWaveform Speech Capsule ─────────────────────

const KaraokeWordView: React.FC<{
  word: KaraokeWordSpan;
  beat: number;
  accent: string;
  fg: string;
}> = ({ word, beat, accent, fg }) => {
  const span = Math.max(0.06, word.endBeat - word.startBeat);
  const p = clamp01((beat - word.startBeat) / span);
  const feather = 7;
  const edge = p * (100 + feather * 2) - feather;
  const mask = `linear-gradient(90deg, #000 ${(edge - feather).toFixed(1)}%, transparent ${(edge + feather).toFixed(1)}%)`;

  // After finishing, settle smoothly from bright accent to primary cream ink over 0.35 beats (KaraokeFillSync.tsx L47)
  const settle = clamp01((beat - word.endBeat) / 0.35);
  const fillRgb = rgbMix(hexRgb(accent), hexRgb(fg), settle);

  // Reading-finger bar retracts left-to-right over 0.14 beats once the word completes (KaraokeFillSync.tsx L50)
  const retract = clamp01((beat - word.endBeat) / 0.14);
  const showFinger = p > 0.03 && retract < 1;

  return (
    <>
      <span className="sc-kword">
        <span className="sc-kword-dim">{word.text}</span>
        {p > 0.001 && (
          <span
            className="sc-kword-lit"
            aria-hidden="true"
            style={{
              color: fillRgb,
              WebkitMaskImage: p >= 0.999 ? undefined : mask,
              maskImage: p >= 0.999 ? undefined : mask,
              textShadow: settle < 0.9 ? `0 0 18px ${accent}55` : undefined,
            }}
          >
            {word.text}
          </span>
        )}
        {showFinger && (
          <span
            className="sc-kword-finger"
            aria-hidden="true"
            style={{
              left: `${(retract * p * 100).toFixed(1)}%`,
              width: `${(Math.max(0, p - retract * p) * 100).toFixed(1)}%`,
              background: accent,
              boxShadow: `0 2px 12px ${accent}88`,
            }}
          />
        )}
      </span>{" "}
    </>
  );
};

const ShotcraftSpeechCapsule: React.FC<{
  capsule: PlacedSpeechCapsule;
  beat: number;
  timeSec: number;
  bgOverride?: string;
  fgOverride?: string;
  showTail?: boolean;
}> = ({ capsule, beat, timeSec, bgOverride, fgOverride, showTail = true }) => {
  const { speaker, roleLabel, accent, words, startBeat, endBeat, centerX, anchorX, topY, maxWidthPct, level, singing } = capsule;
  const fg = fgOverride ?? "#f8efe2";
  const lineProgress = clamp01((beat - startBeat) / Math.max(0.25, endBeat - startBeat));
  const activeEnergy = singing ? Math.max(0.32, level) : 0.08;

  // Entrance & exit opacity/scale (GlassPillDictationTyping snappy land)
  const enterT = clamp01((beat - (startBeat - 0.12)) / 0.22);
  const exitT = clamp01((beat - (endBeat + 0.18)) / 0.2);
  const vis = clamp01(enterT * (1 - exitT));
  const pillScale = mix(1.04, 1, enterT);

  // 18-bar scrolling voice waveform (VoiceWaveformLive.tsx L92-98)
  const N_BARS = 18;
  const bars = Array.from({ length: N_BARS }, (_, i) => {
    const u = i / (N_BARS - 1);
    const sampleT = timeSec * 14 - (N_BARS - 1 - i) * 0.55;
    const center = Math.pow(Math.sin(u * Math.PI), 0.8);
    const jitter = 0.35 + 0.65 * noiseAt(sampleT + i * 0.17);
    const quiet = activeEnergy < 0.12;
    const hPct = quiet ? 16 : clamp(16 + activeEnergy * center * jitter * 84, 16, 100);
    const played = u <= clamp(lineProgress, 0.15, 1);
    return { hPct, played, quiet };
  });

  // Pointer tail offset within capsule
  // The tail points at the speaker: the stage offset as a share of the bubble's width.
  const deltaPct = clamp(((anchorX - centerX) / Math.max(0.2, maxWidthPct / 100)) * 100, -44, 44);

  return (
    <div
      className="sc-capsule-wrap"
      style={{
        left: `${(centerX * 100).toFixed(2)}%`,
        top: `${(topY * 100).toFixed(2)}%`,
        maxWidth: `${maxWidthPct}%`,
        opacity: vis,
        transform: `translate(-50%, 0) scale(${pillScale.toFixed(3)})`,
      }}
    >
      <div
        className="sc-capsule"
        style={{
          background: bgOverride ?? "linear-gradient(180deg, rgba(38, 24, 28, 0.86) 0%, rgba(16, 10, 13, 0.92) 100%)",
          boxShadow: `inset 0 1.5px 0 rgba(255,255,255,0.26), inset 0 -12px 26px rgba(0,0,0,0.34), 0 6px 16px rgba(5,1,2,0.45), 0 24px 48px -14px rgba(5,1,2,0.76), 0 0 36px -10px ${accent}44`,
        }}
      >
        {/* Internal directional glow (GlassPillDictationTyping) */}
        <div
          className="sc-capsule-glow"
          style={{
            background: `radial-gradient(ellipse 58% 120% at 18% 0%, ${accent}2e 0%, transparent 72%)`,
            opacity: 0.55 + 0.45 * activeEnergy,
          }}
        />
        <div className="sc-capsule-rim" />

        <div className="sc-capsule-head">
          <span
            className="sc-capsule-dot"
            style={{
              background: accent,
              boxShadow: `0 0 0 ${(2 + 4 * activeEnergy).toFixed(1)}px ${accent}33, 0 0 10px ${accent}`,
            }}
          />
          <span className="sc-capsule-speaker" style={{ color: accent }}>
            {speaker}
          </span>
          <span className="sc-capsule-role">{roleLabel}</span>
          <span className="sc-capsule-wave" aria-hidden="true">
            {bars.map((b, idx) => (
              <i
                key={idx}
                style={{
                  height: `${b.hPct.toFixed(0)}%`,
                  background: b.quiet
                    ? "rgba(248,239,226,0.24)"
                    : b.played
                      ? accent
                      : "rgba(248,239,226,0.22)",
                }}
              />
            ))}
          </span>
        </div>

        <div className="sc-capsule-words" style={{ color: fg }}>
          {words.map((w, wi) => (
            <KaraokeWordView key={`${w.text}-${wi}`} word={w} beat={beat} accent={accent} fg={fg} />
          ))}
        </div>
      </div>

      {showTail && (
        <svg
          className="sc-capsule-tail"
          viewBox="0 0 36 18"
          style={{ left: `calc(50% + ${deltaPct.toFixed(1)}%)` }}
          aria-hidden="true"
        >
          <path d="M3,0 L18,16 L33,0 Z" fill="rgba(16, 10, 13, 0.92)" stroke="rgba(255,238,218,0.25)" strokeWidth="1.5" />
          <rect x="5" y="0" width="26" height="2.5" fill="rgba(16, 10, 13, 0.95)" />
        </svg>
      )}
    </div>
  );
};

// ───────────────────── Main Unified ShotcraftStage Component ─────────────────────

export const ShotcraftStage: React.FC<ShotcraftStageProps> = ({
  piece,
  voices,
  studio404,
  beat,
  timeSec,
  performing,
  dancing,
  still = false,
  selectedIndex = 0,
  cameraFollow = true,
  actors: liveActors,
  poses: livePoses,
  liveMidiSpeech = null,
  customBubbles,
  bandParts: externalBandParts,
  onSelectActor,
  renderPropFx,
  padGesture,
  puppetRef,
  resolveAsset = (p) => p,
  interactive,
  neonLens: controlledNeonLens,
  onNeonLensChange,
  showInternalLensBar = true,
  neonFmvManifest = null,
  renderCharacterOverride,
}) => {
  const onstageVoiceIds = useMemo(
    () => (piece.stage ? voices.map((v) => v.id).filter((id) => piece.stage!.includes(id)) : voices.map((v) => v.id)),
    [piece.stage, voices],
  );
  const isSoloStage = onstageVoiceIds.length === 1;
  const soloVoiceId = isSoloStage ? onstageVoiceIds[0] : null;
  const isNeonTakeTwo = soloVoiceId === "vee" && piece.title === "Take Two";
  const [userWorldChoice, setUserWorldChoice] = useState<{ title: string; lens: WorldLens } | null>(null);
  const defaultLens: WorldLens = isNeonTakeTwo ? "diorama" : "archive";
  const activeLens = controlledNeonLens ?? (userWorldChoice?.title === piece.title ? userWorldChoice.lens : defaultLens);
  const setWorldLens = (next: WorldLens) => {
    setUserWorldChoice({ title: piece.title, lens: next });
    onNeonLensChange?.(next);
  };
  const isInteractive = interactive ?? Boolean(onSelectActor);
  const poses = livePoses ?? deterministicPoses(piece, voices, beat, performing);

  const onstageArtKeys = useMemo(
    () =>
      voices
        .filter((v) => onstageVoiceIds.includes(v.id))
        .map((v) => resolvePerformerIdentity(v, studio404, piece.title).artKey),
    [voices, onstageVoiceIds, studio404, piece.title],
  );
  const fmvOverrides = useMemo(
    () => (neonFmvManifest ? { neon: neonFmvManifest } : undefined),
    [neonFmvManifest],
  );
  const castFmvManifests = useCastFmvManifests(onstageArtKeys, resolveAsset, fmvOverrides);

  const soloArt = studio404 && soloVoiceId ? STUDIO_404_CAST[soloVoiceId]?.artKey : undefined;
  const soloSet = soloArt ? soloSets.find(set => set.art === soloArt) : undefined;
  const workshopArt = soloArt && Object.hasOwn(workshopSongs,soloArt) && workshopSongs[soloArt as WorkshopSinger] === piece.title ? soloArt as WorkshopSinger : null;
  const workshop = workshopArt ? workshopTake(workshopArt, piece.tracks.find(t=>t.id===soloVoiceId),performing ? beat : 0,still) : null;
  const cueAndNeon = studio404 && piece.title === "Right on Cue";
  const onCart = soloSet?.art === "zap";
  const inRepairBay = soloSet?.art === "neon" && piece.title === "Take Two";
  const neonCues = useMemo(()=>inRepairBay ? neonScore(piece) : null,[inRepairBay,piece]);
  const neon = neonCues ? neonTake(neonCues,beat,performing,still) : null;
  const onValveBench = soloSet?.art === "gruff";
  const cartFrame = zapFrame(performing && !still ? beat : 0);
  const cueSolo = soloSet?.art==="cue" && piece.title==="Line?";
  const cord = performing && !still ? cordExposure(piece,beat) : null;
  const bowStart = piece.title==="Ribbon and Felt" ? piece.sections?.find(s=>s.name==="curtain call")?.beat : undefined;
  const tabbyBow = performing && bowStart!==undefined && beat>=bowStart && beat<bowStart+8;
  const directing = onCart && piece.title === "Every Button";
  const cuts = useMemo(() => directing ? zapCues(piece) : null, [piece, directing]);
  const take = cuts ? zapTake(cuts, performing ? beat : -2) : null;
  const crt = cartFrame >= 50 && cartFrame < 86 ? "bars" : cartFrame >= 39 && cartFrame < 50 ? "playing" : null;

  // Remap actor X range in Studio 404 mode so the 8 singers fill [0.11..0.68] cleanly and leave stage right clear for Tracking & Hertz,
  // or center cleanly when a solo song clears the stage (`stage: tabby`)
  const rawActors = liveActors ?? deterministicActors(piece, voices, beat, performing, studio404, still);
  const actors = useMemo(() => {
    if (cueAndNeon) {
      const entrance = piece.sections?.find(s => s.name === "step inside")?.beat ?? 20;
      const travel = performing && !still ? clamp01((beat - entrance - 4) / 3) : 0;
      return rawActors.map((a, i) => ({
        ...a, x: voices[i]?.id === "vee" ? 0.29 + travel * 0.08 : 0.69, depth: 0, lean: 0, hop: 0,
      }));
    }
    if (isSoloStage) {
      return rawActors.map((a, idx) => {
        if (voices[idx]?.id !== soloVoiceId) return a;
        const stepX = !still && dancing ? Math.sin(beat * 0.45) * 0.045 : 0;
        return {
          ...a,
          x: 0.5 + stepX,
          depth: 0,
          face: 1,
          walking: !still && dancing && Math.abs(Math.cos(beat * 0.45)) > 0.45,
        };
      });
    }
    if (!studio404 || !liveActors) return rawActors;
    return rawActors.map((a) => ({
      ...a,
      x: 0.11 + clamp01((a.x - 0.09) / 0.82) * 0.57, // Keep Neon inside the camera crop and Tracking clear at stage right.
    }));
  }, [cueAndNeon, piece.sections, performing, rawActors, liveActors, studio404, isSoloStage, voices, soloVoiceId, still, dancing, beat]);

  const showBand = piece.stage ? piece.stage.includes("band") : (piece.kind !== "skit" && piece.chords.length > 0);
  const computedBandParts = useMemo(
    () => externalBandParts ?? (showBand ? bandFor(piece) : []),
    [externalBandParts, showBand, piece],
  );
  const bandState = sampleBandState(computedBandParts, beat, dancing, piece.bpm);
  const showCritics = !piece.stage || piece.stage.some((id) => id === "critics" || id === "tracking" || id === "hertz");
  const duet = studio404 && showCritics ? duetCriticsStateAt(beat, dancing, still) : null;

  // Narrative set-pieces for "The Neon Playbook" (aesthetic-rules R4: <= 3 controlled stage moments, zero beat-shake)
  const isNeonPlaybook = piece.title === "The Neon Playbook";
  const isBlackout = isNeonPlaybook && performing && beat >= 42 && beat < 44;
  const isVhsRoll = isNeonPlaybook && performing && beat >= 94.4 && beat < 97.4;
  const isFinaleGlow = isNeonPlaybook && performing && beat >= 101.5;

  const blackoutAmt = isBlackout
    ? clamp01(Math.min((beat - 42) * 8, (44 - beat) * 8))
    : 0;
  const postBlackoutFlash = isNeonPlaybook && performing && beat >= 44 && beat < 44.6
    ? tungstenFlicker((beat - 44) * beatSeconds(piece))
    : 1;
  const startFlicker = performing ? tungstenFlicker(Math.max(0, timeSec - 0.05)) : 1;
  const lampOn = startFlicker * postBlackoutFlash * (1 - blackoutAmt * 0.92);

  // Determine featured / spotlight targets
  const ids = voices.map((v) => v.id);
  const featuredFlags = !performing
    ? ids.map((_, idx) => Boolean(liveMidiSpeech && voices[idx]?.id === liveMidiSpeech.voiceId))
    : piece.scenes
      ? sceneFeatured(piece.scenes, ids, beat)
      : featuredAt(piece.tracks, ids, beat);

  const singingIndices = poses.map((p, i) => (p.singing || featuredFlags[i] ? i : -1)).filter((i) => i >= 0);

  // Build active spotlights in 1920x1080 virtual stage coordinates
  const spots = useMemo(() => {
    if (!performing && liveMidiSpeech) {
      const idx = Math.max(0, voices.findIndex((v) => v.id === liveMidiSpeech.voiceId));
      const ax = actors[idx]?.x ?? 0.45;
      const color = studio404 ? (STUDIO_404_CAST[voices[idx]?.id ?? "vee"]?.color ?? "#57d3e8") : (voices[idx]?.color ?? "#57d3e8");
      return [{ x: ax * 1920, y: 590, rx: 390, ry: 380, color, intensity: 1 }];
    }
    if (!performing) {
      if (isSoloStage) {
        const idx = Math.max(0, voices.findIndex((v) => v.id === soloVoiceId));
        const sx = (actors[idx]?.x ?? 0.5) * 1920;
        const c = studio404 ? (STUDIO_404_CAST[soloVoiceId!]?.color ?? "#3fbfa0") : (voices[idx]?.color ?? "#ffe6c2");
        return [{ x: sx, y: 585, rx: 430, ry: 410, color: c, intensity: 0.94 }];
      }
      // Gentle damped stage rehearsal sweep (SpotlightSweepReveal pendulum feel)
      const u = Math.sin(timeSec * 0.55) * 0.26;
      const sx = (0.45 + u) * 1920;
      const sy = 575 - 38 * u * u;
      return [{ x: sx, y: sy, rx: 480, ry: 420, color: "#ffe6c2", intensity: 0.78 }];
    }
    if (singingIndices.length === 0) {
      if (isSoloStage) {
        const idx = Math.max(0, voices.findIndex((v) => v.id === soloVoiceId));
        const sx = (actors[idx]?.x ?? 0.5) * 1920;
        const c = studio404 ? (STUDIO_404_CAST[soloVoiceId!]?.color ?? "#3fbfa0") : (voices[idx]?.color ?? "#ffe6c2");
        return [{ x: sx, y: 585, rx: 430, ry: 410, color: c, intensity: 0.88 }];
      }
      return [{ x: 880, y: 580, rx: 520, ry: 420, color: "#ffe6c2", intensity: 0.62 }];
    }
    if (singingIndices.length >= 3 || isFinaleGlow) {
      // Iris opens wide across the whole choir (SpotlightSweepReveal IRIS_END)
      return [
        {
          x: 880,
          y: 575,
          rx: isFinaleGlow ? 1140 : 980,
          ry: isFinaleGlow ? 560 : 490,
          color: isFinaleGlow ? "#ffd996" : "#ffe6c2",
          intensity: isFinaleGlow ? 1.12 : 0.94,
        },
      ];
    }
    return singingIndices.slice(0, 2).map((idx) => {
      const v = voices[idx];
      const ax = actors[idx]?.x ?? 0.45;
      const c = studio404 ? (STUDIO_404_CAST[v.id]?.color ?? v.color) : v.color;
      return {
        x: ax * 1920,
        y: 590,
        rx: singingIndices.length === 1 ? 410 : 350,
        ry: 390,
        color: c,
        intensity: 1,
      };
    });
  }, [performing, liveMidiSpeech, voices, actors, studio404, timeSec, singingIndices, isFinaleGlow, isSoloStage, soloVoiceId]);

  // Velvet curtain radial mask string (SpotlightSweepReveal.tsx L104)
  const curtainMask = spots
    .map(
      (s) =>
        `radial-gradient(ellipse ${((s.rx / 1920) * 100).toFixed(2)}% ${((s.ry / 1080) * 100).toFixed(2)}% at ${((s.x / 1920) * 100).toFixed(2)}% ${((s.y / 1080) * 100).toFixed(2)}%, rgba(0,0,0,${Math.min(1, 0.96 * s.intensity).toFixed(2)}) 0%, rgba(0,0,0,${(0.75 * s.intensity).toFixed(2)}) 44%, rgba(0,0,0,${(0.28 * s.intensity).toFixed(2)}) 72%, transparent 100%)`,
    )
    .join(", ");

  // Subtle 2.5D stage framing toward solo/duet singer or active MIDI Moppet (R4 compliant: smooth, zero beat-shake)
  const framing = useMemo(() => {
    if (cueAndNeon || soloSet || !cameraFollow || still) return { zoom: 1, focusX: 0.5 };
    if (!performing && liveMidiSpeech) {
      const idx = Math.max(0, voices.findIndex((v) => v.id === liveMidiSpeech.voiceId));
      return { zoom: 1.035, focusX: clamp(actors[idx]?.x ?? 0.45, 0.25, 0.72) };
    }
    if (performing && singingIndices.length >= 1 && singingIndices.length <= 2) {
      const avgX = singingIndices.reduce((s, idx) => s + (actors[idx]?.x ?? 0.45), 0) / singingIndices.length;
      return { zoom: 1.04, focusX: clamp(avgX, 0.25, 0.72) };
    }
    return { zoom: 1, focusX: 0.5 };
  }, [cueAndNeon, soloSet, cameraFollow, still, performing, liveMidiSpeech, voices, actors, singingIndices]);

  const maxShiftPct = (framing.zoom - 1) * 46;
  const stageShiftXPct = clamp(-(framing.focusX - 0.5) * 100 * framing.zoom, -maxShiftPct, maxShiftPct);

  // Build speech capsules (either from custom VideoStudio clips or live score/MIDI/chatter)
  const placedCapsules = useMemo<
    { capsule: PlacedSpeechCapsule; bg?: string; fg?: string; showTail: boolean }[]
  >(() => {
    const bs = beatSeconds(piece);
    if (customBubbles) {
      const active = customBubbles.filter((b) => timeSec >= b.startSec && timeSec < b.startSec + b.durationSec);
      return active.map((b) => {
        const startBeat = (b.startSec - LEAD_IN) / bs;
        const endBeat = (b.startSec + b.durationSec - LEAD_IN) / bs;
        const words: KaraokeWordSpan[] = b.words?.length
          ? b.words.map((w) => ({
              text: w.text,
              startBeat: (w.startSec - LEAD_IN) / bs,
              endBeat: (w.endSec - LEAD_IN) / bs,
            }))
          : mapSkitWords(b.text, startBeat, endBeat);
        const isLegacyCream = b.bg.toLowerCase() === "#f6ecd2";
        return {
          capsule: {
            key: b.id,
            speaker: b.speaker.toUpperCase(),
            roleLabel: "CAPTION",
            accent: b.color || "#57d3e8",
            text: b.text,
            words,
            startBeat,
            endBeat,
            centerX: clamp(b.x, 0.24, 0.76),
            anchorX: clamp(b.x, 0.14, 0.86),
            topY: clamp(b.y, 0.06, 0.34),
            maxWidthPct: 48,
            level: 0.68,
            singing: true,
            count: 1,
          },
          bg: isLegacyCream ? undefined : b.bg,
          fg: isLegacyCream ? "#f8efe2" : b.fg,
          showTail: b.tail !== "none",
        };
      });
    }

    if (!performing && liveMidiSpeech && liveMidiSpeech.text.trim()) {
      const idx = Math.max(0, voices.findIndex((v) => v.id === liveMidiSpeech.voiceId));
      const v = voices[idx] ?? voices[0];
      const name = studio404 ? studio404Name(v.id, v.name) : v.name;
      const accent = studio404 ? (STUDIO_404_CAST[v.id]?.color ?? v.color) : v.color;
      const ax = actors[idx]?.x ?? 0.45;
      const words = mapSkitWords(liveMidiSpeech.text, beat - 0.15, beat + 0.35);
      return [
        {
          capsule: {
            key: `midi-${v.id}`,
            speaker: name.toUpperCase(),
            roleLabel: liveMidiSpeech.roleLabel ?? "LIVE MIDI",
            accent,
            text: liveMidiSpeech.text,
            words,
            startBeat: beat - 0.2,
            endBeat: beat + 0.8,
            centerX: clamp(ax, 0.26, 0.74),
            anchorX: ax,
            topY: 0.085,
            maxWidthPct: 48,
            level: Math.max(0.4, liveMidiSpeech.level),
            singing: true,
            count: 1,
          },
          showTail: true,
        },
      ];
    }

    const inputs: StageCapsuleInput[] = voices.map((v, i) => {
      const offstage = piece.stage && !piece.stage.includes(v.id);
      if (offstage) {
        return {
          id: v.id,
          name: studio404 ? studio404Name(v.id, v.name) : v.name,
          color: studio404 ? (STUDIO_404_CAST[v.id]?.color ?? v.color) : v.color,
          x: actors[i]?.x ?? 0.5,
          level: 0,
          singing: false,
          bubbleText: null,
          detail: null,
        };
      }
      const detail = performing ? speechDetailForTrack(piece, piece.tracks.find((t) => t.id === v.id), beat) : null;
      const wanderBubble = !performing ? (actors[i]?.bubble ?? null) : null;
      return {
        id: v.id,
        name: (studio404 ? studio404Name(v.id, v.name) : v.name).toUpperCase(),
        color: studio404 ? (STUDIO_404_CAST[v.id]?.color ?? v.color) : v.color,
        x: actors[i]?.x ?? 0.5,
        level: poses[i]?.level ?? 0,
        singing: Boolean(poses[i]?.singing || wanderBubble),
        bubbleText: detail?.text ?? wanderBubble,
        detail,
      };
    });

    return layoutStageCapsules(inputs, beat).map((capsule) => ({ capsule, showTail: true }));
  }, [customBubbles, performing, liveMidiSpeech, voices, studio404, actors, piece, beat, poses, timeSec]);

  const breathe = still ? 1 : 1 + 0.025 * Math.sin(timeSec * 1.6);
  const vhsOffsetY = isVhsRoll && !still ? Math.sin(timeSec * 22) * 1.4 : 0;

  // S-29 / S-30: Polymorphic 8-world stage works for EVERY song & cast (zero hardcoded Neon paths!)
  if (activeLens !== "archive") {
    return (
      <WorldsStage
        piece={piece}
        voices={voices}
        poses={poses}
        studio404={studio404}
        beat={beat}
        timeSec={timeSec}
        performing={performing}
        still={still}
        selectedIndex={selectedIndex}
        lens={activeLens}
        onSelectLens={isInteractive && showInternalLensBar ? setWorldLens : undefined}
        interactive={isInteractive}
        resolveAsset={resolveAsset}
        fmvManifests={castFmvManifests}
      />
    );
  }

  return (
    <div data-duet={cueAndNeon || undefined} data-solo-set={soloSet?.art} className={`sc-stage${studio404 ? " studio404" : ""}${isBlackout ? " blackout" : ""}`}>
      {isInteractive && showInternalLensBar && (
        <div className="nw-archive-return" data-layout="overlay">
          <div className="nw-lens-dock" role="tablist" aria-label="Performance world lens">
            {WORLD_LENSES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={activeLens === item.id}
                className={`nw-lens-pill${activeLens === item.id ? " active" : ""}`}
                onClick={() => setWorldLens(item.id)}
                title={item.tagline}
              >
                {item.shortLabel}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Framed 2.5D stage plane */}
      <div
        className="sc-plane"
        style={{
          transformOrigin: neon?.detail && cameraFollow ? "40% 84%" : undefined,
          transform: neon?.detail && cameraFollow
            ? `translate(${neon.detail*8}%, ${-neon.detail*16}%) scale(${1+neon.detail*1.45})`
            : framing.zoom === 1 && vhsOffsetY === 0
              ? undefined
              : `translate(${stageShiftXPct.toFixed(2)}%, ${vhsOffsetY.toFixed(2)}%) scale(${framing.zoom.toFixed(3)})`,
        }}
      >
        {cueAndNeon && <div className="sc-solo-setting" data-layout="overlay" aria-hidden="true"
          style={{ backgroundImage: `url("${resolveAsset("/rehearsal/sets/right-on-cue.webp")}")` }} />}
        {soloSet && <div className="sc-solo-setting" aria-hidden="true" data-layout="overlay"
          style={{ backgroundImage: `url("${resolveAsset(`/rehearsal/sets/${neon ? "neon-repair" : onValveBench ? "gruff-bench" : soloSet.art}.webp`)}")` }}>
          {soloSet.art === "cue" && piece.title === "Line?" && <CuePromptStand resolveAsset={resolveAsset} piece={piece} beat={performing ? beat : 0} />}
          {neon && <RepairBayLights take={neon} />}
          {take && <ZapTelevision take={take} still={still} resolveAsset={resolveAsset} />}
          {onCart && !take && crt && <img className="sc-cart-crt" src={resolveAsset(`/rehearsal/sets/zap-crt-${crt}.webp`)} alt="" />}
        </div>}
        {/* 1. Far Plane: Unlit Pleated Curtain */}
        <div
          className="sc-curtain-base"
          data-layout="overlay"
          style={{
            backgroundImage: studio404 ? VELVET_CURTAIN_IMAGE : WORKSHOP_CURTAIN_IMAGE,
            opacity: isBlackout ? 0.07 : 0.18,
          }}
        />

        {/* 2. Lit Pleated Curtain Revealed Inside Spotlight Masks (SpotlightSweepReveal.tsx) */}
        <div
          className="sc-curtain-lit"
          data-layout="overlay"
          style={{
            backgroundImage: studio404 ? VELVET_CURTAIN_IMAGE : WORKSHOP_CURTAIN_IMAGE,
            opacity: 0.95 * lampOn * breathe,
            WebkitMaskImage: curtainMask,
            maskImage: curtainMask,
          }}
        >
          <div
            className="sc-curtain-tint"
            style={{
              background: isFinaleGlow ? "rgba(255, 206, 128, 0.16)" : "rgba(255, 154, 106, 0.09)",
            }}
          />
        </div>

        {/* 3. Proscenium Valance Wire & Warm Tungsten Bulbs */}
        <svg className="sc-svg-layer" viewBox="0 0 1920 1080" preserveAspectRatio="none" data-layout="overlay" aria-hidden="true">
          <path d="M 36,16 Q 960,86 1884,16" fill="none" stroke="rgba(227,189,127,0.36)" strokeWidth="2" />
          {[180, 400, 630, 850, 1070, 1290, 1520, 1740].map((bx, idx) => {
            const u = (bx - 36) / 1848;
            const by = 16 + 4 * 70 * u * (1 - u) * 0.5;
            const bulbGlow = lampOn * (0.78 + (still ? 0 : 0.22 * Math.sin(timeSec * 2.6 + idx)));
            return (
              <g key={bx} opacity={bulbGlow}>
                <circle cx={bx} cy={by} r={16} fill="rgba(255,224,170,0.20)" />
                <circle cx={bx} cy={by} r={5.2} fill={idx % 2 === 0 ? "#ffe6c2" : "#e3bd7f"} />
              </g>
            );
          })}
        </svg>

        {/* 4. Grounded Upstage Timber Riser & 3-Piece Backing Band (Thrum, Clacker, Rattle) */}
        {showBand && (
          <div className="sc-band-riser" data-layout="overlay" aria-hidden="true" style={{ opacity: isBlackout ? 0.18 : 0.84 }}>
            <div className="sc-riser-deck" />
            <div className="sc-band-members">
              {(
                [
                  { key: "thrum", state: bandState.thrum },
                  { key: "clacker", state: bandState.clacker },
                  { key: "rattle", state: bandState.rattle },
                ] as const
              ).map(({ key, state }) => {
                const p = state.pose;
                const tx = (p?.dx ?? 0) * 100 * state.flip;
                const ty = (p?.dy ?? 0) * 100;
                const sx = p?.sx ?? 1;
                const sy = p?.sy ?? 1;
                const rot = (p?.rot ?? 0) * state.flip;
                const isHit = state.play > 0.22;
                const restUrl = studio404 && key === "rattle" ? "/rehearsal/band/click-rest.webp" : `/moppets/band/${key}-rest.webp`;
                const playUrl = studio404 && key === "rattle" ? "/rehearsal/band/click-play.webp" : `/moppets/band/${key}-play.webp`;
                return (
                  <div
                    key={key}
                    className={`sc-band-member${state.play > 0.15 ? " hit" : ""}`}
                    style={{
                      transform: `translate(${tx.toFixed(1)}%, ${ty.toFixed(1)}%) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) rotate(${rot.toFixed(2)}deg)`,
                    }}
                  >
                    <span
                      className="sc-band-sprite"
                      style={{ backgroundImage: `url(${resolveAsset(restUrl)})`, visibility: isHit ? "hidden" : "visible" }}
                    />
                    <span
                      className="sc-band-sprite play"
                      style={{ backgroundImage: `url(${resolveAsset(playUrl)})`, visibility: isHit ? "visible" : "hidden" }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 5. Near Plane: Dark Timber Stage Apron + 2px Specular Lip + Floor Light Pools */}
        <div className="sc-floor" data-layout="overlay" aria-hidden="true" />
        <div
          className="sc-floor-lip"
          data-layout="overlay"
          aria-hidden="true"
          style={{ opacity: 0.35 + 0.65 * lampOn }}
        />
        <div
          className="sc-floor-pools"
          data-layout="overlay"
          aria-hidden="true"
          style={{
            opacity: lampOn,
            backgroundImage: spots
              .map((s) => {
                const [r, g, b] = hexRgb(s.color);
                const mr = Math.round(255 * 0.68 + r * 0.32);
                const mg = Math.round(230 * 0.68 + g * 0.32);
                const mb = Math.round(194 * 0.68 + b * 0.32);
                return `radial-gradient(ellipse ${((s.rx * 0.85) / 19.2).toFixed(1)}% 6.8% at ${(s.x / 19.2).toFixed(2)}% 83.2%, rgba(${mr},${mg},${mb},${(0.28 * s.intensity).toFixed(3)}) 0%, rgba(${mr},${mg},${mb},0.06) 55%, transparent 100%)`;
              })
              .join(", "),
          }}
        />

        {/* 6. Blackout Emissive Glow Pools (Neon's Dual Tubes & Watt's Red Switch Shine in the Dark) */}
        {blackoutAmt > 0.02 && (
          <div
            className="sc-emissive-dark"
            data-layout="overlay"
            aria-hidden="true"
            style={{
              opacity: blackoutAmt,
              backgroundImage: voices
                .map((v, idx) => {
                  if (v.id !== "vee" && v.id !== "pip") return null;
                  const ax = (actors[idx]?.x ?? 0.45) * 100;
                  return v.id === "vee"
                    ? `radial-gradient(circle 13% at ${ax.toFixed(1)}% 62%, rgba(87,211,232,0.28) 0%, rgba(255,92,168,0.14) 45%, transparent 76%)`
                    : `radial-gradient(circle 12% at ${ax.toFixed(1)}% 65%, rgba(229,72,58,0.34) 0%, transparent 74%)`;
                })
                .filter(Boolean)
                .join(", "),
            }}
          />
        )}

        {/* 7. Volumetric SVG Tungsten Beams + Clipped Deterministic Dust Motes (SpotlightSweepReveal.tsx) */}
        <svg className="sc-svg-layer sc-beams" viewBox="0 0 1920 1080" preserveAspectRatio="none" data-layout="overlay" aria-hidden="true" style={{ opacity: lampOn }}>
          <defs>
            <linearGradient id="sc-beam-grad" x1="0" y1="0" x2="0" y2="930" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#ffe6c2" stopOpacity="0.28" />
              <stop offset="0.58" stopColor="#ffe6c2" stopOpacity="0.09" />
              <stop offset="1" stopColor="#ffe6c2" stopOpacity="0" />
            </linearGradient>
            <filter id="sc-beam-blur" x="-15%" y="-15%" width="130%" height="130%">
              <feGaussianBlur stdDeviation="18" />
            </filter>
            <clipPath id="sc-beam-clip">
              {spots.map((s, idx) => {
                const lx = mix(960, s.x, 0.55);
                const topHalf = 36;
                const btmHalf = s.rx * 0.88;
                const pts = `${(lx - topHalf).toFixed(1)},0 ${(lx + topHalf).toFixed(1)},0 ${(s.x + btmHalf).toFixed(1)},935 ${(s.x - btmHalf).toFixed(1)},935`;
                return <polygon key={idx} points={pts} />;
              })}
            </clipPath>
          </defs>
          {spots.map((s, idx) => {
            const lx = mix(960, s.x, 0.55);
            const topHalf = 36;
            const btmHalf = s.rx * 0.88;
            const pts = `${(lx - topHalf).toFixed(1)},0 ${(lx + topHalf).toFixed(1)},0 ${(s.x + btmHalf).toFixed(1)},935 ${(s.x - btmHalf).toFixed(1)},935`;
            return (
              <polygon
                key={idx}
                points={pts}
                fill="url(#sc-beam-grad)"
                filter="url(#sc-beam-blur)"
                opacity={spots.length === 1 && s.rx > 800 ? 0.52 : 0.92}
              />
            );
          })}
          <g clipPath="url(#sc-beam-clip)">
            {Array.from({ length: 48 }, (_, i) => {
              const s = spots[i % spots.length];
              const lx = mix(960, s.x, 0.55);
              const u0 = detHash(i);
              const v0 = detHash(i + 100) - 0.5;
              const drift = still ? 0 : ((timeSec * (8 + detHash(i + 200) * 10)) % 100) / 100;
              const uu = (u0 + 1 - drift * 0.35) % 1;
              const yy = mix(42, 895, uu);
              const k = yy / 935;
              const half = mix(36, s.rx * 0.82, k);
              const axisX = mix(lx, s.x, k);
              const xx = clamp(axisX + v0 * half * 1.45 + (still ? 0 : Math.sin(timeSec * 1.3 + i) * 6), 8, 1912);
              const r = 1.1 + detHash(i + 300) * 1.9;
              const tw = still ? 0.7 : 0.35 + 0.65 * Math.abs(Math.sin(timeSec * (1.8 + detHash(i + 400)) + i));
              return <circle key={i} cx={xx} cy={yy} r={r} fill="#ffe6c2" opacity={(0.16 + detHash(i + 500) * 0.38) * tw} />;
            })}
          </g>
        </svg>

        {/* 7b. Standalone Vintage Stage Microphones Set (Ribbon only when solo stage; full 4-mic set for band/ensemble) */}
        {studio404 && (
          <div className="sc-stage-mics" data-layout="overlay" aria-hidden="true">
            {(
              isSoloStage
                ? [{ key: "ribbon", img: "/rehearsal/props/mic-ribbon.webp", className: "sc-mic sc-mic-ribbon", leftOverride: "58.8%" }]
                : [
                    { key: "ribbon", img: "/rehearsal/props/mic-ribbon.webp", className: "sc-mic sc-mic-ribbon", leftOverride: undefined },
                    { key: "boom", img: "/rehearsal/props/mic-boom.webp", className: "sc-mic sc-mic-boom", leftOverride: undefined },
                    { key: "short", img: "/rehearsal/props/mic-short.webp", className: "sc-mic sc-mic-short", leftOverride: undefined },
                    { key: "desk", img: "/rehearsal/props/mic-desk.webp", className: "sc-mic sc-mic-desk", leftOverride: undefined },
                  ]
            ).map(({ key, img, className, leftOverride }) => (
              <div
                key={key}
                className={className}
                style={{
                  ...(leftOverride ? { left: leftOverride } : {}),
                  opacity: isBlackout ? 0.36 : 0.96,
                  filter: `brightness(${(isBlackout ? 0.34 : 0.72 + 0.28 * lampOn).toFixed(2)})`,
                }}
              >
                <span className="sc-mic-shadow" />
                <img src={resolveAsset(img)} alt="" draggable={false} />
              </div>
            ))}
          </div>
        )}

        {/* 8. Tracking & Hertz — Stage-right tape cue and delayed CRT response */}
        {studio404 && duet && (
          <div className="sc-duet-stage" data-layout="layered" aria-label={STUDIO_404_CREW.critics.names}>
            <span className="critic-cable" aria-hidden="true" style={atlasStyle(
              resolveAsset("/rehearsal/rigs/hertz/solo/prop.webp"),
              dancing && !still ? Math.floor(Math.max(0, beat-4)*3)%16 : 0,4,4)}/>
            {(
              [
                { crew: STUDIO_404_CREW.tracking, state: duet.tracking },
                { crew: STUDIO_404_CREW.hertz, state: duet.hertz },
              ] as const
            ).map(({ crew, state }) => {
              // Tracking ejects the tape first. Hertz answers late and the aerial
              // continues through the stop. Both settle before the next exchange.
              const phase = dancing && !still ? (Math.max(0,beat) % 16) : 0;
              const local = Math.max(0, phase - (crew.id === "hertz" ? .65 : 0));
              const action = Math.min(3, Math.floor(local / 4));
              const within = local % 4;
              const gesture = Math.max(0, Math.min(1, within/.9, (4-within)/.85));
              const frame = action*12 + Math.round(gesture*10);
              const cls = `sc-duet-actor has-sing-closed${state.singing ? " singing" : ""}${state.mouthOpen ? " mouth-open" : ""}`;
              return (
                <div
                  key={crew.id}
                  className={cls}
                  data-art-key={crew.id}
                  aria-label={crew.name}
                  style={{
                    opacity: isBlackout ? 0.36 : 0.98,
                    filter: `brightness(${(isBlackout ? 0.34 : state.singing ? 1.06 : 0.94).toFixed(2)})`,
                  }}
                >
                  <span className="sc-foot-shadow" aria-hidden="true" />
                  <span className="critic-performance" aria-hidden="true" data-cel={frame}
                    style={atlasStyle(resolveAsset(`${crew.rigBase}/solo/${state.mouthOpen ? "open" : "closed"}.webp`),frame,8,6)}>
                    {crew.id === "tracking" && action === 1 && <i className="critic-tape"
                      style={atlasStyle(resolveAsset(`${crew.rigBase}/solo/prop.webp`),Math.min(15,Math.floor(within*4)),4,4)}/>}
                  </span>
                  <span className="name-tag">{crew.name.toUpperCase()}</span>
                </div>
              );
            })}
          </div>
        )}

        {cord!==null && <StageCord frame={cord} front={false} solo={cueSolo} resolveAsset={resolveAsset}/>}
        {cord!==null && <StageCord frame={cord} front solo={cueSolo} resolveAsset={resolveAsset}/>}
        {/* 9. The 7 Singing Moppets on the Stage Floor */}
        <div className="cast sc-cast" data-layout="layered">
          {voices.map((v, i) => {
            const offstage = Boolean(piece.stage && !piece.stage.includes(v.id));
            if (cueAndNeon && offstage) return null;
            const s404 = STUDIO_404_CAST[v.id];
            const artKey = studio404 && s404 ? s404.artKey : v.id;
            const displayName = studio404 ? studio404Name(v.id, v.name) : v.name;
            const closedUrl = resolveAsset(studio404 && s404 ? `/rehearsal/rigs/${s404.artKey}/closed.webp` : `/moppets/${v.id}/closed.webp`);
            const singClosedUrl = studio404 && s404 ? resolveAsset(`/rehearsal/rigs/${s404.artKey}/sing-closed.webp`) : null;
            const openUrl = resolveAsset(studio404 && s404 ? `/rehearsal/rigs/${s404.artKey}/open.webp` : `/moppets/${v.id}/open.webp`);

            const a = actors[i] ?? { x: 0.5, depth: 0, face: 1, hop: 0, lean: 0, walking: false, bubble: null };
            const p = poses[i] ?? { singing: false, level: 0, open: 0, viseme: 0 };

            const cue = padGesture;
            const age = cue ? (performance.now()-cue.at)/1000 : 0;
            const clip = cue?.action === "double nod" ? "nod" : cue?.action;
            const repeat = cue?.action === "double nod" && age >= gestureSeconds("nod");
            const liveGesture = !still && cue?.id === v.id && clip ? gestureAt(clip, age - (repeat ? gestureSeconds("nod") : 0)) : null;
            const g = liveGesture ?? (performing ? gestureNow(piece, v.id, beat) : null);
            const dance = studio404 && dancing ? studio404DanceAt(v.id, beat, p.singing, p.level, still) : null;
            const gxPct = ((g?.dx ?? 0) + (dance?.dx ?? 0)) * (a.face < 0 ? -1 : 1) * 100;
            const gyPct = ((g?.dy ?? 0) + (dance?.dy ?? 0)) * 100;
            const gsx = (g?.sx ?? 1) * (dance?.sx ?? 1);
            const gsy = (g?.sy ?? 1) * (dance?.sy ?? 1);
            const grot = ((g?.rot ?? 0) + (dance?.rot ?? 0) + (g?.headRot ?? 0) * 0.2) * (a.face < 0 ? -1 : 1);

            const walkFrame = Math.floor(timeSec * 7 + i * 3) % 8;
            const cel = dancing ? Math.floor(beat * 2) % 8 : a.walking ? walkFrame : 7;
            const col = cel % 4;
            const row = Math.floor(cel / 4);
            const celPos = `${(col * 100) / 3}% ${row * 100}%`;

            const mouthOpen =
              (p.singing && p.open > MOUTH_OPEN_THRESHOLD) ||
              (piece.kind === "skit" && Boolean(a.bubble) && Math.floor(timeSec * 6 + i) % 2 === 0);

            const pulse = dancing ? Math.abs(Math.sin(Math.PI * beat)) : 0;
            const sy = 1 + (dancing ? 0.04 * (pulse - 0.5) * (p.singing ? 1 : 0.5) : still ? 0 : 0.01 * Math.sin(timeSec * 2 + i));
            const depthScale = 1 - 0.2 * a.depth;
            const liftPct = a.depth * 6.5 + a.hop * 5.2 + (a.walking && !dancing && !still ? Math.abs(Math.sin(timeSec * 12 + i)) * 0.6 : 0);

            // Distance to nearest spotlight determines authentic stage illumination falloff
            const actorPx = a.x * 1920;
            const litFactor = spots.reduce((best, s) => {
              const dist = Math.abs(actorPx - s.x) / Math.max(220, s.rx * 1.15);
              return Math.max(best, clamp01(1.18 - dist * 0.82) * s.intensity);
            }, 0.34);

            const blackoutEmissive = isBlackout && (v.id === "vee" || v.id === "pip");
            const brightness = blackoutEmissive
              ? 0.96
              : isBlackout
                ? 0.22
                : clamp(0.42 + 0.68 * litFactor + (p.singing ? 0.12 : 0), 0.38, 1.18);

            const emissiveShadow =
              blackoutEmissive && v.id === "vee"
                ? " drop-shadow(0 0 18px rgba(87,211,232,0.65)) drop-shadow(0 0 28px rgba(255,92,168,0.4))"
                : blackoutEmissive && v.id === "pip"
                  ? " drop-shadow(0 0 20px rgba(229,72,58,0.7))"
                  : "";

            const shadowTight = 1 - Math.min(1, a.hop) * 0.38;
            const isSoloWorkshop = !studio404 && moppet(v.id)?.art === "solo";
            const [nx, ny] = solo.neck[cel];
            const blink = p.viseme === 0 && !still && (timeSec * 0.31 + i) % 1 < 0.04;
            const headCell = blink ? 7 : p.viseme;
            const hs = solo.headScale;
            const headTilt =
              (dancing ? Math.sin((Math.PI * beat) / 2) * 5 : still ? 0 : Math.sin(timeSec * 1.3) * 1.5) +
              (g?.headRot ?? 0) * (a.face < 0 ? -1 : 1);

            const puppetCls = `puppet sc-puppet${i === selectedIndex ? " selected" : ""}${p.singing ? " singing" : ""}${mouthOpen ? " mouth-open" : ""}${singClosedUrl ? " has-sing-closed" : ""}${offstage ? " offstage" : ""}`;
            const puppetStyle: React.CSSProperties = {
              left: cueSolo ? "50%" : workshopArt ? "46%" : neon ? `${neon.x}%` : onCart ? "41.98%" : onValveBench ? "45%" : `${(a.x * 100).toFixed(2)}%`,
              bottom: cueSolo ? "9%" : workshopArt ? "8%" : cueAndNeon ? "11%" : neon ? "11%" : onCart ? "15%" : onValveBench ? "13%" : `${(10.5 + liftPct).toFixed(2)}%`,
              zIndex: Math.round(100 - a.depth * 55 + (p.singing ? 6 : 0)),
              transform: cueSolo || cueAndNeon || workshopArt || neon || onCart || onValveBench ? "translateX(-50%)" : `translateX(-50%) scale(${depthScale.toFixed(3)}) rotate(${a.lean.toFixed(2)}deg)`,
              filter: `brightness(${brightness.toFixed(2)}) saturate(${(p.singing ? 1.06 : 0.94).toFixed(2)})${emissiveShadow}`,
            };

            const spriteVars = {
              "--cel": celPos,
              "--face": (Math.abs(a.face) < 0.35 ? (a.face >= 0 ? 1 : -1) : a.face).toFixed(3),
              "--sy": sy.toFixed(3),
              "--gx": `${gxPct.toFixed(1)}%`,
              "--gy": `${gyPct.toFixed(1)}%`,
              "--gsx": gsx.toFixed(3),
              "--gsy": gsy.toFixed(3),
              "--grot": `${grot.toFixed(2)}deg`,
            } as React.CSSProperties;

            const sungNote = soloSet?.art === "zap" && !offstage
              ? piece.tracks.find(track => track.id === v.id)?.events.find(event => beat >= event.beat && beat < event.beat + event.beats)
              : undefined;
            const actor = !offstage && (cueAndNeon || (soloSet?.art === "cue" && piece.title === "Line?") || neon)
              && (artKey === "neon" || artKey === "cue") ? artKey : null;
            const customClip = tabbyBow && !offstage ? <PinnedBow phase={still ? 0 : (beat-bowStart!)/8} resolveAsset={resolveAsset}/> : workshopArt && workshop && !offstage
              ? <WorkshopSolo actor={workshopArt} take={workshop} open={mouthOpen} resolveAsset={resolveAsset} />
              : actor
              ? <RehearsalActor actor={actor} piece={piece} beat={performing ? beat : cueAndNeon && !still ? 4 + timeSec % 16 : 0} still={still || (!performing && !cueAndNeon)} rollingFrame={neon?.rolling ? neon.frame : undefined} resolveAsset={resolveAsset} />
              : neon && !offstage ? <NeonSolo take={neon} open={mouthOpen} resolveAsset={resolveAsset} /> : soloSet?.art === "zap" && !offstage
              ? <ZapSolo take={take} still={still} beat={performing && !still ? beat : 0} level={p.singing ? p.level : 0} midi={liveMidiSpeech?.voiceId === v.id ? (liveMidiSpeech.midi ?? 60) : (sungNote?.midi ?? 60)} open={mouthOpen} resolveAsset={resolveAsset} />
              : renderCharacterOverride?.(v.id, artKey, spriteVars) ?? null;

            const puppetBody = (
              <>
                <span
                  className="sc-foot-shadow"
                  aria-hidden="true"
                  style={{
                    opacity: (0.52 * shadowTight).toFixed(2),
                    transform: `translateX(-50%) scale(${shadowTight.toFixed(2)})`,
                  }}
                />
                {customClip ?? (isSoloWorkshop ? (
                  <span
                    className="sprite solo"
                    style={
                      {
                        backgroundImage: `url(${resolveAsset(`/moppets/${v.id}/body.webp`)})`,
                        ...spriteVars,
                      } as React.CSSProperties
                    }
                    aria-hidden="true"
                  >
                    <span
                      className="solo-head"
                      style={
                        {
                          backgroundImage: `url(${resolveAsset(`/moppets/${v.id}/head.webp`)})`,
                          width: `${hs * 100}%`,
                          transformOrigin: `50% ${solo.headNeckY * 100}%`,
                          "--head": `${((headCell % 4) * 100) / 3}% ${Math.floor(headCell / 4) * 100}%`,
                          "--hx": `${(nx - hs / 2) * 100}%`,
                          "--hy": `${(ny - solo.headNeckY * hs) * 100}%`,
                          "--tilt": `${headTilt.toFixed(2)}deg`,
                        } as React.CSSProperties
                      }
                    />
                    {renderPropFx?.(v.id, i)}
                  </span>
                ) : (
                  <span className="sprite" style={spriteVars} aria-hidden="true">
                    <span className="sprite-closed" style={{ backgroundImage: `url(${closedUrl})` }} />
                    {singClosedUrl && <span className="sprite-sing-closed" style={{ backgroundImage: `url(${singClosedUrl})` }} />}
                    <span className="sprite-open" style={{ backgroundImage: `url(${openUrl})` }} />
                    {!studio404 && renderPropFx?.(v.id, i)}
                  </span>
                ))}
                <span className="name-tag">{displayName.toUpperCase()}</span>
              </>
            );

            return onSelectActor ? (
              <button
                key={v.id}
                ref={puppetRef ? (el) => puppetRef(i, el) : undefined}
                type="button"
                className={puppetCls}
                data-art-key={artKey}
                onClick={() => onSelectActor(i)}
                aria-label={`Select ${displayName}`}
                aria-pressed={i === selectedIndex}
                style={puppetStyle}
              >
                {puppetBody}
              </button>
            ) : (
              <div key={v.id} className={puppetCls} data-art-key={artKey} style={puppetStyle}>
                {puppetBody}
              </div>
            );
          })}
        </div>
      </div>

      {/* 10. VHS Scanline Gag Overlay (only during Hertz's 'vertical roll' bar 94.4-97.4) */}
      {isVhsRoll && <div className="sc-vhs-scan" data-layout="overlay" aria-hidden="true" />}

      {/* 11. Theatrical Vignette + Soft-Light Film Grain (Polish.tsx) */}
      <div className="sc-vignette" data-layout="overlay" aria-hidden="true" />
      <div className="sc-grain" data-layout="overlay" aria-hidden="true" style={{ backgroundImage: GRAIN_DATA_URI }} />

      {/* 12. Self-Luminous Shotcraft Speech-Bubble Subtitles Layer (Above Vignette & Blackout!) */}
      {placedCapsules.length > 0 && (
        <div className="sc-capsules-layer" data-layout="overlay">
          {placedCapsules.map(({ capsule, bg, fg, showTail }) => (
            <ShotcraftSpeechCapsule
              key={capsule.key}
              capsule={soloSet ? { ...capsule, centerX: 0.82, topY: onCart ? 0.55 : 0.15, maxWidthPct: 29 }
                : cueAndNeon ? { ...capsule, centerX: capsule.speaker.toUpperCase().includes("NEON") ? 0.30 : 0.70,
                  topY: 0.055, maxWidthPct: 36, roleLabel: "DUET" } : capsule}
              beat={customBubbles ? (timeSec - LEAD_IN) / beatSeconds(piece) : beat}
              timeSec={timeSec}
              bgOverride={bg}
              fgOverride={fg}
              showTail={showTail && !soloSet}
            />
          ))}
        </div>
      )}
    </div>
  );
};
