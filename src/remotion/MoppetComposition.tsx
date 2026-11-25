import React, { useEffect, useMemo, useState } from "react";
import { Audio } from "@remotion/media";
import { ThreeCanvas } from "@remotion/three";
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";
import {
  AbsoluteFill,
  Sequence,
  Track,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";
import { SceneCaptions } from "../stage/SceneCaptions";
import {
  DEFAULT_VIDEO_PROPS,
  stageVoicesForPiece,
  videoFrameLayout,
  type MoppetVideoProps,
  type TitleCardConfig,
} from "../choir/videoProject";
import {
  performerAtlasUrls,
  resolvePerformerCel,
  resolvePerformerIdentity,
  type PerformerAvatarCel,
} from "../choir/performer";
import { CAST } from "../choir/voices";
import { beatSeconds, LEAD_IN } from "../choir/timeline";
import { duetCel, rightOnCuePerformance } from "../choir/rightOnCuePerformance";
import { vocalLevelAt } from "../choir/vocalTiming";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const VELVET_CURTAIN_BG =
  "repeating-linear-gradient(90deg, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0) 2.4%, rgba(255,210,200,0.10) 3.65%, rgba(0,0,0,0) 5.0%, rgba(0,0,0,0.58) 6.88%)," +
  "repeating-linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.30) 10.9%, rgba(0,0,0,0) 17.2%)," +
  "linear-gradient(180deg, #22080c 0%, #5a1622 55%, #43101a 100%)";

const WORKSHOP_MOPPETS = new Set(["vee", "scribe", "pip", "clank", "gruff", "tabby", "chip", "zap"]);
const STAGE_SETS = new Set(["chip", "clank", "cue", "gruff", "neon", "tabby", "watt", "zap"]);

/** Resolve public/ paths via staticFile() while preserving absolute, blob, data, and dev-bridge URLs. */
function resolveMediaUrl(url: string): string {
  if (/^(?:https?:|blob:|data:|\/__video\/)/.test(url)) return url;
  return staticFile(url.replace(/^\/+/, ""));
}

/** Shared deterministic Three.js TextureLoader cache so mouth/action switches never trigger Suspense flashes. */
const textureCache = new Map<string, Texture>();
const inflightLoads = new Map<string, Promise<Texture | null>>();
const sharedLoader = new TextureLoader();

function loadCachedTexture(resolvedUrl: string): Promise<Texture | null> {
  const existing = textureCache.get(resolvedUrl);
  if (existing) return Promise.resolve(existing);
  const pending = inflightLoads.get(resolvedUrl);
  if (pending) return pending;
  const promise = new Promise<Texture | null>((resolve) => {
    sharedLoader.load(
      resolvedUrl,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        tex.generateMipmaps = false;
        tex.minFilter = LinearFilter;
        tex.magFilter = LinearFilter;
        tex.wrapS = ClampToEdgeWrapping;
        tex.wrapT = ClampToEdgeWrapping;
        tex.needsUpdate = true;
        textureCache.set(resolvedUrl, tex);
        inflightLoads.delete(resolvedUrl);
        resolve(tex);
      },
      undefined,
      () => {
        inflightLoads.delete(resolvedUrl);
        resolve(null);
      },
    );
  });
  inflightLoads.set(resolvedUrl, promise);
  return promise;
}

