/**
 * Neon Beyond-the-Studio — Multi-Lens Imaginative Performance Variety Pack (`S-26`).
 *
 * The UI stage is a switchable viewing lens over the exact same CHIMERA vocal clock
 * and Neon's existing 48-frame crimson-scarf rig (or any S-27 Flow FMV manifest):
 *   1. Folded Diorama 3D — REAL Three.js WebGL pop-up cardstock storybook (`FoldedBook3D`)
 *   2. Optical Signal    — Dark-field cyan/rose harmonic light-circuit & waveforms
 *   3. Kinetic Zine      — Bold Swiss/editorial print spread where typography IS the stage
 *   4. Vinyl LP          — Tactile spinning turntable platter, sleeve & tonearm tracking song progress
 *   5. Archive 404       — Optional legacy repair bay lens (handled by ShotcraftStage)
 *
 * Zero CSS transitions/animations (100% deterministic for Remotion & live CHIMERA playback).
 * Engine-free (zero `@chimera/wasm/engine.ts` imports).
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import type { Piece } from "../choir/music.ts";
import type { KaraokeWordSpan } from "../choir/bubbles.ts";
import { FoldedBook3D } from "./FoldedBook3D.tsx";
import {
  computeNeonWorldState,
  NEON_PLATES,
  NEON_WORLD_LENSES,
  type NeonFmvRigManifest,
  type NeonWorldLens,
  type NeonWorldState,
} from "./neonWorlds.ts";
import "./neon-worlds.css";

export interface NeonWorldsStageProps {
  piece: Piece;
  beat: number;
  timeSec: number;
  performing: boolean;
  still: boolean;
  singing: boolean;
  level: number;
  mouthOpen: boolean;
  lens: NeonWorldLens;
  onSelectLens?: (lens: NeonWorldLens) => void;
  interactive?: boolean;
  resolveAsset: (path: string) => string;
  fmvManifest?: NeonFmvRigManifest | null;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function NeonCutoutSprite({
  state,
  resolveAsset,
  className = "",
}: {
  state: NeonWorldState;
  resolveAsset: (path: string) => string;
  className?: string;
}) {
  const { cel, cyan, rose, singing, mouthOpen, vocalLevel } = state;
  const col = cel.frame % cel.cols;
  const row = Math.floor(cel.frame / cel.cols);
  const posX = cel.cols > 1 ? (col * 100) / (cel.cols - 1) : 0;
  const posY = cel.rows > 1 ? (row * 100) / (cel.rows - 1) : 0;
  const glowFilter = [
    `drop-shadow(0 0 ${Math.round(8 + cyan * 16)}px rgba(60, 230, 245, ${(0.22 + cyan * 0.48).toFixed(2)}))`,
    `drop-shadow(0 0 ${Math.round(8 + rose * 16)}px rgba(255, 78, 140, ${(0.18 + rose * 0.45).toFixed(2)}))`,
  ].join(" ");

  return (
    <span
      className={`nw-performer${singing ? " singing" : ""}${mouthOpen ? " mouth-open" : ""} ${className}`}
      data-action={cel.action}
      data-source={cel.source}
      data-cel={cel.frame}
      aria-hidden="true"
      style={{ filter: glowFilter }}
    >
      <span
        className="nw-performer-atlas"
        style={{
          backgroundImage: `url("${resolveAsset(cel.atlasUrl)}")`,
          backgroundSize: `${cel.cols * 100}% ${cel.rows * 100}%`,
          backgroundPosition: `${posX}% ${posY}%`,
        }}
      />
      <i
        className="nw-tube-aura nw-tube-aura-cyan"
        style={{ opacity: clamp(0.12 + cyan * 0.72 + (mouthOpen ? vocalLevel * 0.2 : 0), 0, 0.95) }}
      />
      <i
        className="nw-tube-aura nw-tube-aura-rose"
        style={{ opacity: clamp(0.12 + rose * 0.72 + (mouthOpen ? vocalLevel * 0.2 : 0), 0, 0.95) }}
      />
    </span>
  );
}

function LyricRun({
  words,
  fallback,
  beat,
  accentA,
  accentB,
}: {
  words: readonly KaraokeWordSpan[];
  fallback: string;
  beat: number;
  accentA: string;
  accentB: string;
}) {
  if (!words.length) return <span className="nw-lyric-idle">{fallback}</span>;
  return (
    <>
      {words.map((w, idx) => {
        const span = Math.max(0.08, w.endBeat - w.startBeat);
        const p = clamp((beat - w.startBeat) / span, 0, 1);
        const lit = p > 0.05;
        const active = p > 0.05 && p < 0.98;
        const accent = idx % 2 === 0 ? accentA : accentB;
        return (
          <span
            key={`${w.text}-${idx}`}
            className={`nw-word${lit ? " lit" : ""}${active ? " active" : ""}`}
            style={
              lit
                ? {
                    color: active ? accent : undefined,
                    textShadow: active ? `0 0 18px ${accent}66` : undefined,
                  }
                : undefined
            }
          >
            {w.text}{" "}
          </span>
        );
      })}
    </>
  );
}

export const NeonWorldsStage: React.FC<NeonWorldsStageProps> = ({
  piece,
  beat,
  timeSec,
  performing,
  still,
  singing,
  level,
  mouthOpen,
  lens,
  onSelectLens,
  interactive = false,
  resolveAsset,
  fmvManifest = null,
}) => {
  const [plateOverride, setPlateOverride] = useState<number | null>(null);
  const [userOrbit, setUserOrbit] = useState<{ azimuth: number; elevation: number } | null>(null);
  const [bellImpulse, setBellImpulse] = useState(0);
  const dragRef = useRef<{ startX: number; startY: number; baseAz: number; baseEl: number } | null>(null);

  const effectivePlateOverride = performing ? null : plateOverride;

  const state = useMemo(
    () =>
      computeNeonWorldState({
        piece,
        beat,
        timeSec,
        performing,
        still,
        singing,
        level,
        mouthOpen,
        plateOverride: effectivePlateOverride,
        fmvManifest,
      }),
    [piece, beat, timeSec, performing, still, singing, level, mouthOpen, effectivePlateOverride, fmvManifest],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || lens !== "diorama") return;
      if ((e.target as HTMLElement).closest("button")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseAz: userOrbit?.azimuth ?? 0,
        baseEl: userOrbit?.elevation ?? 0.44,
      };
    },
    [interactive, lens, userOrbit],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setUserOrbit({
      azimuth: clamp(d.baseAz - dx * 0.0055, -0.78, 0.78),
      elevation: clamp(d.baseEl + dy * 0.0038, 0.16, 0.76),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const stepPlate = useCallback(
    (delta: number) => {
      const next = (state.plateIndex + delta + NEON_PLATES.length) % NEON_PLATES.length;
      setPlateOverride(next);
    },
    [state.plateIndex],
  );

  const resetView = useCallback(() => {
    setUserOrbit(null);
    setPlateOverride(null);
  }, []);

  // Deterministic waveforms for Optical Signal world
  const signalPaths = useMemo(() => {
    const makeWave = (amp: number, freq: number, phase: number, baseY: number) => {
      const pts: string[] = [];
      for (let i = 0; i <= 32; i++) {
        const u = i / 32;
        const env = Math.sin(u * Math.PI);
        const y = baseY + Math.sin(u * Math.PI * freq + phase) * amp * env;
        pts.push(`${i === 0 ? "M" : "L"}${(u * 1000).toFixed(1)},${y.toFixed(1)}`);
      }
      return pts.join(" ");
    };
    const t = still ? 0 : performing ? beat * 1.4 : 0.4;
    return {
      cyan: makeWave(18 + state.cyan * 54, 4, t, 260),
      rose: makeWave(18 + state.rose * 54, 5, -t * 1.15 + 1.1, 260),
    };
  }, [beat, performing, still, state.cyan, state.rose]);

  const lensBar = onSelectLens && (
    <div className="nw-lens-dock" role="tablist" aria-label="Neon performance world lens" data-layout="overlay">
      {NEON_WORLD_LENSES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={lens === item.id}
          className={`nw-lens-pill${lens === item.id ? " active" : ""}`}
          onClick={() => onSelectLens(item.id)}
          title={item.tagline}
        >
          {item.shortLabel}
        </button>
      ))}
    </div>
  );

  /* ───────────────────── LENS 1: REAL THREE.JS 3D FOLDED SONGBOOK DIORAMA ───────────────────── */
  if (lens === "diorama") {
    return (
      <div
        className={`sc-stage nw-stage nw-diorama${state.darkness > 0.4 ? " is-dark" : ""}${state.sharedLight > 0.5 ? " is-shared" : ""}`}
        data-neon-lens="diorama"
        data-plate={state.plateIndex + 1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Full-bleed real Three.js 3D WebGL tabletop diorama */}
        <div className="nw-three-layer" data-layout="overlay">
          <FoldedBook3D
            state={state}
            beat={performing ? beat : state.plate.startBeat}
            userOrbit={interactive ? userOrbit : null}
            bellImpulse={bellImpulse}
            resolveAsset={resolveAsset}
          />
        </div>

        {/* Hidden semantic hook so Playwright & screen readers see live performer source/action */}
        <span
          className="nw-performer-sr"
          data-action={state.cel.action}
          data-source={state.cel.source}
          data-cel={state.cel.frame}
          aria-hidden="true"
        />

        {/* Top Editorial Masthead + Variety-Pack World Switcher */}
        <div className="nw-diorama-top" data-layout="overlay">
          <div className="nw-masthead">
            <div className="nw-brand-row">
              <span className="nw-book-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z" />
                  <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v17h5.5a2.5 2.5 0 0 1 2.5 2V5.5Z" />
                </svg>
              </span>
              <span className="nw-brand-title">The Folded Songbook</span>
              <span className="nw-brand-meta">NEON · TAKE TWO</span>
            </div>
            <div className="nw-chapter-eyebrow">— {state.plate.chapterEyebrow}</div>
            <h2 className="nw-chapter-title">{state.plate.title}</h2>
            <p className="nw-chapter-sub">
              <em>{state.plate.subtitle}</em> · {state.plate.promptHint}
            </p>
          </div>

          <div className="nw-top-controls">
            {lensBar}
            {interactive && (
              <button
                type="button"
                className="nw-ghost-btn"
                onClick={() => setBellImpulse((c) => c + 1)}
                title="Ring the 3D brass & rose bell in the Lantern Arch"
              >
                🔔 Ring bell
              </button>
            )}
            {interactive && (userOrbit || plateOverride !== null) && (
              <button type="button" className="nw-ghost-btn" onClick={resetView}>
                Reset view
              </button>
            )}
          </div>
        </div>

        {/* Bottom Editorial Story Caption + Tactile Page Stepper */}
        <div className="nw-diorama-bottom" data-layout="overlay">
          <div className="nw-story-caption">
            <span className="nw-caption-tag">
              <i className="nw-dot-cyan" /> NEON&apos;S SONG
            </span>
            <p className="nw-caption-line">
              <LyricRun
                words={state.words}
                fallback={state.lineText}
                beat={beat}
                accentA="#5cebf7"
                accentB="#ff78ab"
              />
            </p>
          </div>

          <div className="nw-plate-stepper" aria-label="Songbook chapter plates">
            <div className="nw-stepper-meta">
              <span>PAPER TURNS · TABLE ROTATES</span>
              <strong>{state.plate.numberLabel}</strong>
            </div>
            <div className="nw-stepper-row">
              {interactive && (
                <button
                  type="button"
                  className="nw-step-btn"
                  aria-label="Previous plate"
                  onClick={() => stepPlate(-1)}
                >
                  ←
                </button>
              )}
              <div className="nw-step-dots">
                {NEON_PLATES.map((p) => (
                  <button
                    key={p.index}
                    type="button"
                    disabled={!interactive}
                    className={`nw-step-dot${state.plateIndex === p.index ? " active" : ""}`}
                    aria-label={`Plate ${p.index + 1}: ${p.title}`}
                    onClick={() => interactive && setPlateOverride(p.index)}
                  />
                ))}
              </div>
              {interactive && (
                <button
                  type="button"
                  className="nw-step-btn"
                  aria-label="Next plate"
                  onClick={() => stepPlate(1)}
                >
                  →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ───────────────────── LENS 2: OPTICAL SIGNAL & LIGHT-CIRCUIT WORLD ───────────────────── */
  if (lens === "signal") {
    const orbitRot = still ? 0 : performing ? (beat * 11) % 360 : 22;
    return (
      <div
        className={`sc-stage nw-stage nw-signal${state.darkness > 0.4 ? " is-dark" : ""}`}
        data-neon-lens="signal"
        data-plate={state.plateIndex + 1}
      >
        <div className="nw-signal-bg" data-layout="overlay" aria-hidden="true">
          <div className="nw-orb nw-orb-cyan" style={{ opacity: 0.16 + state.cyan * 0.45 }} />
          <div className="nw-orb nw-orb-rose" style={{ opacity: 0.14 + state.rose * 0.45 }} />
          <div className="nw-signal-grid" />
        </div>

        <div className="nw-signal-top" data-layout="overlay">
          <div className="nw-signal-badges">
            <span className="nw-signal-pill">OPTICAL SIGNAL WORLD</span>
            <span className="nw-signal-song">
              Neon — <em>Take Two</em>
            </span>
          </div>
          {lensBar}
        </div>

        <div className="nw-signal-body" data-layout="overlay">
          <div className="nw-signal-editorial">
            <div className="nw-signal-eyebrow">{state.plate.chapterEyebrow}</div>
            <h2 className="nw-signal-lyric">
              <LyricRun
                words={state.words}
                fallback={state.plate.title}
                beat={beat}
                accentA="#5cebf7"
                accentB="#ff649c"
              />
            </h2>
            <p className="nw-signal-desc">{state.plate.promptHint}</p>

            <div className="nw-tube-meters">
              <div className="nw-meter-row">
                <span>LEFT TUBE · CYAN</span>
                <div className="nw-meter-track">
                  <div className="nw-meter-fill cyan" style={{ width: `${Math.round(state.cyan * 100)}%` }} />
                </div>
              </div>
              <div className="nw-meter-row">
                <span>RIGHT TUBE · ROSE</span>
                <div className="nw-meter-track">
                  <div className="nw-meter-fill rose" style={{ width: `${Math.round(state.rose * 100)}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="nw-signal-aperture">
            <svg className="nw-signal-svg" viewBox="0 0 1000 520" aria-hidden="true">
              <path
                d={signalPaths.cyan}
                fill="none"
                stroke="#3ce6f5"
                strokeWidth="3.2"
                opacity={(0.22 + state.cyan * 0.72).toFixed(2)}
              />
              <path
                d={signalPaths.rose}
                fill="none"
                stroke="#ff4e8c"
                strokeWidth="3.2"
                opacity={(0.22 + state.rose * 0.72).toFixed(2)}
              />
              <g style={{ transformOrigin: "500px 260px", transform: `rotate(${orbitRot.toFixed(1)}deg)` }}>
                <circle
                  cx="500"
                  cy="260"
                  r="195"
                  fill="none"
                  stroke="rgba(92,235,247,0.34)"
                  strokeWidth="2"
                  strokeDasharray="16 14"
                />
                <circle cx="695" cy="260" r="8" fill="#5cebf7" opacity={0.35 + state.cyan * 0.65} />
              </g>
              <g style={{ transformOrigin: "500px 260px", transform: `rotate(${(-orbitRot * 0.7).toFixed(1)}deg)` }}>
                <circle
                  cx="500"
                  cy="260"
                  r="152"
                  fill="none"
                  stroke="rgba(255,94,153,0.38)"
                  strokeWidth="2"
                  strokeDasharray="8 12"
                />
                <circle cx="348" cy="260" r="7" fill="#ff5e99" opacity={0.35 + state.rose * 0.65} />
              </g>
            </svg>

            <div className="nw-signal-actor">
              <NeonCutoutSprite state={state} resolveAsset={resolveAsset} />
            </div>
          </div>
        </div>

        <div className="nw-signal-foot" data-layout="overlay">
          <span>● {piece.bpm} BPM · {piece.key}</span>
          <span>
            {NEON_PLATES.map((p) => (
              <span key={p.index} className={`nw-foot-sec${state.plateIndex === p.index ? " active" : ""}`}>
                {p.sectionName.toUpperCase()}
              </span>
            ))}
          </span>
          <span className="nw-signal-lock">CHIMERA CLOCK LOCKED</span>
        </div>
      </div>
    );
  }

  /* ───────────────────── LENS 3: KINETIC LYRIC ZINE ───────────────────── */
  if (lens === "zine") {
    return (
      <div
        className={`sc-stage nw-stage nw-zine${state.darkness > 0.4 ? " is-dark" : ""}`}
        data-neon-lens="zine"
        data-plate={state.plateIndex + 1}
      >
        <div className="nw-zine-bar" data-layout="overlay">
          {lensBar}
          <span className="nw-zine-strap">ISSUE NO. 19 · NEON · {piece.key.toUpperCase()} · {piece.bpm} BPM</span>
        </div>

        <div className="nw-zine-spread" data-layout="overlay">
          <div className="nw-zine-poster">
            <div className="nw-zine-head">
              <span>{state.plate.chapterEyebrow}</span>
              <strong>{state.plate.title.toUpperCase()}</strong>
            </div>

            <div className="nw-zine-type">
              <LyricRun
                words={state.words}
                fallback={state.lineText}
                beat={beat}
                accentA="#009cb8"
                accentB="#d82765"
              />
            </div>

            <div className="nw-zine-rule">
              <span>{state.plate.promptHint}</span>
              <span className="nw-zine-beat">BEAT {Math.max(0, beat).toFixed(1)}</span>
            </div>
          </div>

          <div className="nw-zine-frame">
            <div className="nw-zine-frame-meta">
              <span>PERFORMER CUTOUT</span>
              <span>{state.cel.source === "fmv-manifest" ? "KEYED FLOW FMV" : "48-FRAME RIG"}</span>
            </div>
            <div className="nw-zine-actor">
              <NeonCutoutSprite state={state} resolveAsset={resolveAsset} />
            </div>
            <div className="nw-zine-spectrum">
              <span style={{ width: `${Math.round(state.cyan * 50)}%`, background: "#3ce6f5" }} />
              <span style={{ width: `${Math.round(state.rose * 50)}%`, background: "#ff4e8c" }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ───────────────────── LENS 4: VINYL LP TURNTABLE WORLD ───────────────────── */
  const songProgress = clamp(beat / Math.max(16, piece.beats || 64), 0, 1);
  const discAngle = still ? 0 : performing ? (beat * 36) % 360 : 18;
  const armAngle = 14 + songProgress * 22;

  return (
    <div
      className={`sc-stage nw-stage nw-vinyl${state.darkness > 0.4 ? " is-dark" : ""}`}
      data-neon-lens="vinyl"
      data-plate={state.plateIndex + 1}
    >
      <div className="nw-vinyl-top" data-layout="overlay">
        <div className="nw-vinyl-brand">
          <span className="nw-vinyl-cat">SIDE A · 45 RPM</span>
          <span className="nw-vinyl-album">NEON — <em>Take Two</em></span>
        </div>
        {lensBar}
      </div>

      <div className="nw-vinyl-deck" data-layout="overlay">
        {/* Left Tactile Record Sleeve / Liner Notes */}
        <div className="nw-sleeve-card">
          <div className="nw-sleeve-strip" />
          <div className="nw-sleeve-inner">
            <div className="nw-sleeve-eyebrow">{state.plate.chapterEyebrow}</div>
            <h2 className="nw-sleeve-title">{state.plate.title}</h2>
            <p className="nw-sleeve-lyric">
              <LyricRun
                words={state.words}
                fallback={state.lineText}
                beat={beat}
                accentA="#5cebf7"
                accentB="#ff649c"
              />
            </p>
            <div className="nw-sleeve-tracks">
              {NEON_PLATES.map((p) => (
                <div key={p.index} className={`nw-track-row${state.plateIndex === p.index ? " active" : ""}`}>
                  <span>A{p.index + 1}</span>
                  <strong>{p.title}</strong>
                  <span>{p.sectionName}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Spinning Vinyl Platter + Tonearm + Neon Performing On the Disc */}
        <div className="nw-platter-wrap">
          <div className="nw-vinyl-disc" style={{ transform: `rotate(${discAngle.toFixed(1)}deg)` }} aria-hidden="true">
            <div className="nw-vinyl-sheen" />
            <div className="nw-vinyl-label">
              <span>NEON</span>
              <small>TAKE TWO</small>
            </div>
          </div>

          <div className="nw-tonearm" style={{ transform: `rotate(${armAngle.toFixed(1)}deg)` }} aria-hidden="true">
            <span className="nw-tonearm-pivot" />
            <span className="nw-tonearm-rod" />
            <span className="nw-tonearm-head" />
          </div>

          <div className="nw-vinyl-actor">
            <NeonCutoutSprite state={state} resolveAsset={resolveAsset} />
          </div>
        </div>
      </div>
    </div>
  );
};
