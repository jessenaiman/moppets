/**
 * Unified Three.js GLSL Stage Lighting Shader (`S-61`):
 * Physically integrates 2D/2.5D transparent WebP character cutouts & rig parts into any 3D Stage World:
 *  - GPU UV sub-rect cropping (`uUvRect`) for 4x2 sheets, 8x6 atlases, AND zero-slice 8-viseme head crops
 *  - Edge-aware whisker green-spill suppression (protects mint-cyan CRT eyes)
 *  - World-matched key light + colored shadow fill + ambient floor bounce
 *  - Overhead left/right alpha-gradient fresnel rim wrap (`uRimLeft`, `uRimRight`, `uSpotBias`)
 *  - Selective additive CRT LED phosphor bloom on Tabby's mint eyes modulated by live voicing energy
 *  - Clean `uLightingEnabled` (`0` = No-Post diagnostic baseline, `1` = Final graded look)
 */
import * as THREE from "three";
import type { StageLightingProfile } from "./stageWorlds.ts";

export interface StagePuppetUniformValues {
  map: THREE.Texture | null;
  uvRect: readonly [number, number, number, number];
  lighting: StageLightingProfile;
  lightingEnabled: boolean;
  tungstenWarmth: number;
  rimIntensity: number;
  crtEyeGlow: number;
  voiceEnergy: number;
  spotBias: number;
  /** Optional UV-space bottom soft feather (0..0.12) used on cropped head -> collar blend. */
  bottomFeather?: number;
  /** Enable cyan CRT phosphor bloom detection (Tabby / CRT heads). */
  hasCrtEyes?: boolean;
  /** Enable warm-amber CRT parchment ink-contrast + glow boost (Folio). */
  hasAmberCrt?: boolean;
  opacity?: number;
}

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vLocalUv;
  varying vec2 vTexUv;
  uniform vec4 uUvRect;

  void main() {
    vLocalUv = uv;
    vTexUv = vec2(
      uUvRect.x + uv.x * uUvRect.z,
      uUvRect.y + uv.y * uUvRect.w
    );
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vLocalUv;
  varying vec2 vTexUv;

  uniform sampler2D uMap;
  uniform vec4 uUvRect;
  uniform float uLightingEnabled;
  uniform vec3 uKeyColor;
  uniform float uKeyStrength;
  uniform vec3 uShadowTint;
  uniform float uShadowStrength;
  uniform vec3 uRimLeftColor;
  uniform vec3 uRimRightColor;
  uniform float uRimStrength;
  uniform vec3 uAmbientBounce;
  uniform float uSpotBias;
  uniform float uCrtGlow;
  uniform float uVoiceEnergy;
  uniform float uHasCrtEyes;
  uniform float uHasAmberCrt;
  uniform float uBottomFeather;
  uniform float uOpacity;

  vec2 clampCellUv(vec2 uv) {
    vec2 pad = uUvRect.zw * 0.002;
    return clamp(uv, uUvRect.xy + pad, uUvRect.xy + uUvRect.zw - pad);
  }

  void main() {
    vec4 tex = texture2D(uMap, clampCellUv(vTexUv));
    float alpha = tex.a * uOpacity;

    // Optional crisp soft-edge feather at bottom chin crop so cropped head merges seamlessly into collar
    if (uBottomFeather > 0.001) {
      alpha *= smoothstep(0.0, uBottomFeather, vLocalUv.y);
    }

    if (alpha < 0.015) discard;

    vec3 col = tex.rgb;

    // Detect bright mint-cyan LED eyes & crisp emerald VFD readouts (e.g. Tracker 12:00) before spill suppression
    float cyanScore = smoothstep(0.38, 0.72, col.g)
                    * smoothstep(0.32, 0.65, col.b)
                    * smoothstep(0.68, 0.28, col.r);
    float vfdGreenScore = smoothstep(0.30, 0.56, col.g)
                        * smoothstep(0.05, 0.22, col.g - max(col.r, col.b))
                        * smoothstep(0.52, 0.58, vLocalUv.y)
                        * smoothstep(0.80, 0.74, vLocalUv.y);
    float eyeMask = uHasCrtEyes * max(
      cyanScore * smoothstep(0.28, 0.44, vLocalUv.y) * smoothstep(0.92, 0.68, vLocalUv.y),
      vfdGreenScore
    );

    // Subtle green chroma-fringe cleanup strictly on outer semi-transparent edges (whisker tips / felt fuzz)
    float edgeMask = 1.0 - smoothstep(0.35, 0.96, alpha);
    float greenExcess = max(0.0, col.g - max(col.r, col.b));
    float spillAmount = greenExcess * (0.62 * edgeMask + 0.25) * (1.0 - eyeMask);
    col.g -= spillAmount * 0.92;
    col.r += spillAmount * 0.14;
    col.b += spillAmount * 0.08;

    // Warm-amber CRT scroll contrast & backlit ink crispening (Folio word-eyes & smile)
    float amberMask = 0.0;
    if (uHasAmberCrt > 0.5) {
      float hood = smoothstep(0.28, 0.35, vLocalUv.x) * smoothstep(0.76, 0.69, vLocalUv.x)
                 * smoothstep(0.52, 0.58, vLocalUv.y) * smoothstep(0.78, 0.72, vLocalUv.y);
      float inkLuma = dot(col, vec3(0.299, 0.587, 0.114));
      float warm = hood * smoothstep(0.05, 0.16, col.r - col.b) * smoothstep(0.06, 0.16, inkLuma);
      float inkPull = warm * smoothstep(0.42, 0.16, inkLuma);
      float glowLift = warm * smoothstep(0.34, 0.54, inkLuma);
      col = clamp(col * (1.0 - inkPull * vec3(0.54, 0.58, 0.62)) + vec3(0.08, 0.052, 0.014) * glowLift, 0.0, 1.0);
      amberMask = glowLift;
    }

    // No-Post Diagnostic Mode: output clean sRGB texture directly
    if (uLightingEnabled < 0.5) {
      gl_FragColor = vec4(col, alpha);
      return;
    }

    // 1. Directional key-light gradient across vertical & horizontal form + warm/cool world grade
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    float topLight = mix(0.84, 1.12, smoothstep(0.05, 0.92, vLocalUv.y));
    vec3 keyGrade = mix(vec3(1.0), uKeyColor * topLight, uKeyStrength);

    // 2. Shadow-fill lift + floor bounce near the paws
    float shadowMask = (1.0 - smoothstep(0.08, 0.52, luma)) * uShadowStrength;
    float floorBounceMask = (1.0 - smoothstep(0.0, 0.36, vLocalUv.y)) * 0.42;
    vec3 lit = col * keyGrade + uShadowTint * shadowMask * 0.22 + uAmbientBounce * floorBounceMask * col;

    // 3. Overhead dual-fresnel alpha-silhouette rim wrap (left + right studio spotlights)
    vec2 pxStep = uUvRect.zw * vec2(0.011, 0.013);
    float aLeft  = texture2D(uMap, clampCellUv(vTexUv + vec2(-pxStep.x,  pxStep.y * 0.75))).a;
    float aRight = texture2D(uMap, clampCellUv(vTexUv + vec2( pxStep.x,  pxStep.y * 0.75))).a;
    float aUp    = texture2D(uMap, clampCellUv(vTexUv + vec2(0.0,        pxStep.y * 1.1))).a;

    float rimL = clamp(alpha - aLeft, 0.0, 1.0);
    float rimR = clamp(alpha - aRight, 0.0, 1.0);
    float rimTop = clamp(alpha - aUp, 0.0, 1.0);

    float leftWeight  = clamp(0.68 - uSpotBias * 0.45, 0.25, 1.15);
    float rightWeight = clamp(0.68 + uSpotBias * 0.45, 0.25, 1.15);

    vec3 rimLight =
      uRimLeftColor  * (rimL * leftWeight + rimTop * 0.42 * leftWeight) +
      uRimRightColor * (rimR * rightWeight + rimTop * 0.42 * rightWeight);

    // Keep rim light naturally strongest on head/ears/shoulders and gentle near feet
    float rimHeightFalloff = mix(0.28, 1.0, smoothstep(0.08, 0.72, vLocalUv.y));
    lit += rimLight * uRimStrength * rimHeightFalloff * 0.52;

    // 4. Steady selective mint-cyan CRT LED eye & emerald VFD glow (subtle breath only — NEVER flashes on syllables!)
    if (eyeMask > 0.01) {
      float energyBoost = 1.0 + uVoiceEnergy * 0.08;
      vec3 glowHue = mix(vec3(0.26, 1.0, 0.84), vec3(0.22, 1.0, 0.34), step(0.08, col.g - col.b));
      vec3 phosphor = glowHue * (0.24 * uCrtGlow * energyBoost);
      lit = mix(lit, col * 1.08 + phosphor, eyeMask);
    }
    if (amberMask > 0.01) {
      lit += vec3(0.06, 0.04, 0.012) * amberMask * uCrtGlow;
    }

    // Subtle filmic highlight rolloff so warm rim + CRT glow never clip harshly
    lit = lit / (1.0 + max(vec3(0.0), lit - 0.88) * 0.45);
    gl_FragColor = vec4(clamp(lit, 0.0, 1.0), alpha);
  }
`;

export function createStagePuppetMaterial(initial: StagePuppetUniformValues): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uMap: { value: initial.map },
      uUvRect: { value: new THREE.Vector4(...initial.uvRect) },
      uLightingEnabled: { value: initial.lightingEnabled ? 1 : 0 },
      uKeyColor: { value: new THREE.Vector3(...initial.lighting.keyColor) },
      uKeyStrength: { value: initial.lighting.keyStrength * initial.tungstenWarmth },
      uShadowTint: { value: new THREE.Vector3(...initial.lighting.shadowTint) },
      uShadowStrength: { value: initial.lighting.shadowStrength },
      uRimLeftColor: { value: new THREE.Vector3(...initial.lighting.rimLeftColor) },
      uRimRightColor: { value: new THREE.Vector3(...initial.lighting.rimRightColor) },
      uRimStrength: { value: initial.lighting.rimStrength * initial.rimIntensity },
      uAmbientBounce: { value: new THREE.Vector3(...initial.lighting.ambientBounce) },
      uSpotBias: { value: initial.spotBias },
      uCrtGlow: { value: initial.lighting.crtGlowBoost * initial.crtEyeGlow },
      uVoiceEnergy: { value: initial.voiceEnergy },
      uHasCrtEyes: { value: initial.hasCrtEyes ? 1 : 0 },
      uHasAmberCrt: { value: initial.hasAmberCrt ? 1 : 0 },
      uBottomFeather: { value: initial.bottomFeather ?? 0 },
      uOpacity: { value: initial.opacity ?? 1 },
    },
  });
  return mat;
}

export function syncStagePuppetMaterial(mat: THREE.ShaderMaterial, next: StagePuppetUniformValues): void {
  const u = mat.uniforms;
  u.uMap.value = next.map;
  (u.uUvRect.value as THREE.Vector4).set(next.uvRect[0], next.uvRect[1], next.uvRect[2], next.uvRect[3]);
  u.uLightingEnabled.value = next.lightingEnabled ? 1 : 0;
  (u.uKeyColor.value as THREE.Vector3).set(
    next.lighting.keyColor[0],
    next.lighting.keyColor[1],
    next.lighting.keyColor[2],
  );
  u.uKeyStrength.value = next.lighting.keyStrength * next.tungstenWarmth;
  (u.uShadowTint.value as THREE.Vector3).set(
    next.lighting.shadowTint[0],
    next.lighting.shadowTint[1],
    next.lighting.shadowTint[2],
  );
  u.uShadowStrength.value = next.lighting.shadowStrength;
  (u.uRimLeftColor.value as THREE.Vector3).set(
    next.lighting.rimLeftColor[0],
    next.lighting.rimLeftColor[1],
    next.lighting.rimLeftColor[2],
  );
  (u.uRimRightColor.value as THREE.Vector3).set(
    next.lighting.rimRightColor[0],
    next.lighting.rimRightColor[1],
    next.lighting.rimRightColor[2],
  );
  u.uRimStrength.value = next.lighting.rimStrength * next.rimIntensity;
  (u.uAmbientBounce.value as THREE.Vector3).set(
    next.lighting.ambientBounce[0],
    next.lighting.ambientBounce[1],
    next.lighting.ambientBounce[2],
  );
  u.uSpotBias.value = next.spotBias;
  u.uCrtGlow.value = next.lighting.crtGlowBoost * next.crtEyeGlow;
  u.uVoiceEnergy.value = next.voiceEnergy;
  u.uHasCrtEyes.value = next.hasCrtEyes ? 1 : 0;
  u.uHasAmberCrt.value = next.hasAmberCrt ? 1 : 0;
  u.uBottomFeather.value = next.bottomFeather ?? 0;
  u.uOpacity.value = next.opacity ?? 1;
}
