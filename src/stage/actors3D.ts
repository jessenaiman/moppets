/**
 * Unified Pure-Three.js 3-Tier Moppet Performer Engine (0 React-Three-Fiber overhead):
 *  - Tier 1 (`GlbPerformer3D`): Rigged true-3D `.glb` Moppets (`chip`, `clank`, `cue`, `hertz`,
 *    `neon`, `tabby`, `thrum`, `tracker`, `watt`, `zap`) with skeletal 6-clip `AnimationMixer`
 *    smoothstep crossfading, flush `screen_face` CRT emissive shader, Tabby head-bone-mounted
 *    cyan pixel-LED eyes & CHIMERA felt muzzle, AniCraft 4x2 visemes, morph targets & jaw bone.
 *  - Tier 2 (`MultiplanePerformer3D`): Articulated 2.5D multiplane `THREE.Group` hierarchies
 *    (`clank`, `fuzz`, `hertz`, `latch`, `ozzi`, `tally`) with Z-layered depth separation,
 *    `evaluateMultiplanePose` IK kinematics, curved braided hose limbs (`evaluateHoseOffset`),
 *    Ozzi live phosphor CRT oscilloscope, and clean additive CRT viseme faces.
 *  - Tier 3 (`AtlasPerformer3D`): World-lit 2.5D stage performers using `createStagePuppetMaterial`
 *    (dual-fresnel rim lighting + shadow tint + CRT eye glow) + AniCraft 4x2 viseme overlays +
 *    grounded floor contact shadows.
 *
 * Every performer receives live CHIMERA articulator telemetry (`Pose` / `VocalArticSample`) and
 * `Expression` spring head-nod/tilt/breath.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { canonicalCastId } from "../choir/castManifest.ts";
import type {
  AniCraftFaceSheetSpec,
  CastCharacterManifest,
  HoseDeformSpec,
  Moppet3DModelSpec,
  MultiplaneCrtFaceSpec,
  MultiplaneNodeSpec,
  MultiplaneRigSpec,
} from "../choir/castManifest.ts";
import type { PerformerAvatarCel } from "../choir/performer.ts";
import type { VocalArticSample } from "../choir/vocalTiming.ts";
import { computeIsolatedMouthModulation } from "./isolatedMouthContract.ts";
import {
  evaluateHoseOffset,
  evaluateMultiplanePose,
  quantizeTwosSec,
  type EvaluatedMultiplanePose,
} from "./multiplaneKinematics.ts";
import { UNIT_CIRCLE_GEO, UNIT_PLANE_GEO } from "./stageGeometries.ts";
import { createStagePuppetMaterial, syncStagePuppetMaterial } from "./stageLightingMaterial.ts";
import { createSoftGlowTexture, loadStageTexture } from "./stageTextures.ts";
import { resolveStageWorld, type StageWorldId } from "./stageWorlds.ts";
import { naturalBlinkAmountAt, type TabbyFacialState } from "./visemeMapper.ts";

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

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
/** Monotonic z-sorted render order across all 3 tiers so riser performers never bleed through front actors. */
const zRenderOrder = (z: number) => Math.round(300 + z * 100);

// ── Shared Soft Contact Shadow Texture & Offscreen Opaque Pixel Scanners (`S-53`) ──
let sharedContactShadowTex: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture | null {
  if (!sharedContactShadowTex) {
    sharedContactShadowTex = createSoftGlowTexture("rgba(6,4,8,0.68)", "rgba(6,4,8,0.22)");
  }
  return sharedContactShadowTex;
}

