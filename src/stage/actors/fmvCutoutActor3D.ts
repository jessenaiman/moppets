/**
 * Tier 3: World-Lit 2.5D Depth Stage Cutout (`AtlasPerformer3D` / `FmvCutoutActor3D`)
 * using `createStagePuppetMaterial`, AniCraft 4x2 viseme overlays, and grounded contact shadows.
 */
import * as THREE from "three";
import { UNIT_PLANE_GEO } from "../stageGeometries.ts";
import { createStagePuppetMaterial, syncStagePuppetMaterial } from "../stageLightingMaterial.ts";
import { loadStageTexture } from "../stageTextures.ts";
import { resolveStageWorld, type StageWorldId } from "../stageWorlds.ts";
import {
  clamp,
  clamp01,
  createAtlasDepthMaterial,
  createContactShadowMesh,
  getAtlasSolidBottomNorm,
  zRenderOrder,
  type PerformerUpdateInput,
  type StageActor3D,
} from "./actorShared.ts";
import {
  computeAniCraftCellUvRect,
  createAniCraftFaceMat,
  createSoftPlateAlphaTexture,
  selectAniCraftFaceCell,
} from "./aniCraftFaceShader.ts";

// Per-frame chin grille anchor across LeadSinger's 48f swaying `sing.webp` performance
const LEADSINGER_SING_MOUTH_PIVOTS: readonly (readonly [number, number])[] = [
  [0.501, 0.28], [0.504, 0.283], [0.512, 0.285], [0.479, 0.286], [0.466, 0.277], [0.435, 0.285], [0.418, 0.291], [0.405, 0.296],
  [0.404, 0.288], [0.404, 0.292], [0.416, 0.291], [0.408, 0.297], [0.408, 0.29], [0.407, 0.293], [0.424, 0.29], [0.45, 0.288],
  [0.455, 0.288], [0.495, 0.272], [0.51, 0.281], [0.514, 0.278], [0.535, 0.286], [0.554, 0.287], [0.554, 0.288], [0.562, 0.292],
  [0.552, 0.286], [0.535, 0.283], [0.497, 0.282], [0.475, 0.283], [0.459, 0.281], [0.451, 0.284], [0.478, 0.284], [0.488, 0.284],
  [0.484, 0.284], [0.507, 0.281], [0.487, 0.278], [0.484, 0.275], [0.491, 0.273], [0.496, 0.268], [0.485, 0.272], [0.491, 0.274],
  [0.509, 0.279], [0.495, 0.274], [0.498, 0.275], [0.493, 0.274], [0.497, 0.27], [0.494, 0.278], [0.503, 0.283], [0.495, 0.272],
];

const GESTURE_CLIPS = new Set([
  "clap",
  "cheer",
  "jump",
  "bow",
  "shrug",
  "toaster-shrug",
  "walk",
  "walk-left",
  "walk-right",
  "step",
  "nod",
  "double nod",
  "tilt",
  "laugh",
  "gasp",
  "drawer-lead",
]);

function evaluateClipGestureOffset(
  clip: string,
  inp: PerformerUpdateInput,
  el: number,
): { hop: number; sx: number; sy: number; rotX: number; rotY: number; rotZ: number } {
  let gHop = 0;
  let gSy = 1;
  let gSx = 1;
  let gRotX = 0;
  let gRotY = 0;
  let gRotZ = 0;

  if (clip === "clap") {
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
    const u = clamp01(el / 1.65);
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
    const u = clamp01(el / 1.55);
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
    const u = clamp01(el / 2.5);
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
    const u = clamp01(el / 2.0);
    const pop = u < 0.14 ? Math.sin((u / 0.14) * (Math.PI * 0.5)) : u < 0.78 ? 1 : Math.cos(((u - 0.78) / 0.22) * (Math.PI * 0.5));
    gHop = 0.075 * pop;
    gSy = 1 + 0.055 * pop;
    gSx = 1 - 0.03 * pop;
  }

  return { hop: gHop, sx: gSx, sy: gSy, rotX: gRotX, rotY: gRotY, rotZ: gRotZ };
}

export class AtlasPerformer3D implements StageActor3D {
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
    const isGestureClip = GESTURE_CLIPS.has(clip);

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

    if (this.gestureWeight > 0.004 && isGestureClip) {
      const el = inp.actionElapsedSec !== undefined ? Math.max(0, inp.actionElapsedSec) : inp.timeSec;
      const g = evaluateClipGestureOffset(clip, inp, el);
      const w = this.gestureWeight;
      hop += g.hop * w;
      sx *= 1 + (g.sx - 1) * w;
      sy *= 1 + (g.sy - 1) * w;
      rotX += g.rotX * w;
      rotY += g.rotY * w;
      rotZ += g.rotZ * w;
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
    const aspect = img?.width && img?.height ? img.width / cols / Math.max(1, img.height / rows) : 0.85;
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

export { AtlasPerformer3D as FmvCutoutActor3D };