/** Preload all cast & stage textures up-front under one Remotion delayRender() handle (frame-0 deterministic). */
function usePreloadedTextures(urls: readonly string[]): ReadonlyMap<string, Texture> {
  const { delayRender, continueRender } = useDelayRender();
  const key = urls.join("|");
  const [, setVersion] = useState(0);

  useEffect(() => {
    const missing = urls.filter((u) => !textureCache.has(u));
    if (missing.length === 0) return;
    let alive = true;
    const handle = delayRender(`Preloading ${missing.length} stage textures`);
    void Promise.all(missing.map((u) => loadCachedTexture(u))).finally(() => {
      if (alive) setVersion((v) => v + 1);
      continueRender(handle);
    });
    return () => {
      alive = false;
      continueRender(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delayRender, continueRender]);

  return textureCache;
}

/** Procedural soft radial ground-contact shadow texture (separate from character sprites). */
let sharedShadowTexture: CanvasTexture | null = null;
function getShadowTexture(): CanvasTexture | null {
  if (sharedShadowTexture) return sharedShadowTexture;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(64, 32, 4, 64, 32, 60);
  grad.addColorStop(0, "rgba(6, 3, 4, 0.72)");
  grad.addColorStop(0.55, "rgba(6, 3, 4, 0.34)");
  grad.addColorStop(1, "rgba(6, 3, 4, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 64);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  sharedShadowTexture = tex;
  return tex;
}

/** Procedural soft radial white mask for active-singer floor spotlight pools (tinted via material color). */
let sharedGlowTexture: CanvasTexture | null = null;
function getGlowTexture(): CanvasTexture | null {
  if (sharedGlowTexture) return sharedGlowTexture;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(64, 32, 2, 64, 32, 60);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  grad.addColorStop(0.45, "rgba(255, 255, 255, 0.42)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 64);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  sharedGlowTexture = tex;
  return tex;
}

/** Procedural Studio 404 theatrical velvet-and-timber stage backdrop (rendered in WebGL so zero blank frames). */
function createStageBackdropTexture(width: number, height: number): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const w = Math.min(1024, Math.max(512, Math.round(width / 2)));
  const h = Math.min(1024, Math.max(512, Math.round(height / 2)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const floorY = Math.round(h * 0.73);
  // Deep theatrical back wall + warm center wash
  const wallGrad = ctx.createLinearGradient(0, 0, 0, floorY);
  wallGrad.addColorStop(0, "#140c14");
  wallGrad.addColorStop(0.55, "#2a1720");
  wallGrad.addColorStop(1, "#3d2226");
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, w, floorY);

  // Subtle vertical velvet pleats
  const pleats = 18;
  for (let i = 0; i < pleats; i++) {
    const px = (i / pleats) * w;
    const pw = w / pleats;
    const pleatGrad = ctx.createLinearGradient(px, 0, px + pw, 0);
    pleatGrad.addColorStop(0, "rgba(0, 0, 0, 0.36)");
    pleatGrad.addColorStop(0.42, "rgba(255, 206, 172, 0.05)");
    pleatGrad.addColorStop(1, "rgba(0, 0, 0, 0.36)");
    ctx.fillStyle = pleatGrad;
    ctx.fillRect(px, 0, pw + 1, floorY);
  }

  // Warm overhead stage spotlight glow
  const spotGrad = ctx.createRadialGradient(w * 0.5, floorY * 0.55, w * 0.04, w * 0.5, floorY * 0.55, w * 0.55);
  spotGrad.addColorStop(0, "rgba(246, 201, 144, 0.17)");
  spotGrad.addColorStop(0.6, "rgba(218, 134, 96, 0.06)");
  spotGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = spotGrad;
  ctx.fillRect(0, 0, w, floorY);

  // Solid hardwood stage apron floor
  const floorGrad = ctx.createLinearGradient(0, floorY, 0, h);
  floorGrad.addColorStop(0, "#5c3d2c");
  floorGrad.addColorStop(0.18, "#472e22");
  floorGrad.addColorStop(1, "#1e120f");
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, floorY, w, h - floorY);

  // Subtle plank perspective grooves
  ctx.strokeStyle = "rgba(18, 9, 7, 0.28)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 5; i++) {
    const py = floorY + ((h - floorY) * i) / 6;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();
  }

  // Warm brass apron trim at back edge of stage floor
  const trimGrad = ctx.createLinearGradient(0, 0, w, 0);
  trimGrad.addColorStop(0, "rgba(227, 189, 127, 0.08)");
  trimGrad.addColorStop(0.5, "rgba(255, 224, 174, 0.45)");
  trimGrad.addColorStop(1, "rgba(227, 189, 127, 0.08)");
  ctx.fillStyle = trimGrad;
  ctx.fillRect(0, floorY - 2, w, 3);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  return tex;
}

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
      <div style={{ position: "absolute", inset: "0 0 18% 0", backgroundImage: VELVET_CURTAIN_BG, opacity: 0.16 }} />
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
            translate: `0px ${interpolate(rise, [0, 1], [14, 0]).toFixed(2)}px`,
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
            fontSize: 34,
            fontWeight: 500,
            lineHeight: 1.35,
            color: "#d8c6b2",
            maxWidth: portrait ? 880 : 1120,
            translate: `0px ${interpolate(rise, [0, 1], [10, 0]).toFixed(2)}px`,
          }}
        >
          {card.subheading}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Single sprite mesh with synchronous UV cell offset directly from Remotion's useCurrentFrame(). */
