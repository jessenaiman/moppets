/**
 * Remotion Composition mounting the unified `ShotcraftStage` directly from score + beat math,
 * with `SpotlightSweepReveal` velvet curtain & tungsten spotlight title/outro cards.
 * Zero `stage.mp4` capture hack; 100% parity between live booth, `@remotion/player`, and export.
 */
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { makeRound } from "../choir/music.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import { CAST } from "../choir/voices.ts";
import { moppet } from "../choir/cast/index.ts";
import { STUDIO_404_CAST, STUDIO_404_CREW } from "../choir/studio404.ts";
import { manifestForCharacter } from "../choir/clipTimeline.ts";
import {
  DEFAULT_VIDEO_PROPS,
  stageVoicesForPiece,
  type MoppetVideoProps,
  type TitleCardConfig,
} from "../choir/videoProject.ts";
import { ShotcraftStage } from "../stage/ShotcraftStage.tsx";
import { CharacterClip } from "./CharacterClip.tsx";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const VELVET_CURTAIN_BG =
  "repeating-linear-gradient(90deg, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0) 2.4%, rgba(255,210,200,0.10) 3.65%, rgba(0,0,0,0) 5.0%, rgba(0,0,0,0.58) 6.88%)," +
  "repeating-linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.30) 10.9%, rgba(0,0,0,0) 17.2%)," +
  "linear-gradient(180deg, #22080c 0%, #5a1622 55%, #43101a 100%)";