function createContactShadowMesh(opacity: number): {
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

interface OpaqueImageBounds {
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

function getReadyImageDimensions(img: unknown): { width: number; height: number } | null {
  if (!img || typeof img !== "object") return null;
  const el = img as { complete?: boolean; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  if (typeof el.complete === "boolean") {
    if (!el.complete || !el.naturalWidth || !el.naturalHeight) return null;
    return { width: el.naturalWidth, height: el.naturalHeight };
  }
  if (!el.width || !el.height || el.width <= 0 || el.height <= 0) return null;
  return { width: el.width, height: el.height };
}

function getTextureOpaqueBounds(tex: THREE.Texture | null | undefined): OpaqueImageBounds | null {
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

function getAtlasSolidBottomNorm(
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

function createMultiplaneDepthMaterial(tex: THREE.Texture | null): THREE.MeshDepthMaterial {
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

function createAtlasDepthMaterial(): THREE.ShaderMaterial {
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

/** Normalize any blocking cue, take, or pad gesture onto the 6 canonical NLA skeletal clips. */
export function resolve3DClipName(actionClip: string | null | undefined, singing: boolean): string {
  const raw = (actionClip ?? "").trim().toLowerCase();
  if (!raw) return singing ? "sing" : "idle";
  if (raw === "idle" || raw === "sing" || raw === "walk" || raw === "jump" || raw === "spin" || raw === "bow") {
    return raw;
  }
  if (
    raw.includes("walk") ||
    raw === "step" ||
    raw === "nod" ||
    raw === "double nod" ||
    raw === "march" ||
    raw === "strut" ||
    raw === "pace"
  ) {
    return "walk";
  }
  if (
    raw.includes("jump") ||
    raw === "clap" ||
    raw === "cheer" ||
    raw === "hop" ||
    raw === "toast" ||
    raw === "stamp" ||
    raw === "react" ||
    raw === "reaction" ||
    raw === "celebrate" ||
    raw === "bounce" ||
    raw === "laugh" ||
    raw === "shrug"
  ) {
    return "jump";
  }
  if (
    raw.includes("spin") ||
    raw.includes("turn") ||
    raw === "fx" ||
    raw === "gasp" ||
    raw === "shred" ||
    raw === "dance" ||
    raw === "twirl" ||
    raw === "action" ||
    raw === "letter" ||
    raw === "cast" ||
    raw === "tilt" ||
    raw === "toaster-shrug"
  ) {
    return "spin";
  }
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

function loadCachedGltf(url: string, onLoaded?: () => void): GLTF | null {
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

// ── AniCraft 4x2 Face Viseme UV Shader ──
const ANICRAFT_FACE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vLocalUv;
  uniform vec4 uUvRect;
  void main() {
    vLocalUv = uv;
    vUv = vec2(uUvRect.x + uv.x * uUvRect.z, uUvRect.y + uv.y * uUvRect.w);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ANICRAFT_FACE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vLocalUv;
  uniform sampler2D uMap;
  uniform vec4 uUvRect;
  uniform float uCrtMask;
  uniform float uPhosphorBoost;
  uniform float uSrgbOutput;
  void main() {
    vec2 pad = uUvRect.zw * 0.004;
    vec2 clamped = clamp(vUv, uUvRect.xy + pad, uUvRect.xy + uUvRect.zw - pad);
    vec4 tex = texture2D(uMap, clamped);
    if (uPhosphorBoost > 3.5) {
      // LeadSinger glowing coral-amber backlit mouth against BareChassis dark chin grille & cream visor
      vec3 srgb = pow(max(tex.rgb, vec3(0.0001)), vec3(1.0 / 2.2));
      float lipMask = smoothstep(0.24, 0.34, srgb.r) * (1.0 - smoothstep(0.58, 0.78, srgb.r)) * smoothstep(0.10, 0.20, srgb.r - srgb.g);
      float brightMask = smoothstep(0.62, 0.80, max(srgb.r, max(srgb.g, srgb.b)));
      vec3 coralGoldLip = vec3(1.0, 0.50, 0.36);
      vec3 glowInner = vec3(1.0, 0.82, 0.86);
      vec3 darkCavity = srgb * 0.42;
      tex.rgb = mix(mix(darkCavity, glowInner, brightMask), coralGoldLip, lipMask);
    } else if (uPhosphorBoost > 2.5) {
      // Click brass/gold backlit mouth against dark-maroon shutter chassis (cool slate -> warm gold)
      vec3 srgb = pow(max(tex.rgb, vec3(0.0001)), vec3(1.0 / 2.2));
      float maxC = max(srgb.r, max(srgb.g, srgb.b));
      float lipMask = smoothstep(0.18, 0.26, maxC) * (1.0 - smoothstep(0.50, 0.68, maxC));
      float brightMask = smoothstep(0.56, 0.76, maxC);
      vec3 goldLip = vec3(1.0, 0.78, 0.26);
      vec3 glowInner = vec3(1.0, 0.92, 0.66);
      vec3 darkCavity = srgb * 0.40;
      tex.rgb = mix(mix(darkCavity, glowInner, brightMask), goldLip, lipMask);
    } else if (uPhosphorBoost > 1.5) {
      // Deck Walkman VU-amber backlit mouth: turn dark-brown lip ring luminous gold while preserving dark inner throat + coral tongue
      vec3 srgb = pow(max(tex.rgb, vec3(0.0001)), vec3(1.0 / 2.2));
      float lipMask = smoothstep(0.15, 0.21, srgb.r) * (1.0 - smoothstep(0.42, 0.62, srgb.r)) * smoothstep(0.04, 0.10, srgb.r - srgb.b);
      float brightMask = smoothstep(0.50, 0.72, max(srgb.r, max(srgb.g, srgb.b)));
      vec3 goldLip = vec3(1.0, 0.80, 0.24);
      vec3 glowInner = clamp(srgb * vec3(1.24, 1.18, 1.05) + vec3(0.08, 0.04, 0.0), 0.0, 1.0);
      vec3 darkCavity = srgb * 0.45;
      tex.rgb = mix(mix(darkCavity, glowInner, brightMask), goldLip, lipMask);
    } else if (uPhosphorBoost > 0.5) {
      float peak = max(tex.r, max(tex.g, tex.b));
      vec3 srgb = pow(max(tex.rgb, vec3(0.0001)), vec3(1.0 / 2.2));
      float lift = mix(0.62, 1.34, smoothstep(0.08, 0.42, peak));
      tex.rgb = srgb * lift;
    } else if (uSrgbOutput > 0.5) {
      tex.rgb = pow(max(tex.rgb, vec3(0.0001)), vec3(1.0 / 2.2));
    }
    if (uCrtMask > 0.5) {
      vec2 q = abs(vLocalUv - 0.5) * 2.0;
      float corner = length(max(q - vec2(0.74, 0.68), 0.0));
      float mask = 1.0 - smoothstep(0.20, 0.255, corner);
      tex.a *= mask;
    }
    if (tex.a < 0.04) discard;
    gl_FragColor = tex;
  }
`;

function createAniCraftFaceMat(
  map: THREE.Texture | null,
  crtMask = false,
  phosphorBoost = false,
  srgbOutput = false,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ANICRAFT_FACE_VERT,
    fragmentShader: ANICRAFT_FACE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uMap: { value: map },
      uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uCrtMask: { value: crtMask ? 1 : 0 },
      uPhosphorBoost: { value: phosphorBoost ? 1 : 0 },
      uSrgbOutput: { value: srgbOutput ? 1 : 0 },
    },
  });
}

function createSoftPlateAlphaTexture(shape: "rounded-rect" | "circle" = "rounded-rect"): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const ny = (y + 0.5) / S - 0.5;
    for (let x = 0; x < S; x++) {
      const nx = (x + 0.5) / S - 0.5;
      let a = 0;
      if (shape === "circle") {
        const r = Math.hypot(nx, ny) * 2;
        a = Math.max(0, Math.min(1, (0.96 - r) / 0.24));
      } else {
        const ax = Math.abs(nx) * 2;
        const ay = Math.abs(ny) * 2;
        const dist = Math.hypot(Math.max(ax - 0.68, 0), Math.max(ay - 0.68, 0));
        const edge = Math.max(ax, ay);
        a =
          edge >= 0.98
            ? 0
            : Math.max(0, Math.min(1, (0.31 - dist) / 0.14)) *
              Math.max(0, Math.min(1, (0.98 - edge) / 0.16));
      }
      const v = Math.round(a * 255);
      const idx = (y * S + x) * 4;
      d[idx] = v;
      d[idx + 1] = v;
      d[idx + 2] = v;
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function computeAniCraftCellUvRect(
  cell: number,
  cols: number,
  rows: number,
  mouthOnly = false,
  crtInset: boolean | "cue" | "clank" | "watt" | "chip" = false,
): readonly [number, number, number, number] {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const total = safeCols * safeRows;
  const idx = ((Math.floor(cell) % total) + total) % total;
  const col = idx % safeCols;
  const row = Math.floor(idx / safeCols);
  const cellU = col / safeCols;
  const cellV = 1 - (row + 1) / safeRows;
  const du = 1 / safeCols;
  const dv = 1 / safeRows;
  if (mouthOnly) {
    return [cellU + du * 0.14, cellV + dv * 0.04, du * 0.72, dv * 0.48];
  }
  if (crtInset === "clank") {
    return [cellU + du * 0.065, cellV + dv * 0.065, du * 0.87, dv * 0.87];
  }
  if (crtInset === "watt") {
    return [cellU + du * 0.12, cellV + dv * 0.1, du * 0.76, dv * 0.8];
  }
  if (crtInset === "chip") {
    return [cellU + du * 0.28, cellV + dv * 0.06, du * 0.44, dv * 0.44];
  }
  if (crtInset) {
    return [cellU + du * 0.06, cellV + dv * 0.13, du * 0.88, dv * 0.74];
  }
  return [cellU, cellV, du, dv];
}

function selectAniCraftFaceCell(
  artic: VocalArticSample | undefined,
  singing: boolean,
  timeSec: number,
  actionClip: string | null | undefined,
): number {
  const blink = clamp01(naturalBlinkAmountAt(timeSec, singing));
  const open = singing && artic ? clamp01(artic.open) : 0;
  const round = singing && artic ? clamp01(artic.round) : 0;
  const width = singing && artic ? clamp01(artic.lipWidth) : 0.5;
  const labio = singing && artic ? clamp01(artic.labiodental) : 0;
  const clip = (actionClip ?? "").toLowerCase();

  if (!singing) {
    if (blink > 0.48 || clip === "bow" || clip === "jump" || clip === "clap" || clip === "cheer") return 7;
    return 0;
  }
  if (open <= 0.025) return clip === "clap" ? 7 : 1;
  if (labio >= 0.45 && open < 0.44) return 2;
  if (round >= 0.62 && open < 0.56) return 6;
  if (round >= 0.36 && open >= 0.32) return 5;
  if (width >= 0.56 && open < 0.52) return 3;
  return open >= 0.3 ? 4 : 3;
}

// ── Flush 3D CRT `screen_face` Material Slot Driver ──
interface ScreenFaceDriver {
  readonly material: THREE.MeshStandardMaterial;
  readonly sync: (artic: VocalArticSample | undefined, singing: boolean, timeSec: number, clip: string) => void;
  readonly dispose: () => void;
}

function createScreenFaceDriver(style: "neon-rings" | "crt-phosphor" = "neon-rings"): ScreenFaceDriver | null {
  if (typeof document === "undefined") return null;
  const W = 512;
  const H = 320;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  const material = new THREE.MeshStandardMaterial({
    name: "screen_face",
    color: new THREE.Color(0x05070a),
    roughness: 0.2,
    metalness: 0.08,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: texture,
    emissiveIntensity: 2.0,
  });

  let lastKey = "";

  const drawEye = (cx: number, cy: number, r: number, color: string, glow: string, blink: number, happy: boolean) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (happy) {
      ctx.strokeStyle = color;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 24;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(0, r * 0.22, r * 0.85, Math.PI * 1.16, Math.PI * 1.84);
      ctx.stroke();
    } else {
      ctx.scale(1, Math.max(0.1, 1 - blink * 0.9));
      ctx.strokeStyle = glow;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 28;
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  const sync = (artic: VocalArticSample | undefined, singing: boolean, timeSec: number, actionClip: string) => {
    const open = singing && artic ? clamp01(artic.open) : 0;
    const jaw = singing && artic ? clamp01(artic.jaw) : open;
    const round = singing && artic ? clamp01(artic.round) : 0;
    const width = singing && artic ? clamp01(artic.lipWidth) : 0.5;
    const labio = singing && artic ? clamp01(artic.labiodental) : 0;
    const blink = clamp01(naturalBlinkAmountAt(timeSec, singing));
    const happy =
      (actionClip === "bow" || actionClip === "jump" || actionClip === "clap" || actionClip === "cheer") &&
      open <= 0.25;

    const q = (v: number) => Math.round(v * 30);
    const isClosed = !singing || open <= 0.025;
    const key = `${style}|${singing ? 1 : 0}|${isClosed ? 1 : 0}|${happy ? 1 : 0}|${q(blink)}|${q(open)}|${q(jaw)}|${q(round)}|${q(width)}|${q(labio)}`;
    if (key === lastKey) return;
    lastKey = key;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.015)";
    for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2);

    const leftColor = style === "crt-phosphor" ? "#68ffbe" : "#62f7ff";
    const leftGlow = style === "crt-phosphor" ? "#20d68a" : "#00d9ff";
    const rightColor = style === "crt-phosphor" ? "#68ffbe" : "#ff6cb4";
    const rightGlow = style === "crt-phosphor" ? "#20d68a" : "#ff1f80";
    const mouthColor = style === "crt-phosphor" ? "#7cffc8" : "#ff96d0";
    const mouthGlow = style === "crt-phosphor" ? "#25e090" : "#ff2686";

    // Verified against neon-3d.glb `screen_face` UVs (flipY=false -> V=0.12..0.93 front flat glass):
    // Eyes sit at V=0.40 (Y=0.272) and mouth at V=0.71 (Y=0.220), cleanly clear of the bottom bezel.
    drawEye(W * 0.31, H * 0.4, 56, leftColor, leftGlow, blink, happy);
    drawEye(W * 0.69, H * 0.4, 56, rightColor, rightGlow, blink, happy);

    ctx.save();
    ctx.translate(W * 0.5, H * 0.71);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = mouthGlow;
    ctx.shadowBlur = 24;

    if (isClosed) {
      const halfW = singing ? 36 : 30;
      ctx.strokeStyle = mouthGlow;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(-halfW, 0);
      ctx.quadraticCurveTo(0, singing ? 4 : 6, halfW, 0);
      ctx.stroke();
      ctx.strokeStyle = mouthColor;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(-halfW, 0);
      ctx.quadraticCurveTo(0, singing ? 4 : 6, halfW, 0);
      ctx.stroke();
    } else if (labio >= 0.45 && open < 0.44) {
      // `fv` labiodental: glowing lower lip arc + bright upper teeth bar
      ctx.strokeStyle = mouthGlow;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(-42, 6);
      ctx.quadraticCurveTo(0, 14, 42, 6);
      ctx.stroke();
      ctx.strokeStyle = mouthColor;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = "#fff4fb";
      ctx.shadowBlur = 10;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-26, -5);
      ctx.lineTo(26, -5);
      ctx.stroke();
    } else {
      const openAmp = Math.pow(clamp01(Math.max(open, jaw)), 0.65);
      const drawMouthEllipse = (rx: number, ry: number, tongue = false) => {
        ctx.fillStyle = "rgba(3, 1, 6, 0.96)";
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        if (tongue && ry >= 22) {
          ctx.save();
          ctx.clip();
          ctx.fillStyle = "rgba(255, 86, 152, 0.35)";
          ctx.beginPath();
          ctx.ellipse(0, ry * 0.72, rx * 0.65, ry * 0.48, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.strokeStyle = mouthGlow;
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = mouthColor;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      };

      if (round >= 0.56 && open < 0.58) {
        // `oo` rounded ring
        const r = clamp(22 + openAmp * 12, 22, 34);
        drawMouthEllipse(r * 0.96, r, false);
      } else if (round >= 0.34) {
        // `oh` tall rounded oval
        const rx = clamp(30 + openAmp * 10, 30, 40);
        const ry = clamp(24 + openAmp * 20, 24, 44);
        drawMouthEllipse(rx, ry, true);
      } else if (width >= 0.55 && open < 0.48) {
        // `ee` wide neon smile
        const rx = clamp(48 + width * 20, 48, 68);
        const ry = clamp(15 + openAmp * 18, 15, 33);
        drawMouthEllipse(rx, ry, false);
      } else {
        // `ah` bold glowing open ellipse
        const rx = clamp(40 + width * 22 - round * 14, 34, 62);
        const ry = clamp(18 + openAmp * 28, 18, 46);
        drawMouthEllipse(rx, ry, true);
      }
    }
    ctx.restore();
    texture.needsUpdate = true;
  };

  sync(undefined, false, 0, "idle");
  return {
    material,
    sync,
    dispose: () => {
      texture.dispose();
      material.dispose();
    },
  };
}

// ── Tabby Head-Bone-Mounted Cyan Pixel-LED Eyes & CHIMERA Felt Muzzle ──
class TabbyHeadPortals {
  readonly eyeGroup = new THREE.Group();
  readonly mouthGroup = new THREE.Group();

  private readonly happyGroup = new THREE.Group();
  private readonly openEyeGroup = new THREE.Group();
  private readonly leftEye = new THREE.Group();
  private readonly rightEye = new THREE.Group();
  private readonly eyeMat = new THREE.MeshBasicMaterial({
    color: "#44f5dc",
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  private readonly closedMouth = new THREE.Group();
  private readonly closedBar: THREE.Mesh;
  private readonly fvMouth = new THREE.Group();
  private readonly vowelMouth = new THREE.Group();
  private readonly rimMesh: THREE.Mesh;
  private readonly cavMesh: THREE.Mesh;
  private readonly tongueMesh: THREE.Mesh;
  private readonly orderedMeshes: Array<{ mesh: THREE.Mesh; offset: number }> = [];

  private registerOrder(mesh: THREE.Mesh, offset: number): void {
    mesh.renderOrder = 210 + offset;
    this.orderedMeshes.push({ mesh, offset });
  }

  constructor(eyeMount: THREE.Object3D | null, mouthMount: THREE.Object3D | null) {
    const darkMat = new THREE.MeshBasicMaterial({
      color: "#051114",
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.eyeGroup.position.set(0, -0.004, 0.014);
    const backing = new THREE.Mesh(UNIT_PLANE_GEO, darkMat);
    backing.position.set(0, -0.008, 0);
    backing.scale.set(0.315, 0.168, 1);
    this.registerOrder(backing, 1);
    this.eyeGroup.add(backing);

    this.happyGroup.position.set(0, 0.006, 0.006);
    for (const ex of [-0.064, 0.064]) {
      const g = new THREE.Group();
      g.position.x = ex;
      const l = new THREE.Mesh(UNIT_PLANE_GEO, this.eyeMat);
      l.position.x = -0.015;
      l.rotation.z = 0.68;
      l.scale.set(0.046, 0.014, 1);
      this.registerOrder(l, 4);
      const r = new THREE.Mesh(UNIT_PLANE_GEO, this.eyeMat);
      r.position.x = 0.015;
      r.rotation.z = -0.68;
      r.scale.set(0.046, 0.014, 1);
      this.registerOrder(r, 4);
      g.add(l, r);
      this.happyGroup.add(g);
    }
    this.eyeGroup.add(this.happyGroup);

    this.openEyeGroup.position.set(0, 0.004, 0.006);
    const buildEye = (x: number, target: THREE.Group) => {
      target.position.x = x;
      const outer = new THREE.Mesh(UNIT_PLANE_GEO, this.eyeMat);
      outer.scale.set(0.066, 0.076, 1);
      this.registerOrder(outer, 2);
      const pupil = new THREE.Mesh(UNIT_PLANE_GEO, darkMat);
      pupil.position.z = 0.004;
      pupil.scale.set(0.026, 0.034, 1);
      this.registerOrder(pupil, 4);
      target.add(outer, pupil);
      this.openEyeGroup.add(target);
    };
    buildEye(-0.064, this.leftEye);
    buildEye(0.064, this.rightEye);
    this.eyeGroup.add(this.openEyeGroup);
    eyeMount?.add(this.eyeGroup);

    // Mouth overlay
    this.mouthGroup.position.set(0, -0.004, 0.012);
    const lipDark = new THREE.MeshBasicMaterial({ color: "#3c1b1d", transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.closedBar = new THREE.Mesh(UNIT_PLANE_GEO, lipDark);
    this.closedBar.scale.set(0.058, 0.0085, 1);
    this.registerOrder(this.closedBar, 5);
    this.closedMouth.add(this.closedBar);
    this.mouthGroup.add(this.closedMouth);

    const fvLip = new THREE.Mesh(UNIT_PLANE_GEO, lipDark);
    fvLip.position.y = -0.002;
    fvLip.scale.set(0.052, 0.014, 1);
    this.registerOrder(fvLip, 5);
    const fvTooth = new THREE.Mesh(
      UNIT_PLANE_GEO,
      new THREE.MeshBasicMaterial({ color: "#f9efe2", transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    fvTooth.position.set(0, 0.0025, 0.002);
    fvTooth.scale.set(0.036, 0.0055, 1);
    this.registerOrder(fvTooth, 6);
    this.fvMouth.add(fvLip, fvTooth);
    this.mouthGroup.add(this.fvMouth);

    this.rimMesh = new THREE.Mesh(
      UNIT_CIRCLE_GEO,
      new THREE.MeshBasicMaterial({ color: "#4a1e22", transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.registerOrder(this.rimMesh, 5);
    this.cavMesh = new THREE.Mesh(
      UNIT_CIRCLE_GEO,
      new THREE.MeshBasicMaterial({ color: "#1f080b", transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.cavMesh.position.z = 0.002;
    this.registerOrder(this.cavMesh, 6);
    this.tongueMesh = new THREE.Mesh(
      UNIT_CIRCLE_GEO,
      new THREE.MeshBasicMaterial({ color: "#d8686d", transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.tongueMesh.position.z = 0.004;
    this.registerOrder(this.tongueMesh, 7);
    this.vowelMouth.add(this.rimMesh, this.cavMesh, this.tongueMesh);
    this.mouthGroup.add(this.vowelMouth);
    mouthMount?.add(this.mouthGroup);
  }

  sync(facial: TabbyFacialState | undefined, actionClip: string | null, baseOrder: number): void {
    for (const entry of this.orderedMeshes) {
      entry.mesh.renderOrder = baseOrder + entry.offset;
    }
    if (!facial) {
      this.eyeGroup.visible = false;
      this.mouthGroup.visible = false;
      return;
    }
    this.eyeGroup.visible = true;
    const blink = clamp01(facial.blinkAmount);
    const isHappy =
      blink < 0.35 &&
      (actionClip === "bow" ||
        actionClip === "jump" ||
        actionClip === "clap" ||
        (facial.speaking && facial.viseme === 3 && facial.mouthWidth > 0.62));
    const isCurious = blink < 0.35 && !isHappy && (facial.viseme === 6 || facial.mouthOpen > 0.72);
    const eyeScaleY = Math.max(0.14, 1 - blink * 0.86);

    this.eyeMat.color.set(facial.browLift > 0.25 ? "#78fff0" : "#44f5dc");
    this.happyGroup.visible = isHappy;
    this.openEyeGroup.visible = !isHappy;
    this.openEyeGroup.position.y = 0.004 + facial.browLift * 0.006;
    this.leftEye.scale.set(isCurious ? 0.88 : 1, eyeScaleY * (isCurious ? 0.92 : 1), 1);
    this.rightEye.scale.set(isCurious ? 1.12 : 1, eyeScaleY * (isCurious ? 1.12 : 1), 1);

    const mod = computeIsolatedMouthModulation(facial);
    const key = mod.activeKey;
    const isRest = key === "rest";
    const isClosed = key === "closed";
    const isFv = key === "fv";
    this.mouthGroup.visible = !isRest;
    this.closedMouth.visible = isClosed;
    this.fvMouth.visible = isFv;
    this.vowelMouth.visible = !isRest && !isClosed && !isFv;

    if (isClosed) {
      this.closedBar.scale.set(0.058 * mod.scaleX, 0.0085, 1);
    } else if (this.vowelMouth.visible) {
      const open = clamp01(facial.mouthOpen);
      const round = clamp01(facial.mouthRound);
      const width = clamp01(facial.mouthWidth);
      let cavW = 0.044;
      let cavH = 0.032;
      if (key === "ee") {
        cavW = 0.056 * (0.9 + width * 0.2);
        cavH = 0.024 * (0.85 + open * 0.45);
      } else if (key === "ah") {
        cavW = 0.048 * (0.9 + width * 0.16);
        cavH = 0.044 * (0.8 + open * 0.45);
      } else if (key === "oh") {
        cavW = 0.038 * (1.05 - round * 0.18);
        cavH = 0.04 * (0.85 + open * 0.35);
      } else if (key === "oo") {
        cavW = 0.027;
        cavH = 0.028 * (0.85 + open * 0.3);
      }
      this.vowelMouth.position.y = -cavH * 0.22;
      this.rimMesh.scale.set(cavW * 0.56, cavH * 0.56, 1);
      this.cavMesh.scale.set(cavW * 0.47, cavH * 0.47, 1);
      this.tongueMesh.position.y = -cavH * 0.18;
      this.tongueMesh.scale.set(cavW * 0.32, cavH * 0.22, 1);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TIER 1: RIGGED TRUE-3D `.glb` PERFORMER
// ═══════════════════════════════════════════════════════════════════════════
interface SoleVertSample {
  readonly mesh: THREE.SkinnedMesh;
  readonly idx: number;
}

class GlbPerformer3D {
  readonly group = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly shadowMesh: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly footShadowL: THREE.Mesh;
  private readonly footShadowMatL: THREE.MeshBasicMaterial;
  private readonly footShadowR: THREE.Mesh;
  private readonly footShadowMatR: THREE.MeshBasicMaterial;
  private readonly root: THREE.Object3D;
  private readonly bindRootX: number;
  private readonly bindRootY: number;
  private readonly bindRootZ: number;
  private readonly soleVertsL: SoleVertSample[] = [];
  private readonly soleVertsR: SoleVertSample[] = [];
  private readonly soleBoneL: THREE.Object3D | null = null;
  private readonly soleBoneR: THREE.Object3D | null = null;
  private readonly soleOffsetL: number = 0;
  private readonly soleOffsetR: number = 0;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly morphMeshes: THREE.Mesh[] = [];
  private readonly screenDrivers: ScreenFaceDriver[] = [];
  private readonly jawBone: THREE.Object3D | null = null;
  private readonly jawRestX: number = 0;
  private readonly shoulderL: THREE.Object3D | null = null;
  private readonly shoulderR: THREE.Object3D | null = null;
  private readonly upperArmL: THREE.Object3D | null = null;
  private readonly upperArmR: THREE.Object3D | null = null;
  private readonly forearmL: THREE.Object3D | null = null;
  private readonly forearmR: THREE.Object3D | null = null;
  private readonly handL: THREE.Object3D | null = null;
  private readonly handR: THREE.Object3D | null = null;
  private readonly thighL: THREE.Object3D | null = null;
  private readonly thighR: THREE.Object3D | null = null;
  private readonly shinL: THREE.Object3D | null = null;
  private readonly shinR: THREE.Object3D | null = null;
  private readonly footL: THREE.Object3D | null = null;
  private readonly footR: THREE.Object3D | null = null;
  private readonly earL: THREE.Object3D | null = null;
  private readonly earR: THREE.Object3D | null = null;
  private readonly tail1: THREE.Object3D | null = null;
  private readonly tail2: THREE.Object3D | null = null;
  private readonly tail3: THREE.Object3D | null = null;
  private readonly relaxArmsRad: number = 0;
  private readonly isCueModel: boolean = false;
  private readonly isClankModel: boolean = false;
  private readonly isWattModel: boolean = false;
  private readonly isChipModel: boolean = false;
  private readonly isZapModel: boolean = false;
  private readonly isThrumModel: boolean = false;
  private readonly tabbyPortals: TabbyHeadPortals | null = null;
  private readonly faceMesh: THREE.Mesh | null = null;
  private readonly faceMat: THREE.ShaderMaterial | null = null;
  private readonly faceSheet: AniCraftFaceSheetSpec | undefined;
  private readonly wattPlateMesh: THREE.Mesh | null = null;
  private readonly wattPlateMat: THREE.MeshStandardMaterial | null = null;
  private readonly chipEyeL: THREE.Mesh | null = null;
  private readonly chipEyeR: THREE.Mesh | null = null;
  private readonly chipEyeMatL: THREE.ShaderMaterial | null = null;
  private readonly chipEyeMatR: THREE.ShaderMaterial | null = null;
  private readonly chipLidL: THREE.Mesh | null = null;
  private readonly chipLidR: THREE.Mesh | null = null;
  private readonly chipLidMat: THREE.MeshStandardMaterial | null = null;

  private readonly tmpEuler = new THREE.Euler(0, 0, 0, "ZYX");
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpTargetQuat = new THREE.Quaternion();
  private readonly tmpSoleVec = new THREE.Vector3();
  private readonly tmpFootVecL = new THREE.Vector3();
  private readonly tmpFootVecR = new THREE.Vector3();
  private clapWeight = 0;
  private earPerk = 0;
  private tailActiveWeight = 0;
  private lastPostSec = -1;
  private readonly headAnchorPos = new THREE.Vector3();

  private readonly blend = {
    currentClip: "",
    prevClip: null as string | null,
    switchTimeSec: 0,
    prevLocalTime: 0,
    lastTimeSec: -1,
    lastLocalTime: 0,
  };

  constructor(private readonly spec: Moppet3DModelSpec, gltf: GLTF) {
    const aoShadow = createContactShadowMesh(0.36);
    this.shadowMesh = aoShadow.mesh;
    this.shadowMat = aoShadow.mat;
    this.shadowMesh.renderOrder = 160;
    this.group.add(this.shadowMesh);

    const fShadowL = createContactShadowMesh(0.68);
    this.footShadowL = fShadowL.mesh;
    this.footShadowMatL = fShadowL.mat;
    this.footShadowL.renderOrder = 161;
    this.group.add(this.footShadowL);

    const fShadowR = createContactShadowMesh(0.68);
    this.footShadowR = fShadowR.mesh;
    this.footShadowMatR = fShadowR.mat;
    this.footShadowR.renderOrder = 161;
    this.group.add(this.footShadowR);

    this.group.add(this.bodyGroup);

    const root = SkeletonUtils.clone(gltf.scene);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const normScale = 1 / Math.max(0.001, size.y);

    // Sample extreme sole vertices across left/right feet in bind pose for sub-millimeter grounding & foot shadows
    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    const skeletonBones: THREE.Bone[] = [];
    root.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        skinnedMeshes.push(obj as THREE.SkinnedMesh);
      } else if ((obj as THREE.Bone).isBone) {
        skeletonBones.push(obj as THREE.Bone);
      }
    });

    interface RawSoleVert {
      mesh: THREE.SkinnedMesh;
      idx: number;
      x: number;
      y: number;
      z: number;
    }
    const lowVerts: RawSoleVert[] = [];
    let minYL = Infinity;
    let minYR = Infinity;
    const vTmp = new THREE.Vector3();
    const lowBandY = box.min.y + size.y * 0.14;
    for (const sm of skinnedMeshes) {
      sm.skeleton?.update();
      const posAttr = sm.geometry.getAttribute("position");
      if (!posAttr) continue;
      for (let i = 0; i < posAttr.count; i++) {
        vTmp.fromBufferAttribute(posAttr, i);
        sm.applyBoneTransform(i, vTmp);
        vTmp.applyMatrix4(sm.matrixWorld);
        if (vTmp.y <= lowBandY) {
          lowVerts.push({ mesh: sm, idx: i, x: vTmp.x, y: vTmp.y, z: vTmp.z });
          if (vTmp.x < center.x) {
            if (vTmp.y < minYL) minYL = vTmp.y;
          } else {
            if (vTmp.y < minYR) minYR = vTmp.y;
          }
        }
      }
    }
    const pickSideExtremes = (sideVerts: RawSoleVert[], sideMinY: number): SoleVertSample[] => {
      if (!Number.isFinite(sideMinY) || sideVerts.length === 0) return [];
      const band = sideVerts.filter((p) => p.y <= sideMinY + size.y * 0.035);
      if (band.length === 0) return [];
      const picked = new Map<string, SoleVertSample>();
      const addSlice = (sorted: RawSoleVert[]) => {
        for (let k = 0; k < Math.min(4, sorted.length); k++) {
          const item = sorted[k];
          picked.set(`${item.mesh.uuid}:${item.idx}`, { mesh: item.mesh, idx: item.idx });
        }
      };
      addSlice([...band].sort((a, b) => a.y - b.y));
      addSlice([...band].sort((a, b) => a.z - b.z));
      addSlice([...band].sort((a, b) => b.z - a.z));
      addSlice([...band].sort((a, b) => a.x - b.x));
      addSlice([...band].sort((a, b) => b.x - a.x));
      return [...picked.values()];
    };
    this.soleVertsL = pickSideExtremes(
      lowVerts.filter((p) => p.x < center.x),
      minYL,
    );
    this.soleVertsR = pickSideExtremes(
      lowVerts.filter((p) => p.x >= center.x),
      minYR,
    );

    const footObjL = root.getObjectByName("foot_L") ?? root.getObjectByName("foot_l") ?? null;
    const footObjR = root.getObjectByName("foot_R") ?? root.getObjectByName("foot_r") ?? null;

    let pivotCenterX = center.x;
    let pivotCenterZ = center.z;
    if (footObjL && footObjR) {
      footObjL.getWorldPosition(this.tmpFootVecL);
      footObjR.getWorldPosition(this.tmpFootVecR);
      pivotCenterX = (this.tmpFootVecL.x + this.tmpFootVecR.x) * 0.5;
      pivotCenterZ = (this.tmpFootVecL.z + this.tmpFootVecR.z) * 0.5;
    } else if (lowVerts.length > 0) {
      const bandAll = lowVerts.filter((p) => p.y <= box.min.y + size.y * 0.05);
      const src = bandAll.length > 0 ? bandAll : lowVerts;
      let sx = 0;
      let sz = 0;
      for (const p of src) {
        sx += p.x;
        sz += p.z;
      }
      pivotCenterX = sx / src.length;
      pivotCenterZ = sz / src.length;
    }

    this.bindRootX = -pivotCenterX * normScale;
    this.bindRootY = -box.min.y * normScale;
    this.bindRootZ = -pivotCenterZ * normScale;
    root.position.set(this.bindRootX, this.bindRootY, this.bindRootZ);
    root.scale.setScalar(normScale);
    root.updateMatrixWorld(true);

    // Precompute bind-pose sole offsets for bone fallback (including 46-bone neon rig)
    if (footObjL && footObjR) {
      this.soleBoneL = footObjL;
      this.soleBoneR = footObjR;
      footObjL.getWorldPosition(this.tmpFootVecL);
      footObjR.getWorldPosition(this.tmpFootVecR);
      this.soleOffsetL = Math.max(0, this.tmpFootVecL.y);
      this.soleOffsetR = Math.max(0, this.tmpFootVecR.y);
    } else if (skeletonBones.length > 0) {
      const boneY = skeletonBones
        .map((b) => {
          b.getWorldPosition(vTmp);
          return { bone: b, x: vTmp.x, y: vTmp.y };
        })
        .sort((a, b) => a.y - b.y);
      const leftBone = boneY.find((b) => b.x < 0) ?? boneY[0];
      const rightBone = boneY.find((b) => b.x >= 0) ?? boneY[1] ?? boneY[0];
      this.soleBoneL = leftBone?.bone ?? null;
      this.soleBoneR = rightBone?.bone ?? null;
      this.soleOffsetL = Math.max(0, leftBone?.y ?? 0);
      this.soleOffsetR = Math.max(0, rightBone?.y ?? 0);
    }

    this.root = root;
    this.bodyGroup.add(root);

    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      this.actions.set(clip.name.toLowerCase(), this.mixer.clipAction(clip));
    }

    let jawBone: THREE.Object3D | null = null;
    let shoulderL: THREE.Object3D | null = null;
    let shoulderR: THREE.Object3D | null = null;
    let upperArmL: THREE.Object3D | null = null;
    let upperArmR: THREE.Object3D | null = null;
    let forearmL: THREE.Object3D | null = null;
    let forearmR: THREE.Object3D | null = null;
    let handL: THREE.Object3D | null = null;
    let handR: THREE.Object3D | null = null;
    let thighL: THREE.Object3D | null = null;
    let thighR: THREE.Object3D | null = null;
    let shinL: THREE.Object3D | null = null;
    let shinR: THREE.Object3D | null = null;
    let footL: THREE.Object3D | null = null;
    let footR: THREE.Object3D | null = null;
    let earL: THREE.Object3D | null = null;
    let earR: THREE.Object3D | null = null;
    let tail1: THREE.Object3D | null = null;
    let tail2: THREE.Object3D | null = null;
    let tail3: THREE.Object3D | null = null;
    let eyeMount: THREE.Object3D | null = null;
    let mouthMount: THREE.Object3D | null = null;
    let faceMount: THREE.Object3D | null = null;
    const jawName = (spec.jawBoneName ?? "jaw").toLowerCase();

    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mats = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
        let replaced = false;
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (m && typeof m.name === "string" && m.name.toLowerCase().startsWith("screen_face")) {
            const drv = createScreenFaceDriver(spec.screenStyle ?? "neon-rings");
            if (drv) {
              mats[i] = drv.material;
              this.screenDrivers.push(drv);
              replaced = true;
              continue;
            }
          }
          const std = m as THREE.MeshStandardMaterial;
          if (std && "metalness" in std && typeof std.metalness === "number") {
            if (std.metalness > 0.35) std.metalness = 0.3;
            if (typeof std.roughness === "number" && std.roughness < 0.45) std.roughness = 0.5;
            std.needsUpdate = true;
          }
        }
        if (replaced) mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          this.morphMeshes.push(mesh);
        }
      }
      const lower = obj.name.toLowerCase();
      if (!jawBone && lower.includes(jawName)) jawBone = obj;
      if (!shoulderL && lower === "shoulder_l") shoulderL = obj;
      if (!shoulderR && lower === "shoulder_r") shoulderR = obj;
      if (!upperArmL && lower === "upper_arm_l") upperArmL = obj;
      if (!upperArmR && lower === "upper_arm_r") upperArmR = obj;
      if (!forearmL && lower === "forearm_l") forearmL = obj;
      if (!forearmR && lower === "forearm_r") forearmR = obj;
      if (!handL && lower === "hand_l") handL = obj;
      if (!handR && lower === "hand_r") handR = obj;
      if (!thighL && lower === "thigh_l") thighL = obj;
      if (!thighR && lower === "thigh_r") thighR = obj;
      if (!shinL && lower === "shin_l") shinL = obj;
      if (!shinR && lower === "shin_r") shinR = obj;
      if (!footL && lower === "foot_l") footL = obj;
      if (!footR && lower === "foot_r") footR = obj;
      if (!earL && lower === "ear_l") earL = obj;
      if (!earR && lower === "ear_r") earR = obj;
      if (!tail1 && lower === "tail_1") tail1 = obj;
      if (!tail2 && lower === "tail_2") tail2 = obj;
      if (!tail3 && lower === "tail_3") tail3 = obj;
      if (!eyeMount && lower === "tabby_eye_screen_mount") eyeMount = obj;
      if (!mouthMount && lower === "tabby_mouth_mount") mouthMount = obj;
      if (!faceMount && lower === "moppet_face_mount") faceMount = obj;
    });
    const headBone = root.getObjectByName("head") ?? null;

    this.jawBone = jawBone;
    this.jawRestX = jawBone ? (jawBone as THREE.Object3D).rotation.x : 0;
    this.shoulderL = shoulderL;
    this.shoulderR = shoulderR;
    this.upperArmL = upperArmL;
    this.upperArmR = upperArmR;
    this.forearmL = forearmL;
    this.forearmR = forearmR;
    this.handL = handL;
    this.handR = handR;
    this.thighL = thighL;
    this.thighR = thighR;
    this.shinL = shinL;
    this.shinR = shinR;
    this.footL = footL;
    this.footR = footR;
    this.earL = earL;
    this.earR = earR;
    this.tail1 = tail1;
    this.tail2 = tail2;
    this.tail3 = tail3;
    this.relaxArmsRad = spec.url.includes("/hertz/")
      ? -0.44
      : spec.url.includes("/tracker/")
        ? -0.32
        : 0;
    this.isCueModel = spec.url.includes("/cue/");
    this.isClankModel = spec.url.includes("/clank/");
    this.isWattModel = spec.url.includes("/watt/");
    this.isChipModel = spec.url.includes("/chip/");
    this.isZapModel = spec.url.includes("/zap/");
    this.isThrumModel = spec.url.includes("/thrum/");

    if (spec.faceOverlay === "tabby-led-mouth" && (eyeMount || mouthMount)) {
      this.tabbyPortals = new TabbyHeadPortals(eyeMount, mouthMount);
    }

    if (spec.faceOverlay === "anicraft-face-sheet" && spec.faceSheet && faceMount) {
      this.faceSheet = spec.faceSheet;
      const tex = loadStageTexture(spec.faceSheet.url) ?? null;
      this.faceMat = createAniCraftFaceMat(
        tex,
        this.isCueModel || this.isClankModel,
        this.isClankModel || this.isThrumModel,
        this.isWattModel || this.isChipModel || this.isThrumModel,
      );
      this.faceMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.faceMat);
      if (this.isWattModel) {
        const plateAlpha = createSoftPlateAlphaTexture("rounded-rect");
        this.wattPlateMat = new THREE.MeshStandardMaterial({
          color: "#cfc6b8",
          roughness: 0.78,
          metalness: 0.02,
          alphaMap: plateAlpha ?? undefined,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        this.wattPlateMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.wattPlateMat);
        this.wattPlateMesh.position.set(0, 0, 0.013);
        this.wattPlateMesh.scale.set(0.104, 0.098, 1);
        this.wattPlateMesh.renderOrder = 194;
        (faceMount as THREE.Object3D).add(this.wattPlateMesh);
        this.faceMesh.position.set(0, 0, 0.015);
      } else if (this.isChipModel) {
        this.faceMesh.position.set(0, 0, 0.015);
        if (headBone) {
          const lidAlpha = createSoftPlateAlphaTexture("circle");
          this.chipLidMat = new THREE.MeshStandardMaterial({
            color: "#2b82b8",
            roughness: 0.72,
            metalness: 0.02,
            alphaMap: lidAlpha ?? undefined,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          this.chipLidL = new THREE.Mesh(UNIT_PLANE_GEO, this.chipLidMat);
          this.chipLidL.position.set(0.061, 0.121, 0.098);
          this.chipLidL.rotation.set(-0.18, 0.16, 0, "YXZ");
          this.chipLidL.scale.set(0.054, 0.054, 1);
          headBone.add(this.chipLidL);

          this.chipLidR = new THREE.Mesh(UNIT_PLANE_GEO, this.chipLidMat);
          this.chipLidR.position.set(-0.054, 0.118, 0.086);
          this.chipLidR.rotation.set(-0.18, -0.24, 0, "YXZ");
          this.chipLidR.scale.set(0.054, 0.054, 1);
          headBone.add(this.chipLidR);

          this.chipEyeMatL = createAniCraftFaceMat(tex, false, false, true);
          this.chipEyeL = new THREE.Mesh(UNIT_PLANE_GEO, this.chipEyeMatL);
          this.chipEyeL.position.set(0.0613, 0.1213, 0.1);
          this.chipEyeL.rotation.set(-0.18, 0.16, 0, "YXZ");
          this.chipEyeL.scale.set(0.052, 0.052, 1);
          headBone.add(this.chipEyeL);

          this.chipEyeMatR = createAniCraftFaceMat(tex, false, false, true);
          this.chipEyeR = new THREE.Mesh(UNIT_PLANE_GEO, this.chipEyeMatR);
          this.chipEyeR.position.set(-0.0545, 0.1183, 0.088);
          this.chipEyeR.rotation.set(-0.18, -0.24, 0, "YXZ");
          this.chipEyeR.scale.set(0.052, 0.052, 1);
          headBone.add(this.chipEyeR);
        }
      } else if (this.isThrumModel) {
        this.faceMesh.position.set(
          spec.faceSheet.offsetX ?? 0,
          spec.faceSheet.offsetY ?? -0.026,
          0.013,
        );
        if (headBone) {
          const lidAlpha = createSoftPlateAlphaTexture("rounded-rect");
          this.chipLidMat = new THREE.MeshStandardMaterial({
            color: "#1c1a1e",
            roughness: 0.78,
            metalness: 0.04,
            alphaMap: lidAlpha ?? undefined,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          this.chipLidL = new THREE.Mesh(UNIT_PLANE_GEO, this.chipLidMat);
          this.chipLidL.position.set(0.054, 0.194, 0.104);
          this.chipLidL.scale.set(0.058, 0.048, 1);
          headBone.add(this.chipLidL);

          this.chipLidR = new THREE.Mesh(UNIT_PLANE_GEO, this.chipLidMat);
          this.chipLidR.position.set(-0.056, 0.194, 0.104);
          this.chipLidR.scale.set(0.058, 0.048, 1);
          headBone.add(this.chipLidR);

          this.chipEyeMatL = createAniCraftFaceMat(tex, false, true, true);
          this.chipEyeL = new THREE.Mesh(UNIT_PLANE_GEO, this.chipEyeMatL);
          this.chipEyeL.position.set(0.054, 0.194, 0.107);
          this.chipEyeL.scale.set(0.054, 0.054, 1);
          headBone.add(this.chipEyeL);

          this.chipEyeMatR = createAniCraftFaceMat(tex, false, true, true);
          this.chipEyeR = new THREE.Mesh(UNIT_PLANE_GEO, this.chipEyeMatR);
          this.chipEyeR.position.set(-0.056, 0.194, 0.107);
          this.chipEyeR.scale.set(0.054, 0.054, 1);
          headBone.add(this.chipEyeR);
        }
      } else {
        this.faceMesh.position.set(
          spec.faceSheet.offsetX ?? 0,
          spec.faceSheet.offsetY ?? 0,
          Math.max(0.015, spec.faceSheet.offsetZ ?? 0.01),
        );
      }
      this.faceMesh.renderOrder = 195;
      (faceMount as THREE.Object3D).add(this.faceMesh);
    }
  }

  /** Apply Tabby-only procedural paw-clap + Disney ear perk & tail follow-through after mixer evaluation. */
  private applyTabbySecondaryPose(inp: PerformerUpdateInput, isTabbyClap: boolean): void {
    const dt =
      this.lastPostSec >= 0 && inp.timeSec >= this.lastPostSec
        ? clamp(inp.timeSec - this.lastPostSec, 0, 0.05)
        : 0.016;
    this.lastPostSec = inp.timeSec;

    // 1. Real procedural 2-beat paw-clap (`shoulder_L/R` -> `upper_arm` -> `forearm` -> `hand` forward/inward to chest)
    const clapTarget = isTabbyClap ? 1 : 0;
    const clapRate = isTabbyClap ? 14 : 10;
    this.clapWeight += (clapTarget - this.clapWeight) * (1 - Math.exp(-dt * clapRate));
    if (this.clapWeight > 0.002) {
      const u = (((inp.beat % 2) + 2) % 2) / 2;
      let openAmt: number;
      if (u < 0.16) {
        const a = u / 0.16;
        openAmt = 0.36 + 0.64 * (1 - Math.pow(1 - a, 3));
      } else if (u < 0.28) {
        const snap = (u - 0.16) / 0.12;
        openAmt = 1 - snap * snap * snap;
      } else if (u < 0.56) {
        const hold = (u - 0.28) / 0.28;
        openAmt = 0.2 * Math.sin(hold * Math.PI * 0.65);
      } else if (u < 0.82) {
        const reb = (u - 0.56) / 0.26;
        openAmt = 0.18 + 0.3 * (1 - Math.pow(1 - reb, 2));
      } else {
        const set = (u - 0.82) / 0.18;
        openAmt = 0.48 - 0.12 * set;
      }

      const uaZ = -1.36 + openAmt * 0.48;
      const uaX = -0.34 + openAmt * 0.08;
      const uaY = 0.14;
      const faZ = -1.32 + openAmt * 0.58;
      const faX = 0.24 - openAmt * 0.08;
      const hdZ = -0.06 + openAmt * 0.14;

      const slerpBone = (bone: THREE.Object3D | null, ex: number, ey: number, ez: number) => {
        if (!bone) return;
        this.tmpEuler.set(ex, ey, ez, "ZYX");
        this.tmpQuat.setFromEuler(this.tmpEuler);
        bone.quaternion.slerp(this.tmpQuat, clamp01(this.clapWeight));
      };
      slerpBone(this.upperArmL, uaX, uaY, uaZ);
      slerpBone(this.forearmL, faX, 0, faZ);
      slerpBone(this.handL, 0.06, 0.1, hdZ);
      slerpBone(this.upperArmR, uaX, -uaY, -uaZ);
      slerpBone(this.forearmR, faX, 0, -faZ);
      slerpBone(this.handR, 0.06, -0.1, -hdZ);
    }

    // 2. Ear perk follow-through driven by browLift / high singing pitch, settling cleanly when quiet
    const rawBrow = inp.tabbyFacial ? clamp(inp.tabbyFacial.browLift, -0.25, 1) : 0;
    const pitchPerk =
      inp.singing && inp.artic && inp.artic.f0 > 240
        ? clamp((inp.artic.f0 - 240) / 180, 0, 0.75)
        : 0;
    const clapPerk = isTabbyClap ? 0.45 : 0;
    const targetPerk = inp.singing
      ? clamp(Math.max(rawBrow, pitchPerk * 0.85, clapPerk), -0.15, 1)
      : clamp(Math.max(rawBrow * 0.35, clapPerk), -0.1, 0.65);
    const earRate = targetPerk > this.earPerk ? 12 : 5;
    this.earPerk += (targetPerk - this.earPerk) * (1 - Math.exp(-dt * earRate));
    if (Math.abs(this.earPerk) > 0.002) {
      if (this.earL) {
        this.earL.rotateZ(this.earPerk * 0.14);
        this.earL.rotateX(this.earPerk * 0.09);
      }
      if (this.earR) {
        this.earR.rotateZ(-this.earPerk * 0.14);
        this.earR.rotateX(this.earPerk * 0.09);
      }
    }

    // 3. Overlapping tail wave drag (`tail_1` -> `tail_2` -> `tail_3`) on performing beat accents; settles to 0 when idle
    const tailActiveTarget = inp.performing || inp.singing ? 1 : 0;
    const tailRate = tailActiveTarget > 0 ? 8 : 5;
    this.tailActiveWeight += (tailActiveTarget - this.tailActiveWeight) * (1 - Math.exp(-dt * tailRate));
    if (this.tailActiveWeight > 0.002) {
      const sampleTailPhrase = (beatVal: number): number => {
        const b = Math.max(0, beatVal);
        const dir = Math.floor(b / 2) % 2 === 0 ? 1 : -1;
        const u = ((b % 2) + 2) % 2 / 2;
        let env = 0;
        if (u < 0.14) {
          const a = u / 0.14;
          env = -0.22 * (1 - Math.pow(1 - a, 3));
        } else if (u < 0.36) {
          const s = (u - 0.14) / 0.22 - 1;
          env = -0.22 + 1.22 * (1 + 2.4 * s * s * s + 1.4 * s * s);
        } else if (u < 0.78) {
          env = 0.94 - 0.08 * ((u - 0.36) / 0.42);
        } else {
          const r = (u - 0.78) / 0.22;
          env = 0.86 * Math.pow(1 - r, 3);
        }
        return dir * env * this.tailActiveWeight;
      };
      const w1 = sampleTailPhrase(inp.beat);
      const w2 = sampleTailPhrase(inp.beat - 0.18);
      const w3 = sampleTailPhrase(inp.beat - 0.36);
      if (this.tail1) {
        this.tail1.rotateY(w1 * 0.14);
        this.tail1.rotateX(Math.abs(w1) * 0.08);
      }
      if (this.tail2) {
        this.tail2.rotateZ(-w2 * 0.18);
        this.tail2.rotateX(w2 * 0.08);
      }
      if (this.tail3) {
        this.tail3.rotateZ(-w3 * 0.24);
        this.tail3.rotateX(w3 * 0.1);
      }
    }
  }

  /** Apply 2-beat procedural arm/wing clap (`clank`, `chip`, or asymmetric `watt`). */
  private applyTwoBeatClapPose(
    inp: PerformerUpdateInput,
    active: boolean,
    upperHitQ: readonly [number, number, number, number],
    upperOpenQ: readonly [number, number, number, number],
    foreHitQ: readonly [number, number, number, number],
    foreOpenQ: readonly [number, number, number, number],
    asymRight?: {
      readonly upperHitQ: readonly [number, number, number, number];
      readonly upperOpenQ: readonly [number, number, number, number];
      readonly foreHitQ: readonly [number, number, number, number];
      readonly foreOpenQ: readonly [number, number, number, number];
      readonly shoulderHitL?: readonly [number, number, number, number];
      readonly shoulderOpenL?: readonly [number, number, number, number];
      readonly shoulderHitR?: readonly [number, number, number, number];
      readonly shoulderOpenR?: readonly [number, number, number, number];
    },
  ): void {
    const dt =
      this.lastPostSec >= 0 && inp.timeSec >= this.lastPostSec
        ? clamp(inp.timeSec - this.lastPostSec, 0, 0.05)
        : 0.016;
    this.lastPostSec = inp.timeSec;

    const clapTarget = active ? 1 : 0;
    const clapRate = active ? 30 : 10;
    this.clapWeight += (clapTarget - this.clapWeight) * (1 - Math.exp(-dt * clapRate));
    if (this.clapWeight <= 0.002) return;

    // Pose-to-pose 2-beat phrase: anticipation -> snap contact -> hold -> recoil
    // Interactive Cast Pad clicks start deterministically from `actionElapsedSec` so beat 1 snaps crisply at ~120ms
    const u =
      inp.actionElapsedSec !== undefined && !inp.performing
        ? (((inp.actionElapsedSec * 1.65) % 1) + 1) % 1
        : (((inp.beat * 1.0 + inp.phaseIndex * 0.25) % 1) + 1) % 1;
    let openAmt: number;
    if (u < 0.08) {
      const a = u / 0.08;
      openAmt = 0.45 + 0.55 * (1 - Math.pow(1 - a, 3));
    } else if (u < 0.20) {
      const snap = (u - 0.08) / 0.12;
      openAmt = 1 - snap * snap * snap;
    } else if (u < 0.56) {
      const hold = (u - 0.20) / 0.36;
      openAmt = 0.06 * Math.sin(hold * Math.PI * 0.65);
    } else if (u < 0.84) {
      const reb = (u - 0.56) / 0.28;
      openAmt = 0.06 + 0.54 * (1 - Math.pow(1 - reb, 2));
    } else {
      const set = (u - 0.84) / 0.16;
      openAmt = 0.60 - 0.15 * set;
    }

    const slerpOne = (
      bone: THREE.Object3D | null,
      hitQ: readonly [number, number, number, number],
      openQ: readonly [number, number, number, number],
      mirrorR = false,
    ) => {
      if (!bone) return;
      this.tmpQuat.set(hitQ[0], hitQ[1], hitQ[2], hitQ[3]);
      this.tmpTargetQuat.set(openQ[0], openQ[1], openQ[2], openQ[3]);
      this.tmpQuat.slerp(this.tmpTargetQuat, openAmt);
      if (mirrorR) {
        this.tmpQuat.set(this.tmpQuat.x, -this.tmpQuat.y, -this.tmpQuat.z, this.tmpQuat.w);
      }
      bone.quaternion.slerp(this.tmpQuat, this.clapWeight);
    };

    if (asymRight?.shoulderHitL && asymRight.shoulderOpenL) {
      slerpOne(this.shoulderL, asymRight.shoulderHitL, asymRight.shoulderOpenL);
    }
    if (asymRight?.shoulderHitR && asymRight.shoulderOpenR) {
      slerpOne(this.shoulderR, asymRight.shoulderHitR, asymRight.shoulderOpenR);
    }
    slerpOne(this.upperArmL, upperHitQ, upperOpenQ);
    slerpOne(
      this.upperArmR,
      asymRight?.upperHitQ ?? upperHitQ,
      asymRight?.upperOpenQ ?? upperOpenQ,
      !asymRight,
    );
    slerpOne(this.forearmL, foreHitQ, foreOpenQ);
    slerpOne(
      this.forearmR,
      asymRight?.foreHitQ ?? foreHitQ,
      asymRight?.foreOpenQ ?? foreOpenQ,
      !asymRight,
    );
  }

  update(inp: PerformerUpdateInput): void {
    const rawClip = (inp.actionClip ?? "").trim().toLowerCase();
    const isTabbyClap = this.tabbyPortals !== null && rawClip === "clap";
    const isClankClap = this.isClankModel && rawClip === "clap";
    const isWattClap = this.isWattModel && rawClip === "clap";
    const isChipClap = this.isChipModel && rawClip === "clap";
    const isZapClap = this.isZapModel && rawClip === "clap";
    const isThrumClap = this.isThrumModel && rawClip === "clap";
    const resolvedClip =
      isTabbyClap || isClankClap || isWattClap || isChipClap || isZapClap || isThrumClap
        ? inp.singing
          ? "sing"
          : "idle"
        : resolve3DClipName(inp.actionClip, inp.singing);
    const chosenEntry: [string, THREE.AnimationAction] | undefined =
      (this.actions.has(resolvedClip) ? [resolvedClip, this.actions.get(resolvedClip)!] : undefined) ??
      (this.actions.has(inp.singing ? "sing" : "idle")
        ? [inp.singing ? "sing" : "idle", this.actions.get(inp.singing ? "sing" : "idle")!]
        : undefined) ??
      (this.actions.has("idle") ? ["idle", this.actions.get("idle")!] : undefined) ??
      this.actions.entries().next().value;

    if (chosenEntry) {
      const [chosenKey, chosen] = chosenEntry;
      const dur = Math.max(0.05, chosen.getClip().duration || 1);
      const isInteractiveWalk = chosenKey === "walk" && inp.actionElapsedSec !== undefined;
      const isOneShot = chosenKey === "jump" || chosenKey === "spin" || chosenKey === "bow";
      const sampleSec = isInteractiveWalk
        ? inp.actionElapsedSec! + (this.isZapModel ? 0.36 : 0.2)
        : isOneShot
          ? inp.timeSec
          : inp.timeSec + inp.phaseIndex * 0.43;
      const t =
        inp.clipProgress01 !== undefined && Number.isFinite(inp.clipProgress01)
          ? clamp01(inp.clipProgress01) * (dur - 0.001)
          : ((sampleSec % dur) + dur) % dur;

      const bs = this.blend;
      const dt = bs.lastTimeSec >= 0 ? inp.timeSec - bs.lastTimeSec : 0;
      if (!bs.currentClip || dt < -0.02 || dt > 0.6) {
        bs.currentClip = chosenKey;
        bs.prevClip = null;
        bs.switchTimeSec = inp.timeSec;
      } else if (chosenKey !== bs.currentClip) {
        bs.prevClip = bs.currentClip;
        bs.currentClip = chosenKey;
        bs.switchTimeSec = inp.timeSec;
        bs.prevLocalTime = bs.lastLocalTime;
      }

      const blendDur = isInteractiveWalk ? 0.09 : 0.22;
      const rawBlend = bs.prevClip ? clamp01((inp.timeSec - bs.switchTimeSec) / blendDur) : 1;
      const alpha = rawBlend * rawBlend * (3 - 2 * rawBlend);
      const prevAction = bs.prevClip && alpha < 0.995 ? this.actions.get(bs.prevClip) : undefined;

      for (const a of this.actions.values()) {
        if (a !== chosen && a !== prevAction) {
          a.setEffectiveWeight(0);
          a.stop();
        }
      }
      if (prevAction && prevAction !== chosen) {
        const pDur = Math.max(0.05, prevAction.getClip().duration || 1);
        const pT = (((bs.prevLocalTime + Math.max(0, inp.timeSec - bs.switchTimeSec)) % pDur) + pDur) % pDur;
        if (!prevAction.isRunning()) prevAction.play();
        prevAction.enabled = true;
        prevAction.paused = false;
        prevAction.setEffectiveWeight(1 - alpha);
        prevAction.time = pT;
      } else {
        bs.prevClip = null;
      }

      if (!chosen.isRunning()) chosen.play();
      chosen.enabled = true;
      chosen.paused = false;
      chosen.setEffectiveWeight(prevAction ? alpha : 1);
      chosen.time = t;

      this.mixer.update(0);
      if (this.relaxArmsRad !== 0 && (resolvedClip === "idle" || resolvedClip === "sing")) {
        this.upperArmL?.rotateX(this.relaxArmsRad);
        this.upperArmR?.rotateX(this.relaxArmsRad);
        this.forearmL?.rotateX(-0.14);
        this.forearmR?.rotateX(-0.14);
      }
      if (this.tabbyPortals !== null) {
        this.applyTabbySecondaryPose(inp, isTabbyClap);
      }
      if (this.isClankModel) {
        this.applyTwoBeatClapPose(
          inp,
          isClankClap,
          [-0.2972, 0.2409, -0.5068, 0.7726],
          [-0.4208, 0.188, -0.2738, 0.8442],
          [0.0073, -0.0068, -0.6816, 0.7317],
          [0, 0, -0.2231, 0.9748],
        );
      }
      if (this.isWattModel) {
        this.applyTwoBeatClapPose(
          inp,
          isWattClap,
          [0.1584, -0.11, -0.2705, 0.9432],
          [-0.2762, -0.3777, -0.1984, 0.8612],
          [0.0061, 0.0002, 0.0137, 0.9999],
          [0.0029, 0.0004, 0.0051, 1],
          {
            upperHitQ: [-0.1416, -0.4397, 0.484, 0.7432],
            upperOpenQ: [-0.0104, -0.4069, 0.2352, 0.8826],
            foreHitQ: [0.0059, 0.0063, 0.0036, 1],
            foreOpenQ: [0.0438, 0.0022, 0.0218, 0.9988],
            shoulderHitL: [-0.2534, -0.6601, -0.6601, 0.2534],
            shoulderOpenL: [-0.4056, -0.5792, -0.5792, 0.4056],
            shoulderHitR: [-0.4305, 0.561, 0.561, 0.4305],
            shoulderOpenR: [-0.4777, 0.5213, 0.5213, 0.4777],
          },
        );
      }
      if (this.isChipModel) {
        this.applyTwoBeatClapPose(
          inp,
          isChipClap,
          [-0.0805, -0.0334, -0.3812, 0.9204],
          [-0.2071, -0.0181, -0.0853, 0.9744],
          [0, 0, -0.2588, 0.9659],
          [0, 0, -0.0698, 0.9976],
          {
            upperHitQ: [-0.0805, 0.0334, 0.3812, 0.9204],
            upperOpenQ: [-0.2071, 0.0181, 0.0853, 0.9744],
            foreHitQ: [0, 0, 0.2588, 0.9659],
            foreOpenQ: [0, 0, 0.0698, 0.9976],
            shoulderHitL: [-0.2706, -0.6533, -0.6533, 0.2706],
            shoulderOpenL: [-0.4156, -0.5721, -0.5721, 0.4156],
            shoulderHitR: [-0.2706, 0.6533, 0.6533, 0.2706],
            shoulderOpenR: [-0.4156, 0.5721, 0.5721, 0.4156],
          },
        );
      }
      if (this.isThrumModel) {
        this.applyTwoBeatClapPose(
          inp,
          isThrumClap,
          [0.1591, -0.1283, -0.6003, 0.7732],
          [0.0848, -0.1039, -0.4105, 0.902],
          [0.1059, -0.2759, -0.3425, 0.8918],
          [0.0359, -0.1754, -0.1971, 0.9639],
          {
            upperHitQ: [0.1591, 0.1283, 0.6003, 0.7732],
            upperOpenQ: [0.0848, 0.1039, 0.4105, 0.902],
            foreHitQ: [0.1059, 0.2759, 0.3425, 0.8918],
            foreOpenQ: [0.0359, 0.1754, 0.1971, 0.9639],
            shoulderHitL: [-0.4338, -0.5584, -0.5584, 0.4338],
            shoulderOpenL: [-0.4611, -0.5361, -0.5361, 0.4611],
            shoulderHitR: [-0.4338, 0.5584, 0.5584, 0.4338],
            shoulderOpenR: [-0.4611, 0.5361, 0.5361, 0.4611],
          },
        );
      }
      if (this.isZapModel) {
        if (chosenKey === "walk") {
          const stepPhase =
            ((inp.actionElapsedSec !== undefined ? inp.actionElapsedSec + 0.02 : sampleSec) / dur) *
            Math.PI *
            2;
          const stepEnv = inp.actionElapsedSec !== undefined ? clamp01(inp.actionElapsedSec / 0.09) : 1;
          const liftL = Math.max(0, Math.sin(stepPhase)) * stepEnv;
          const liftR = Math.max(0, -Math.sin(stepPhase)) * stepEnv;
          if (liftL > 0.01) {
            this.thighL?.rotateX(liftL * 0.48);
            this.shinL?.rotateX(-liftL * 0.85);
            this.footL?.rotateX(liftL * 0.32);
          }
          if (liftR > 0.01) {
            this.thighR?.rotateX(liftR * 0.48);
            this.shinR?.rotateX(-liftR * 0.85);
            this.footR?.rotateX(liftR * 0.32);
          }
        }
        this.applyTwoBeatClapPose(
          inp,
          isZapClap,
          [0.1133, 0.2286, -0.1928, 0.9475],
          [0.1995, 0.1919, -0.1995, 0.94],
          [0.1384, 0.209, -0.053, 0.9666],
          [0.1624, 0.2059, -0.0776, 0.9619],
          {
            upperHitQ: [-0.0081, 0.058, 0.3746, 0.9253],
            upperOpenQ: [-0.0091, 0.0114, 0.3498, 0.9367],
            foreHitQ: [0.0519, 0.0293, 0.1039, 0.9928],
            foreOpenQ: [-0.0223, 0.0297, 0.1881, 0.9815],
            shoulderHitL: [-0.1237, -0.5722, -0.6791, 0.4429],
            shoulderOpenL: [-0.3259, -0.4305, -0.6933, 0.4773],
            shoulderHitR: [-0.0318, 0.782, 0.5341, 0.3196],
            shoulderOpenR: [-0.2802, 0.7608, 0.5086, 0.2898],
          },
        );
      }
      this.root.updateMatrixWorld(true);
      bs.lastTimeSec = inp.timeSec;
      bs.lastLocalTime = t;
    }

    // CHIMERA articulators -> morphs, jaw bone, flush CRT screen, Tabby portals, AniCraft face
    const open = inp.artic ? clamp01(inp.artic.open) : 0;
    const jaw = inp.artic ? clamp01(inp.artic.jaw) : open;
    const round = inp.artic ? clamp01(inp.artic.round) : 0;
    const width = inp.artic ? clamp01(inp.artic.lipWidth) : 0.5;
    const closed = open <= 0.02 ? 1 : 0;

    for (const mesh of this.morphMeshes) {
      const dict = mesh.morphTargetDictionary!;
      const inf = mesh.morphTargetInfluences!;
      const setMorph = (names: readonly string[], v: number) => {
        for (const n of names) {
          const idx = dict[n];
          if (idx !== undefined) inf[idx] = v;
        }
      };
      setMorph(["jawOpen", "mouthOpen", "viseme_aa", "JawOpen", "MouthOpen"], open);
      setMorph(["mouthFunnel", "mouthPucker", "viseme_O", "viseme_U"], open > 0.02 ? round : 0);
      setMorph(["mouthSmile", "mouthStretch", "viseme_I"], open > 0.02 ? Math.max(0, width - 0.4) * 1.4 : 0);
      setMorph(["mouthClose", "viseme_PP"], closed);
    }

    if (this.jawBone) {
      const maxRad = ((this.spec.jawMaxDeg ?? 22) * Math.PI) / 180;
      this.jawBone.rotation.x = this.jawRestX + jaw * maxRad;
    }

    for (const drv of this.screenDrivers) {
      drv.sync(inp.artic, inp.singing, inp.timeSec, isZapClap ? "clap" : resolvedClip);
    }

    const baseOrder = zRenderOrder(inp.z);
    this.tabbyPortals?.sync(inp.tabbyFacial, isTabbyClap ? "clap" : resolvedClip, baseOrder);

    if (this.faceMesh && this.faceMat && this.faceSheet) {
      const tex = loadStageTexture(this.faceSheet.url) ?? null;
      const faceClip = isClankClap || isWattClap || isChipClap || isThrumClap || isZapClap ? "clap" : resolvedClip;
      const cell = selectAniCraftFaceCell(inp.artic, inp.singing, inp.timeSec, faceClip);
      const mouthOnly = Boolean(this.faceSheet.mouthOnly) && !this.isWattModel && !this.isChipModel;
      const uvRect = computeAniCraftCellUvRect(
        cell,
        this.faceSheet.cols,
        this.faceSheet.rows,
        mouthOnly,
        this.isClankModel ? "clank" : this.isWattModel ? "watt" : this.isChipModel ? "chip" : this.isCueModel,
      );
      this.faceMat.uniforms.uMap.value = tex;
      (this.faceMat.uniforms.uUvRect.value as THREE.Vector4).set(uvRect[0], uvRect[1], uvRect[2], uvRect[3]);
      const hideMouth = mouthOnly && ((!inp.singing && !isThrumClap) || cell === 0 || (cell === 7 && !isThrumClap));
      this.faceMesh.visible = Boolean(tex) && !hideMouth;
      this.faceMesh.renderOrder = baseOrder + 5;
      if (this.wattPlateMesh) {
        this.wattPlateMesh.visible = Boolean(tex);
        this.wattPlateMesh.renderOrder = baseOrder + 4;
      }
      if (this.chipEyeL && this.chipEyeR && this.chipEyeMatL && this.chipEyeMatR) {
        const blink = clamp01(naturalBlinkAmountAt(inp.timeSec, inp.singing));
        const happyEye =
          blink > 0.48 || resolvedClip === "bow" || resolvedClip === "jump" || isChipClap || isThrumClap;
        const eyeCell = happyEye ? 7 : 0;
        const cols = Math.max(1, this.faceSheet.cols);
        const rows = Math.max(1, this.faceSheet.rows);
        const col = eyeCell % cols;
        const row = Math.floor(eyeCell / cols);
        const cellU = col / cols;
        const cellV = 1 - (row + 1) / rows;
        const du = 1 / cols;
        const dv = 1 / rows;
        const uOffL = this.isThrumModel ? 0.535 : 0.55;
        const uOffR = this.isThrumModel ? 0.145 : 0.16;
        const vOff = this.isThrumModel ? 0.595 : 0.59;
        const uvSpan = this.isThrumModel ? 0.31 : 0.29;
        this.chipEyeMatL.uniforms.uMap.value = tex;
        (this.chipEyeMatL.uniforms.uUvRect.value as THREE.Vector4).set(
          cellU + du * uOffL,
          cellV + dv * vOff,
          du * uvSpan,
          dv * uvSpan,
        );
        this.chipEyeMatR.uniforms.uMap.value = tex;
        (this.chipEyeMatR.uniforms.uUvRect.value as THREE.Vector4).set(
          cellU + du * uOffR,
          cellV + dv * vOff,
          du * uvSpan,
          dv * uvSpan,
        );
        const showEyes = Boolean(tex);
        this.chipEyeL.visible = showEyes;
        this.chipEyeR.visible = showEyes;
        this.chipEyeL.renderOrder = baseOrder + 5;
        this.chipEyeR.renderOrder = baseOrder + 5;
        if (this.chipLidL && this.chipLidR) {
          this.chipLidL.visible = showEyes;
          this.chipLidR.visible = showEyes;
          this.chipLidL.renderOrder = baseOrder + 4;
          this.chipLidR.renderOrder = baseOrder + 4;
        }
      }
      const openBoostY =
        inp.singing && inp.artic && inp.artic.open > 0.05
          ? 1 + clamp01(inp.artic.open) * (this.isChipModel ? 0.16 : mouthOnly ? 0.14 : 0.06)
          : 1;
      const faceW = this.isCueModel
        ? 0.168
        : this.isClankModel
          ? 0.182
          : this.isWattModel
            ? 0.102
            : this.isChipModel
              ? 0.098
              : this.isThrumModel
                ? 0.162
                : this.faceSheet.width;
      const faceH = this.isCueModel
        ? 0.114
        : this.isClankModel
          ? 0.15
          : this.isWattModel
            ? 0.096
            : this.isChipModel
              ? 0.078
              : this.isThrumModel
                ? 0.092
                : this.faceSheet.height;
      this.faceMesh.scale.set(faceW, faceH * openBoostY, 1);
    }

    const h = inp.worldHeight * (this.spec.scale ?? 1);
    const baseFloorY = inp.floorY ?? 0;
    const hopY = Math.max(0, inp.y - baseFloorY);
    const isOneShot = resolvedClip === "jump" || resolvedClip === "spin" || resolvedClip === "bow";
    const beatPhase = inp.beat * Math.PI * 2 + inp.phaseIndex * 0.7;
    const applySinGroove = inp.performing && !isOneShot && !inp.poseDrivenGroove;
    // Grounded volume-preserving beat groove (zero floating hover off y = 0)
    const grooveAmt = applySinGroove
      ? (0.5 - 0.5 * Math.cos(beatPhase)) * (inp.singing ? 0.024 : 0.014)
      : 0;
    const grooveSy = 1 - grooveAmt;
    const grooveSx = 1 / Math.sqrt(grooveSy);
    const grooveSway = applySinGroove ? Math.sin(beatPhase * 0.5) * (inp.singing ? 0.045 : 0.024) : 0;
    const breath = inp.poseDrivenGroove ? 1 : 1 + Math.sin(inp.timeSec * 2.1 + inp.phaseIndex) * 0.008;
    const yawRad = ((this.spec.yawOffsetDeg ?? 0) * Math.PI) / 180 + inp.rotY + (inp.facing < 0 ? -0.35 : 0);

    const bodySy = Math.max(0.2, h * inp.stretchY * breath * grooveSy);
    this.group.position.set(inp.x, baseFloorY, inp.z);
    this.bodyGroup.position.set(0, hopY + (this.spec.yOffset ?? 0), 0);
    this.bodyGroup.rotation.set(0, yawRad, inp.leanRad + grooveSway);
    this.bodyGroup.scale.set(h * inp.squashX * grooveSx, bodySy, h * grooveSx);
    this.root.position.set(this.bindRootX, this.bindRootY, this.bindRootZ);
    this.group.updateMatrixWorld(true);

    const sampleSideSole = (
      verts: readonly SoleVertSample[],
      bone: THREE.Object3D | null,
      soleOff: number,
    ): { minY: number; cx: number; cz: number } => {
      if (verts.length > 0) {
        let minY = Infinity;
        let sx = 0;
        let sz = 0;
        const v = this.tmpSoleVec;
        for (let i = 0; i < verts.length; i++) {
          const item = verts[i];
          const posAttr = item.mesh.geometry.getAttribute("position");
          v.fromBufferAttribute(posAttr, item.idx);
          item.mesh.applyBoneTransform(item.idx, v);
          v.applyMatrix4(item.mesh.matrixWorld);
          if (v.y < minY) minY = v.y;
          sx += v.x;
          sz += v.z;
        }
        return { minY, cx: sx / verts.length, cz: sz / verts.length };
      }
      if (bone) {
        bone.getWorldPosition(this.tmpSoleVec);
        return {
          minY: this.tmpSoleVec.y - soleOff * bodySy,
          cx: this.tmpSoleVec.x,
          cz: this.tmpSoleVec.z,
        };
      }
      return { minY: baseFloorY + hopY, cx: inp.x, cz: inp.z };
    };

    const soleL = sampleSideSole(this.soleVertsL, this.soleBoneL, this.soleOffsetL);
    const soleR = sampleSideSole(this.soleVertsR, this.soleBoneR, this.soleOffsetR);
    const minFootWorldY = Math.min(soleL.minY, soleR.minY);
    const isJumpClip = resolvedClip === "jump";
    let groundShiftWorldY = 0;
    if (hopY <= 0.004 && !isJumpClip && Number.isFinite(minFootWorldY)) {
      const deltaBodyY = clamp(-(minFootWorldY - baseFloorY) / bodySy, -0.22, 0.22);
      this.root.position.y = this.bindRootY + deltaBodyY;
      this.group.updateMatrixWorld(true);
      groundShiftWorldY = deltaBodyY * bodySy;
    }

    const liftL = Math.max(0, soleL.minY + groundShiftWorldY - baseFloorY);
    const liftR = Math.max(0, soleR.minY + groundShiftWorldY - baseFloorY);
    const footSpotR = clamp(h * 0.16, 0.17, 0.34);
    const footScaleL = clamp(1 - liftL * 0.9, 0.45, 1.0);
    const footScaleR = clamp(1 - liftR * 0.9, 0.45, 1.0);

    this.footShadowL.position.set(soleL.cx - inp.x, 0.002, soleL.cz - inp.z);
    this.footShadowL.scale.set(footSpotR * 1.45 * footScaleL, footSpotR * 1.15 * footScaleL, 1);
    this.footShadowL.renderOrder = baseOrder - 29;
    this.footShadowMatL.opacity = clamp(0.68 - liftL * 1.85, 0.04, 0.68);

    this.footShadowR.position.set(soleR.cx - inp.x, 0.002, soleR.cz - inp.z);
    this.footShadowR.scale.set(footSpotR * 1.45 * footScaleR, footSpotR * 1.15 * footScaleR, 1);
    this.footShadowR.renderOrder = baseOrder - 29;
    this.footShadowMatR.opacity = clamp(0.68 - liftR * 1.85, 0.04, 0.68);

    this.shadowMesh.position.set(
      (soleL.cx + soleR.cx) * 0.5 - inp.x,
      0.002,
      (soleL.cz + soleR.cz) * 0.5 - inp.z,
    );
    this.shadowMesh.renderOrder = baseOrder - 30;
    const shadowR = clamp(h * 0.28 * (1 - hopY * 0.2), 0.32, 0.76);
    this.shadowMesh.scale.set(shadowR * 2.15, shadowR * 1.4, 1);
    this.shadowMat.opacity = clamp(0.36 - hopY * 0.12, 0.08, 0.36);

    this.headAnchorPos.set(inp.x, baseFloorY + hopY + inp.worldHeight * 0.96, inp.z);
  }

  getHeadWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.headAnchorPos);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const d of this.screenDrivers) d.dispose();
    this.faceMat?.dispose();
    this.wattPlateMat?.alphaMap?.dispose();
    this.wattPlateMat?.dispose();
    this.chipEyeMatL?.dispose();
    this.chipEyeMatR?.dispose();
    this.chipLidMat?.alphaMap?.dispose();
    this.chipLidMat?.dispose();
    this.shadowMat.dispose();
    this.footShadowMatL.dispose();
    this.footShadowMatR.dispose();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TIER 2: ARTICULATED 2.5D MULTIPLANE RIG (`clank`, `fuzz`, `hertz`, `latch`, `ozzi`, `tally`)
// ═══════════════════════════════════════════════════════════════════════════
interface MultiplaneNodeVisual {
  readonly spec: MultiplaneNodeSpec;
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh | null;
  readonly mat: THREE.MeshBasicMaterial | null;
  readonly depthMat: THREE.MeshDepthMaterial | null;
  readonly hoseGeo: THREE.PlaneGeometry | null;
  readonly hoseBasePos: Float32Array | null;
}

class MultiplanePerformer3D {
  readonly group = new THREE.Group();
  private readonly rigRoot = new THREE.Group();
  private readonly shadowMesh: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly glowMesh: THREE.Mesh;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly nodeVisuals = new Map<number, MultiplaneNodeVisual>();
  private readonly restPose: EvaluatedMultiplanePose;
  private restOpaqueMinY = 0;
  private measuredReadyCount = -1;
  private readonly crtCanvas: HTMLCanvasElement | null = null;
  private readonly crtTex: THREE.CanvasTexture | null = null;
  private readonly crtMat: THREE.MeshBasicMaterial | null = null;
  private readonly crtScreenMesh: THREE.Mesh | null = null;
  private readonly tallyDomeGlowMat: THREE.MeshBasicMaterial | null = null;
  private readonly tallyDomeGlowMesh: THREE.Mesh | null = null;
  private readonly tallyMouthCanvas: HTMLCanvasElement | null = null;
  private readonly tallyMouthTex: THREE.CanvasTexture | null = null;
  private readonly tallyMouthMat: THREE.MeshBasicMaterial | null = null;
  private readonly tallyMouthMesh: THREE.Mesh | null = null;
  private readonly latchLedGroup: THREE.Group | null = null;
  private readonly latchLedGlowMat: THREE.MeshBasicMaterial | null = null;
  private readonly latchLedGlowMesh: THREE.Mesh | null = null;
  private readonly fuzzTubeGlowMat: THREE.MeshBasicMaterial | null = null;
  private readonly fuzzTubeGlowL: THREE.Mesh | null = null;
  private readonly fuzzTubeGlowR: THREE.Mesh | null = null;
  private readonly fuzzFaceCanvas: HTMLCanvasElement | null = null;
  private readonly fuzzFaceTex: THREE.CanvasTexture | null = null;
  private readonly fuzzFaceMat: THREE.MeshBasicMaterial | null = null;
  private readonly fuzzFaceMesh: THREE.Mesh | null = null;
  private readonly hertzScreenCanvas: HTMLCanvasElement | null = null;
  private readonly hertzScreenTex: THREE.CanvasTexture | null = null;
  private readonly hertzScreenMat: THREE.MeshBasicMaterial | null = null;
  private readonly hertzScreenMesh: THREE.Mesh | null = null;
  private readonly effectiveRigHeightPx: number = 920;
  private readonly effectiveRigWidthPx: number = 680;
  private lastCrtKey = "";
  private lastTallyMouthKey = "";
  private lastFuzzFaceKey = "";
  private lastHertzScreenKey = "";
  private readonly headAnchorPos = new THREE.Vector3();

  constructor(private readonly rig: MultiplaneRigSpec) {
    // Measure actual footage vertical/horizontal pixel span at rest so compact props (e.g. Latch pedal)
    // fill their authored worldHeight cleanly instead of shrinking to 1/3 height against a 920px biped divisor.
    const restPose = evaluateMultiplanePose(rig, {
      beat: 0,
      timeSec: 0,
      singing: false,
      level: 0,
      mouthOpen: false,
      gagActive: false,
      phaseIndex: 0,
      still: true,
    });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of rig.nodes) {
      if (n.sourceType !== "Footage" || !n.publicSrc || n.width <= 0 || n.height <= 0) continue;
      const np = restPose.byId.get(n.id);
      if (!np) continue;
      const ancX = n.anchor[0] ?? 0;
      const ancY = n.anchor[1] ?? 0;
      const left = -ancX;
      const right = n.width - ancX;
      const top = ancY;
      const bottom = ancY - n.height;
      const m = np.worldMat;
      for (const [lx, ly] of [
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
      ]) {
        const wx = m.a * lx + m.c * ly + m.tx;
        const wy = m.b * lx + m.d * ly + m.ty;
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }
    }
    this.restPose = restPose;
    if (Number.isFinite(minY) && Number.isFinite(maxY) && maxY - minY > 80) {
      const spanY = maxY - minY;
      this.effectiveRigHeightPx = spanY < 620 ? clamp(spanY * 1.18, 520, 920) : 920;
    }
    if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX - minX > 80) {
      this.effectiveRigWidthPx = clamp(maxX - minX, 340, 860);
    }
    const contactShadow = createContactShadowMesh(0.72);
    this.shadowMesh = contactShadow.mesh;
    this.shadowMat = contactShadow.mat;
    this.shadowMesh.renderOrder = 155;
    this.group.add(this.shadowMesh);

    const glowTex = createSoftGlowTexture("rgba(255,255,255,0.6)", "rgba(255,255,255,0.15)");
    this.glowMat = new THREE.MeshBasicMaterial({
      map: glowTex ?? undefined,
      color: "#ffd080",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.glowMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.glowMat);
    this.glowMesh.rotation.x = -Math.PI / 2;
    this.glowMesh.position.set(0, 0.003, 0);
    this.glowMesh.renderOrder = 158;
    this.group.add(this.glowMesh);

    this.group.add(this.rigRoot);

    // Build parented THREE.Group hierarchy preserving true Z-layered 2.5D separation!
    for (const n of rig.nodes) {
      const grp = new THREE.Group();
      let mesh: THREE.Mesh | null = null;
      let mat: THREE.MeshBasicMaterial | null = null;
      let depthMat: THREE.MeshDepthMaterial | null = null;
      let hoseGeo: THREE.PlaneGeometry | null = null;
      let hoseBasePos: Float32Array | null = null;

      if (n.sourceType === "Footage" && n.publicSrc && n.width > 0 && n.height > 0) {
        const tex = loadStageTexture(n.publicSrc) ?? null;
        mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.03,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        depthMat = createMultiplaneDepthMaterial(tex);
        const ancX = n.anchor[0] ?? 0;
        const ancY = n.anchor[1] ?? 0;
        const cx = n.width / 2 - ancX;
        const cy = -(n.height / 2 - ancY);
        const meshZ = n.zPx * 0.18;

        if (n.hoseDeform) {
          hoseGeo = new THREE.PlaneGeometry(n.width, n.height, 14, 4);
          const posAttr = hoseGeo.getAttribute("position") as THREE.BufferAttribute;
          hoseBasePos = new Float32Array(posAttr.array.length);
          hoseBasePos.set(posAttr.array as Float32Array);
          mesh = new THREE.Mesh(hoseGeo, mat);
          mesh.position.set(cx, cy, meshZ);
        } else {
          mesh = new THREE.Mesh(UNIT_PLANE_GEO, mat);
          mesh.position.set(cx, cy, meshZ);
          mesh.scale.set(n.width, n.height, 1);
        }
        mesh.castShadow = true;
        mesh.customDepthMaterial = depthMat;
        grp.add(mesh);
      }

      this.nodeVisuals.set(n.id, { spec: n, group: grp, mesh, mat, depthMat, hoseGeo, hoseBasePos });
    }

    for (const n of rig.nodes) {
      const entry = this.nodeVisuals.get(n.id)!;
      if (n.parent !== null && this.nodeVisuals.has(n.parent)) {
        this.nodeVisuals.get(n.parent)!.group.add(entry.group);
      } else {
        this.rigRoot.add(entry.group);
      }
    }

    // Optional procedural CRT overlay for Ozzi (`hasProceduralPhosphorCrt`) or `rig.crtFace`
    if ((rig.crtFace || rig.hasProceduralPhosphorCrt) && typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = rig.hasProceduralPhosphorCrt ? 256 : 192;
      this.crtCanvas = c;
      this.crtTex = new THREE.CanvasTexture(c);
      this.crtTex.colorSpace = THREE.SRGBColorSpace;
      this.crtMat = new THREE.MeshBasicMaterial({
        map: this.crtTex,
        transparent: true,
        depthWrite: false,
        blending: rig.hasProceduralPhosphorCrt ? THREE.NormalBlending : THREE.AdditiveBlending,
        toneMapped: false,
      });

      if (rig.crtFace) {
        const host = this.nodeVisuals.get(rig.crtFace.nodeId);
        if (host) {
          const n = host.spec;
          const cx = rig.crtFace.screenCenter[0] - (n.anchor[0] ?? 0);
          const cy = -(rig.crtFace.screenCenter[1] - (n.anchor[1] ?? 0));
          const scr = new THREE.Mesh(UNIT_PLANE_GEO, this.crtMat);
          scr.position.set(cx, cy, n.zPx * 0.18 + 6);
          scr.rotation.z = (rig.crtFace.skewYDeg * Math.PI) / 180;
          scr.scale.set(rig.crtFace.screenSize[0], rig.crtFace.screenSize[1], 1);
          scr.renderOrder = 340;
          host.group.add(scr);
          this.crtScreenMesh = scr;
        }
      } else if (rig.hasProceduralPhosphorCrt) {
        const host = this.nodeVisuals.get(997) ?? this.nodeVisuals.values().next().value;
        if (host) {
          // Center circular phosphor glass directly inside `scope_bezel_frame.webp` cutout (hole cx=-0.5, cy=+188.5, dia=277px)
          const scr = new THREE.Mesh(UNIT_PLANE_GEO, this.crtMat);
          scr.position.set(-0.5, 188.5, 3.6);
          scr.scale.set(304, 304, 1);
          scr.renderOrder = 166;
          host.group.add(scr);
          this.crtScreenMesh = scr;
        }
      }
    }

    // Tally: red `ON AIR` broadcast beacon bloom + articulated mechanical speaker-beak mouth
    if (rig.id === "tally" && typeof document !== "undefined") {
      const domeLit = this.nodeVisuals.get(621);
      if (domeLit) {
        const haloTex = createSoftGlowTexture("rgba(255,112,78,0.96)", "rgba(255,28,14,0.22)");
        this.tallyDomeGlowMat = new THREE.MeshBasicMaterial({
          map: haloTex ?? undefined,
          color: "#ff4834",
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        const halo = new THREE.Mesh(UNIT_PLANE_GEO, this.tallyDomeGlowMat);
        // `on_air_dome_lit.webp` (94x78, anchor [47,77]) filament core sits at pixel (45, 42) -> (-2, +35)
        halo.position.set(-2, 35, 8.2);
        halo.scale.set(220, 220, 1);
        halo.renderOrder = 324;
        domeLit.group.add(halo);
        this.tallyDomeGlowMesh = halo;
      }

      const headHost = this.nodeVisuals.get(683);
      if (headHost) {
        const mc = document.createElement("canvas");
        mc.width = 160;
        mc.height = 112;
        this.tallyMouthCanvas = mc;
        this.tallyMouthTex = new THREE.CanvasTexture(mc);
        this.tallyMouthTex.colorSpace = THREE.SRGBColorSpace;
        this.tallyMouthMat = new THREE.MeshBasicMaterial({
          map: this.tallyMouthTex,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const mouth = new THREE.Mesh(UNIT_PLANE_GEO, this.tallyMouthMat);
        // `head_housing.webp` (293x222, anchor [146.5,195]) oval grille sits at pixel (144, 184.5) -> (-2.5, +10.5)
        mouth.position.set(-2.5, 10.5, headHost.spec.zPx * 0.18 + 3.5);
        mouth.scale.set(116, 82, 1);
        mouth.visible = false;
        mouth.renderOrder = 316;
        headHost.group.add(mouth);
        this.tallyMouthMesh = mouth;
      }
    }

    // Latch: live studio talkback status LED beacon tracking the active pedal sprite
    if (rig.id === "latch" && typeof document !== "undefined") {
      const pelvisHost = this.nodeVisuals.get(2);
      if (pelvisHost) {
        const ledGroup = new THREE.Group();
        const ledTex = createSoftGlowTexture("rgba(255,235,175,0.98)", "rgba(255,128,36,0.26)");
        this.latchLedGlowMat = new THREE.MeshBasicMaterial({
          map: ledTex ?? undefined,
          color: "#ffad42",
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        const ledMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.latchLedGlowMat);
        ledMesh.position.set(339, 175.7, 9.5);
        ledMesh.scale.set(136, 136, 1);
        ledMesh.visible = false;
        ledMesh.renderOrder = 320;
        ledGroup.add(ledMesh);
        pelvisHost.group.add(ledGroup);
        this.latchLedGroup = ledGroup;
        this.latchLedGlowMesh = ledMesh;
      }
    }

    // Fuzz: twin vacuum tube overdrive bloom + expressive CHIMERA LED rock EQ / face display
    if (rig.id === "fuzz" && typeof document !== "undefined") {
      const headHardware = this.nodeVisuals.get(147);
      if (headHardware) {
        const tubeTex = createSoftGlowTexture("rgba(255,205,112,0.98)", "rgba(255,104,22,0.28)");
        this.fuzzTubeGlowMat = new THREE.MeshBasicMaterial({
          map: tubeTex ?? undefined,
          color: "#ffa63a",
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        const tubeL = new THREE.Mesh(UNIT_PLANE_GEO, this.fuzzTubeGlowMat);
        // `part_head_404.webp` (410x343, anchor [205,171.5]) tube cores sit at (-60.4, +90.6) & (+100.0, +63.5)
        tubeL.position.set(-60.4, 90.6, headHardware.spec.zPx * 0.18 + 3.2);
        tubeL.scale.set(125, 138, 1);
        tubeL.renderOrder = 316;
        headHardware.group.add(tubeL);
        this.fuzzTubeGlowL = tubeL;

        const tubeR = new THREE.Mesh(UNIT_PLANE_GEO, this.fuzzTubeGlowMat);
        tubeR.position.set(100.0, 63.5, headHardware.spec.zPx * 0.18 + 3.2);
        tubeR.scale.set(102, 114, 1);
        tubeR.renderOrder = 316;
        headHardware.group.add(tubeR);
        this.fuzzTubeGlowR = tubeR;
      }

      const headNull = this.nodeVisuals.get(14);
      if (headNull) {
        const fc = document.createElement("canvas");
        fc.width = 320;
        fc.height = 104;
        this.fuzzFaceCanvas = fc;
        this.fuzzFaceTex = new THREE.CanvasTexture(fc);
        this.fuzzFaceTex.colorSpace = THREE.SRGBColorSpace;
        this.fuzzFaceMat = new THREE.MeshBasicMaterial({
          map: this.fuzzFaceTex,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const face = new THREE.Mesh(UNIT_PLANE_GEO, this.fuzzFaceMat);
        // `head_chassis_play.webp` dark LED bezel (x=104..389, y=176..267) in `Head_Null` space at 0.645 scale
        face.position.set(2.9, 37.5, 9.32);
        face.scale.set(183.8, 58.7, 1);
        face.visible = false;
        face.renderOrder = 322;
        headNull.group.add(face);
        this.fuzzFaceMesh = face;
      }
    }

    // Hertz: live CH 04 / VIDEO 1 CRT phosphor glass display with blinking cyan eyes & CHIMERA vowel mouth
    if (rig.id === "hertz" && typeof document !== "undefined") {
      const screenOsd = this.nodeVisuals.get(525);
      if (screenOsd) {
        const hc = document.createElement("canvas");
        hc.width = 320;
        hc.height = 272;
        this.hertzScreenCanvas = hc;
        this.hertzScreenTex = new THREE.CanvasTexture(hc);
        this.hertzScreenTex.colorSpace = THREE.SRGBColorSpace;
        this.hertzScreenMat = new THREE.MeshBasicMaterial({
          map: this.hertzScreenTex,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const scr = new THREE.Mesh(UNIT_PLANE_GEO, this.hertzScreenMat);
        // `part_screen_osd.webp` inner dark CRT glass sits inside metal bezel (`x=15..347, y=15..265` on 363x281)
        scr.position.set(-0.5, 0.5, screenOsd.spec.zPx * 0.18 + 0.85);
        scr.scale.set(324, 244, 1);
        scr.renderOrder = 320;
        screenOsd.group.add(scr);
        this.hertzScreenMesh = scr;
      }
    }

    this.recomputeRestOpaqueMinY();
  }

  private updateHose(entry: MultiplaneNodeVisual, hose: HoseDeformSpec, bendPx: number): void {
    if (!entry.hoseGeo || !entry.hoseBasePos) return;
    const posAttr = entry.hoseGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const base = entry.hoseBasePos;
    const w = Math.max(1, entry.spec.width);
    const h = Math.max(1, entry.spec.height);

    for (let i = 0; i < posAttr.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const u =
        hose.axis === "x-right"
          ? (bx + w * 0.5) / w
          : hose.axis === "x-left"
            ? (w * 0.5 - bx) / w
            : (h * 0.5 - by) / h;
      const offset = evaluateHoseOffset(entry.spec, bendPx, u);
      arr[i * 3] = bx + offset.dx;
      arr[i * 3 + 1] = by + offset.dy;
    }
    posAttr.needsUpdate = true;
  }

  private updateCrtCanvas(inp: PerformerUpdateInput): void {
    if (!this.crtCanvas || !this.crtTex) return;
    const ctx = this.crtCanvas.getContext("2d");
    if (!ctx) return;
    const qTime = quantizeTwosSec(inp.timeSec);
    const open = inp.artic ? clamp01(inp.artic.open) : inp.mouthOpen ? 0.55 : 0;
    const round = inp.artic ? clamp01(inp.artic.round) : 0;
    const width = inp.artic ? clamp01(inp.artic.lipWidth) : 0.5;
    const clip = (inp.actionClip ?? "").toLowerCase();
    const key = `${Math.round(qTime * 12)}|${inp.singing ? 1 : 0}|${Math.round(open * 10)}|${Math.round(round * 6)}|${Math.round(width * 6)}|${clip}|${inp.gagActive ? 1 : 0}`;
    if (key === this.lastCrtKey) return;
    this.lastCrtKey = key;

    const W = this.crtCanvas.width;
    const H = this.crtCanvas.height;
    ctx.clearRect(0, 0, W, H);

    if (this.rig.hasProceduralPhosphorCrt) {
      // Ozzi's iconic emerald CRT oscilloscope screen + glowing pill eyes + purple polarizer specs + live CHIMERA waveform
      const cx = W * 0.5;
      const cy = H * 0.5;
      const rScreen = W * 0.48;
      const blink = clamp01(naturalBlinkAmountAt(qTime, inp.singing));
      const isProbeArc = clip === "probe-arc";
      const isSpecsGag = inp.gagActive && !isProbeArc;
      const happyEyes = clip === "clap" || clip === "cheer" || clip === "jump" || clip === "bow";

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rScreen, 0, Math.PI * 2);
      ctx.clip();

      // 1. Rich radial emerald CRT phosphor glass backing (eliminates hollow black void!)
      const bg = ctx.createRadialGradient(cx, cy - 10, 10, cx, cy, rScreen);
      bg.addColorStop(0, "#19633c");
      bg.addColorStop(0.62, "#0c3a21");
      bg.addColorStop(1, "#04160c");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // 2. Crisp phosphor graticule grid lines
      ctx.strokeStyle = "rgba(92, 247, 178, 0.22)";
      ctx.lineWidth = 1.5;
      const step = 28;
      for (let x = cx % step; x < W; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = cy % step; y < H; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // 3. Round brass-rimmed purple polarizer glasses (nudge/tilt interactively on `Adjust Specs`)
      const lensOffsetY = isSpecsGag ? -7 : 0;
      const specsTilt = isSpecsGag ? -0.11 : 0;
      ctx.save();
      ctx.translate(cx, cy - 22 + lensOffsetY);
      ctx.rotate(specsTilt);
      for (const lx of [-37, 37]) {
        const lg = ctx.createRadialGradient(lx - 8, -8, 4, lx, 0, 34);
        lg.addColorStop(0, "rgba(154, 72, 240, 0.44)");
        lg.addColorStop(1, "rgba(86, 26, 152, 0.52)");
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(lx, 0, 32, 0, Math.PI * 2);
        ctx.fill();

        // Specular sheen arc on top-left of purple polarizer glass
        ctx.strokeStyle = "rgba(232, 200, 255, 0.35)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(lx, 0, 24, Math.PI * 1.15, Math.PI * 1.55);
        ctx.stroke();

        // Burnished brass rim
        ctx.strokeStyle = "#d1a85e";
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.arc(lx, 0, 32, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Brass nose bridge
      ctx.strokeStyle = "#d1a85e";
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(0, 3, 7, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.restore();

      // 4. Vivid glowing mint-green CRT pill eyes shining crisply through the purple polarizer lenses
      ctx.strokeStyle = "#a4ffdc";
      ctx.fillStyle = "#9effd8";
      ctx.shadowColor = isSpecsGag ? "#74ffe4" : "#2ef2a4";
      ctx.shadowBlur = isSpecsGag ? 20 : 14;
      ctx.lineWidth = 5.5;
      for (const ex of [cx - 37, cx + 37]) {
        const ey = cy - 22;
        if (happyEyes && (!inp.singing || open <= 0.04)) {
          ctx.beginPath();
          ctx.arc(ex, ey + 5, 13, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        } else if (blink > 0.55) {
          ctx.beginPath();
          ctx.roundRect(ex - 13, ey - 2.5, 26, 5, 2.5);
          ctx.fill();
        } else {
          const eh = Math.max(6, 30 * (1 - blink * 0.85));
          ctx.beginPath();
          ctx.roundRect(ex - 9.5, ey - eh * 0.5, 19, eh, 9.5);
          ctx.fill();
        }
      }

      // 5. Glowing emerald oscilloscope waveform mouth (tapered zig-zag at rest -> dynamic CHIMERA wave when singing!)
      const mouthY = cy + 44;
      const amp = isProbeArc ? 26 + 12 * Math.abs(Math.sin(qTime * 11)) : inp.singing ? 9 + open * 30 : 5.5;
      const freq = isProbeArc ? 20 : inp.singing ? 12 + width * 6 - round * 3 : 12.5;
      const phaseScroll = inp.singing || isProbeArc ? qTime * 9.5 : 0;
      ctx.strokeStyle = "#96ffd4";
      ctx.shadowColor = "#24f0a0";
      ctx.shadowBlur = 14;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      const x0 = cx - 74;
      const spanW = 148;
      for (let dx = 0; dx <= spanW; dx += 3) {
        const u = dx / spanW;
        const env = Math.sin(u * Math.PI);
        const harm = isProbeArc ? Math.sin(u * freq * 1.9 + phaseScroll * 1.6) * 0.35 : 0;
        const y = mouthY + env * amp * (Math.sin(u * freq + phaseScroll) + harm);
        if (dx === 0) ctx.moveTo(x0 + dx, y);
        else ctx.lineTo(x0 + dx, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    } else if (this.rig.crtFace) {
      const cf = this.rig.crtFace;
      const sx = W / Math.max(1, cf.screenSize[0]);
      const sy = H / Math.max(1, cf.screenSize[1]);
      const blink = clamp01(naturalBlinkAmountAt(qTime, inp.singing));
      const happyEyes = clip === "clap" || clip === "bow" || clip === "jump";

      const drawEye = (ox: number, oy: number, size: number) => {
        const ex = W * 0.5 + ox * sx;
        const ey = H * 0.5 + oy * sy;
        const ew = Math.max(18, size * sx * 0.72);
        const eh = Math.max(4, size * sy * 0.72 * (1 - blink * 0.85));
        ctx.strokeStyle = "#62ff9b";
        ctx.fillStyle = "#48f288";
        ctx.shadowColor = "#25e090";
        ctx.shadowBlur = 14;
        ctx.lineWidth = 5;
        if (happyEyes && (!inp.singing || open <= 0.04)) {
          ctx.beginPath();
          ctx.arc(ex, ey + eh * 0.25, ew * 0.42, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        } else if (blink > 0.55) {
          ctx.fillRect(ex - ew * 0.5, ey - 3, ew, 6);
        } else {
          ctx.strokeRect(ex - ew * 0.5, ey - eh * 0.5, ew, eh);
          ctx.globalAlpha = 0.26;
          ctx.fillRect(ex - ew * 0.5, ey - eh * 0.5, ew, eh);
          ctx.globalAlpha = 1;
        }
      };

      drawEye(cf.leftEye[0], cf.leftEye[1], cf.leftEye[2]);
      drawEye(cf.rightEye[0], cf.rightEye[1], cf.rightEye[2]);

      // CHIMERA-driven amber CRT phosphor mouth
      const mx = W * 0.5 + cf.mouth[0] * sx;
      const my = H * 0.5 + cf.mouth[1] * sy;
      ctx.fillStyle = "#ffc864";
      ctx.strokeStyle = "#ffc864";
      ctx.shadowColor = "#ff9d2e";
      ctx.shadowBlur = 14;
      ctx.lineWidth = 5;
      if (!inp.singing || open <= 0.04) {
        if (happyEyes) {
          ctx.beginPath();
          ctx.arc(mx, my - 6, 26, 0.15 * Math.PI, 0.85 * Math.PI);
          ctx.stroke();
        } else {
          ctx.fillRect(mx - 28, my - 4, 56, 8);
        }
      } else if (round >= 0.5) {
        const rx = 14 + (1 - round * 0.35) * 10;
        const ry = 10 + open * 18;
        ctx.beginPath();
        ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const mw = Math.round(32 + width * 30 + open * 14);
        const mh = Math.round(8 + open * 28);
        ctx.beginPath();
        ctx.roundRect(mx - mw * 0.5, my - mh * 0.5, mw, mh, 6);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    this.crtTex.needsUpdate = true;
  }

  private updateTallyOverlays(inp: PerformerUpdateInput, baseOrder: number): void {
    const clip = (inp.actionClip ?? "").toLowerCase();
    const isTickerCue = clip === "ticker-cue" || clip === "gasp" || inp.gagActive;

    if (this.tallyDomeGlowMesh && this.tallyDomeGlowMat) {
      this.tallyDomeGlowMesh.renderOrder = baseOrder + 24;
      const pulse = isTickerCue
        ? 1.16 + 0.2 * Math.sin(inp.timeSec * 16)
        : inp.singing || clip === "sing"
          ? 0.96 + 0.24 * clamp01(inp.level)
          : 0.88;
      this.tallyDomeGlowMesh.scale.set(220 * pulse, 220 * pulse, 1);
      this.tallyDomeGlowMat.opacity = clamp01(
        isTickerCue ? 1.0 : inp.singing || clip === "sing" ? 0.76 + 0.24 * clamp01(inp.level) : 0.74,
      );
    }

    if (!this.tallyMouthCanvas || !this.tallyMouthTex || !this.tallyMouthMesh) return;
    this.tallyMouthMesh.renderOrder = baseOrder + 16;

    const qTime = quantizeTwosSec(inp.timeSec);
    const previewSing = clip === "sing" && !inp.singing ? 0.36 + 0.32 * Math.abs(Math.sin(qTime * 9)) : 0;
    const rawOpen = inp.artic ? clamp01(inp.artic.open) : inp.mouthOpen ? 0.56 : 0;
    const open = Math.max(previewSing, rawOpen);
    const round = inp.artic ? clamp01(inp.artic.round) : 0;
    const width = inp.artic ? clamp01(inp.artic.lipWidth) : 0.5;
    const isSingMouth = (inp.singing || clip === "sing") && (open > 0.03 || inp.mouthOpen || previewSing > 0);
    const isHappySmile = !isSingMouth && (clip === "clap" || clip === "cheer" || clip === "laugh");

    if (!isSingMouth && !isTickerCue && !isHappySmile) {
      this.tallyMouthMesh.visible = false;
      return;
    }
    this.tallyMouthMesh.visible = true;

    const key = `${Math.round(qTime * 12)}|${isSingMouth ? 1 : 0}|${Math.round(open * 12)}|${Math.round(round * 6)}|${Math.round(width * 6)}|${isTickerCue ? 1 : 0}|${isHappySmile ? 1 : 0}`;
    if (key === this.lastTallyMouthKey) return;
    this.lastTallyMouthKey = key;

    const ctx = this.tallyMouthCanvas.getContext("2d");
    if (!ctx) return;
    const W = this.tallyMouthCanvas.width;
    const H = this.tallyMouthCanvas.height;
    ctx.clearRect(0, 0, W, H);

    const cx = W * 0.5;
    const cy = H * 0.5 + (isSingMouth ? open * 4 : 0);

    if (isSingMouth) {
      const rx = clamp01((24 + width * 22 - round * 12 + open * 8) / 56) * 52;
      const ry = Math.max(10, Math.min(38, 10 + open * 25 + round * 5));

      // Recessed gunmetal + brass-cream hinged mechanical speaker bezel
      ctx.fillStyle = "#16110d";
      ctx.strokeStyle = "#dfd0aa";
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 4, ry + 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner glowing broadcast VU resonator inside dark beak cavity
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(8, rx), Math.max(6, ry), 0, 0, Math.PI * 2);
      ctx.clip();

      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, Math.max(rx, ry));
      glow.addColorStop(0, "#fff0ba");
      glow.addColorStop(0.42, "#ffa838");
      glow.addColorStop(0.85, "#b8441c");
      glow.addColorStop(1, "#2a120a");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

      // Crisp horizontal speaker reed/grille bars flexing with vowel openness
      ctx.strokeStyle = "rgba(255, 245, 205, 0.88)";
      ctx.lineWidth = 3;
      const bars = open > 0.45 ? 3 : 2;
      for (let b = 0; b < bars; b++) {
        const yOff = (b - (bars - 1) * 0.5) * (ry * 0.62);
        const halfSpan = Math.max(10, rx * (1 - 0.18 * Math.abs(b - (bars - 1) * 0.5)));
        ctx.beginPath();
        ctx.moveTo(cx - halfSpan, cy + yOff);
        ctx.lineTo(cx + halfSpan, cy + yOff);
        ctx.stroke();
      }
      ctx.restore();
    } else if (isTickerCue) {
      // Surprised 'O' cue aperture rimmed in warm brass-amber
      ctx.fillStyle = "#17110d";
      ctx.strokeStyle = "#f2c66d";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 22, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = "#ff7c3a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 13, 16, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (isHappySmile) {
      // Happy upward broadcast speaker grin during Clap / Cheer / Laugh
      ctx.fillStyle = "#17110d";
      ctx.strokeStyle = "#dfd0aa";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 1, 36, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 5.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy - 9, 25, 0.14 * Math.PI, 0.86 * Math.PI);
      ctx.stroke();
    }

    this.tallyMouthTex.needsUpdate = true;
  }

  private updateLatchLed(inp: PerformerUpdateInput, pose: EvaluatedMultiplanePose, baseOrder: number): void {
    if (!this.latchLedGroup || !this.latchLedGlowMesh || !this.latchLedGlowMat) return;
    const pSpeak = pose.byId.get(4);
    const pListen = pose.byId.get(5);
    const pRest = pose.byId.get(3);
    const activePose = pSpeak?.visible ? pSpeak : pListen?.visible ? pListen : pRest;
    if (!activePose) {
      this.latchLedGlowMesh.visible = false;
      return;
    }

    this.latchLedGroup.position.set(activePose.localX, activePose.localY, 0);
    this.latchLedGroup.scale.set(activePose.scaleX, activePose.scaleY, 1);
    this.latchLedGroup.rotation.set(0, 0, activePose.rotZ);

    const clip = (inp.actionClip ?? "").toLowerCase();
    const isListening = Boolean(pListen?.visible) || clip === "listening" || clip === "listen";
    const isHotMic =
      inp.singing ||
      clip === "sing" ||
      clip === "clap" ||
      clip === "cheer" ||
      clip === "jump" ||
      inp.gagActive;

    if (!isHotMic && !isListening) {
      this.latchLedGlowMesh.visible = false;
      return;
    }

    if (pSpeak?.visible) {
      this.latchLedGlowMesh.position.set(339.0, 175.7, 9.5);
    } else if (pListen?.visible) {
      this.latchLedGlowMesh.position.set(336.5, 224.2, 9.5);
    } else {
      this.latchLedGlowMesh.position.set(338.9, 212.2, 9.5);
    }

    this.latchLedGlowMesh.visible = true;
    this.latchLedGlowMesh.renderOrder = baseOrder + 20;
    if (isListening && !inp.singing && clip !== "clap") {
      const pulse = 0.5 + 0.5 * Math.sin(inp.timeSec * 8.5);
      this.latchLedGlowMat.color.set("#4af59b");
      this.latchLedGlowMat.opacity = clamp01(0.54 + 0.34 * pulse);
      const sz = 112 + 24 * pulse;
      this.latchLedGlowMesh.scale.set(sz, sz, 1);
    } else {
      const levelBoost = inp.singing ? clamp01(inp.level) : 0.72;
      this.latchLedGlowMat.color.set(clip === "clap" ? "#ffd059" : "#ff9b36");
      this.latchLedGlowMat.opacity = clamp01(0.76 + 0.24 * levelBoost);
      const sz = 128 + 34 * levelBoost;
      this.latchLedGlowMesh.scale.set(sz, sz, 1);
    }
  }

  private updateFuzzOverlays(inp: PerformerUpdateInput, baseOrder: number): void {
    const clip = (inp.actionClip ?? "").toLowerCase();
    const isShred = clip === "shred" || clip === "overdrive" || clip === "overdrive-arc" || inp.gagActive;
    const isHappy = clip === "clap" || clip === "bow" || clip === "cheer" || clip === "jump" || clip === "laugh";
    const isSingMode = inp.singing || clip === "sing";

    if (this.fuzzTubeGlowMat && this.fuzzTubeGlowL && this.fuzzTubeGlowR) {
      const surge = isShred
        ? 1.48 + 0.18 * Math.abs(Math.sin(inp.timeSec * 20))
        : isSingMode || isHappy
          ? 1.12 + 0.28 * clamp01(inp.level || (clip === "sing" ? 0.65 : 0.45))
          : 0.96 + 0.04 * Math.sin(inp.timeSec * 3);
      this.fuzzTubeGlowL.scale.set(125 * surge, 138 * surge, 1);
      this.fuzzTubeGlowR.scale.set(102 * surge, 114 * surge, 1);
      this.fuzzTubeGlowL.renderOrder = baseOrder + 16;
      this.fuzzTubeGlowR.renderOrder = baseOrder + 16;
      this.fuzzTubeGlowMat.color.set(isShred ? "#ffb948" : "#ff9b34");
      this.fuzzTubeGlowMat.opacity = clamp01(
        isShred ? 0.92 : isSingMode || isHappy ? 0.58 + 0.34 * clamp01(inp.level || 0.5) : 0.36,
      );
    }

    if (!this.fuzzFaceCanvas || !this.fuzzFaceTex || !this.fuzzFaceMesh) return;
    this.fuzzFaceMesh.renderOrder = baseOrder + 22;

    if (!isSingMode && !isShred && !isHappy) {
      // Idle cleanly keeps canonical glowing green `"PLAY"` display from `head_chassis_play.webp`
      this.fuzzFaceMesh.visible = false;
      return;
    }
    this.fuzzFaceMesh.visible = true;

    const qTime = quantizeTwosSec(inp.timeSec);
    const previewOpen = clip === "sing" && !inp.singing ? 0.38 + 0.32 * Math.abs(Math.sin(qTime * 10)) : 0;
    const rawOpen = inp.artic ? clamp01(inp.artic.open) : inp.mouthOpen ? 0.58 : 0;
    const open = Math.max(previewOpen, rawOpen);
    const round = inp.artic ? clamp01(inp.artic.round) : 0;
    const width = inp.artic ? clamp01(inp.artic.lipWidth) : 0.55;
    const blink = clamp01(naturalBlinkAmountAt(qTime, inp.singing));

    const key = `${Math.round(qTime * 12)}|${isSingMode ? 1 : 0}|${isShred ? 1 : 0}|${isHappy ? 1 : 0}|${Math.round(open * 12)}|${Math.round(round * 6)}|${Math.round(width * 6)}|${Math.round(blink * 6)}`;
    if (key === this.lastFuzzFaceKey) return;
    this.lastFuzzFaceKey = key;

    const ctx = this.fuzzFaceCanvas.getContext("2d");
    if (!ctx) return;
    const W = this.fuzzFaceCanvas.width;
    const H = this.fuzzFaceCanvas.height;
    ctx.clearRect(0, 0, W, H);

    // Opaque deep OLED phosphor backing so static `"PLAY"`/`"NO_NET"` text underneath never ghosts through
    ctx.fillStyle = "#060907";
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 10);
    ctx.fill();

    // Faint phosphor LED scanlines
    ctx.fillStyle = "rgba(80, 255, 130, 0.06)";
    for (let y = 8; y < H; y += 8) {
      ctx.fillRect(6, y, W - 12, 2);
    }

    const eyeColor = isShred ? "#ffb23f" : "#6aff8e";
    const eyeGlow = isShred ? "#ff7c1a" : "#32e868";
    ctx.strokeStyle = eyeColor;
    ctx.fillStyle = eyeColor;
    ctx.shadowColor = eyeGlow;
    ctx.shadowBlur = isShred ? 16 : 12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Left & Right pixel-LED eyes cleanly framing center rock EQ / vowel mouth
    const drawFuzzEye = (ex: number, isRight: boolean) => {
      const ey = 52;
      if (isShred) {
        // Fierce rock `> <` slanted LED shred eyes
        ctx.lineWidth = 6.5;
        ctx.beginPath();
        if (!isRight) {
          ctx.moveTo(ex - 16, ey - 14);
          ctx.lineTo(ex + 14, ey);
          ctx.lineTo(ex - 16, ey + 14);
        } else {
          ctx.moveTo(ex + 16, ey - 14);
          ctx.lineTo(ex - 14, ey);
          ctx.lineTo(ex + 16, ey + 14);
        }
        ctx.stroke();
      } else if (isHappy && (!isSingMode || open <= 0.04)) {
        // Joyful `^ ^` LED arcs during Clap / Bow / Cheer
        ctx.lineWidth = 6.5;
        ctx.beginPath();
        ctx.arc(ex, ey + 7, 17, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else if (blink > 0.55) {
        ctx.fillRect(ex - 16, ey - 3, 32, 6);
      } else {
        const eh = Math.max(8, Math.round(32 * (1 - blink * 0.85)));
        ctx.beginPath();
        ctx.roundRect(ex - 14, ey - eh * 0.5, 28, eh, 5);
        ctx.fill();
      }
    };
    drawFuzzEye(48, false);
    drawFuzzEye(W - 48, true);

    // Center CHIMERA vocal LED / Graphic EQ mouth (`x = 92..228`)
    const mx = W * 0.5;
    const my = H * 0.52;
    if (isShred) {
      // Roaring 7-band orange/amber/green distortion overdrive equalizer
      const bands = 7;
      const bw = 12;
      const gap = 5;
      const startX = mx - ((bands * bw + (bands - 1) * gap) * 0.5);
      for (let b = 0; b < bands; b++) {
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(qTime * 19 + b * 1.15));
        const bh = Math.round(24 + pulse * 54);
        const bx = startX + b * (bw + gap);
        ctx.fillStyle = b % 2 === 0 ? "#ffb840" : "#ff6b35";
        ctx.shadowColor = "#ff8224";
        ctx.beginPath();
        ctx.roundRect(bx, my - bh * 0.5, bw, bh, 3);
        ctx.fill();
      }
    } else if (isSingMode && open > 0.03) {
      if (round >= 0.5) {
        // Rounded 'O' LED phosphor vowel
        const rx = 18 + (1 - round * 0.35) * 14;
        const ry = 12 + open * 22;
        ctx.strokeStyle = "#8cff9e";
        ctx.shadowColor = "#42f575";
        ctx.lineWidth = 6.5;
        ctx.beginPath();
        ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Expressive multi-band LED singing mouth flexing cleanly with CHIMERA open + lipWidth
        const bands = 7;
        const spanW = 72 + width * 46;
        const gap = 4;
        const bw = (spanW - (bands - 1) * gap) / bands;
        const startX = mx - spanW * 0.5;
        for (let b = 0; b < bands; b++) {
          const arch = 1 - 0.38 * Math.abs(b - (bands - 1) * 0.5) / 3;
          const shimmer = 0.85 + 0.15 * Math.sin(qTime * 16 + b * 0.9);
          const bh = Math.max(10, Math.round((12 + open * 58) * arch * shimmer));
          const bx = startX + b * (bw + gap);
          ctx.fillStyle = bh > 46 ? "#ffd35c" : "#6aff8e";
          ctx.shadowColor = bh > 46 ? "#ffaa33" : "#2be866";
          ctx.beginPath();
          ctx.roundRect(bx, my - bh * 0.5, bw, bh, 3);
          ctx.fill();
        }
      }
    } else if (isHappy) {
      // Wide glowing rockstar smile arc
      ctx.strokeStyle = "#8cff9e";
      ctx.shadowColor = "#34e86a";
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(mx, my - 12, 34, 0.14 * Math.PI, 0.86 * Math.PI);
      ctx.stroke();
    } else {
      // Closed crisp LED lip line between vocal syllables while singing phase active
      ctx.fillStyle = "#6aff8e";
      ctx.fillRect(mx - 38, my - 3.5, 76, 7);
    }

    ctx.shadowBlur = 0;
    this.fuzzFaceTex.needsUpdate = true;
  }

  private updateHertzScreen(inp: PerformerUpdateInput, pose: EvaluatedMultiplanePose, baseOrder: number): void {
    if (!this.hertzScreenCanvas || !this.hertzScreenTex || !this.hertzScreenMesh) return;
    this.hertzScreenMesh.renderOrder = baseOrder + 19;
    const osdVisible = Boolean(pose.byId.get(525)?.visible);
    this.hertzScreenMesh.visible = osdVisible;
    if (!osdVisible) return;

    const qTime = quantizeTwosSec(inp.timeSec);
    const clip = (inp.actionClip ?? "").toLowerCase();
    const isSingMode = inp.singing || clip === "sing";
    const isHappy = clip === "clap" || clip === "bow" || clip === "jump" || clip === "cheer";
    const previewOpen = clip === "sing" && !inp.singing ? 0.36 + 0.3 * Math.abs(Math.sin(qTime * 9)) : 0;
    const rawOpen = inp.artic ? clamp01(inp.artic.open) : inp.mouthOpen ? 0.56 : 0;
    const open = Math.max(previewOpen, rawOpen);
    const round = inp.artic ? clamp01(inp.artic.round) : 0;
    const width = inp.artic ? clamp01(inp.artic.lipWidth) : 0.55;
    const blink = clamp01(naturalBlinkAmountAt(qTime, inp.singing));

    const key = `${Math.round(qTime * 12)}|${isSingMode ? 1 : 0}|${isHappy ? 1 : 0}|${Math.round(open * 12)}|${Math.round(round * 6)}|${Math.round(width * 6)}|${Math.round(blink * 6)}`;
    if (key === this.lastHertzScreenKey) return;
    this.lastHertzScreenKey = key;

    const ctx = this.hertzScreenCanvas.getContext("2d");
    if (!ctx) return;
    const W = this.hertzScreenCanvas.width;
    const H = this.hertzScreenCanvas.height;
    ctx.clearRect(0, 0, W, H);

    // 1. Opaque deep CRT glass backing with raster scanlines (`CH 04` / `VIDEO 1` replaces static baked OSD eyes)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, 22);
    ctx.clip();

    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 16, W * 0.5, H * 0.5, W * 0.62);
    bg.addColorStop(0, "#152324");
    bg.addColorStop(0.65, "#091112");
    bg.addColorStop(1, "#030607");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(108, 255, 226, 0.05)";
    for (let y = 4; y < H; y += 5) {
      ctx.fillRect(0, y, W, 2);
    }

    // Subtle upper cathode-ray glass reflection arc
    ctx.fillStyle = "rgba(210, 245, 245, 0.06)";
    ctx.beginPath();
    ctx.ellipse(W * 0.36, 18, 92, 22, -0.06, 0, Math.PI * 2);
    ctx.fill();

    // 2. Crisp OSD HUD (`CH 04` top-left mint-cyan, `VIDEO 1` top-right warm amber, matching `bible-hero.webp`)
    ctx.font = "bold 20px ui-monospace, 'Courier New', monospace";
    ctx.textBaseline = "top";
    ctx.shadowBlur = 10;

    ctx.textAlign = "left";
    ctx.fillStyle = "#5cffc4";
    ctx.shadowColor = "#24e89c";
    ctx.fillText("CH 04", 22, 18);

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffb842";
    ctx.shadowColor = "#f08a18";
    ctx.fillText("VIDEO 1", W - 22, 18);

    // 3. Warm amber pixel brows + glowing mint-cyan CRT eyes
    const browLift = isHappy || (isSingMode && open > 0.35) ? -6 : 0;
    const eyeXs = [98, W - 98];
    const ey = 118;

    for (const ex of eyeXs) {
      // Warm amber curved pixel brow
      ctx.fillStyle = "#ffb43e";
      ctx.shadowColor = "#ff8c1a";
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.roundRect(ex - 20, 66 + browLift, 40, 8, 4);
      ctx.fill();

      // Mint-cyan CRT eye
      ctx.strokeStyle = "#69fff0";
      ctx.fillStyle = "#69fff0";
      ctx.shadowColor = "#2be6d4";
      ctx.shadowBlur = 16;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (isHappy && (!isSingMode || open <= 0.04)) {
        // Joyful pixel-styled `^ ^` arches (`part_screen_osd.webp`)
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(ex - 22, ey + 12);
        ctx.lineTo(ex, ey - 14);
        ctx.lineTo(ex + 22, ey + 12);
        ctx.stroke();
      } else if (blink > 0.55) {
        ctx.beginPath();
        ctx.roundRect(ex - 22, ey - 4, 44, 8, 4);
        ctx.fill();
      } else {
        const eh = Math.max(10, Math.round(62 * (1 - blink * 0.85)));
        const ew = 42;
        ctx.beginPath();
        ctx.roundRect(ex - ew * 0.5, ey - eh * 0.5, ew, eh, 16);
        ctx.fill();

        // Dark CRT pupil cutout + bright glint pixel matching Canon v2 `bible-hero.webp`
        if (eh > 26) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#102828";
          ctx.beginPath();
          ctx.roundRect(ex - 6, ey - eh * 0.19, 12, eh * 0.38, 4);
          ctx.fill();

          ctx.fillStyle = "#e6ffff";
          ctx.fillRect(ex - 13, ey - eh * 0.3, 8, 8);
        }
      }
    }

    // 4. Warm amber pixel smile / CHIMERA live singing viseme mouth
    const mx = W * 0.5;
    const my = 204;
    ctx.strokeStyle = "#ffc046";
    ctx.fillStyle = "#ffc046";
    ctx.shadowColor = "#ff8c18";
    ctx.shadowBlur = 14;
    ctx.lineCap = "round";

    if (isSingMode && open > 0.04) {
      if (round >= 0.5) {
        const rx = 18 + (1 - round * 0.32) * 10;
        const ry = 12 + open * 18;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const mw = Math.round(46 + width * 42 + open * 14);
        const mh = Math.round(14 + open * 36);
        ctx.beginPath();
        ctx.roundRect(mx - mw * 0.5, my - mh * 0.5, mw, mh, 10);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = "#481c06";
        ctx.beginPath();
        ctx.roundRect(mx - mw * 0.5 + 6, my - mh * 0.5 + 6, Math.max(8, mw - 12), Math.max(4, mh - 12), 6);
        ctx.fill();
      }
    } else {
      // Crisp stepped warm-amber CRT pixel smile (`bible-hero.webp`)
      const smileSpan = isHappy ? 42 : 34;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(mx, my - 16, smileSpan, 0.16 * Math.PI, 0.84 * Math.PI);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.restore();
    this.hertzScreenTex.needsUpdate = true;
  }

  private recomputeRestOpaqueMinY(): void {
    let readyCount = 0;
    for (const entry of this.nodeVisuals.values()) {
      if (getReadyImageDimensions(entry.mat?.map?.image)) {
        readyCount++;
      }
    }
    if (readyCount === this.measuredReadyCount) return;
    this.measuredReadyCount = readyCount;

    let minOpaqueY = Infinity;
    for (const n of this.rig.nodes) {
      if (n.sourceType !== "Footage" || !n.publicSrc || n.width <= 0 || n.height <= 0) continue;
      const np = this.restPose.byId.get(n.id);
      if (!np || !np.visible) continue;
      const entry = this.nodeVisuals.get(n.id);
      const tex = entry?.mat?.map ?? loadStageTexture(n.publicSrc) ?? null;
      const bounds = getTextureOpaqueBounds(tex) ?? { minXNorm: 0, maxXNorm: 1, topNorm: 0, bottomNorm: 1 };
      const ancX = n.anchor[0] ?? 0;
      const ancY = n.anchor[1] ?? 0;
      const left = -ancX + bounds.minXNorm * n.width;
      const right = -ancX + bounds.maxXNorm * n.width;
      const top = ancY - bounds.topNorm * n.height;
      const bottom = ancY - bounds.bottomNorm * n.height;
      const m = np.worldMat;
      for (const [lx, ly] of [
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
      ]) {
        const wy = m.b * lx + m.d * ly + m.ty;
        if (wy < minOpaqueY) minOpaqueY = wy;
      }
    }
    if (Number.isFinite(minOpaqueY)) {
      this.restOpaqueMinY = minOpaqueY;
    }
  }

  update(inp: PerformerUpdateInput): void {
    const playingInstrument = !inp.singing && inp.performing && inp.level > 0.05;
    const pose = evaluateMultiplanePose(this.rig, {
      beat: inp.beat,
      timeSec: inp.timeSec,
      singing: inp.singing,
      playingInstrument,
      level: inp.level,
      mouthOpen: inp.mouthOpen,
      gagActive: inp.gagActive,
      phaseIndex: inp.phaseIndex,
      still: false,
      actionClip: inp.actionClip,
      actionElapsedSec: inp.actionElapsedSec,
    });

    const baseOrder = zRenderOrder(inp.z);

    for (const entry of this.nodeVisuals.values()) {
      const np = pose.byId.get(entry.spec.id);
      if (!np) continue;
      entry.group.position.set(np.localX, np.localY, 0);
      entry.group.scale.set(np.scaleX, np.scaleY, 1);
      entry.group.rotation.set(0, 0, np.rotZ);
      entry.group.visible = np.visible;

      if (entry.mat && entry.spec.publicSrc) {
        const tex = loadStageTexture(entry.spec.publicSrc);
        if (tex && entry.mat.map !== tex) {
          entry.mat.map = tex;
          entry.mat.needsUpdate = true;
          if (entry.depthMat) {
            entry.depthMat.map = tex;
            entry.depthMat.needsUpdate = true;
          }
        }
      }
      if (entry.mesh) {
        entry.mesh.renderOrder = baseOrder + Math.round(entry.spec.zPx * 0.5);
      }
      if (entry.spec.hoseDeform) {
        this.updateHose(entry, entry.spec.hoseDeform, np.hoseBendPx);
      }
    }
    this.recomputeRestOpaqueMinY();

    if (this.crtScreenMesh) {
      // Ozzi's CRT glass renders cleanly between rear cord bangs (+7) and front steel bezel (+12)
      this.crtScreenMesh.renderOrder = baseOrder + (this.rig.hasProceduralPhosphorCrt ? 10 : 40);
    }

    this.updateCrtCanvas(inp);
    this.updateTallyOverlays(inp, baseOrder);
    this.updateLatchLed(inp, pose, baseOrder);
    this.updateFuzzOverlays(inp, baseOrder);
    this.updateHertzScreen(inp, pose, baseOrder);

    const baseFloorY = inp.floorY ?? 0;
    const rigScale = inp.worldHeight / this.effectiveRigHeightPx;
    const hopY = Math.max(0, inp.y - baseFloorY) + (pose.rootHopPx ?? 0) * rigScale;
    const approxW = clamp(this.effectiveRigWidthPx * rigScale, 0.72, 2.05);
    this.group.position.set(inp.x, baseFloorY, inp.z);
    this.shadowMesh.renderOrder = baseOrder - 45;
    const shadowScale = clamp(1 - hopY * 0.28, 0.72, 1);
    this.shadowMesh.scale.set(approxW * 0.88 * shadowScale, approxW * 0.52 * shadowScale, 1);
    this.shadowMat.opacity = clamp(0.72 * (1 - hopY * 0.38), 0.14, 0.72);
    this.glowMesh.renderOrder = baseOrder - 42;
    this.glowMesh.visible = inp.level > 0.08;
    this.glowMesh.scale.set(approxW * 0.92, approxW * 0.54, 1);
    this.glowMat.color.set(inp.accentColor);
    this.glowMat.opacity = clamp(inp.level * 0.42, 0, 0.42);

    this.rigRoot.position.set(0, hopY - this.restOpaqueMinY * rigScale * inp.stretchY, 0);
    this.rigRoot.scale.set(
      rigScale * (inp.facing < 0 ? -1 : 1) * inp.squashX,
      rigScale * inp.stretchY,
      rigScale,
    );
    this.rigRoot.rotation.set(0, inp.rotY, inp.leanRad);
    const restingHopY = Math.max(0, inp.y - baseFloorY);
    this.headAnchorPos.set(inp.x, baseFloorY + restingHopY + inp.worldHeight * 0.96, inp.z);
  }

  getHeadWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.headAnchorPos);
  }

  dispose(): void {
    for (const e of this.nodeVisuals.values()) {
      e.mat?.dispose();
      e.depthMat?.dispose();
      e.hoseGeo?.dispose();
    }
    this.crtTex?.dispose();
    this.crtMat?.dispose();
    this.tallyDomeGlowMat?.map?.dispose();
    this.tallyDomeGlowMat?.dispose();
    this.tallyMouthTex?.dispose();
    this.tallyMouthMat?.dispose();
    this.latchLedGlowMat?.map?.dispose();
    this.latchLedGlowMat?.dispose();
    this.fuzzTubeGlowMat?.map?.dispose();
    this.fuzzTubeGlowMat?.dispose();
    this.fuzzFaceTex?.dispose();
    this.fuzzFaceMat?.dispose();
    this.hertzScreenTex?.dispose();
    this.hertzScreenMat?.dispose();
    this.shadowMat.dispose();
    this.glowMat.dispose();
  }
}

// Per-frame chin grille anchor across LeadSinger's 48f swaying `sing.webp` performance
const LEADSINGER_SING_MOUTH_PIVOTS: readonly (readonly [number, number])[] = [
  [0.501, 0.28], [0.504, 0.283], [0.512, 0.285], [0.479, 0.286], [0.466, 0.277], [0.435, 0.285], [0.418, 0.291], [0.405, 0.296],
  [0.404, 0.288], [0.404, 0.292], [0.416, 0.291], [0.408, 0.297], [0.408, 0.29], [0.407, 0.293], [0.424, 0.29], [0.45, 0.288],
  [0.455, 0.288], [0.495, 0.272], [0.51, 0.281], [0.514, 0.278], [0.535, 0.286], [0.554, 0.287], [0.554, 0.288], [0.562, 0.292],
  [0.552, 0.286], [0.535, 0.283], [0.497, 0.282], [0.475, 0.283], [0.459, 0.281], [0.451, 0.284], [0.478, 0.284], [0.488, 0.284],
  [0.484, 0.284], [0.507, 0.281], [0.487, 0.278], [0.484, 0.275], [0.491, 0.273], [0.496, 0.268], [0.485, 0.272], [0.491, 0.274],
  [0.509, 0.279], [0.495, 0.274], [0.498, 0.275], [0.493, 0.274], [0.497, 0.27], [0.494, 0.278], [0.503, 0.283], [0.495, 0.272],
];

// ═══════════════════════════════════════════════════════════════════════════
// TIER 3: WORLD-LIT 2.5D DEPTH STAGE CUTOUT (`createStagePuppetMaterial` + AniCraft)
// ═══════════════════════════════════════════════════════════════════════════
class AtlasPerformer3D {
  readonly group = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly shadowMesh: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly planeMesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly depthMat: THREE.ShaderMaterial;
  private readonly mouthPatchMesh: THREE.Mesh;
  private readonly mouthPatchMat: THREE.MeshBasicMaterial;
  private readonly faceMesh: THREE.Mesh;
  private readonly faceMat: THREE.ShaderMaterial;
  private gestureWeight = 0;
  private lastAtlasTimeSec = -1;
  private readonly headAnchorPos = new THREE.Vector3();

  constructor(worldId: StageWorldId) {
    const world = resolveStageWorld(worldId);
    const contactShadow = createContactShadowMesh(0.76);
    this.shadowMesh = contactShadow.mesh;
    this.shadowMat = contactShadow.mat;
    this.group.add(this.shadowMesh);

    this.mat = createStagePuppetMaterial({
      map: null,
      uvRect: [0, 0, 1, 1],
      lighting: world.lighting,
      lightingEnabled: true,
      tungstenWarmth: 1,
      rimIntensity: 0.85,
      crtEyeGlow: 0.9,
      voiceEnergy: 0,
      spotBias: 0,
      hasCrtEyes: false,
    });
    this.depthMat = createAtlasDepthMaterial();
    this.planeMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.mat);
    this.planeMesh.castShadow = true;
    this.planeMesh.customDepthMaterial = this.depthMat;
    this.bodyGroup.add(this.planeMesh);

    const patchTex = createSoftPlateAlphaTexture("circle");
    this.mouthPatchMat = new THREE.MeshBasicMaterial({
      color: "#e4bf84",
      alphaMap: patchTex,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mouthPatchMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.mouthPatchMat);
    this.mouthPatchMesh.visible = false;
    this.bodyGroup.add(this.mouthPatchMesh);

    this.faceMat = createAniCraftFaceMat(null);
    this.faceMesh = new THREE.Mesh(UNIT_PLANE_GEO, this.faceMat);
    this.faceMesh.visible = false;
    this.bodyGroup.add(this.faceMesh);

    this.group.add(this.bodyGroup);
  }

  /**
   * Disney 2.5D pose-to-pose kinematics (`clap`, `cheer`, `jump`, `bow`, `toaster-shrug`, `walk`,
   * `nod`, `tilt`, `laugh`, `gasp`, `sing`) pivoted around grounded feet at `y = 0`.
   */
  private evaluateAtlasPoseMotion(inp: PerformerUpdateInput): {
    hop: number;
    sx: number;
    sy: number;
    rotX: number;
    rotY: number;
    rotZ: number;
  } {
    const dt =
      this.lastAtlasTimeSec >= 0 && inp.timeSec >= this.lastAtlasTimeSec
        ? clamp(inp.timeSec - this.lastAtlasTimeSec, 0, 0.05)
        : 0.016;
    this.lastAtlasTimeSec = inp.timeSec;

    const clip = (inp.actionClip ?? "").trim().toLowerCase();
    const isGestureClip =
      clip === "clap" ||
      clip === "cheer" ||
      clip === "jump" ||
      clip === "bow" ||
      clip === "shrug" ||
      clip === "toaster-shrug" ||
      clip === "walk" ||
      clip === "walk-left" ||
      clip === "walk-right" ||
      clip === "step" ||
      clip === "nod" ||
      clip === "double nod" ||
      clip === "tilt" ||
      clip === "laugh" ||
      clip === "gasp" ||
      clip === "drawer-lead";

    const targetW = isGestureClip ? 1 : 0;
    const rate = isGestureClip ? 28 : 10;
    this.gestureWeight += (targetW - this.gestureWeight) * (1 - Math.exp(-dt * rate));
    if (isGestureClip && inp.actionElapsedSec !== undefined && inp.actionElapsedSec < 0.16) {
      this.gestureWeight = Math.max(this.gestureWeight, 0.52);
    }

    let hop = 0;
    let sx = 1;
    let sy = 1;
    let rotX = 0;
    let rotY = 0;
    let rotZ = 0;

    // 1. Live CHIMERA singing phrase projection & subtle breath when not blocked elsewhere
    if (inp.singing) {
      const e = clamp01(inp.level);
      const phrase = Math.sin(inp.beat * Math.PI + inp.phaseIndex * 0.7);
      sy += e * 0.036 + phrase * 0.012 * e;
      sx -= e * 0.018;
      rotX += e * 0.068;
      if (!inp.poseDrivenGroove) {
        rotZ += phrase * 0.03 * (0.4 + e * 0.6);
      }
    } else if (inp.performing && !inp.poseDrivenGroove && !isGestureClip) {
      const sway = Math.sin(inp.beat * Math.PI * 0.5 + inp.phaseIndex * 0.7);
      rotZ += sway * 0.02;
      sy += Math.sin(inp.timeSec * 2.1 + inp.phaseIndex) * 0.008;
    }

    // 2. Expressive Disney gesture / Bible clip phrasing
    if (this.gestureWeight > 0.004 && isGestureClip) {
      const el = inp.actionElapsedSec !== undefined ? Math.max(0, inp.actionElapsedSec) : inp.timeSec;
      let gHop = 0;
      let gSy = 1;
      let gSx = 1;
      let gRotX = 0;
      let gRotY = 0;
      let gRotZ = 0;

      if (clip === "clap") {
        // Snappy 2-beat double-bounce with chest-forward joy pop (works paused via actionElapsedSec or live via beat)
        const cycle = (inp.performing ? inp.beat * 1.15 : el * 1.95) + inp.phaseIndex * 0.25;
        const u = ((cycle % 1) + 1) % 1;
        const dip = u < 0.08 ? Math.sin((u / 0.08) * Math.PI) : 0;
        const hit = u >= 0.08 && u < 0.44 ? Math.sin(((u - 0.08) / 0.36) * Math.PI) : 0;
        const bounce = Math.abs(Math.sin(cycle * Math.PI));
        gHop = 0.16 * hit + 0.055 * bounce;
        gSy = 1 - 0.11 * dip + 0.13 * hit;
        gSx = 1 / Math.sqrt(gSy);
        gRotX = 0.18 * hit;
        gRotY = Math.cos(cycle * Math.PI) * 0.1;
        gRotZ = Math.sin(cycle * Math.PI) * 0.13;
      } else if (clip === "cheer") {
        const dur = 1.65;
        const u = clamp01(el / dur);
        if (u < 0.07) {
          const a = Math.sin((u / 0.07) * Math.PI);
          gSy = 1 - 0.13 * a;
          gSx = 1 + 0.11 * a;
          gRotX = 0.11 * a;
        } else if (u < 0.85) {
          const air = (u - 0.07) / 0.78;
          const arc = 4 * air * (1 - air);
          const doubleHop = Math.abs(Math.sin(air * Math.PI * 2));
          const lift = clamp01(0.58 * arc + 0.48 * doubleHop);
          gHop = 0.34 * lift;
          gSy = 1 + 0.15 * lift;
          gSx = 1 - 0.1 * lift;
          gRotX = -0.14 * lift;
          gRotY = Math.cos(air * Math.PI * 2) * 0.16;
          gRotZ = Math.sin(air * Math.PI * 3) * 0.16;
        } else {
          const land = Math.sin(((u - 0.85) / 0.15) * Math.PI);
          gSy = 1 - 0.11 * land;
          gSx = 1 + 0.09 * land;
        }
      } else if (clip === "jump") {
        const dur = 1.55;
        const u = clamp01(el / dur);
        if (u < 0.18) {
          const a = Math.sin((u / 0.18) * Math.PI);
          gSy = 1 - 0.14 * a;
          gSx = 1 + 0.12 * a;
        } else if (u < 0.76) {
          const air = (u - 0.18) / 0.58;
          const arc = 4 * air * (1 - air);
          gHop = 0.34 * arc;
          gSy = 1 + 0.12 * arc;
          gSx = 1 - 0.09 * arc;
          gRotX = -0.06 * arc;
        } else {
          const land = Math.sin(((u - 0.76) / 0.24) * Math.PI);
          gSy = 1 - 0.12 * land;
          gSx = 1 + 0.11 * land;
        }
      } else if (clip === "bow") {
        const dur = 2.5;
        const u = clamp01(el / dur);
        const hold =
          u < 0.22
            ? Math.sin((u / 0.22) * (Math.PI * 0.5))
            : u < 0.72
              ? 1
              : Math.cos(((u - 0.72) / 0.28) * (Math.PI * 0.5));
        const s = hold * hold * (3 - 2 * hold);
        gRotX = 0.34 * s;
        gSy = 1 - 0.075 * s;
        gSx = 1 + 0.055 * s;
      } else if (clip === "toaster-shrug" || clip === "shrug") {
        // Bold comedic shoulder-heave: quick micro-dip -> immediate wide chest/shoulder pop + head cant -> settle
        const dur = clip === "toaster-shrug" ? 2.6 : 1.65;
        const u = clamp01(el / dur);
        if (u < 0.05) {
          const a = Math.sin((u / 0.05) * Math.PI);
          gSy = 1 - 0.09 * a;
          gSx = 1 + 0.08 * a;
        } else if (u < 0.85) {
          const k = (u - 0.05) / 0.8;
          const env = Math.sin(Math.min(1, k * 2.2) * Math.PI * 0.5) * (k > 0.78 ? (1 - k) / 0.22 : 1);
          const doubleBeat = 0.76 + 0.24 * Math.abs(Math.sin(k * Math.PI * 2));
          const heave = clamp01(env * doubleBeat);
          gHop = 0.11 * heave;
          gSy = 1 + 0.12 * heave;
          gSx = 1 + 0.14 * heave;
          gRotZ = 0.21 * heave;
          gRotX = -0.15 * heave;
          gRotY = 0.24 * heave;
        } else {
          const set = Math.sin(((u - 0.85) / 0.15) * Math.PI);
          gSy = 1 - 0.1 * set;
          gSx = 1 + 0.09 * set;
        }
      } else if (clip === "walk" || clip === "walk-left" || clip === "walk-right" || clip === "step") {
        const stride = el * 7.8;
        gHop = Math.abs(Math.sin(stride)) * 0.065;
        gRotZ = Math.sin(stride) * 0.065;
        gRotX = 0.085;
        gSy = 1 + Math.sin(stride * 2) * 0.03;
        gSx = 1 / Math.sqrt(gSy);
      } else if (clip === "nod" || clip === "double nod") {
        const beats = clip === "double nod" ? 2 : 1;
        const u = clamp01(el / 1.4);
        const pulse = Math.max(0, Math.sin(u * Math.PI * beats * 2));
        gRotX = 0.18 * pulse;
        gSy = 1 - 0.04 * pulse;
      } else if (clip === "tilt") {
        const u = clamp01(el / 1.5);
        const env = Math.sin(u * Math.PI);
        gRotZ = 0.14 * env;
        gRotY = 0.16 * env;
        gSy = 1 + 0.02 * env;
      } else if (clip === "laugh") {
        const u = clamp01(el / 1.6);
        const env = Math.sin(u * Math.PI);
        const bounce = Math.abs(Math.sin(el * 13));
        gHop = 0.04 * bounce * env;
        gSy = 1 + 0.065 * bounce * env;
        gSx = 1 - 0.045 * bounce * env;
        gRotX = -0.07 * bounce * env;
      } else if (clip === "gasp") {
        const u = clamp01(el / 1.5);
        const pop = u < 0.24 ? Math.sin((u / 0.24) * (Math.PI * 0.5)) : Math.pow(Math.max(0, 1 - (u - 0.24) / 0.76), 1.6);
        gHop = 0.07 * pop;
        gSy = 1 + 0.105 * pop;
        gSx = 1 - 0.07 * pop;
        gRotX = -0.14 * pop;
      } else if (clip === "drawer-lead") {
        // Tracker Canon v2 VHS cassette-tray pop: spring anticipation dip -> upbeat chest lift during drawer release
        const u = clamp01(el / 2.0);
        const pop = u < 0.14 ? Math.sin((u / 0.14) * (Math.PI * 0.5)) : u < 0.78 ? 1 : Math.cos(((u - 0.78) / 0.22) * (Math.PI * 0.5));
        gHop = 0.075 * pop;
        gSy = 1 + 0.055 * pop;
        gSx = 1 - 0.03 * pop;
      }

      const w = this.gestureWeight;
      hop += gHop * w;
      sx *= 1 + (gSx - 1) * w;
      sy *= 1 + (gSy - 1) * w;
      rotX += gRotX * w;
      rotY += gRotY * w;
      rotZ += gRotZ * w;
    }

    return { hop, sx, sy, rotX, rotY, rotZ };
  }

  update(inp: PerformerUpdateInput): void {
    const primaryTex = loadStageTexture(inp.cel.atlasUrl) ?? null;
    const idleClip = inp.manifest?.clips?.idle;
    const idleFallbackTex =
      !primaryTex && idleClip?.url && idleClip.url !== inp.cel.atlasUrl
        ? (loadStageTexture(idleClip.url) ?? null)
        : null;
    const portraitFallbackTex =
      !primaryTex && !idleFallbackTex && inp.manifest?.portraitUrl
        ? (loadStageTexture(inp.manifest.portraitUrl) ?? null)
        : null;
    const tex = primaryTex ?? idleFallbackTex ?? portraitFallbackTex;
    this.planeMesh.visible = Boolean(tex);

    let cols = Math.max(1, inp.cel.cols);
    let rows = Math.max(1, inp.cel.rows);
    let rawFrame = inp.cel.frame;
    let effectiveAction = inp.cel.action;
    let effectiveAnchorY = inp.cel.anchorY ?? 0.98;

    if (!primaryTex && idleFallbackTex && idleClip) {
      cols = Math.max(1, idleClip.cols);
      rows = Math.max(1, idleClip.rows);
      const count = Math.max(1, idleClip.frameCount ?? idleClip.frames);
      rawFrame = (idleClip.startFrame ?? 0) + (count > 1 ? Math.floor(Math.max(0, inp.timeSec) * idleClip.fps) % count : 0);
      effectiveAction = "idle";
      effectiveAnchorY = idleClip.anchorY ?? effectiveAnchorY;
    } else if (!primaryTex && !idleFallbackTex && portraitFallbackTex) {
      cols = 1;
      rows = 1;
      rawFrame = 0;
      effectiveAction = "idle";
    }

    let idx = ((Math.floor(rawFrame) % (cols * rows)) + cols * rows) % (cols * rows);
    // Gruff's walk.webp holds 4 side-stride frames (0..3) on top row and 4 front-idle frames (4..7) on bottom row
    const isGruffSideWalk = inp.castId === "gruff" && effectiveAction === "walk";
    if (isGruffSideWalk) {
      idx = idx % 4;
    }
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const uvRect: readonly [number, number, number, number] = [
      col / cols,
      1 - (row + 1) / rows,
      1 / cols,
      1 / rows,
    ];

    const img = tex?.image as { width?: number; height?: number } | undefined;
    const aspect = img?.width && img?.height ? (img.width / cols) / Math.max(1, img.height / rows) : 0.85;
    const h = inp.worldHeight;
    const w = h * aspect;
    const measuredSolidBottom = tex ? getAtlasSolidBottomNorm(tex, cols, rows) : undefined;
    const anchorY = measuredSolidBottom ?? effectiveAnchorY;
    const centerY = (anchorY - 0.5) * h;

    const world = resolveStageWorld(inp.worldId);
    const isFolio = inp.castId === "folio";
    const isTracker = inp.castId === "tracker";
    syncStagePuppetMaterial(this.mat, {
      map: tex,
      uvRect,
      lighting: world.lighting,
      lightingEnabled: true,
      tungstenWarmth: 1,
      rimIntensity: 0.88,
      crtEyeGlow: 0.95,
      voiceEnergy: inp.level,
      spotBias: clamp(inp.x / 3, -1, 1),
      hasCrtEyes: isTracker,
      hasAmberCrt: isFolio,
    });
    this.depthMat.uniforms.uMap.value = tex;
    this.depthMat.uniforms.uHasMap.value = tex ? 1 : 0;
    (this.depthMat.uniforms.uUvRect.value as THREE.Vector4).set(uvRect[0], uvRect[1], uvRect[2], uvRect[3]);

    const motion = this.evaluateAtlasPoseMotion(inp);
    const order = zRenderOrder(inp.z);
    const baseFloorY = inp.floorY ?? 0;
    const hopY = Math.max(0, inp.y - baseFloorY) + motion.hop;
    this.shadowMesh.renderOrder = order - 15;
    const shadowR = clamp(w * 0.34 * (1 - hopY * 0.25), 0.26, 0.72);
    this.shadowMesh.scale.set(shadowR * 2.1, shadowR * 1.32, 1);
    this.shadowMat.opacity = clamp(0.76 * (1 - hopY * 0.38), 0.14, 0.76);

    this.group.position.set(inp.x, baseFloorY, inp.z);
    this.bodyGroup.position.set(0, hopY, 0);
    this.bodyGroup.scale.set(
      inp.squashX * motion.sx * (inp.facing < 0 ? -1 : 1),
      inp.stretchY * motion.sy,
      1,
    );
    this.bodyGroup.rotation.set(motion.rotX, inp.rotY + motion.rotY, inp.leanRad + motion.rotZ);

    this.planeMesh.position.set(0, centerY, 0);
    this.planeMesh.scale.set(w, h, 1);
    this.planeMesh.renderOrder = order;

    // Optional AniCraft 4x2 viseme face overlay on 2.5D atlas performers
    const overlay = inp.manifest?.anicraftFaceOverlay;
    const isDeck = inp.castId === "deck";
    const isClick = inp.castId === "click";
    const isLeadSinger = inp.castId === "leadsinger";
    const suppressDeckTake =
      isDeck && (inp.cel.action === "walk" || inp.cel.action === "logging-clip" || inp.cel.action === "tape-jam");
    const suppressClickTake =
      isClick && (inp.cel.action === "walk" || inp.cel.action === "performance");
    const suppressLeadSingerTake =
      isLeadSinger && (inp.cel.action === "walk" || inp.cel.action === "puppet-rig" || inp.cel.action === "performance");
    if (
      overlay &&
      tex &&
      !portraitFallbackTex &&
      !isGruffSideWalk &&
      !suppressDeckTake &&
      !suppressClickTake &&
      !suppressLeadSingerTake
    ) {
      const fTex = loadStageTexture(overlay.url) ?? null;
      const cell = selectAniCraftFaceCell(inp.artic, inp.singing, inp.timeSec, inp.actionClip);
      const fUv = computeAniCraftCellUvRect(cell, overlay.cols, overlay.rows, Boolean(overlay.mouthOnly));
      const isFolioWalk = isFolio && inp.cel.action === "walk";
      const leadSingerSingPivot =
        isLeadSinger && effectiveAction === "sing"
          ? LEADSINGER_SING_MOUTH_PIVOTS[idx % LEADSINGER_SING_MOUTH_PIVOTS.length]
          : undefined;
      const pivotX = isFolioWalk ? 0.494 : leadSingerSingPivot ? leadSingerSingPivot[0] : overlay.pivotX;
      const pivotY = isFolioWalk ? 0.392 : leadSingerSingPivot ? leadSingerSingPivot[1] : overlay.pivotY;
      const clipLower = (inp.actionClip ?? "").trim().toLowerCase();
      const happyCastSmile =
        (isDeck || isClick || isLeadSinger) &&
        cell === 7 &&
        (clipLower === "clap" || clipLower === "cheer" || clipLower === "bow" || clipLower === "jump");
      this.faceMat.uniforms.uMap.value = fTex;
      this.faceMat.uniforms.uPhosphorBoost.value = isLeadSinger ? 4.0 : isClick ? 3.0 : isDeck ? 2.0 : 0.0;
      this.faceMat.uniforms.uSrgbOutput.value =
        inp.castId === "gruff" || isFolio || isDeck || isClick || isLeadSinger ? 1 : 0;
      (this.faceMat.uniforms.uUvRect.value as THREE.Vector4).set(fUv[0], fUv[1], fUv[2], fUv[3]);
      this.faceMesh.visible =
        Boolean(fTex) && !(overlay.mouthOnly && !happyCastSmile && (!inp.singing || cell === 0 || cell === 7));
      this.faceMesh.position.set(
        (pivotX - 0.5) * w,
        centerY + (0.5 - pivotY) * h,
        0.025,
      );
      this.faceMesh.scale.set(w * overlay.widthFrac, h * overlay.heightFrac, 1);
      this.faceMesh.renderOrder = order + 2;

      this.mouthPatchMesh.visible = isFolio && this.faceMesh.visible;
      if (this.mouthPatchMesh.visible) {
        this.mouthPatchMesh.position.set(this.faceMesh.position.x, this.faceMesh.position.y, 0.018);
        this.mouthPatchMesh.scale.set(w * overlay.widthFrac * 0.9, h * overlay.heightFrac * 1.04, 1);
        this.mouthPatchMesh.renderOrder = order + 1;
      }
    } else {
      this.faceMesh.visible = false;
      this.mouthPatchMesh.visible = false;
    }

    const restingHopY = Math.max(0, inp.y - baseFloorY);
    this.headAnchorPos.set(inp.x, baseFloorY + restingHopY + inp.worldHeight * 0.96, inp.z);
  }

  getHeadWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.headAnchorPos);
  }

  dispose(): void {
    this.mat.dispose();
    this.depthMat.dispose();
    this.mouthPatchMat.alphaMap?.dispose();
    this.mouthPatchMat.dispose();
    this.faceMat.dispose();
    this.shadowMat.dispose();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED STAGE ACTORS MANAGER
// ═══════════════════════════════════════════════════════════════════════════
interface ManagedActorSlot {
  readonly key: string;
  voiceId: string;
  castId: string;
  tier: "glb" | "multiplane" | "atlas";
  specKey: string;
  glb?: GlbPerformer3D;
  multiplane?: MultiplanePerformer3D;
  atlas?: AtlasPerformer3D;
}

export class StageActorsManager {
  readonly root = new THREE.Group();
  private readonly slots = new Map<string, ManagedActorSlot>();
  private readonly headAnchors = new Map<string, { voiceId: string; castId: string; pos: THREE.Vector3 }>();

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Sync every visible performer cleanly, returning active render tier summary for HUD badge. */
  syncAll(inputs: readonly PerformerUpdateInput[]): { glbCount: number; multiplaneCount: number; atlasCount: number } {
    const activeKeys = new Set<string>();
    let glbCount = 0;
    let multiplaneCount = 0;
    let atlasCount = 0;

    for (const inp of inputs) {
      activeKeys.add(inp.key);
      const voiceId = inp.key.includes(":") ? inp.key.slice(0, inp.key.indexOf(":")) : inp.key;
      const baseFloorY = inp.floorY ?? 0;
      const restingHopY = Math.max(0, inp.y - baseFloorY);
      let anchorEntry = this.headAnchors.get(inp.key);
      if (!anchorEntry) {
        anchorEntry = { voiceId, castId: inp.castId, pos: new THREE.Vector3() };
        this.headAnchors.set(inp.key, anchorEntry);
      } else {
        anchorEntry.voiceId = voiceId;
        anchorEntry.castId = inp.castId;
      }
      anchorEntry.pos.set(inp.x, baseFloorY + restingHopY + inp.worldHeight * 0.96, inp.z);

      const m = inp.manifest;
      const wantsMultiplane =
        Boolean(m?.multiplane) && (inp.rigPreference === "multiplane-first" || !m?.model3d);
      const wantsGlb = Boolean(m?.model3d) && !wantsMultiplane;

      let chosenTier: "glb" | "multiplane" | "atlas" = "atlas";
      let specKey = `atlas:${inp.castId}`;
      let loadedGltf: GLTF | null = null;

      if (wantsGlb && m?.model3d) {
        loadedGltf = loadCachedGltf(m.model3d.url);
        if (loadedGltf) {
          chosenTier = "glb";
          specKey = `glb:${m.model3d.url}`;
        } else if (!gltfFailed.has(m.model3d.url)) {
          // Wait cleanly while preferred .glb loads so performers never pop from a mismatched Multiplane/Atlas costume mid-act.
          const existing = this.slots.get(inp.key);
          if (!existing) continue;
          chosenTier = existing.tier;
          specKey = existing.specKey;
        } else if (m.multiplane) {
          chosenTier = "multiplane";
          specKey = `mp:${m.multiplane.id}`;
        }
      } else if (wantsMultiplane && m?.multiplane) {
        chosenTier = "multiplane";
        specKey = `mp:${m.multiplane.id}`;
      }

      let slot = this.slots.get(inp.key);
      if (slot && (slot.tier !== chosenTier || slot.specKey !== specKey)) {
        this.removeSlot(slot);
        slot = undefined;
      }

      if (!slot) {
        slot = { key: inp.key, voiceId, castId: inp.castId, tier: chosenTier, specKey };
        if (chosenTier === "glb" && m?.model3d && loadedGltf) {
          slot.glb = new GlbPerformer3D(m.model3d, loadedGltf);
          this.root.add(slot.glb.group);
        } else if (chosenTier === "multiplane" && m?.multiplane) {
          slot.multiplane = new MultiplanePerformer3D(m.multiplane);
          this.root.add(slot.multiplane.group);
        } else {
          slot.atlas = new AtlasPerformer3D(inp.worldId);
          this.root.add(slot.atlas.group);
        }
        this.slots.set(inp.key, slot);
      } else {
        slot.voiceId = voiceId;
        slot.castId = inp.castId;
      }

      if (slot.glb) {
        slot.glb.group.visible = true;
        slot.glb.update(inp);
        glbCount++;
      } else if (slot.multiplane) {
        slot.multiplane.group.visible = true;
        slot.multiplane.update(inp);
        multiplaneCount++;
      } else if (slot.atlas) {
        slot.atlas.group.visible = true;
        slot.atlas.update(inp);
        atlasCount++;
      }
    }

    for (const [k, slot] of this.slots.entries()) {
      if (!activeKeys.has(k)) {
        this.removeSlot(slot);
        this.slots.delete(k);
      }
    }
    for (const k of this.headAnchors.keys()) {
      if (!activeKeys.has(k)) this.headAnchors.delete(k);
    }

    return { glbCount, multiplaneCount, atlasCount };
  }

  /**
   * Resolve resting/smoothed crown world position `(x, floorY + hopY + worldHeight * 0.96, z)`
   * for a performer matched by slot key, `voiceId`, or `castId` (never micro-jitters).
   */
  getHeadWorldPos(key: string, out: THREE.Vector3): boolean {
    const canon = canonicalCastId(key);
    const exact = this.slots.get(key);
    if (exact) {
      if (exact.glb) {
        exact.glb.getHeadWorldPos(out);
        return true;
      }
      if (exact.multiplane) {
        exact.multiplane.getHeadWorldPos(out);
        return true;
      }
      if (exact.atlas) {
        exact.atlas.getHeadWorldPos(out);
        return true;
      }
    }
    for (const slot of this.slots.values()) {
      if (slot.voiceId === key || slot.castId === key || slot.castId === canon || canonicalCastId(slot.voiceId) === canon) {
        if (slot.glb) {
          slot.glb.getHeadWorldPos(out);
          return true;
        }
        if (slot.multiplane) {
          slot.multiplane.getHeadWorldPos(out);
          return true;
        }
        if (slot.atlas) {
          slot.atlas.getHeadWorldPos(out);
          return true;
        }
      }
    }
    const anchorExact = this.headAnchors.get(key);
    if (anchorExact) {
      out.copy(anchorExact.pos);
      return true;
    }
    for (const anchor of this.headAnchors.values()) {
      if (anchor.voiceId === key || anchor.castId === key || anchor.castId === canon || canonicalCastId(anchor.voiceId) === canon) {
        out.copy(anchor.pos);
        return true;
      }
    }
    return false;
  }

  private removeSlot(slot: ManagedActorSlot): void {
    if (slot.glb) {
      this.root.remove(slot.glb.group);
      slot.glb.dispose();
    }
    if (slot.multiplane) {
      this.root.remove(slot.multiplane.group);
      slot.multiplane.dispose();
    }
    if (slot.atlas) {
      this.root.remove(slot.atlas.group);
      slot.atlas.dispose();
    }
  }

  dispose(): void {
    for (const slot of this.slots.values()) {
      this.removeSlot(slot);
    }
    this.slots.clear();
    this.scene.remove(this.root);
  }
}
