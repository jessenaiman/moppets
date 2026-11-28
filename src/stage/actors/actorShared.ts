/**
 * Shared types, caches, grounding pixel scanners, depth materials, and GLB clip helpers
 * for the 3-tier Moppet stage performer engine.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CastCharacterManifest } from "../../choir/castManifest.ts";
import type { PerformerAvatarCel } from "../../choir/performer.ts";
import type { VocalArticSample } from "../../choir/vocalTiming.ts";
import { UNIT_PLANE_GEO } from "../stageGeometries.ts";
import { createSoftGlowTexture } from "../stageTextures.ts";
import type { StageWorldId } from "../stageWorlds.ts";
import type { TabbyFacialState } from "../visemeMapper.ts";

export type { VocalArticSample };

export type RigPreference = "auto-3d" | "multiplane-first";

export interface PerformerUpdateInput {
  readonly key: string;
  readonly castId: string;
  readonly manifest: CastCharacterManifest | undefined;
  readonly cel: PerformerAvatarCel;
  readonly accentColor: string;
  readonly worldId: StageWorldId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Ground support Y surface for shadows & pads (0 on floor, 0.28 on Studio 404 oak riser). */
  readonly floorY?: number;
  readonly worldHeight: number;
  readonly facing: number;
  readonly rotY: number;
  readonly squashX: number;
  readonly stretchY: number;
  readonly leanRad: number;
  readonly timeSec: number;
  readonly beat: number;
  readonly performing: boolean;
  readonly singing: boolean;
  readonly level: number;
  readonly mouthOpen: boolean;
  readonly gagActive: boolean;
  readonly phaseIndex: number;
  readonly actionClip: string | null;
  readonly actionElapsedSec?: number;
  readonly clipProgress01?: number;
  /** When true, skip GlbPerformer3D's sinusoidal idle/sing groove because caller supplies pose-to-pose groove. */
  readonly poseDrivenGroove?: boolean;
  readonly artic?: VocalArticSample;
  readonly tabbyFacial?: TabbyFacialState;
  readonly rigPreference: RigPreference;
}