const TitleSlide: React.FC<{ card: TitleCardConfig; isOutro?: boolean }> = ({ card, isOutro = false }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const portrait = height > width;

  const fadeOut = interpolate(
    frame,
    [Math.max(8, durationInFrames - 10), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const rise = spring({ frame: frame + 4, fps, config: { damping: 18, stiffness: 150 } });

  // Damped pendulum spotlight + iris expansion adapted from SpotlightSweepReveal.tsx (visible on frame 0!)
  const swingEnd = Math.max(18, Math.round(durationInFrames * 0.58));
  const env = 1 - clamp((frame - 4) / swingEnd, 0, 1);
  const theta = -0.55 + (2 * Math.PI * frame) / Math.max(24, Math.round(fps * 1.35));
  const u = Math.sin(theta) * env;
  const spotXPct = 50 + u * 24;
  const iris = clamp((frame - swingEnd * 0.65) / Math.max(10, durationInFrames * 0.25), 0, 1);
  const rxPct = 30 + iris * 40;
  const ryPct = 38 + iris * 28;
  const mask = `radial-gradient(ellipse ${rxPct.toFixed(1)}% ${ryPct.toFixed(1)}% at ${spotXPct.toFixed(1)}% 48%, #000 0%, rgba(0,0,0,0.92) 48%, rgba(0,0,0,0.38) 76%, transparent 100%)`;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, #1a0a0d 0%, ${card.bg || "#0f0507"} 65%, #070203 100%)`,
        color: "#f8efe2",
        opacity: fadeOut,
        overflow: "hidden",
        fontFamily: "'Instrument Sans', 'DM Sans', system-ui, sans-serif",
      }}
    >
      {/* Ambient unlit velvet curtain */}
      <div style={{ position: "absolute", inset: "0 0 18% 0", backgroundImage: VELVET_CURTAIN_BG, opacity: 0.16 }} />
      {/* Spotlight-revealed lit velvet curtain */}
      <div
        style={{
          position: "absolute",
          inset: "0 0 18% 0",
          backgroundImage: VELVET_CURTAIN_BG,
          opacity: 0.94,
          WebkitMaskImage: mask,
          maskImage: mask,
        }}
      />
      {/* Stage floor apron */}
      <div style={{ position: "absolute", left: 0, right: 0, top: "82%", bottom: 0, background: "linear-gradient(180deg, #241210 0%, #090404 100%)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: "82%", height: 2, background: "linear-gradient(90deg, transparent, rgba(255,230,194,0.38), transparent)" }} />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: portrait ? "64px 56px" : "64px 120px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 20px",
            borderRadius: 999,
            border: "1px solid rgba(227, 189, 127, 0.36)",
            background: "rgba(20, 10, 13, 0.82)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: portrait ? 22 : 20,
            letterSpacing: "0.16em",
            color: "#e3bd7f",
            marginBottom: 28,
            transform: `translateY(${interpolate(rise, [0, 1], [14, 0])}px)`,
          }}
        >
          <span
            style={{
              width: 11,
              height: 11,
              borderRadius: "50%",
              background: isOutro ? "#3fbfa0" : "#e5483a",
              boxShadow: `0 0 12px ${isOutro ? "#3fbfa0" : "#e5483a"}`,
              display: "inline-block",
            }}
          />
          {isOutro ? "STUDIO 404 · CURTAIN CALL" : "STUDIO 404 · PREMIERE STAGE"}
        </div>

        {/* Dim shadow copy (0.09) + spotlight-masked lit title copy (SpotlightSweepReveal.tsx) */}
        <div style={{ position: "relative" }}>
          <h1
            style={{
              margin: 0,
              fontSize: portrait ? 78 : 96,
              lineHeight: 1.04,
              fontWeight: 780,
              letterSpacing: "-0.03em",
              opacity: 0.14,
            }}
          >
            {card.heading}
          </h1>
          <h1
            style={{
              position: "absolute",
              inset: 0,
              margin: 0,
              fontSize: portrait ? 78 : 96,
              lineHeight: 1.04,
              fontWeight: 780,
              letterSpacing: "-0.03em",
              color: "#f8efe2",
              textShadow: "0 4px 28px rgba(255, 224, 176, 0.32)",
              WebkitMaskImage: mask,
              maskImage: mask,
            }}
          >
            {card.heading}
          </h1>
        </div>

        <div
          style={{
            height: 4,
            width: interpolate(rise, [0, 1], [0, portrait ? 300 : 420]),
            borderRadius: 4,
            background: card.accent,
            margin: "26px 0 20px",
          }}
        />

        <p
          style={{
            margin: 0,
            fontSize: portrait ? 34 : 34,
            fontWeight: 500,
            lineHeight: 1.35,
            color: "#d8c6b2",
            maxWidth: portrait ? 880 : 1120,
            transform: `translateY(${interpolate(rise, [0, 1], [10, 0])}px)`,
          }}
        >
          {card.subheading}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const MoppetStageScene: React.FC<{ props: MoppetVideoProps }> = ({ props }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const portrait = height > width;
  const stageSec = frame / fps;
  const piece = props.piece ?? DEFAULT_VIDEO_PROPS.piece ?? makeRound();
  const bs = beatSeconds(piece);
  const beat = Math.max(0, (stageSec - LEAD_IN) / bs);

  const fadeIn = props.intro.enabled
    ? interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  const fadeOut = props.outro.enabled
    ? interpolate(frame, [Math.max(8, durationInFrames - 10), durationInFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  const voices = React.useMemo(
    () => stageVoicesForPiece(piece, CAST, props.studio404),
    [piece, props.studio404],
  );

  const resolveAsset = React.useCallback((assetPath: string): string => {
    if (!assetPath || /^(?:https?:|data:|blob:|\/__video\/)/.test(assetPath)) return assetPath;
    return staticFile(assetPath.replace(/^\/+/, ""));
  }, []);

  const showBand = piece.stage?.includes("band") || (piece.kind !== "skit" && piece.chords.length > 0);
  const preloadUrls = React.useMemo(() => {
    const urls = new Set<string>();
    for (const v of voices) {
      if (manifestForCharacter(v.id, props.studio404)) continue;
      const s404 = props.studio404 ? STUDIO_404_CAST[v.id] : undefined;
      if (s404) {
        urls.add(resolveAsset(`/rehearsal/rigs/${s404.artKey}/closed.webp`));
        urls.add(resolveAsset(`/rehearsal/rigs/${s404.artKey}/sing-closed.webp`));
        urls.add(resolveAsset(`/rehearsal/rigs/${s404.artKey}/open.webp`));
      } else if (moppet(v.id)?.art === "solo") {
        urls.add(resolveAsset(`/moppets/${v.id}/body.webp`));
        urls.add(resolveAsset(`/moppets/${v.id}/head.webp`));
      } else {
        urls.add(resolveAsset(`/moppets/${v.id}/closed.webp`));
        urls.add(resolveAsset(`/moppets/${v.id}/open.webp`));
      }
    }
    if (showBand) {
      for (const key of ["thrum", "clacker", "rattle"]) {
        const prefix = props.studio404 && key === "rattle" ? "/rehearsal/band/click" : `/moppets/band/${key}`;
        urls.add(resolveAsset(`${prefix}-rest.webp`));
        urls.add(resolveAsset(`${prefix}-play.webp`));
      }
    }
    if (props.studio404) {
      for (const crew of [STUDIO_404_CREW.tracking, STUDIO_404_CREW.hertz]) {
        urls.add(resolveAsset(`${crew.rigBase}/closed.webp`));
        urls.add(resolveAsset(`${crew.rigBase}/sing-closed.webp`));
        urls.add(resolveAsset(`${crew.rigBase}/open.webp`));
      }
    }
    return [...urls];
  }, [voices, props.studio404, showBand, resolveAsset]);

  const preloadLayer = preloadUrls.length > 0 && (
    <div
      style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      {preloadUrls.map((url) => (
        <Img key={url} src={url} pauseWhenLoading />
      ))}
    </div>
  );

  const renderCharacterOverride = React.useCallback(
    (voiceId: string, _artKey: string, spriteStyle: React.CSSProperties) => {
      const manifest = manifestForCharacter(voiceId, props.studio404);
      if (!manifest) return null;
      return (
        <CharacterClip
          manifest={manifest}
          piece={piece}
          voiceId={voiceId}
          stageDurationSec={props.stageDurationSec}
          resolveAsset={resolveAsset}
          style={spriteStyle}
        />
      );
    },
    [piece, props.stageDurationSec, props.studio404, resolveAsset],
  );

  const stageElement = (
    <ShotcraftStage
      piece={piece}
      voices={voices}
      studio404={props.studio404}
      beat={beat}
      timeSec={stageSec}
      performing
      dancing
      cameraFollow={props.cameraAutoFollow}
      customBubbles={props.bubbles}
      resolveAsset={resolveAsset}
      renderCharacterOverride={renderCharacterOverride}
    />
  );

  if (!portrait) {
    return (
      <AbsoluteFill style={{ background: "#070203", opacity: fadeIn * fadeOut }}>
        {preloadLayer}
        {props.audioUrl && <Audio src={props.audioUrl} volume={props.audioVolume} />}
        {stageElement}
      </AbsoluteFill>
    );
  }

  // 9:16 vertical framing: centered live 16:9 theatrical stage flanked by Studio 404 header & meter
  const beatPhase = Math.abs(Math.sin(Math.PI * beat));
  return (
    <AbsoluteFill style={{ background: "#0a0405", display: "flex", flexDirection: "column", opacity: fadeIn * fadeOut }}>
      {preloadLayer}
      {props.audioUrl && <Audio src={props.audioUrl} volume={props.audioVolume} />}
      <div
        style={{
          padding: "58px 48px 28px",
          background: "#12080a",
          borderBottom: "1.5px solid rgba(227,189,127,0.24)",
          color: "#f8efe2",
          fontFamily: "'Instrument Sans', system-ui, sans-serif",
        }}
      >
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, letterSpacing: "0.14em", color: "#e3bd7f" }}>
          STUDIO 404 · LIVE STAGE
        </span>
        <h2 style={{ margin: "10px 0 0", fontSize: 52, lineHeight: 1.08 }}>{props.title}</h2>
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#070203", overflow: "hidden" }}>
        <div style={{ width: "100%" }}>{stageElement}</div>
      </div>

      <div
        style={{
          padding: "32px 48px 48px",
          background: "#12080a",
          borderTop: "1.5px solid rgba(227,189,127,0.24)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          color: "#cbbd9d",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: 54 }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((bar) => (
            <div
              key={bar}
              style={{
                flex: 1,
                height: 16 + Math.round(36 * Math.abs(Math.sin(beatPhase * Math.PI + bar * 0.7))),
                borderRadius: 6,
                background: bar % 2 === 0 ? "#57d3e8" : "#e3bd7f",
                opacity: 0.85,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 }}>
          <span>{props.bpm} BPM</span>
          <span>CHIMERA PHYSICAL VOICES</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const MoppetComposition: React.FC<MoppetVideoProps> = (props) => {
  const fps = Math.max(1, props.fps || 30);
  const introFrames = props.intro.enabled ? Math.round(Math.max(0.4, props.intro.durationSec) * fps) : 0;
  const stageFrames = Math.round(Math.max(1, props.stageDurationSec) * fps);
  const outroFrames = props.outro.enabled ? Math.round(Math.max(0.4, props.outro.durationSec) * fps) : 0;

  return (
    <AbsoluteFill style={{ background: "#070203" }}>
      {introFrames > 0 && (
        <Sequence from={0} durationInFrames={introFrames}>
          <TitleSlide card={props.intro} />
        </Sequence>
      )}
      <Sequence from={introFrames} durationInFrames={stageFrames}>
        <MoppetStageScene props={props} />
      </Sequence>
      {outroFrames > 0 && (
        <Sequence from={introFrames + stageFrames} durationInFrames={outroFrames}>
          <TitleSlide card={props.outro} isOutro />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
