/**
 * Typed runtime interface for the compiled Studio 404 Character Bible manifest (`public/cast/manifest.json`
 * mirrored synchronously at build time to `src/choir/castManifest.generated.json`).
 *
 * Pure and engine-free: zero hardcoded per-character branches.
 */
import rawManifest from "./castManifest.generated.json";
import type { PerformerAvatarCel, PerformerPoseInput } from "./performer.ts";

export interface AtlasClipSpec {
  readonly url: string;
  readonly cols: number;
  readonly rows: number;
  readonly frames: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly anchorY: number;
  readonly startFrame?: number;
  readonly frameCount?: number;
  readonly cellWidth?: number;
  readonly cellHeight?: number;
}

export interface HoseDeformSpec {
  /** Fraction `0..1` along the limb axis where flexible cable/hose ends and rigid metal hardware begins. */
  readonly bendEndU: number;
  /** Primary mesh extension axis from root pivot toward the distal hand/claw. */
  readonly axis: "x-right" | "x-left" | "y-down";
  /** Baseline C-curve arc amplitude in node-local pixels at neutral rest pose. */
  readonly restBendPx: number;
}

export interface MultiplaneCrtFaceSpec {
  readonly nodeId: number;
  readonly screenCenter: readonly [number, number];
  readonly screenSize: readonly [number, number];
  readonly skewYDeg: number;
  /** `[offsetX, offsetY, size]` relative to `screenCenter`. */
  readonly leftEye: readonly [number, number, number];
  /** `[offsetX, offsetY, size]` relative to `screenCenter`. */
  readonly rightEye: readonly [number, number, number];
  /** `[offsetX, offsetY]` relative to `screenCenter` for procedural mouth + live `mouthPivot`. */
  readonly mouth: readonly [number, number];
}

export interface MultiplaneNodeSpec {
  readonly id: number;
  readonly name: string;
  readonly role: string;
  readonly parent: number | null;
  readonly sourceType: "Null" | "Footage";
  readonly publicSrc: string | null;
  readonly width: number;
  readonly height: number;
  readonly anchor: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly rotationDeg: number;
  readonly defaultOpacity: number;
  readonly zPx: number;
  /** Exact wrist/claw tip pixel coordinate `(px, py)` inside this node's texture space. */
  readonly distalOffset?: readonly [number, number];
  /** Flexible hose curve parameters preserving rigid distal hardware (`u > bendEndU`). */
  readonly hoseDeform?: HoseDeformSpec;
}

export interface MultiplaneRigSpec {
  readonly id: string;
  readonly displayName: string;
  readonly compWidth: number;
  readonly compHeight: number;
  readonly centerX: number;
  readonly floorY: number;
  readonly hasProceduralPhosphorCrt: boolean;
  readonly hasPurplePolarizerGagProp: boolean;
  readonly crtFace?: MultiplaneCrtFaceSpec;
  readonly extraParts: Readonly<Record<string, { readonly url: string; readonly width: number; readonly height: number }>>;
  readonly nodes: readonly MultiplaneNodeSpec[];
}

export interface BibleAuditRecord {
  readonly status: "verified-bible" | "legacy-unverified" | "mismatch";
  readonly bibleFile: string;
  readonly bibleHeroSrc: string;
  readonly bibleHeroUrl: string;
  readonly stageModelSource: string;
  readonly animationTier: "multiplane-2.5d" | "effectcraft-webm-atlas" | "bible-webm-atlas" | "legacy-rehearsal-stale" | "static-cutout";
  readonly notes: string;
}

export interface IkPointSpec {
  readonly id: string;
  readonly label: string;
  readonly role:
    | "root-foot"
    | "pelvis"
    | "spine"
    | "neck"
    | "head-jaw"
    | "shoulder-l"
    | "hand-l"
    | "shoulder-r"
    | "hand-r"
    | "prop";
  /** Normalized horizontal coordinate in character cell/rig box (0 = left, 1 = right). */
  readonly x: number;
  /** Normalized vertical coordinate in character cell/rig box (0 = top, 1 = bottom). */
  readonly y: number;
  readonly parent?: string;
}