function AtlasSprite({
  source,
  cols,
  rows,
  cel,
  x,
  feetY,
  z,
  maxHeight,
  maxWidth,
  showShadow = true,
  accentColor,
  singingLevel = 0,
}: {
  source: Texture | undefined;
  cols: number;
  rows: number;
  cel: number;
  x: number;
  feetY: number;
  z: number;
  maxHeight: number;
  maxWidth: number;
  showShadow?: boolean;
  accentColor?: string;
  singingLevel?: number;
}) {
  const map = useMemo(() => {
    if (!source) return null;
    const clone = source.clone();
    clone.colorSpace = SRGBColorSpace;
    clone.generateMipmaps = false;
    clone.minFilter = LinearFilter;
    clone.magFilter = LinearFilter;
    clone.wrapS = ClampToEdgeWrapping;
    clone.wrapT = ClampToEdgeWrapping;
    clone.needsUpdate = true;
    return clone;
  }, [source]);

  useEffect(() => () => {
    map?.dispose();
  }, [map]);

  if (!map || !source?.image) return null;

  const img = source.image as { width: number; height: number };
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const totalCells = safeCols * safeRows;
  const safeCel = ((Math.floor(cel) % totalCells) + totalCells) % totalCells;
  const col = safeCel % safeCols;
  const row = Math.floor(safeCel / safeCols);

  // Update UV offset synchronously during render so ThreeCanvas draws the exact cel on this frame.
  map.repeat.set(1 / safeCols, 1 / safeRows);
  map.offset.set(col / safeCols, 1 - (row + 1) / safeRows);

  const cellAspect = (img.width / safeCols) / Math.max(1, img.height / safeRows);
  const height = Math.min(maxHeight, maxWidth / Math.max(0.25, cellAspect));
  const width = height * cellAspect;
  const shadowTex = showShadow ? getShadowTexture() : null;
  const glowTex = accentColor && singingLevel > 0.08 ? getGlowTexture() : null;

  return (
    <group position={[x, feetY, z]}>
      {shadowTex && (
        <mesh position={[0, 4, -0.4]}>
          <planeGeometry args={[width * 0.72, Math.max(24, height * 0.095)]} />
          <meshBasicMaterial map={shadowTex} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {glowTex && (
        <mesh position={[0, 6, -0.35]}>
          <planeGeometry args={[width * 0.92, Math.max(30, height * 0.12)]} />
          <meshBasicMaterial
            map={glowTex}
            color={accentColor}
            transparent
            opacity={clamp(singingLevel * 0.42, 0, 0.42)}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
      <mesh position={[0, height / 2, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={map} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Grounded backdrop plane inside ThreeCanvas so set plates are covered by delayRender(). */
function StageBackdrop({
  setTexture,
  width,
  height,
  riser,
}: {
  setTexture: Texture | undefined;
  width: number;
  height: number;
  riser: { width: number; topY: number; bottomY: number } | null;
}) {
  const fallbackTexture = useMemo(() => createStageBackdropTexture(width, height), [width, height]);
  useEffect(() => () => {
    fallbackTexture?.dispose();
  }, [fallbackTexture]);

  const activeTex = setTexture ?? fallbackTexture;
  let planeW = width;
  let planeH = height;
  if (activeTex?.image) {
    const img = activeTex.image as { width: number; height: number };
    const texAspect = img.width / Math.max(1, img.height);
    const viewAspect = width / Math.max(1, height);
    if (texAspect > viewAspect) {
      planeH = height;
      planeW = height * texAspect;
    } else {
      planeW = width;
      planeH = width / Math.max(0.2, texAspect);
    }
  }

  return (
    <group>
      {activeTex && (
        <mesh position={[0, 0, -40]}>
          <planeGeometry args={[planeW, planeH]} />
          <meshBasicMaterial map={activeTex} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {riser && (
        <group position={[0, 0, -10]}>
          {/* Dark shadow under the wooden riser */}
          <mesh position={[0, riser.bottomY - 8, -0.3]}>
            <planeGeometry args={[riser.width * 1.03, 22]} />
            <meshBasicMaterial color="#0b0505" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
          </mesh>
          {/* Wooden choir riser front face */}
          <mesh position={[0, (riser.topY + riser.bottomY) / 2, 0]}>
            <planeGeometry args={[riser.width, Math.max(18, riser.topY - riser.bottomY)]} />
            <meshBasicMaterial color="#352019" depthWrite={false} toneMapped={false} />
          </mesh>
          {/* Lit riser top deck plank where back-row feet stand */}
          <mesh position={[0, riser.topY + 12, 0.1]}>
            <planeGeometry args={[riser.width * 1.01, 28]} />
            <meshBasicMaterial color="#593a2a" depthWrite={false} toneMapped={false} />
          </mesh>
          {/* Warm brass riser nosing */}
          <mesh position={[0, riser.topY - 1, 0.2]}>
            <planeGeometry args={[riser.width * 1.01, 4]} />
            <meshBasicMaterial color="#c99f67" transparent opacity={0.62} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

interface StagePlacement {
  x: number;
  feetY: number;
  z: number;
  maxHeight: number;
  maxWidth: number;
}

function layoutCast(
  count: number,
  width: number,
  height: number,
): { placements: StagePlacement[]; riser: { width: number; topY: number; bottomY: number } | null } {
  const portrait = height > width;
  const frontLimit = portrait ? 3 : 5;
  const frontFeetY = -height * (portrait ? 0.39 : 0.42);
  const backFeetY = -height * (portrait ? 0.17 : 0.20);
  const floorEdgeY = -height * 0.27;

  if (count <= frontLimit) {
    const usableW = width * (count === 1 ? 0.56 : 0.88);
    const slotW = usableW / Math.max(1, count);
    const maxH = height * (count === 1 ? 0.72 : portrait ? 0.46 : 0.62);
    const placements: StagePlacement[] = Array.from({ length: count }, (_, i) => ({
      x: (i - (count - 1) / 2) * slotW,
      feetY: frontFeetY,
      z: 4 + (i % 2) * 0.2,
      maxHeight: maxH,
      maxWidth: slotW * 0.96,
    }));
    return { placements, riser: null };
  }

  // Two-tier grounded choir formation: front row on stage apron, back row standing on wooden choir riser.
  const frontCount = Math.ceil(count / 2);
  const backCount = count - frontCount;
  const frontSlotW = (width * 0.88) / frontCount;
  const backSlotW = (width * 0.76) / backCount;
  const frontH = height * (portrait ? 0.38 : 0.50);
  const backH = height * (portrait ? 0.34 : 0.44);

  const placements: StagePlacement[] = [];
  for (let i = 0; i < count; i++) {
    if (i < frontCount) {
      placements.push({
        x: (i - (frontCount - 1) / 2) * frontSlotW,
        feetY: frontFeetY,
        z: 4 + (i % 2) * 0.2,
        maxHeight: frontH,
        maxWidth: frontSlotW * 0.94,
      });
    } else {
      const bi = i - frontCount;
      placements.push({
        x: (bi - (backCount - 1) / 2) * backSlotW,
        feetY: backFeetY,
        z: -2 + (bi % 2) * 0.2,
        maxHeight: backH,
        maxWidth: backSlotW * 0.92,
      });
    }
  }

  const riserWidth = Math.min(width * 0.88, Math.max(width * 0.52, backCount * backSlotW * 1.12));
  return {
    placements,
    riser: {
      width: riserWidth,
      topY: backFeetY - 2,
      bottomY: Math.min(floorEdgeY, backFeetY - 36),
    },
  };
}

function CastStage({ project }: { project: MoppetVideoProps }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const time = frame / fps;
  const piece = project.piece ?? DEFAULT_VIDEO_PROPS.piece!;
  const beat = (time - LEAD_IN) / beatSeconds(piece);

  const cast = useMemo(
    () =>
      stageVoicesForPiece(piece, CAST, project.studio404).map((voice) =>
        resolvePerformerIdentity(voice, project.studio404, piece.title),
      ),
    [piece, project.studio404],
  );

  const curtainCall = useMemo(
    () => piece.sections?.find((s) => s.name === "curtain call"),
    [piece.sections],
  );
  const isRightOnCue = project.studio404 && piece.title === "Right on Cue";
  const duet = isRightOnCue ? rightOnCuePerformance(piece, beat) : null;

  const firstActor = cast[0]?.artKey;
  const setId = isRightOnCue
    ? "right-on-cue"
    : piece.title === "Take Two"
      ? "neon-repair"
      : cast.length === 1 && firstActor && STAGE_SETS.has(firstActor)
        ? firstActor
        : null;
  const setUrl = setId ? resolveMediaUrl(`/rehearsal/sets/${setId}.webp`) : null;

  // Preload every atlas and set plate needed across the full piece before frame 0 renders.
  const preloadUrls = useMemo(() => {
    const urls = new Set<string>();
    if (setUrl) urls.add(setUrl);
    for (const actor of cast) {
      if (!project.studio404 && WORKSHOP_MOPPETS.has(actor.artKey)) {
        urls.add(resolveMediaUrl(`/moppets/${actor.artKey}/closed.webp`));
        urls.add(resolveMediaUrl(`/moppets/${actor.artKey}/open.webp`));
      } else {
        for (const u of performerAtlasUrls(actor.artKey, Boolean(curtainCall))) {
          urls.add(resolveMediaUrl(u));
        }
      }
    }
    if (isRightOnCue) {
      urls.add(resolveMediaUrl("/rehearsal/pins/cord/back.webp"));
      urls.add(resolveMediaUrl("/rehearsal/pins/cord/front.webp"));
    }
    return [...urls].sort();
  }, [cast, curtainCall, isRightOnCue, project.studio404, setUrl]);

  const textures = usePreloadedTextures(preloadUrls);
  const { placements, riser } = useMemo(
    () => layoutCast(cast.length, width, height),
    [cast.length, width, height],
  );

  const caption = project.bubbles.find((clip) => time >= clip.startSec && time < clip.startSec + clip.durationSec);
  const speaker = cast.findIndex(({ id }) => id === caption?.speakerId);
  const follow =
    project.cameraAutoFollow && caption && speaker >= 0
      ? clamp(Math.min(time - caption.startSec, caption.startSec + caption.durationSec - time) / 0.24, 0, 1)
      : 0;
  const zoom = project.cameraAutoFollow && duet ? duet.camera.zoom : 1 + 0.11 * follow;
  const pan =
    project.cameraAutoFollow && duet
      ? (0.5 - duet.camera.focusX) * width * zoom
      : follow > 0 && placements[speaker]
        ? -placements[speaker].x * 0.34 * follow
        : 0;

  return (
    <AbsoluteFill
      role="img"
      aria-label="Cast stage"
      data-camera={project.cameraAutoFollow ? "follow" : "wide"}
    >
      <ThreeCanvas
        width={width}
        height={height}
        orthographic
        camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 500 }}
        style={{ background: "#140c14" }}
      >
        <group position={[pan, 0, 0]} scale={[zoom, zoom, 1]}>
          <StageBackdrop
            setTexture={setUrl ? textures.get(setUrl) : undefined}
            width={width}
            height={height}
            riser={riser}
          />
          {duet && duet.cordFrame !== null && (
            <AtlasSprite
              source={textures.get(resolveMediaUrl("/rehearsal/pins/cord/back.webp"))}
              cols={8}
              rows={6}
              cel={duet.cordFrame}
              x={0}
              feetY={-height * 0.42}
              z={-1}
              maxHeight={height * 0.64}
              maxWidth={width * 0.72}
              showShadow={false}
            />
          )}
          {cast.map(({ id, artKey, color }, index) => {
            const active = piece.tracks
              .find((track) => track.id === id)
              ?.events.some((event) => event.beat <= beat && beat < event.beat + event.beats);
            const level = vocalLevelAt(project.vocalTiming, id, time) ?? Number(Boolean(active));
            const open = level > 0.1;
            const pose = { singing: level > 0, level, open: level, viseme: Number(open) };

            let sheet: PerformerAvatarCel;
            if (duet && (artKey === "cue" || artKey === "neon")) {
              sheet = duetCel(duet, artKey);
            } else if (artKey === "tabby" && curtainCall && beat >= curtainCall.beat && beat < curtainCall.beat + 8) {
              sheet = {
                atlasUrl: "/rehearsal/pins/tabby/bow.webp",
                cols: 8,
                rows: 6,
                frame: Math.round((47 * (beat - curtainCall.beat)) / 8),
                action: "bow",
                source: "pin-atlas",
              };
            } else if (!project.studio404 && WORKSHOP_MOPPETS.has(artKey)) {
              sheet = {
                atlasUrl: `/moppets/${artKey}/${open ? "open" : "closed"}.webp`,
                cols: 4,
                rows: 2,
                frame: Math.floor(Math.max(0, beat) * 2) % 8,
                action: pose.singing ? "sing" : "idle",
                source: "sprite-pair",
              };
            } else {
              sheet = resolvePerformerCel(artKey, pose, Math.max(0, beat), time, 0, open);
            }

            const slot = placements[index];
            const duetOffset = duet && artKey === "neon" ? -duet.neonTravel * width * 0.08 : 0;
            return (
              <AtlasSprite
                key={id}
                source={textures.get(resolveMediaUrl(sheet.atlasUrl))}
                cols={sheet.cols}
                rows={sheet.rows}
                cel={sheet.frame}
                x={slot.x + duetOffset}
                feetY={slot.feetY}
                z={slot.z}
                maxHeight={slot.maxHeight}
                maxWidth={slot.maxWidth}
                accentColor={color}
                singingLevel={level}
              />
            );
          })}
          {duet && duet.cordFrame !== null && (
            <AtlasSprite
              source={textures.get(resolveMediaUrl("/rehearsal/pins/cord/front.webp"))}
              cols={8}
              rows={6}
              cel={duet.cordFrame}
              x={0}
              feetY={-height * 0.42}
              z={6}
              maxHeight={height * 0.64}
              maxWidth={width * 0.72}
              showShadow={false}
            />
          )}
        </group>
      </ThreeCanvas>
    </AbsoluteFill>
  );
}

function SoloSubtitles({ project }: { project: MoppetVideoProps }) {
  const time = useCurrentFrame() / useVideoConfig().fps;
  const lines = project.bubbles.filter((b) => time >= b.startSec && time < b.startSec + b.durationSec);
  return (
    <SceneCaptions
      time={time}
      lines={lines.map((b) => ({
        key: b.id,
        speaker: b.speaker,
        text: b.text,
        accent: b.color,
        bg: b.bg,
        fg: b.fg,
        start: b.startSec,
        end: b.startSec + b.durationSec,
        words: (b.words ?? []).map((w) => ({ text: w.text, start: w.startSec, end: w.endSec })),
      }))}
    />
  );
}

export const MoppetComposition: React.FC<MoppetVideoProps> = (props) => {
  const { fps } = useVideoConfig();
  const masterUrl = props.audioUrl;
  const { introFrames, stageFrames, outroFrames } = videoFrameLayout({ ...props, fps });

  return (
    <AbsoluteFill style={{ background: "#070203" }}>
      <Track name="Cards">
        {introFrames > 0 && (
          <Sequence name="Intro card" from={0} durationInFrames={introFrames}>
            <TitleSlide card={props.intro} />
          </Sequence>
        )}
        {outroFrames > 0 && (
          <Sequence name="Outro card" from={introFrames + stageFrames} durationInFrames={outroFrames}>
            <TitleSlide card={props.outro} isOutro />
          </Sequence>
        )}
      </Track>
      <Track name="Stage">
        <Sequence name="Three.js cast stage" from={introFrames} durationInFrames={stageFrames}>
          <CastStage project={props} />
        </Sequence>
      </Track>
      <Track name="Captions">
        <Sequence name="Lyric captions" from={introFrames} durationInFrames={stageFrames}>
          <SoloSubtitles project={props} />
        </Sequence>
      </Track>
      {masterUrl && (
        <Track name="Audio">
          <Audio
            name="Master mix"
            from={introFrames}
            durationInFrames={stageFrames}
            src={resolveMediaUrl(masterUrl)}
            volume={props.audioVolume}
          />
        </Track>
      )}
    </AbsoluteFill>
  );
};
