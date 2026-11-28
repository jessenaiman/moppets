/**
 * Procedural 3D GLB face overlays:
 *  - `ScreenFaceDriver` (flush CRT `screen_face` material slot for Neon / CRT-style performers)
 *  - `TabbyHeadPortals` (head-bone-mounted cyan pixel-LED eyes & CHIMERA felt muzzle)
 */
import * as THREE from "three";
import { computeIsolatedMouthModulation } from "../isolatedMouthContract.ts";
import { UNIT_CIRCLE_GEO, UNIT_PLANE_GEO } from "../stageGeometries.ts";
import { naturalBlinkAmountAt, type TabbyFacialState } from "../visemeMapper.ts";
import { clamp, clamp01, type VocalArticSample } from "./actorShared.ts";

export interface ScreenFaceDriver {
  readonly material: THREE.MeshStandardMaterial;
  readonly sync: (artic: VocalArticSample | undefined, singing: boolean, timeSec: number, clip: string) => void;
  readonly dispose: () => void;
}

export function createScreenFaceDriver(
  style: "neon-rings" | "crt-phosphor" = "neon-rings",
): ScreenFaceDriver | null {
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
      (actionClip === "bow" ||
        actionClip === "jump" ||
        actionClip === "clap" ||
        actionClip === "cheer" ||
        actionClip === "laugh") &&
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
        const r = clamp(22 + openAmp * 12, 22, 34);
        drawMouthEllipse(r * 0.96, r, false);
      } else if (round >= 0.34) {
        const rx = clamp(30 + openAmp * 10, 30, 40);
        const ry = clamp(24 + openAmp * 20, 24, 44);
        drawMouthEllipse(rx, ry, true);
      } else if (width >= 0.55 && open < 0.48) {
        const rx = clamp(48 + width * 20, 48, 68);
        const ry = clamp(15 + openAmp * 18, 15, 33);
        drawMouthEllipse(rx, ry, false);
      } else {
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

/** Tabby head-bone-mounted cyan pixel-LED eyes & CHIMERA felt muzzle. */
export class TabbyHeadPortals {
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
    const lipDark = new THREE.MeshBasicMaterial({
      color: "#3c1b1d",
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
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
      new THREE.MeshBasicMaterial({
        color: "#f9efe2",
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    fvTooth.position.set(0, 0.0025, 0.002);
    fvTooth.scale.set(0.036, 0.0055, 1);
    this.registerOrder(fvTooth, 6);
    this.fvMouth.add(fvLip, fvTooth);
    this.mouthGroup.add(this.fvMouth);

    this.rimMesh = new THREE.Mesh(
      UNIT_CIRCLE_GEO,
      new THREE.MeshBasicMaterial({
        color: "#4a1e22",
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.registerOrder(this.rimMesh, 5);
    this.cavMesh = new THREE.Mesh(
      UNIT_CIRCLE_GEO,
      new THREE.MeshBasicMaterial({
        color: "#1f080b",
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.cavMesh.position.z = 0.002;
    this.registerOrder(this.cavMesh, 6);
    this.tongueMesh = new THREE.Mesh(
      UNIT_CIRCLE_GEO,
      new THREE.MeshBasicMaterial({
        color: "#d8686d",
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
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
        actionClip === "cheer" ||
        actionClip === "laugh" ||
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