export interface VocalSyncSpec {
  readonly mode: "multiplane-jaw-sine" | "open-closed-viseme" | "sing-vs-idle-loop" | "static-no-mouth";
  readonly hasDedicatedMouthOpen: boolean;
  readonly mouthPivot: readonly [number, number];
  readonly note: string;
}

export interface BibleDefect {
  readonly code: string;
  readonly severity: "error" | "warn";
  readonly category: "model-mismatch" | "missing-animation" | "vocal-sync" | "ik-pivot" | "edge-clipping" | "alpha-halo";
  readonly message: string;
}

export interface AniCraftFaceSheetSpec {
  readonly url: string;
  readonly cols: number;
  readonly rows: number;
  /** Width & height in normalized character height (height = 1.0) local head-bone space. */
  readonly width: number;
  readonly height: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly offsetZ?: number;
  /** Optional: render lower mouth-only sub-crop of each cell (preserves sculpted 3D eyes). */
  readonly mouthOnly?: boolean;
}

export interface AniCraft2DFaceOverlaySpec {
  readonly url: string;
  readonly cols: number;
  readonly rows: number;
  /** Normalized pivot `(0..1 from left, 0..1 from top)` inside the character atlas cell. */
  readonly pivotX: number;
  readonly pivotY: number;
  readonly widthFrac: number;
  readonly heightFrac: number;
  readonly mouthOnly?: boolean;
}

export interface CharacterRigArtifacts {
  readonly rigJson: string;
  readonly meshJson: string;
  readonly lottieJson: string;
  readonly blenderJson: string;
}

export interface Moppet3DModelSpec {
  readonly url: string;
  readonly scale?: number;
  readonly yOffset?: number;
  readonly yawOffsetDeg?: number;
  readonly jawBoneName?: string;
  readonly jawMaxDeg?: number;
  readonly faceOverlay?: "tabby-led-mouth" | "anicraft-face-sheet" | "screen-material-slot";
  readonly screenStyle?: "neon-rings" | "crt-phosphor";
  readonly faceSheet?: AniCraftFaceSheetSpec;
}

export interface CastCharacterManifest {
  readonly id: string;
  readonly bibleDir: string;
  readonly displayName: string;
  readonly role: string;
  readonly color: string;
  readonly accentB: string;
  readonly heightDu: number;
  readonly scaleFactor: number;
  readonly portraitUrl: string;
  readonly renderMode: "multiplane" | "atlas";
  readonly model3d?: Moppet3DModelSpec;
  readonly anicraftFaceOverlay?: AniCraft2DFaceOverlaySpec;
  readonly multiplane?: MultiplaneRigSpec;
  readonly clips: Readonly<Record<string, AtlasClipSpec>>;
  readonly directedTakes: Readonly<Record<string, string>>;
  readonly bibleAudit?: BibleAuditRecord;
  readonly rigArtifacts?: CharacterRigArtifacts;
  readonly ikPoints: readonly IkPointSpec[];
  readonly vocalSyncSpec: VocalSyncSpec;
  readonly defects: readonly BibleDefect[];
}