export interface StageActor3D {
  readonly group: THREE.Group;
  update(inp: PerformerUpdateInput): void;
  getHeadWorldPos(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Monotonic z-sorted render order across all 3 tiers so riser performers never bleed through front actors. */
export const zRenderOrder = (z: number): number => Math.round(300 + z * 100);

// ── Shared Soft Contact Shadow Texture & Offscreen Opaque Pixel Scanners (`S-53`) ──
let sharedContactShadowTex: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture | null {
  if (!sharedContactShadowTex) {
    sharedContactShadowTex = createSoftGlowTexture("rgba(6,4,8,0.68)", "rgba(6,4,8,0.22)");
  }
  return sharedContactShadowTex;
}

export function createContactShadowMesh(opacity: number): {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
} {
  const mat = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture() ?? undefined,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(UNIT_PLANE_GEO, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  return { mesh, mat };
}

export interface OpaqueImageBounds {
  readonly minXNorm: number;
  readonly maxXNorm: number;
  readonly topNorm: number;
  readonly bottomNorm: number;
}

const opaqueBoundsCache = new WeakMap<object, OpaqueImageBounds>();
const atlasSolidBottomCache = new WeakMap<object, Map<string, number>>();
let scanCanvas: HTMLCanvasElement | null = null;
let scanCtx: CanvasRenderingContext2D | null = null;

function getScanContext(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!scanCanvas) {
    scanCanvas = document.createElement("canvas");
  }
  if (scanCanvas.width !== w) scanCanvas.width = w;
  if (scanCanvas.height !== h) scanCanvas.height = h;
  if (!scanCtx) {
    scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
  }
  return scanCtx;
}

export function getReadyImageDimensions(img: unknown): { width: number; height: number } | null {
  if (!img || typeof img !== "object") return null;
  const el = img as {
    complete?: boolean;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  if (typeof el.complete === "boolean") {
    if (!el.complete || !el.naturalWidth || !el.naturalHeight) return null;
    return { width: el.naturalWidth, height: el.naturalHeight };
  }
  if (!el.width || !el.height || el.width <= 0 || el.height <= 0) return null;
  return { width: el.width, height: el.height };
}

export function getTextureOpaqueBounds(tex: THREE.Texture | null | undefined): OpaqueImageBounds | null {
  if (!tex?.image) return null;
  const key = tex.image as object;
  const hit = opaqueBoundsCache.get(key);
  if (hit) return hit;

  const dims = getReadyImageDimensions(tex.image);
  if (!dims) return null;

  const scale = Math.min(1, 256 / Math.max(dims.width, dims.height));
  const sw = Math.max(8, Math.round(dims.width * scale));
  const sh = Math.max(8, Math.round(dims.height * scale));
  const ctx = getScanContext(sw, sh);
  if (!ctx) return null;

  try {
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(tex.image as CanvasImageSource, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    const minRowPx = Math.max(2, Math.floor(sw * 0.01));
    let minX = sw;
    let maxX = -1;
    let minY = sh;
    let maxY = -1;
    for (let y = 0; y < sh; y++) {
      let rowOpaque = 0;
      let rowMinX = sw;
      let rowMaxX = -1;
      const rowOff = y * sw * 4;
      for (let x = 0; x < sw; x++) {
        if (data[rowOff + x * 4 + 3] >= 160) {
          rowOpaque++;
          if (x < rowMinX) rowMinX = x;
          if (x > rowMaxX) rowMaxX = x;
        }
      }
      if (rowOpaque >= minRowPx) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (rowMinX < minX) minX = rowMinX;
        if (rowMaxX > maxX) maxX = rowMaxX;
      }
    }
    const bounds: OpaqueImageBounds =
      maxY >= minY && maxX >= minX
        ? {
            minXNorm: minX / sw,
            maxXNorm: (maxX + 1) / sw,
            topNorm: minY / sh,
            bottomNorm: (maxY + 1) / sh,
          }
        : { minXNorm: 0, maxXNorm: 1, topNorm: 0, bottomNorm: 1 };
    opaqueBoundsCache.set(key, bounds);
    return bounds;
  } catch {
    return null;
  }
}

export function getAtlasSolidBottomNorm(
  tex: THREE.Texture | null | undefined,
  cols: number,
  rows: number,
): number | undefined {
  if (!tex?.image) return undefined;
  const imgKey = tex.image as object;
  const gridKey = `${cols}x${rows}`;
  let byGrid = atlasSolidBottomCache.get(imgKey);
  const cached = byGrid?.get(gridKey);
  if (cached !== undefined) return cached;

  const dims = getReadyImageDimensions(tex.image);
  if (!dims) return undefined;

  const cCols = Math.max(1, cols);
  const cRows = Math.max(1, rows);
  const cellW = dims.width / cCols;
  const cellH = dims.height / cRows;
  const scale = Math.min(1, 192 / Math.max(cellW, cellH));
  const sw = Math.max(16, Math.round(cellW * scale));
  const sh = Math.max(16, Math.round(cellH * scale));
  const ctx = getScanContext(sw, sh);
  if (!ctx) return undefined;

  const totalCells = cCols * cRows;
  const sampleIndices: number[] = [0];
  if (totalCells > 1) {
    const sampleCount = Math.min(totalCells, 8);
    for (let s = 1; s < sampleCount; s++) {
      const idx = Math.min(totalCells - 1, Math.round((s * (totalCells - 1)) / (sampleCount - 1)));
      if (!sampleIndices.includes(idx)) sampleIndices.push(idx);
    }
  }

  const bottoms: number[] = [];
  const minRowPx = Math.max(3, Math.floor(sw * 0.015));
  try {
    for (const idx of sampleIndices) {
      const col = idx % cCols;
      const row = Math.floor(idx / cCols);
      ctx.clearRect(0, 0, sw, sh);
      ctx.drawImage(
        tex.image as CanvasImageSource,
        col * cellW,
        row * cellH,
        cellW,
        cellH,
        0,
        0,
        sw,
        sh,
      );
      const data = ctx.getImageData(0, 0, sw, sh).data;
      let maxOpaqueRow = -1;
      for (let y = sh - 1; y >= 0; y--) {
        let cnt = 0;
        const rowOff = y * sw * 4;
        for (let x = 0; x < sw; x++) {
          if (data[rowOff + x * 4 + 3] >= 160) {
            cnt++;
            if (cnt >= minRowPx) break;
          }
        }
        if (cnt >= minRowPx) {
          maxOpaqueRow = y;
          break;
        }
      }
      if (maxOpaqueRow >= 0) {
        bottoms.push((maxOpaqueRow + 1) / sh);
      }
    }
  } catch {
    return undefined;
  }

  if (bottoms.length === 0) return undefined;
  bottoms.sort((a, b) => a - b);
  const spread = bottoms[bottoms.length - 1] - bottoms[0];
  const chosen =
    spread > 0.15
      ? bottoms[Math.floor((bottoms.length - 1) * 0.5)]
      : bottoms[Math.floor((bottoms.length - 1) * 0.75)];

  if (!byGrid) {
    byGrid = new Map<string, number>();
    atlasSolidBottomCache.set(imgKey, byGrid);
  }
  byGrid.set(gridKey, chosen);
  return chosen;
}

export function createMultiplaneDepthMaterial(tex: THREE.Texture | null): THREE.MeshDepthMaterial {
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: tex,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
  });
  depthMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      "if ( diffuseColor.a < 0.35 ) discard;",
    );
  };
  depthMat.customProgramCacheKey = () => "multiplane-depth-alpha35";
  return depthMat;
}

