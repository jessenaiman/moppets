/**
 * AniCraft 4x2 Face Viseme UV shader, alpha plate textures, and cell selection helpers.
 */
import * as THREE from "three";
import { naturalBlinkAmountAt } from "../visemeMapper.ts";
import { clamp01, type VocalArticSample } from "./actorShared.ts";

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

export function createAniCraftFaceMat(
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

export function createSoftPlateAlphaTexture(
  shape: "rounded-rect" | "circle" = "rounded-rect",
): THREE.CanvasTexture | null {
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

export function computeAniCraftCellUvRect(
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

export function selectAniCraftFaceCell(
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
