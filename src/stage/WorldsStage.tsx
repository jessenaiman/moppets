/**
 * Generic OO Multi-Lens Performance Worlds (`WorldsStage` — `S-29`).
 *
 * Renders ANY song and ANY cast (solo, duet, or full choir) across 6 switchable lenses
 * with zero hardcoded character names, sprites, or song titles:
 *   1. Diorama 3D  — Real Three.js 3D pop-up cardstock storybook staging all onstage performers (`FoldedBook3D`)
 *   2. CHIMERA 3D  — Live multi-head CHIMERA phosphor anatomical airways driven by each singer's vocal physics
 *   3. Signal      — Dark-field harmonic light-circuit & waveforms tinted to the active cast
 *   4. Zine        — Bold editorial print spread where lyrics & cast cutouts share the page
 *   5. Vinyl LP    — Spinning turntable platter, liner sleeve & tonearm tracking the active song
 *   6. Archive 404 — Classic Studio 404 theatrical velvet curtain stage (handled by ShotcraftStage)
 *
 * Zero CSS transitions/animations (100% deterministic for Remotion & live CHIMERA playback).
 * Engine-free (zero `@chimera/wasm/engine.ts` imports).
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import type { Piece } from "../choir/music.ts";
import type { KaraokeWordSpan } from "../choir/bubbles.ts";
import type { CharacterFmvManifest, PerformerFrame, PerformerPoseInput } from "../choir/performer.ts";
import { FoldedBook3D } from "./FoldedBook3D.tsx";
import { CaravanWorld3D } from "./CaravanWorld3D.tsx";
import { computeWorldState, WORLD_LENSES, type WorldLens } from "./worlds.ts";
import "./neon-worlds.css";

export interface WorldsStageProps {
  piece: Piece;
  voices: readonly { id: string; name: string; role?: string; color: string }[];
  poses: readonly PerformerPoseInput[];
  studio404: boolean;
  beat: number;
  timeSec: number;
  performing: boolean;
  still: boolean;
  selectedIndex?: number;
  lens: WorldLens;
  onSelectLens?: (lens: WorldLens) => void;
  interactive?: boolean;
  resolveAsset: (path: string) => string;
  fmvManifests?: Record<string, CharacterFmvManifest | null>;
  neonDioramaMotion?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Polymorphic 2D performer sprite (supports Flow FMV atlas, Pin atlas, or WebP rest/sing cutout). */
function PerformerCutout({
  performer,
  resolveAsset,
  compact = false,
}: {
  performer: PerformerFrame;
  resolveAsset: (path: string) => string;
  compact?: boolean;
}) {
  const { cel, color, accentB, singing, mouthOpen, level } = performer;
  const col = cel.frame % cel.cols;
  const row = Math.floor(cel.frame / cel.cols);
  const posX = cel.cols > 1 ? (col * 100) / (cel.cols - 1) : 0;
  const posY = cel.rows > 1 ? (row * 100) / (cel.rows - 1) : 0;
  const energy = singing ? Math.max(0.35, level) : 0.14;
  const glowFilter = `drop-shadow(0 0 ${Math.round(6 + energy * 16)}px ${color}aa)`;

  return (
    <span
      className={`nw-performer${singing ? " singing" : ""}${mouthOpen ? " mouth-open" : ""}${compact ? " compact" : ""}`}
      data-performer-id={performer.id}
      data-art-key={performer.artKey}
      data-action={cel.action}
      data-source={cel.source}
      data-cel={cel.frame}
      style={{
        filter: glowFilter,
        transform: singing ? `translateY(${(-3 - energy * 6).toFixed(1)}px) scale(${(1.03 + energy * 0.04).toFixed(3)})` : undefined,
      }}
      title={`${performer.name} — ${performer.role}`}
    >
      <span
        className="nw-performer-atlas"
        style={
          cel.cols === 1 && cel.rows === 1
            ? {
                backgroundImage: `url("${resolveAsset(cel.atlasUrl)}")`,
                backgroundSize: "contain",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center bottom",
              }
            : {
                backgroundImage: `url("${resolveAsset(cel.atlasUrl)}")`,
                backgroundSize: `${cel.cols * 100}% ${cel.rows * 100}%`,
                backgroundPosition: `${posX}% ${posY}%`,
              }
        }
      />
      <i
        className="nw-tube-aura"
        style={{
          background: `radial-gradient(circle, ${color}66 0%, ${accentB}22 55%, transparent 74%)`,
          opacity: clamp(0.12 + energy * 0.65, 0, 0.9),
        }}
      />
    </span>
  );
}