export function createAtlasDepthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uHasMap: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform vec4 uUvRect;
      varying vec2 vTexUv;
      varying vec2 vHighPrecisionZW;
      void main() {
        vTexUv = vec2(uUvRect.x + uv.x * uUvRect.z, uUvRect.y + uv.y * uUvRect.w);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vHighPrecisionZW = gl_Position.zw;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D uMap;
      uniform vec4 uUvRect;
      uniform float uHasMap;
      varying vec2 vTexUv;
      varying vec2 vHighPrecisionZW;
      void main() {
        if (uHasMap < 0.5) discard;
        vec2 pad = uUvRect.zw * 0.002;
        vec2 clampedUv = clamp(vTexUv, uUvRect.xy + pad, uUvRect.xy + uUvRect.zw - pad);
        float a = texture2D(uMap, clampedUv).a;
        if (a < 0.35) discard;
        float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
        gl_FragColor = packDepthToRGBA(fragCoordZ);
      }
    `,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });
}

const ROOT_POS_BONES = new Set(["root", "hips", "hip", "pelvis", "armature", "mixamorig:hips", "bone_0"]);

/**
 * Enforce Three.js character animation contract on loaded GLB clips:
 * 1) Strip `.scale` tracks (G9: zero bone scaling warp).
 * 2) Strip `.position` tracks on non-root bones (zero limb-stretch warp).
 * 3) Strip horizontal X/Z drift on root `.position` tracks while preserving vertical Y motion.
 */
export function sanitizeThreeAnimationClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const orig of clip.tracks) {
    const dotIdx = orig.name.lastIndexOf(".");
    const nodePart = (dotIdx >= 0 ? orig.name.slice(0, dotIdx) : orig.name).toLowerCase();
    const leafNode = nodePart.split("::").pop() ?? nodePart;
    const prop = dotIdx >= 0 ? orig.name.slice(dotIdx + 1).toLowerCase() : "";

    if (prop === "scale") continue;
    if (prop === "position") {
      if (!ROOT_POS_BONES.has(nodePart) && !ROOT_POS_BONES.has(leafNode)) {
        continue;
      }
      const tr = orig.clone();
      const v = tr.values;
      if (v.length >= 3) {
        const x0 = v[0] ?? 0;
        const z0 = v[2] ?? 0;
        for (let i = 0; i + 2 < v.length; i += 3) {
          v[i] = x0;
          v[i + 2] = z0;
        }
      }
      tracks.push(tr);
      continue;
    }
    tracks.push(orig);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

const CLIP_ALIAS_MAP: Record<string, string> = {
  dancing: "dance",
  cheering: "cheer",
  celebrate: "cheer",
  party: "cheer",
  hype: "cheer",
  clapping: "clap",
  applaud: "clap",
  waving: "wave",
  hello: "wave",
  hi: "wave",
  "guitar-playing": "guitar",
  strum: "guitar",
  shred: "guitar",
  "playing-drums": "drums",
  drum: "drums",
  laugh: "laugh",
  giggle: "laugh",
  chuckle: "laugh",
  shrug: "shrug",
  "toaster-shrug": "shrug",
  dunno: "shrug",
  gasp: "gasp",
  shock: "gasp",
  surprise: "gasp",
  nod: "nod",
  "double nod": "nod",
  agree: "nod",
  tilt: "tilt",
  curious: "tilt",
  think: "tilt",
  hmm: "tilt",
  sit: "sit",
  sitting: "sit",
  seat: "sit",
  sneak: "sneak",
  creep: "sneak",
  tiptoe: "sneak",
  run: "run",
  sprint: "run",
  dash: "run",
  jog: "run",
  strut: "strut",
  march: "strut",
  swagger: "strut",
  conduct: "conduct",
  maestro: "conduct",
  direct: "conduct",
  piano: "piano",
  keys: "piano",
  keyboard: "piano",
  synth: "piano",
  violin: "violin",
  fiddle: "violin",
  strings: "violin",
  headbang: "headbang",
  rock: "headbang",
  metal: "headbang",
  croon: "croon",
  ballad: "croon",
  mic: "croon",
  yawn: "yawn",
  sleepy: "yawn",
  tired: "yawn",
  sleep: "yawn",
  panic: "panic",
  flail: "panic",
  freakout: "panic",
  stagger: "stagger",
  hit_react: "stagger",
  bonk: "stagger",
  oof: "stagger",
};

const CORE_CLIPS = new Set(["idle", "sing", "walk", "jump", "spin", "bow"]);
const WALK_ALIASES = new Set(["step", "nod", "double nod", "march", "strut", "pace"]);
const JUMP_ALIASES = new Set([
  "clap",
  "cheer",
  "hop",
  "toast",
  "stamp",
  "react",
  "reaction",
  "celebrate",
  "bounce",
  "laugh",
  "shrug",
]);
const SPIN_ALIASES = new Set([
  "fx",
  "gasp",
  "shred",
  "dance",
  "twirl",
  "action",
  "letter",
  "cast",
  "tilt",
  "toaster-shrug",
]);

/** Normalize any blocking cue, take, or pad gesture onto the cast GLB NLA skeletal clips. */
export function resolve3DClipName(
  actionClip: string | null | undefined,
  singing: boolean,
  availableActions?: ReadonlyMap<string, THREE.AnimationAction>,
): string {
  const raw = (actionClip ?? "").trim().toLowerCase();
  if (!raw) return singing ? "sing" : "idle";
  const nativeAlias = CLIP_ALIAS_MAP[raw] ?? raw;
  if (availableActions?.has(nativeAlias)) {
    return nativeAlias;
  }
  if (CORE_CLIPS.has(raw)) return raw;
  if (raw.includes("walk") || WALK_ALIASES.has(raw)) return "walk";
  if (raw.includes("jump") || JUMP_ALIASES.has(raw)) return "jump";
  if (raw.includes("spin") || raw.includes("turn") || SPIN_ALIASES.has(raw)) return "spin";
  if (raw.includes("bow") || raw.includes("curtain")) return "bow";
  if (raw.includes("sing") || raw === "belt" || raw === "acting-sheet") return "sing";
  return singing ? "sing" : "idle";
}

// ── Shared GLTF Cache ──
const gltfCache = new Map<string, GLTF>();
const gltfPending = new Map<string, Promise<GLTF | null>>();
const gltfFailed = new Set<string>();
const sharedGltfLoader = new GLTFLoader();
sharedGltfLoader.setMeshoptDecoder(MeshoptDecoder);

export function hasGltfFailed(url: string): boolean {
  return gltfFailed.has(url);
}

export function loadCachedGltf(url: string, onLoaded?: () => void): GLTF | null {
  const hit = gltfCache.get(url);
  if (hit) return hit;
  if (!gltfPending.has(url)) {
    const p = new Promise<GLTF | null>((resolve) => {
      sharedGltfLoader.load(
        url,
        (gltf) => {
          gltfCache.set(url, gltf);
          gltfFailed.delete(url);
          gltfPending.delete(url);
          onLoaded?.();
          resolve(gltf);
        },
        undefined,
        () => {
          gltfFailed.add(url);
          gltfPending.delete(url);
          resolve(null);
        },
      );
    });
    gltfPending.set(url, p);
  } else if (onLoaded) {
    void gltfPending.get(url)?.then(() => onLoaded());
  }
  return null;
}

export function preloadMoppetGlb(url: string): void {
  loadCachedGltf(url);
}