export interface SetPlateManifest {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

export interface CompiledCastManifest {
  readonly generatedAt: string;
  readonly version: number;
  readonly studio404Count: number;
  readonly aliases: Readonly<Record<string, string>>;
  readonly characters: Readonly<Record<string, CastCharacterManifest>>;
  readonly sets: Readonly<Record<string, SetPlateManifest>>;
}

export const CAST_MANIFEST = rawManifest as unknown as CompiledCastManifest;

/** Resolve aliases (e.g. `tracking` -> `tracker`, `moonbeam` -> `moonbell`, `vee` -> `neon`) to canonical Bible ID. */
export function canonicalCastId(id: string): string {
  const key = id.toLowerCase();
  if (CAST_MANIFEST.characters[key]) return key;
  return CAST_MANIFEST.aliases[key] ?? key;
}

export function getCastCharacter(id: string): CastCharacterManifest | undefined {
  return CAST_MANIFEST.characters[canonicalCastId(id)];
}

const EXTRA_SET_PLATES: Readonly<Record<string, string>> = {
  "studio404-spotlight": "/cast/sets/studio404-spotlight.webp",
};

export function getSetPlateUrl(setId: string | null | undefined): string | null {
  if (!setId) return null;
  if (EXTRA_SET_PLATES[setId]) return EXTRA_SET_PLATES[setId];
  const compiled = CAST_MANIFEST.sets[setId];
  if (compiled) return compiled.url;
  return `/rehearsal/sets/${setId}.webp`;
}

export interface ActiveTakeState {
  readonly clipKey: string;
  readonly elapsedSec: number;
  readonly durationSec: number;
}

/** Resolve a directed take name (`; take <name>` or signature gesture) to a character's manifest clip key. */
export function resolveDirectedTakeClip(castId: string, takeName: string): AtlasClipSpec & { clipKey: string } | null {
  const ch = getCastCharacter(castId);
  if (!ch) return null;
  const clipKey = ch.clips[takeName] ? takeName : ch.directedTakes[takeName];
  if (!clipKey) return null;
  const clip = ch.clips[clipKey];
  if (!clip) return null;
  return { ...clip, clipKey };
}

/** Sample a clip spec deterministically at `timeSec` / `beat` (supporting sub-ranges and one-shot directed takes). */
export function sampleManifestClip(
  clip: AtlasClipSpec,
  clipKey: string,
  timeSec: number,
  still: boolean,
  oneShotElapsedSec?: number,
): PerformerAvatarCel {
  const start = clip.startFrame ?? 0;
  const count = Math.max(1, clip.frameCount ?? clip.frames);
  let idx = 0;
  if (!still && count > 1) {
    if (oneShotElapsedSec !== undefined && !clip.loop) {
      idx = Math.min(count - 1, Math.max(0, Math.floor(oneShotElapsedSec * clip.fps)));
    } else {
      const t = oneShotElapsedSec !== undefined ? oneShotElapsedSec : Math.max(0, timeSec);
      idx = Math.floor(Math.max(0, t) * clip.fps) % count;
    }
  }
  return {
    atlasUrl: clip.url,
    cols: clip.cols,
    rows: clip.rows,
    frame: start + idx,
    action: clipKey,
    source: "pin-atlas",
    anchorY: clip.anchorY,
  };
}

/**
 * Pure manifest-driven cel resolver for any Studio 404 character.
 * Priority: active directed take clip -> open/closed singing clip -> sing clip -> idle clip.
 */
export function resolveManifestCel(
  castId: string,
  pose: PerformerPoseInput,
  beat: number,
  timeSec: number,
  plateIndex: number,
  mouthOpen: boolean,
  still = false,
  activeTake?: ActiveTakeState | null,
): PerformerAvatarCel | null {
  const ch = getCastCharacter(castId);
  if (!ch) return null;

  if (activeTake && ch.clips[activeTake.clipKey]) {
    return sampleManifestClip(
      ch.clips[activeTake.clipKey],
      activeTake.clipKey,
      timeSec,
      still,
      activeTake.elapsedSec,
    );
  }

  const singing = !still && pose.singing;
  void mouthOpen;
  void beat;

  // Tabby's 4x2 viseme sheet holds all 8 CHIMERA viseme cels (`rest=0, blink=1, ee=2, oh=3, closed=4, fv=5, oo=6, ah=7`)
  if (singing && ch.clips.visemes && ch.clips.visemes.frames === 8) {
    const TABBY_CELL: Record<number, number> = { 0: 0, 1: 4, 2: 5, 3: 2, 4: 7, 5: 3, 6: 6, 7: 1 };
    const vCode = Math.max(0, Math.min(7, Math.round(pose.viseme)));
    const cell = pose.open <= 0.03 ? 4 : (TABBY_CELL[vCode] ?? 7);
    return {
      atlasUrl: ch.clips.visemes.url,
      cols: ch.clips.visemes.cols,
      rows: ch.clips.visemes.rows,
      frame: cell,
      action: "visemes",
      source: "pin-atlas",
      anchorY: ch.clips.visemes.anchorY,
    };
  }

  // Single-frame cutout rigs (e.g. Latch: rest.webp / speaking.webp / listening.webp) articulate syllables cleanly
  if (ch.clips.idle?.frames === 1 && ch.clips.sing?.frames === 1) {
    const openSyllable = singing && pose.open > 0.04;
    const clipKey = openSyllable ? "sing" : "idle";
    const clip = ch.clips[clipKey] ?? ch.clips.idle;
    return sampleManifestClip(clip, clipKey, timeSec, still);
  }

  let clipKey = "idle";
  if (singing) {
    if (plateIndex >= 3 && ch.clips.bow) {
      clipKey = "bow";
    } else if (ch.clips.sing) {
      clipKey = "sing";
    } else if (ch.clips["sing-open"]) {
      clipKey = "sing-open";
    } else if (ch.clips.cast) {
      clipKey = "cast";
    } else if (ch.clips.performance) {
      clipKey = "performance";
    } else if (ch.clips.turn) {
      clipKey = "turn";
    } else if (ch.clips["acting-sheet"]) {
      clipKey = "acting-sheet";
    }
  }

  const clip = ch.clips[clipKey] ?? ch.clips.idle;
  if (!clip) return null;

  // Tracker Canon v2 (`sing.webp`): synchronize VHS cassette-drawer opening directly to CHIMERA phoneme openness
  if (ch.id === "tracker" && singing && clipKey === "sing" && clip.frames >= 24) {
    const effOpen = pose.open > 0.001 ? pose.open : mouthOpen ? 0.45 : 0;
    const CLOSED_FRAMES = [0, 1, 5, 6, 11, 17, 22, 23];
    const MID_FRAMES = [4, 9, 10, 14, 15, 19, 20];
    const WIDE_FRAMES = [2, 3, 7, 8, 12, 13, 18];
    const bank = effOpen > 0.36 ? WIDE_FRAMES : effOpen > 0.04 ? MID_FRAMES : CLOSED_FRAMES;
    const stepIdx = still ? 0 : Math.floor(Math.max(0, timeSec) * 8) % bank.length;
    return {
      atlasUrl: clip.url,
      cols: clip.cols,
      rows: clip.rows,
      frame: bank[stepIdx] ?? 0,
      action: clipKey,
      source: "fmv-manifest",
      anchorY: clip.anchorY,
    };
  }

  return sampleManifestClip(clip, clipKey, timeSec, still);
}

/** Collect every asset URL (multiplane rig WebP parts + extraParts + every atlas clip) for delayRender() preloading. */
export function collectCastAssetUrls(castId: string): string[] {
  const ch = getCastCharacter(castId);
  if (!ch) return [];
  const urls = new Set<string>();
  for (const clip of Object.values(ch.clips)) {
    urls.add(clip.url);
  }
  if (ch.anicraftFaceOverlay?.url) {
    urls.add(ch.anicraftFaceOverlay.url);
  }
  if (ch.multiplane) {
    for (const node of ch.multiplane.nodes) {
      if (node.publicSrc) urls.add(node.publicSrc);
    }
    for (const extra of Object.values(ch.multiplane.extraParts)) {
      urls.add(extra.url);
    }
  }
  return [...urls];
}
