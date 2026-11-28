/**
 * Three.js overlay mesh & texture lifecycle for Tier 2 Multiplane rigs
 * (Ozzi/generic CRT face, Tally ON-AIR dome + speaker mouth, Fuzz tube bloom + LED face,
 * Hertz CH 04 / VIDEO 1 CRT phosphor screen).
 */
import * as THREE from "three";
import type { MultiplaneNodeSpec, MultiplaneRigSpec } from "../../choir/castManifest.ts";
import { quantizeTwosSec, type EvaluatedMultiplanePose } from "../multiplaneKinematics.ts";
import { UNIT_PLANE_GEO } from "../stageGeometries.ts";
import { createSoftGlowTexture } from "../stageTextures.ts";
import { naturalBlinkAmountAt } from "../visemeMapper.ts";
import { clamp01, type PerformerUpdateInput } from "./actorShared.ts";
import {
  paintFuzzFaceCanvas,
  paintGenericCrtFaceCanvas,
  paintHertzScreenCanvas,
  paintOzziCrtCanvas,
  paintTallyMouthCanvas,
} from "./multiplaneCanvasPainters.ts";

export interface MultiplaneNodeVisualHost {
  readonly spec: MultiplaneNodeSpec;
  readonly group: THREE.Group;
}

export class MultiplaneOverlayRig {
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

  private lastCrtKey = "";
  private lastTallyMouthKey = "";
  private lastFuzzFaceKey = "";
  private lastHertzScreenKey = "";

  constructor(
    private readonly rig: MultiplaneRigSpec,
    nodeVisuals: ReadonlyMap<number, MultiplaneNodeVisualHost>,
  ) {
    if (typeof document === "undefined") return;

    if (rig.crtFace || rig.hasProceduralPhosphorCrt) {
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
        const host = nodeVisuals.get(rig.crtFace.nodeId);
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
        const host = nodeVisuals.get(997) ?? nodeVisuals.values().next().value;
        if (host) {
          const scr = new THREE.Mesh(UNIT_PLANE_GEO, this.crtMat);
          scr.position.set(-0.5, 188.5, 3.6);
          scr.scale.set(304, 304, 1);
          scr.renderOrder = 166;
          host.group.add(scr);
          this.crtScreenMesh = scr;
        }
      }
    }

    if (rig.id === "tally") {
      const domeLit = nodeVisuals.get(621);
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
        halo.position.set(-2, 35, 8.2);
        halo.scale.set(220, 220, 1);
        halo.renderOrder = 324;
        domeLit.group.add(halo);
        this.tallyDomeGlowMesh = halo;
      }

      const headHost = nodeVisuals.get(683);
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
        mouth.position.set(-2.5, 10.5, headHost.spec.zPx * 0.18 + 3.5);
        mouth.scale.set(116, 82, 1);
        mouth.visible = false;
        mouth.renderOrder = 316;
        headHost.group.add(mouth);
        this.tallyMouthMesh = mouth;
      }
    }

    if (rig.id === "fuzz") {
      const headHardware = nodeVisuals.get(147);
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

      const headNull = nodeVisuals.get(14);
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
        face.position.set(2.9, 37.5, 9.32);
        face.scale.set(183.8, 58.7, 1);
        face.visible = false;
        face.renderOrder = 322;
        headNull.group.add(face);
        this.fuzzFaceMesh = face;
      }
    }

    if (rig.id === "hertz") {
      const screenOsd = nodeVisuals.get(525);
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
        scr.position.set(-0.5, 0.5, screenOsd.spec.zPx * 0.18 + 0.85);
        scr.scale.set(324, 244, 1);
        scr.renderOrder = 320;
        screenOsd.group.add(scr);
        this.hertzScreenMesh = scr;
      }
    }
  }

  update(inp: PerformerUpdateInput, pose: EvaluatedMultiplanePose, baseOrder: number): void {
    if (this.crtScreenMesh) {
      this.crtScreenMesh.renderOrder = baseOrder + (this.rig.hasProceduralPhosphorCrt ? 10 : 40);
    }
    this.updateCrtCanvas(inp);
    this.updateTallyOverlays(inp, baseOrder);
    this.updateFuzzOverlays(inp, baseOrder);
    this.updateHertzScreen(inp, pose, baseOrder);
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
      paintOzziCrtCanvas(ctx, W, H, {
        qTime,
        singing: inp.singing,
        open,
        round,
        width,
        clip,
        gagActive: inp.gagActive,
      });
    } else if (this.rig.crtFace) {
      paintGenericCrtFaceCanvas(ctx, W, H, this.rig.crtFace, {
        qTime,
        singing: inp.singing,
        open,
        round,
        width,
        clip,
      });
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
    paintTallyMouthCanvas(ctx, W, H, { isSingMouth, isTickerCue, isHappySmile, open, round, width });
    this.tallyMouthTex.needsUpdate = true;
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
    paintFuzzFaceCanvas(ctx, W, H, { qTime, isSingMode, isShred, isHappy, open, round, width, blink });
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
    paintHertzScreenCanvas(ctx, W, H, { isSingMode, isHappy, open, round, width, blink });
    this.hertzScreenTex.needsUpdate = true;
  }

  dispose(): void {
    this.crtTex?.dispose();
    this.crtMat?.dispose();
    this.tallyDomeGlowMat?.map?.dispose();
    this.tallyDomeGlowMat?.dispose();
    this.tallyMouthTex?.dispose();
    this.tallyMouthMat?.dispose();
    this.fuzzTubeGlowMat?.map?.dispose();
    this.fuzzTubeGlowMat?.dispose();
    this.fuzzFaceTex?.dispose();
    this.fuzzFaceMat?.dispose();
    this.hertzScreenTex?.dispose();
    this.hertzScreenMat?.dispose();
  }
}