/** Polymorphic cast layout for Signal, Zine, and Vinyl worlds (1 hero or clean multi-singer ensemble). */
function PerformerEnsemble({
  cast,
  resolveAsset,
}: {
  cast: readonly PerformerFrame[];
  resolveAsset: (path: string) => string;
}) {
  if (cast.length <= 1 && cast[0]) {
    return <PerformerCutout performer={cast[0]} resolveAsset={resolveAsset} />;
  }
  return (
    <div className={`nw-ensemble-strip count-${Math.min(8, cast.length)}`}>
      {cast.map((member) => (
        <div key={member.id} className={`nw-ensemble-slot${member.singing ? " active" : ""}`}>
          <PerformerCutout performer={member} resolveAsset={resolveAsset} compact />
          <span className="nw-ensemble-tag" style={{ borderColor: member.color, color: member.singing ? "#fff" : member.color }}>
            {member.name}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * CHIMERA 3D Phosphor Anatomical Cutaway Head (inspired by CHIMERA's viral `?show=` multi-head demos).
 * Every singer in the song gets its own live cutaway head driven by real CHIMERA vocal pose energy:
 * jaw hinge, tongue arch, lip aperture, velum port, vocal-fold vibration pulse & acoustic flow dots.
 */
function ChimeraHeadPanel({
  performer,
  beat,
  facing = 1,
}: {
  performer: PerformerFrame;
  beat: number;
  facing?: 1 | -1;
}) {
  const openAmt = performer.singing ? clamp(0.18 + performer.open * 0.95 + performer.level * 0.35, 0.12, 1) : 0.08;
  const jawDrop = openAmt * 26;
  const tongueX = ((performer.viseme % 5) - 2) * 5.5;
  const tongueY = (performer.mouthOpen ? 8 : -6) + openAmt * 7;
  const pulse = performer.singing ? 0.55 + Math.abs(Math.sin(beat * Math.PI * 3)) * 0.45 : 0.12;
  const glottalR = 6 + openAmt * 11;

  return (
    <div
      className={`nw-xray-card${performer.singing ? " singing" : ""}`}
      data-performer-id={performer.id}
      data-art-key={performer.artKey}
      style={{ "--xray-accent": performer.color } as React.CSSProperties}
    >
      <div className="nw-xray-head">
        <strong style={{ color: performer.color }}>{performer.name}</strong>
        <span>{performer.singing ? `VOICED · ${Math.round(performer.level * 100)}%` : "REST"}</span>
      </div>

      <svg
        className="nw-xray-svg"
        viewBox="0 0 240 220"
        style={{ transform: facing < 0 ? "scaleX(-1)" : undefined }}
        aria-label={`${performer.name} CHIMERA vocal tract cutaway`}
      >
        <defs>
          <radialGradient id={`glow-${performer.id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={performer.color} stopOpacity={0.7 * pulse} />
            <stop offset="100%" stopColor={performer.color} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Subtle vector calibration grid */}
        <path d="M20 55H220 M20 110H220 M20 165H220 M70 20V200 M140 20V200" stroke="rgba(79,182,242,0.12)" strokeWidth="1" />

        {/* Cranial & nasal outer contour */}
        <path
          d="M52 204 C44 162, 42 112, 54 68 C66 28, 114 18, 152 30 C178 38, 192 64, 196 84 L212 104 L194 114"
          fill="none"
          stroke="#4fb6f2"
          strokeWidth="2.4"
          strokeLinecap="round"
        />

        {/* Hard palate & velum soft-palate arch */}
        <path
          d={`M100 108 C126 86, 162 84, 188 102 M100 108 Q88 ${118 + openAmt * 6} 82 142`}
          fill="none"
          stroke="#79d2ff"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* Posterior pharyngeal wall + trachea airway */}
        <path
          d="M72 96 C70 132, 74 168, 76 206 M106 154 C104 176, 104 192, 106 206"
          fill="none"
          stroke="rgba(79,182,242,0.72)"
          strokeWidth="2"
        />

        {/* Glowing vocal folds (glottis pulse) */}
        <circle cx="91" cy="182" r={glottalR + 10} fill={`url(#glow-${performer.id})`} />
        <ellipse
          cx="91"
          cy="182"
          rx={11}
          ry={3 + openAmt * 5}
          fill={performer.singing ? performer.color : "rgba(255,190,92,0.35)"}
          opacity={0.35 + pulse * 0.65}
        />

        {/* Live moving tongue body dome */}
        <path
          d={`M98 164 C${104 + tongueX * 0.4} ${128 + tongueY}, ${146 + tongueX} ${120 + tongueY}, ${178 + tongueX * 0.3} ${132 + jawDrop * 0.55} C164 ${158 + jawDrop * 0.35}, 126 168, 98 164 Z`}
          fill={`${performer.color}28`}
          stroke={performer.color}
          strokeWidth="2.3"
        />

        {/* Articulating lower jaw + lip aperture */}
        <path
          d={`M194 ${118 + jawDrop} L186 ${146 + jawDrop * 0.75} C174 ${168 + jawDrop * 0.5}, 140 ${178 + jawDrop * 0.3}, 110 176`}
          fill="none"
          stroke="#eef6f8"
          strokeWidth="2.6"
          strokeLinecap="round"
        />

        {/* Radiated acoustic wave arcs exiting the lips when singing */}
        {performer.singing && (
          <g stroke={performer.color} fill="none" strokeLinecap="round" opacity={0.4 + openAmt * 0.6}>
            <path d={`M206 ${108 + jawDrop * 0.3} Q218 ${114 + jawDrop * 0.4} 206 ${124 + jawDrop * 0.6}`} strokeWidth="2.2" />
            <path d={`M216 ${100 + jawDrop * 0.25} Q232 ${114 + jawDrop * 0.4} 216 ${132 + jawDrop * 0.65}`} strokeWidth="1.6" opacity="0.65" />
          </g>
        )}
      </svg>

      <div className="nw-xray-meter">
        <div className="nw-xray-bar" style={{ width: `${Math.round(openAmt * 100)}%`, background: performer.color }} />
      </div>
    </div>
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

export const WorldsStage: React.FC<WorldsStageProps> = ({
  piece,
  voices,
  poses,
  studio404,
  beat,
  timeSec,
  performing,
  still,
  selectedIndex = 0,
  lens,
  onSelectLens,
  interactive = false,
  resolveAsset,
  fmvManifests = {},
  neonDioramaMotion = false,
}) => {
  const [plateOverride, setPlateOverride] = useState<number | null>(null);
  const [userOrbit, setUserOrbit] = useState<{ azimuth: number; elevation: number } | null>(null);
  const [bellImpulse, setBellImpulse] = useState(0);
  const [hornImpulse, setHornImpulse] = useState(0);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseAz: number; baseEl: number } | null>(null);

  const effectivePlateOverride = performing ? null : plateOverride;

  const state = useMemo(
    () =>
      computeWorldState({
        piece,
        voices,
        poses,
        studio404,
        beat,
        timeSec,
        performing,
        still,
        selectedIndex,
        plateOverride: effectivePlateOverride,
        fmvManifests,
      }),
    [piece, voices, poses, studio404, beat, timeSec, performing, still, selectedIndex, effectivePlateOverride, fmvManifests],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || (lens !== "diorama" && lens !== "caravan")) return;
      if ((e.target as HTMLElement).closest("button")) return;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseAz: userOrbit?.azimuth ?? 0,
        baseEl: userOrbit?.elevation ?? (lens === "caravan" ? 0.24 : 0.44),
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
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}
  }, []);

  const stepPlate = useCallback(
    (delta: number) => {
      const next = (state.plateIndex + delta + state.plates.length) % state.plates.length;
      setPlateOverride(next);
    },
    [state.plateIndex, state.plates.length],
  );

  const resetView = useCallback(() => {
    setUserOrbit(null);
    setPlateOverride(null);
  }, []);

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
      primary: makeWave(18 + state.energyA * 54, 4, t, 260),
      secondary: makeWave(18 + state.energyB * 54, 5, -t * 1.15 + 1.1, 260),
    };
  }, [beat, performing, still, state.energyA, state.energyB]);

  const castArtKeys = state.cast.map((c) => c.artKey).join(",");

  const lensBar = onSelectLens && (
    <div className="nw-lens-dock" role="tablist" aria-label="Performance world lens" data-layout="overlay">
      {WORLD_LENSES.map((item) => (
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
        data-world-lens="diorama"
        data-cast-keys={castArtKeys}
        data-lead-art={state.lead.artKey}
        data-plate={state.plateIndex + 1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="nw-three-layer" data-layout="overlay">
          <FoldedBook3D
            state={state}
            beat={performing ? beat : state.plate.startBeat}
            userOrbit={interactive ? userOrbit : null}
            bellImpulse={bellImpulse}
            resolveAsset={resolveAsset}
            neonMotionSeconds={neonDioramaMotion ? (performing && !still ? timeSec : 0) : undefined}
          />
        </div>

        {/* Semantic hook exposing live polymorphic cast & avatar source */}
        <span
          className="nw-performer-sr"
          data-performer-id={state.lead.id}
          data-art-key={state.lead.artKey}
          data-action={state.lead.cel.action}
          data-source={state.lead.cel.source}
          data-cel={state.lead.cel.frame}
          aria-hidden="true"
        />

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
              <span className="nw-brand-meta">{state.castSummary.toUpperCase()} · {state.songTitle.toUpperCase()}</span>
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
                title="Ring the 3D brass bell in the Lantern Arch"
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

        <div className="nw-diorama-bottom" data-layout="overlay">
          <div className="nw-story-caption">
            <span className="nw-caption-tag">
              <i className="nw-dot-cyan" style={{ background: state.primaryAccent }} /> {state.speakerName.toUpperCase()} · {state.songTitle.toUpperCase()}
            </span>
            <p className="nw-caption-line">
              <LyricRun
                words={state.words}
                fallback={state.lineText}
                beat={beat}
                accentA={state.primaryAccent}
                accentB={state.secondaryAccent}
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
                <button type="button" className="nw-step-btn" aria-label="Previous plate" onClick={() => stepPlate(-1)}>
                  ←
                </button>
              )}
              <div className="nw-step-dots">
                {state.plates.map((p) => (
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
                <button type="button" className="nw-step-btn" aria-label="Next plate" onClick={() => stepPlate(1)}>
                  →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ───────────────────── LENS 2: MEADOW CARAVAN 3D (PARADE WAGON & ROCKING HORSE) ───────────────────── */
  if (lens === "caravan") {
    return (
      <div
        className={`sc-stage nw-stage nw-caravan${state.darkness > 0.4 ? " is-dark" : ""}`}
        data-neon-lens="caravan"
        data-world-lens="caravan"
        data-cast-keys={castArtKeys}
        data-lead-art={state.lead.artKey}
        data-plate={state.plateIndex + 1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="nw-three-layer" data-layout="overlay">
          <CaravanWorld3D
            state={state}
            beat={performing ? beat : state.plate.startBeat}
            userOrbit={interactive ? userOrbit : null}
            hornImpulse={hornImpulse}
            spotlightId={interactive ? spotlightId : null}
            resolveAsset={resolveAsset}
          />
        </div>

        <div className="nw-diorama-top" data-layout="overlay">
          <div className="nw-masthead">
            <div className="nw-brand-row">
              <span className="nw-brand-title">Meadow Caravan</span>
              <span className="nw-brand-meta">{state.castSummary.toUpperCase()} · {state.songTitle.toUpperCase()}</span>
            </div>
            <div className="nw-chapter-eyebrow">— {state.plate.chapterEyebrow}</div>
            <h2 className="nw-chapter-title">{state.plate.title}</h2>
          </div>

          <div className="nw-top-controls">
            {lensBar}
            {interactive && (
              <button
                type="button"
                className="nw-ghost-btn"
                onClick={() => setHornImpulse((c) => c + 1)}
                title="Honk the brass caravan horn for a joyful bounce & dust puff"
              >
                📯 Honk horn
              </button>
            )}
            {interactive && (userOrbit || spotlightId) && (
              <button
                type="button"
                className="nw-ghost-btn"
                onClick={() => { setUserOrbit(null); setSpotlightId(null); }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="nw-diorama-bottom" data-layout="overlay">
          <div className="nw-story-caption">
            <span className="nw-caption-tag">
              <i className="nw-dot-cyan" style={{ background: state.primaryAccent }} /> {state.speakerName.toUpperCase()} · PARADE WAGON
            </span>
            <p className="nw-caption-line">
              <LyricRun
                words={state.words}
                fallback={state.lineText}
                beat={beat}
                accentA={state.primaryAccent}
                accentB={state.secondaryAccent}
              />
            </p>
          </div>

          {interactive && state.cast.length > 1 && (
            <div className="nw-rider-bar" role="group" aria-label="Spotlight a caravan rider">
              <span className="nw-rider-label">SPOTLIGHT RIDER</span>
              <div className="nw-rider-pills">
                {state.cast.map((rider) => (
                  <button
                    key={rider.id}
                    type="button"
                    aria-pressed={spotlightId === rider.id}
                    className={`nw-rider-pill${spotlightId === rider.id ? " active" : ""}`}
                    style={{ borderColor: rider.color }}
                    onClick={() => setSpotlightId((cur) => (cur === rider.id ? null : rider.id))}
                  >
                    {rider.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ───────────────────── LENS 3: 35MM FLATBED CINEMA STRIP ───────────────────── */
  if (lens === "filmstrip") {
    const frameNo = Math.max(0, Math.floor(timeSec * 24));
    const tcMin = String(Math.floor(timeSec / 60)).padStart(2, "0");
    const tcSec = String(Math.floor(timeSec % 60)).padStart(2, "0");
    const tcFrm = String(frameNo % 24).padStart(2, "0");
    const sprocketShift = -((beat * 26) % 48);

    return (
      <div
        className="sc-stage nw-stage nw-filmstrip"
        data-neon-lens="filmstrip"
        data-world-lens="filmstrip"
        data-cast-keys={castArtKeys}
        data-lead-art={state.lead.artKey}
        data-plate={state.plateIndex + 1}
      >
        <div className="nw-film-sprockets top" style={{ backgroundPositionX: `${sprocketShift.toFixed(1)}px` }} aria-hidden="true" />

        <div className="nw-film-head" data-layout="overlay">
          <div className="nw-film-meta">
            <span className="nw-film-stock">KODAK 5219 · 35MM FLATBED</span>
            <span className="nw-film-tc">TC {tcMin}:{tcSec}:{tcFrm} · FR #{String(frameNo + 1).padStart(4, "0")}</span>
          </div>
          {lensBar}
        </div>

        <div className="nw-film-strip-row" data-layout="overlay">
          <div className="nw-film-gate ghost" aria-hidden="true">
            <span className="nw-gate-num">{String(Math.max(1, frameNo)).padStart(3, "0")}A</span>
            <div className="nw-gate-body">
              <PerformerEnsemble cast={state.cast} resolveAsset={resolveAsset} />
            </div>
          </div>

          <div className="nw-film-gate hero" style={{ borderColor: state.primaryAccent }}>
            <div className="nw-gate-top">
              <span className="nw-gate-num" style={{ color: state.primaryAccent }}>LIVE GATE · {state.plate.numberLabel}</span>
              <span className="nw-gate-title">{state.songTitle.toUpperCase()}</span>
            </div>
            <div className="nw-gate-body">
              <PerformerEnsemble cast={state.cast} resolveAsset={resolveAsset} />
            </div>
            <div className="nw-gate-caption">
              <strong style={{ color: state.primaryAccent }}>{state.speakerName}:</strong>{" "}
              <LyricRun
                words={state.words}
                fallback={state.lineText}
                beat={beat}
                accentA={state.primaryAccent}
                accentB={state.secondaryAccent}
              />
            </div>
          </div>

          <div className="nw-film-gate ghost" aria-hidden="true">
            <span className="nw-gate-num">{String(frameNo + 2).padStart(3, "0")}A</span>
            <div className="nw-gate-body">
              <PerformerEnsemble cast={state.cast} resolveAsset={resolveAsset} />
            </div>
          </div>
        </div>

        <div className="nw-film-sprockets bottom" style={{ backgroundPositionX: `${sprocketShift.toFixed(1)}px` }} aria-hidden="true" />
      </div>
    );
  }

  /* ───────────────────── LENS 4: CHIMERA 3D MULTI-HEAD ANATOMICAL X-RAY ───────────────────── */
  if (lens === "chimera") {
    return (
      <div
        className="sc-stage nw-stage nw-chimera"
        data-neon-lens="chimera"
        data-world-lens="chimera"
        data-cast-keys={castArtKeys}
        data-lead-art={state.lead.artKey}
        data-plate={state.plateIndex + 1}
      >
        <div className="nw-chimera-top" data-layout="overlay">
          <div className="nw-signal-badges">
            <span className="nw-signal-pill">CHIMERA ANATOMICAL CHOIR</span>
            <span className="nw-signal-song">
              {state.castSummary} — <em>{state.songTitle}</em>
            </span>
          </div>
          {lensBar}
        </div>

        <div className={`nw-xray-grid count-${Math.min(8, state.cast.length)}`} data-layout="overlay">
          {state.cast.map((member, idx) => (
            <ChimeraHeadPanel
              key={member.id}
              performer={member}
              beat={beat}
              facing={state.cast.length === 2 && idx === 1 ? -1 : 1}
            />
          ))}
        </div>

        <div className="nw-chimera-foot" data-layout="overlay">
          <span className="nw-chimera-speaker" style={{ color: state.primaryAccent }}>
            {state.speakerName.toUpperCase()}
          </span>
          <p className="nw-chimera-lyric">
            <LyricRun
              words={state.words}
              fallback={state.lineText}
              beat={beat}
              accentA={state.primaryAccent}
              accentB={state.secondaryAccent}
            />
          </p>
          <span className="nw-signal-lock">{piece.bpm} BPM · {piece.key} · {state.cast.length} AIRWAYS</span>
        </div>
      </div>
    );
  }

  /* ───────────────────── LENS 3: OPTICAL SIGNAL & LIGHT-CIRCUIT WORLD ───────────────────── */
  if (lens === "signal") {
    const orbitRot = still ? 0 : performing ? (beat * 11) % 360 : 22;
    return (
      <div
        className={`sc-stage nw-stage nw-signal${state.darkness > 0.4 ? " is-dark" : ""}`}
        data-neon-lens="signal"
        data-world-lens="signal"
        data-cast-keys={castArtKeys}
        data-lead-art={state.lead.artKey}
        data-plate={state.plateIndex + 1}
      >
        <div className="nw-signal-bg" data-layout="overlay" aria-hidden="true">
          <div className="nw-orb nw-orb-cyan" style={{ background: state.primaryAccent, opacity: 0.16 + state.energyA * 0.45 }} />
          <div className="nw-orb nw-orb-rose" style={{ background: state.secondaryAccent, opacity: 0.14 + state.energyB * 0.45 }} />
          <div className="nw-signal-grid" />
        </div>

        <div className="nw-signal-top" data-layout="overlay">
          <div className="nw-signal-badges">
            <span className="nw-signal-pill">OPTICAL SIGNAL WORLD</span>
            <span className="nw-signal-song">
              {state.castSummary} — <em>{state.songTitle}</em>
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
                accentA={state.primaryAccent}
                accentB={state.secondaryAccent}
              />
            </h2>
            <p className="nw-signal-desc">{state.plate.promptHint}</p>

            <div className="nw-tube-meters">
              <div className="nw-meter-row">
                <span>LEAD VOICE · {state.lead.name.toUpperCase()}</span>
                <div className="nw-meter-track">
                  <div className="nw-meter-fill" style={{ width: `${Math.round(state.energyA * 100)}%`, background: state.primaryAccent }} />
                </div>
              </div>
              <div className="nw-meter-row">
                <span>ENSEMBLE ENERGY · {state.cast.length} {state.cast.length === 1 ? "VOICE" : "VOICES"}</span>
                <div className="nw-meter-track">
                  <div className="nw-meter-fill" style={{ width: `${Math.round(state.energyB * 100)}%`, background: state.secondaryAccent }} />
                </div>
              </div>
            </div>
          </div>

          <div className="nw-signal-aperture">
            <svg className="nw-signal-svg" viewBox="0 0 1000 520" aria-hidden="true">
              <path
                d={signalPaths.primary}
                fill="none"
                stroke={state.primaryAccent}
                strokeWidth="3.2"
                opacity={(0.22 + state.energyA * 0.72).toFixed(2)}
              />
              <path
                d={signalPaths.secondary}
                fill="none"
                stroke={state.secondaryAccent}
                strokeWidth="3.2"
                opacity={(0.22 + state.energyB * 0.72).toFixed(2)}
              />
              <g style={{ transformOrigin: "500px 260px", transform: `rotate(${orbitRot.toFixed(1)}deg)` }}>
                <circle cx="500" cy="260" r="195" fill="none" stroke={`${state.primaryAccent}55`} strokeWidth="2" strokeDasharray="16 14" />
                <circle cx="695" cy="260" r="8" fill={state.primaryAccent} opacity={0.35 + state.energyA * 0.65} />
              </g>
              <g style={{ transformOrigin: "500px 260px", transform: `rotate(${(-orbitRot * 0.7).toFixed(1)}deg)` }}>
                <circle cx="500" cy="260" r="152" fill="none" stroke={`${state.secondaryAccent}66`} strokeWidth="2" strokeDasharray="8 12" />
                <circle cx="348" cy="260" r="7" fill={state.secondaryAccent} opacity={0.35 + state.energyB * 0.65} />
              </g>
            </svg>

            <div className="nw-signal-actor">
              <PerformerEnsemble cast={state.cast} resolveAsset={resolveAsset} />
            </div>
          </div>
        </div>

        <div className="nw-signal-foot" data-layout="overlay">
          <span>● {piece.bpm} BPM · {piece.key}</span>
          <span>
            {state.plates.map((p) => (
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

  /* ───────────────────── LENS 4: KINETIC LYRIC ZINE ───────────────────── */
  if (lens === "zine") {
    return (
      <div
        className={`sc-stage nw-stage nw-zine${state.darkness > 0.4 ? " is-dark" : ""}`}
        data-neon-lens="zine"
        data-world-lens="zine"
        data-cast-keys={castArtKeys}
        data-lead-art={state.lead.artKey}
        data-plate={state.plateIndex + 1}
      >
        <div className="nw-zine-bar" data-layout="overlay">
          {lensBar}
          <span className="nw-zine-strap">{state.castSummary.toUpperCase()} · {state.songTitle.toUpperCase()} · {piece.key.toUpperCase()} · {piece.bpm} BPM</span>
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
                accentA={state.primaryAccent}
                accentB={state.secondaryAccent}
              />
            </div>

            <div className="nw-zine-rule">
              <span>{state.plate.subtitle}</span>
              <span className="nw-zine-beat">BEAT {Math.max(0, beat).toFixed(1)}</span>
            </div>
          </div>

          <div className="nw-zine-frame">
            <div className="nw-zine-frame-meta">
              <span>{state.cast.length === 1 ? state.lead.name.toUpperCase() : `CAST (${state.cast.length})`}</span>
              <span>{state.lead.cel.source.toUpperCase()}</span>
            </div>
            <div className="nw-zine-actor">
              <PerformerEnsemble cast={state.cast} resolveAsset={resolveAsset} />
            </div>
            <div className="nw-zine-spectrum">
              <span style={{ width: `${Math.round(state.energyA * 50)}%`, background: state.primaryAccent }} />
              <span style={{ width: `${Math.round(state.energyB * 50)}%`, background: state.secondaryAccent }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ───────────────────── LENS 5: VINYL LP TURNTABLE WORLD ───────────────────── */
  const songProgress = clamp(beat / Math.max(16, piece.beats || 64), 0, 1);
  const discAngle = still ? 0 : performing ? (beat * 36) % 360 : 18;
  const armAngle = 14 + songProgress * 22;

  return (
    <div
      className={`sc-stage nw-stage nw-vinyl${state.darkness > 0.4 ? " is-dark" : ""}`}
      data-neon-lens="vinyl"
      data-world-lens="vinyl"
      data-cast-keys={castArtKeys}
      data-lead-art={state.lead.artKey}
      data-plate={state.plateIndex + 1}
    >
      <div className="nw-vinyl-top" data-layout="overlay">
        <div className="nw-vinyl-brand">
          <span className="nw-vinyl-cat">SIDE A · 45 RPM</span>
          <span className="nw-vinyl-album">{state.castSummary.toUpperCase()} — <em>{state.songTitle}</em></span>
        </div>
        {lensBar}
      </div>

      <div className="nw-vinyl-deck" data-layout="overlay">
        <div className="nw-sleeve-card">
          <div className="nw-sleeve-strip" style={{ background: `linear-gradient(180deg, ${state.primaryAccent}, ${state.secondaryAccent})` }} />
          <div className="nw-sleeve-inner">
            <div className="nw-sleeve-eyebrow">{state.plate.chapterEyebrow}</div>
            <h2 className="nw-sleeve-title">{state.plate.title}</h2>
            <p className="nw-sleeve-lyric">
              <LyricRun
                words={state.words}
                fallback={state.lineText}
                beat={beat}
                accentA={state.primaryAccent}
                accentB={state.secondaryAccent}
              />
            </p>
            <div className="nw-sleeve-tracks">
              {state.plates.map((p) => (
                <div key={p.index} className={`nw-track-row${state.plateIndex === p.index ? " active" : ""}`}>
                  <span>A{p.index + 1}</span>
                  <strong>{p.title}</strong>
                  <span>{p.sectionName}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="nw-platter-wrap">
          <div className="nw-vinyl-disc" style={{ transform: `rotate(${discAngle.toFixed(1)}deg)` }} aria-hidden="true">
            <div className="nw-vinyl-sheen" />
            <div className="nw-vinyl-label" style={{ background: `radial-gradient(circle, ${state.primaryAccent}dd, ${state.secondaryAccent}cc)` }}>
              <span>{state.lead.name.toUpperCase()}</span>
              <small>{state.songTitle.toUpperCase().slice(0, 18)}</small>
            </div>
          </div>

          <div className="nw-tonearm" style={{ transform: `rotate(${armAngle.toFixed(1)}deg)` }} aria-hidden="true">
            <span className="nw-tonearm-pivot" />
            <span className="nw-tonearm-rod" />
            <span className="nw-tonearm-head" />
          </div>

          <div className="nw-vinyl-actor">
            <PerformerEnsemble cast={state.cast} resolveAsset={resolveAsset} />
          </div>
        </div>
      </div>
    </div>
  );
};
