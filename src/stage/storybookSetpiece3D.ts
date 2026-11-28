/**
 * Open 3D Pop-Up Storybook Setpiece (`S-54`):
 * Physical crimson cloth-bound hardcover book (`9.6 x 5.6`) resting on a warm walnut workbench
 * inside an arched study-lamp dome, featuring:
 *  - True 3D curved open page spread (`pageSurfaceY`) with dynamic archival rag-paper canvas artwork
 *    redrawn ONLY when `(songTitle, sceneIndex)` changes
 *  - Real 3D vertex-curled animated page-turn leaf (`PlaneGeometry(4.65, 5.3, 20, 6)`) sweeping
 *    `0 -> π` across ~0.75s whenever `activeScene.sceneIndex` changes
 *  - Hinged 3D folded cardstock pop-up scenery (`popupRoot` with `back.out` unfold):
 *    Hero Lantern Gatehouse upstage center (`z = -1.65`), multi-tier paper pines, hillside cottages,
 *    folded peaks, paper clouds & origami swallows
 *  - Exact curved-page surface grounding query `getSurfaceAt(x, z)` (`surfaceId: "book"`).
 */
import * as THREE from "three";
import type { StageLightingMood } from "./stageDirectorStore.ts";
import type { SurfaceSample } from "./stageSurface.ts";
import { createStorybookStudyDomeMaterial, createWalnutWorkbenchTexture } from "./stageTextures.ts";

export const STORYBOOK_WIDTH = 9.6;
export const STORYBOOK_DEPTH = 5.6;
export const STORYBOOK_SPREAD_W = 9.2;
export const STORYBOOK_SPREAD_D = 5.2;
export const STORYBOOK_LEAF_W = 4.65;
export const STORYBOOK_LEAF_D = 5.3;
export const STORYBOOK_TURN_SEC = 0.75;

export interface StorybookUpdateParams {
  readonly timeSec: number;
  readonly dt: number;
  readonly beat: number;
  readonly voiceEnergy: number;
  readonly songTitle: string;
  readonly sceneIndex: number;
  readonly sectionName: string;
  readonly lightingEnabled: boolean;
  readonly lightingMood: Exclude<StageLightingMood, "auto">;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const backOut = (t: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  const u = clamp(t, 0, 1) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

/** Exact open-book page arch surface height at X across `bookWidth = 9.6`. */
export function pageSurfaceY(x: number, bookWidth = STORYBOOK_WIDTH): number {
  const halfW = Math.max(0.5, bookWidth * 0.5);
  const norm = Math.min(1, Math.abs(x) / halfW);
  const arch = Math.sin(norm * Math.PI * 0.88) * 0.24 - (1 - Math.min(1, norm * 4.5)) * 0.14;
  return 0.16 + arch;
}

/** Exact normalized surface normal of the curved open book spread at X. */
export function pageSurfaceNormal(x: number, bookWidth = STORYBOOK_WIDTH): { nx: number; ny: number } {
  const eps = 0.02;
  const dy = pageSurfaceY(x + eps, bookWidth) - pageSurfaceY(x - eps, bookWidth);
  const slope = dy / (eps * 2);
  const len = Math.hypot(-slope, 1);
  return { nx: -slope / len, ny: 1 / len };
}

function createPaperGrainTexture(baseHex: string, speckHex: string, seed = 1): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);
  let s = seed * 9301 + 49297;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  ctx.fillStyle = speckHex;
  for (let i = 0; i < 2200; i++) {
    ctx.globalAlpha = 0.03 + rand() * 0.06;
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBookSpreadTexture(
  songTitle: string,
  sceneIndex: number,
  sectionName: string,
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 640;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  // Warm archival rag-paper background
  ctx.fillStyle = "#ece1c2";
  ctx.fillRect(0, 0, 1024, 640);

  for (let i = 0; i < 2800; i++) {
    const x = (i * 73) % 1024;
    const y = (i * 197) % 640;
    ctx.fillStyle = i % 2 === 0 ? "rgba(120,96,64,0.038)" : "rgba(255,250,235,0.055)";
    ctx.fillRect(x, y, 2, 2);
  }

  // Printed double border rule
  ctx.strokeStyle = "rgba(126, 98, 66, 0.34)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(22, 22, 980, 596);
  ctx.strokeStyle = "rgba(126, 98, 66, 0.18)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(30, 30, 964, 580);

  // Painted sage meadow across both pages
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(62, 534);
  ctx.lineTo(74, 158);
  ctx.quadraticCurveTo(280, 96, 512, 148);
  ctx.quadraticCurveTo(750, 98, 950, 158);
  ctx.lineTo(962, 534);
  ctx.quadraticCurveTo(742, 550, 512, 526);
  ctx.quadraticCurveTo(280, 550, 62, 534);
  ctx.closePath();
  const meadowGrad = ctx.createLinearGradient(0, 110, 0, 540);
  meadowGrad.addColorStop(0, "#8ba66e");
  meadowGrad.addColorStop(0.55, "#b3c284");
  meadowGrad.addColorStop(1, "#cad096");
  ctx.fillStyle = meadowGrad;
  ctx.fill();
  ctx.strokeStyle = "#f4ecd4";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  // Painted winding sandstone footpath crossing the spine
  ctx.save();
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(215, 496);
  ctx.bezierCurveTo(265, 400, 370, 366, 512, 396);
  ctx.bezierCurveTo(648, 424, 725, 374, 678, 286);
  ctx.strokeStyle = "#e8d7ad";
  ctx.lineWidth = 50;
  ctx.stroke();
  ctx.strokeStyle = "#d1bc8a";
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 10]);
  ctx.stroke();
  ctx.restore();

  // Subtle decorative musical staff & treble clef flourish on top left header
  ctx.save();
  ctx.strokeStyle = "rgba(110, 82, 52, 0.25)";
  ctx.lineWidth = 1.4;
  for (let s = 0; s < 5; s++) {
    const sy = 56 + s * 6;
    ctx.beginPath();
    ctx.moveTo(58, sy);
    ctx.lineTo(250, sy);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(116, 74, 38, 0.55)";
  ctx.font = "italic 34px Georgia, serif";
  ctx.fillText("𝄞", 62, 84);
  ctx.restore();

  // Soft center spine gutter shading + stitched binding thread ticks
  const gutter = ctx.createLinearGradient(476, 0, 548, 0);
  gutter.addColorStop(0, "rgba(74,56,34,0)");
  gutter.addColorStop(0.47, "rgba(62,46,28,0.22)");
  gutter.addColorStop(0.5, "rgba(42,30,18,0.44)");
  gutter.addColorStop(0.53, "rgba(62,46,28,0.20)");
  gutter.addColorStop(1, "rgba(74,56,34,0)");
  ctx.fillStyle = gutter;
  ctx.fillRect(476, 0, 72, 640);

  ctx.strokeStyle = "#7a5e3c";
  ctx.lineWidth = 3;
  for (let y = 78; y <= 558; y += 34) {
    ctx.beginPath();
    ctx.moveTo(504, y);
    ctx.lineTo(520, y + 6);
    ctx.stroke();
  }

  // Song header & active scene stamps
  const titleUpper = (songTitle || "STUDIO 404 FOLIO").toUpperCase().slice(0, 32);
  const sceneCode = `S${String(Math.max(1, sceneIndex)).padStart(2, "0")}`;
  const secUpper = (sectionName || "CHAPTER").toUpperCase().slice(0, 26);

  ctx.fillStyle = "rgba(92, 68, 42, 0.82)";
  ctx.font = "600 17px ui-monospace, 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText(titleUpper, 58, 592);
  ctx.textAlign = "right";
  ctx.fillText(`${sceneCode} · ${secUpper}`, 966, 592);
  ctx.font = "600 15px ui-monospace, 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(104, 80, 50, 0.65)";
  ctx.fillText(`FOLIO PLATE ${sceneCode}`, 966, 76);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Gently arched open-book spread whose top surface matches `pageSurfaceY(x, STORYBOOK_WIDTH)` exactly. */
function createCurvedSpreadGeometry(width: number, depth: number): THREE.BufferGeometry {
  const segX = 48;
  const segZ = 16;
  const geo = new THREE.BoxGeometry(width, 0.24, depth, segX, 1, segZ);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    if (y > 0) {
      pos.setY(i, pageSurfaceY(x, STORYBOOK_WIDTH));
    } else {
      pos.setY(i, -0.02);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function buildPaperPine(scale: number, greenHex: number, trimMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055 * scale, 0.08 * scale, 0.28 * scale, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b472d, roughness: 0.92 }),
  );
  trunk.position.y = 0.14 * scale;
  trunk.castShadow = true;
  g.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({
    color: greenHex,
    roughness: 0.88,
    flatShading: true,
  });
  for (const [r, h, y] of [
    [0.44, 0.62, 0.52],
    [0.35, 0.56, 0.88],
    [0.24, 0.48, 1.22],
  ] as const) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * scale, h * scale, 6), leafMat);
    cone.position.y = y * scale;
    cone.castShadow = true;
    cone.receiveShadow = true;
    g.add(cone);

    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(r * scale * 1.01, r * scale * 1.03, 0.025 * scale, 6),
      trimMat,
    );
    rim.position.y = (y - h * 0.48) * scale;
    g.add(rim);
  }
  return g;
}

function buildPaperCottage(scale: number, trimMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xede2c4, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xc24836, roughness: 0.85, flatShading: true });
  const winMat = new THREE.MeshStandardMaterial({
    color: 0xffd27a,
    emissive: 0xffb347,
    emissiveIntensity: 0.72,
    roughness: 0.35,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62 * scale, 0.46 * scale, 0.54 * scale), wallMat);
  body.position.y = 0.23 * scale;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const roofShape = new THREE.Shape();
  roofShape.moveTo(-0.42 * scale, 0);
  roofShape.lineTo(0, 0.36 * scale);
  roofShape.lineTo(0.42 * scale, 0);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 0.66 * scale, bevelEnabled: false });
  roofGeo.translate(0, 0, -0.33 * scale);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = 0.44 * scale;
  roof.castShadow = true;
  g.add(roof);

  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.66 * scale, 0.03 * scale, 0.58 * scale), trimMat);
  trim.position.y = 0.46 * scale;
  g.add(trim);

  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.14 * scale, 0.16 * scale), winMat);
  win.position.set(0, 0.24 * scale, 0.275 * scale);
  g.add(win);

  return g;
}

function buildLanternGatehouse(trimMat: THREE.Material) {
  const root = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xcab895, roughness: 0.92, flatShading: true });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4b2a, roughness: 0.88 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xc44332, roughness: 0.82, flatShading: true });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xf2c55c,
    emissive: 0xd99b26,
    emissiveIntensity: 0.32,
    metalness: 0.48,
    roughness: 0.32,
  });
  const roseRingMat = new THREE.MeshStandardMaterial({
    color: 0xff5e99,
    emissive: 0xff4286,
    emissiveIntensity: 1.25,
    roughness: 0.25,
  });
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffdc80,
    emissive: 0xffae33,
    emissiveIntensity: 1.1,
    roughness: 0.28,
  });

  const pillarGeo = new THREE.BoxGeometry(0.46, 1.52, 0.42);
  for (const px of [-0.78, 0.78]) {
    const p = new THREE.Mesh(pillarGeo, stoneMat);
    p.position.set(px, 0.76, 0);
    p.castShadow = true;
    p.receiveShadow = true;
    root.add(p);
  }

  const header = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.46, 0.46), stoneMat);
  header.position.set(0, 1.54, 0);
  header.castShadow = true;
  header.receiveShadow = true;
  root.add(header);

  const door = new THREE.Mesh(new THREE.BoxGeometry(1.16, 1.34, 0.12), woodMat);
  door.position.set(0, 0.67, -0.10);
  door.receiveShadow = true;
  root.add(door);

  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 1.34, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x452815, roughness: 0.9 }),
  );
  seam.position.set(0, 0.67, -0.09);
  root.add(seam);

  for (const sx of [-0.14, 0.14]) {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), brassMat);
    knob.position.set(sx, 0.62, -0.02);
    root.add(knob);
  }

  const roofShape = new THREE.Shape();
  roofShape.moveTo(-1.42, 0);
  roofShape.lineTo(0, 0.92);
  roofShape.lineTo(1.42, 0);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 0.84, bevelEnabled: false });
  roofGeo.translate(0, 0, -0.42);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(0, 1.72, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  root.add(roof);

  const pedShape = new THREE.Shape();
  pedShape.moveTo(-1.05, 0);
  pedShape.lineTo(0, 0.68);
  pedShape.lineTo(1.05, 0);
  pedShape.closePath();
  const ped = new THREE.Mesh(
    new THREE.ShapeGeometry(pedShape),
    new THREE.MeshStandardMaterial({ color: 0x8f5932, roughness: 0.88 }),
  );
  ped.position.set(0, 1.72, 0.43);
  root.add(ped);

  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), brassMat);
  diamond.scale.set(1, 1, 0.3);
  diamond.position.set(0, 2.02, 0.46);
  root.add(diamond);

  const eave = new THREE.Mesh(new THREE.BoxGeometry(2.88, 0.05, 0.88), trimMat);
  eave.position.set(0, 1.71, 0);
  root.add(eave);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 6), woodMat);
  pole.position.set(0, 2.88, 0);
  root.add(pole);

  const flag = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.44, 3),
    new THREE.MeshStandardMaterial({ color: 0xd93f32, roughness: 0.75 }),
  );
  flag.rotation.z = -Math.PI / 2;
  flag.position.set(0.22, 3.04, 0);
  root.add(flag);

  for (const sx of [-1.06, 1.06]) {
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.24, 6), lanternMat);
    lantern.position.set(sx, 1.06, 0.22);
    root.add(lantern);
  }

  const bellPivot = new THREE.Group();
  bellPivot.position.set(0, 1.38, 0.14);

  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6), brassMat);
  cord.position.y = -0.11;
  bellPivot.add(cord);

  const bellProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.08, -0.02),
    new THREE.Vector2(0.15, -0.16),
    new THREE.Vector2(0.24, -0.32),
    new THREE.Vector2(0.18, -0.34),
  ];
  const bellMesh = new THREE.Mesh(new THREE.LatheGeometry(bellProfile, 14), brassMat);
  bellMesh.position.y = -0.16;
  bellMesh.castShadow = true;
  bellPivot.add(bellMesh);

  const roseRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.036, 10, 28), roseRingMat);
  roseRing.position.set(0, -0.34, 0.04);
  bellPivot.add(roseRing);

  root.add(bellPivot);
  return { root, bellPivot, roseRingMat, lanternMat, flag };
}

function buildFoldedMountain(width: number, height: number, hexLight: number, hexShade: number): THREE.Group {
  const g = new THREE.Group();
  const depth = 0.22;
  const halfW = width * 0.5;

  const leftShape = new THREE.Shape();
  leftShape.moveTo(-halfW, 0);
  leftShape.lineTo(0, height);
  leftShape.lineTo(0, 0);
  leftShape.closePath();
  const leftGeo = new THREE.ExtrudeGeometry(leftShape, { depth, bevelEnabled: false });
  leftGeo.translate(0, 0, -depth * 0.5);
  const leftMesh = new THREE.Mesh(
    leftGeo,
    new THREE.MeshStandardMaterial({ color: hexLight, roughness: 0.9, flatShading: true }),
  );
  leftMesh.castShadow = true;
  leftMesh.receiveShadow = true;
  g.add(leftMesh);

  const rightShape = new THREE.Shape();
  rightShape.moveTo(0, 0);
  rightShape.lineTo(0, height);
  rightShape.lineTo(halfW, 0);
  rightShape.closePath();
  const rightGeo = new THREE.ExtrudeGeometry(rightShape, { depth, bevelEnabled: false });
  rightGeo.translate(0, 0, -depth * 0.5);
  const rightMesh = new THREE.Mesh(
    rightGeo,
    new THREE.MeshStandardMaterial({ color: hexShade, roughness: 0.92, flatShading: true }),
  );
  rightMesh.castShadow = true;
  rightMesh.receiveShadow = true;
  g.add(rightMesh);

  return g;
}

function buildPaperCloud(scale: number): THREE.Group {
  const g = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf4ebd2, roughness: 0.92 });
  const rodMat = new THREE.MeshStandardMaterial({ color: 0xbda782, roughness: 0.85 });

  for (const [x, y, r] of [
    [-0.36, 0, 0.22],
    [-0.1, 0.14, 0.28],
    [0.2, 0.1, 0.25],
    [0.42, -0.02, 0.18],
  ] as const) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * scale, r * scale, 0.06 * scale, 12), cloudMat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x * scale, y * scale, 0);
    m.castShadow = true;
    g.add(m);
  }
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * scale, 0.018 * scale, 1.3 * scale, 6), rodMat);
  rod.position.set(0, -0.65 * scale, -0.02);
  g.add(rod);
  return g;
}

export class StorybookSetpiece3D {
  readonly group = new THREE.Group();

  private readonly domeMat: THREE.ShaderMaterial;
  private readonly pageMat: THREE.MeshStandardMaterial;
  private readonly spreadTextures = new Map<string, THREE.CanvasTexture>();
  private readonly popupRoot = new THREE.Group();
  private readonly gate: ReturnType<typeof buildLanternGatehouse>;
  private readonly sunGroup: THREE.Group;
  private readonly sunCoreMat: THREE.MeshStandardMaterial;
  private readonly sunRingMat: THREE.MeshStandardMaterial;
  private readonly clouds: THREE.Group[] = [];
  private readonly birds: THREE.Group[] = [];

  // Real 3D Vertex-Curled Animated Page-Turn Leaf
  private readonly leafMesh: THREE.Mesh;
  private readonly leafGeo: THREE.PlaneGeometry;
  private readonly leafBaseU: Float32Array;
  private readonly leafBaseZ: Float32Array;

  private readonly disposables: { dispose(): void }[] = [];
  private currentSongTitle = "";
  private currentSceneIndex = -1;
  private turnElapsed = STORYBOOK_TURN_SEC;
  private turnDirection: 1 | -1 = 1;

  constructor() {
    // 1. Warm Arched Study-Lamp Backdrop Dome (`SphereGeometry(38, 32, 18)` BackSide)
    this.domeMat = createStorybookStudyDomeMaterial();
    this.disposables.push(this.domeMat);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(38, 32, 18), this.domeMat);
    dome.renderOrder = 1;
    this.group.add(dome);

    // 2. Lit Wooden Studio Workbench Tabletop (`receiveShadow = true`)
    const walnutTex = createWalnutWorkbenchTexture();
    if (walnutTex) this.disposables.push(walnutTex);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0xb98a64,
      map: walnutTex,
      roughness: 0.72,
      metalness: 0.06,
    });
    const table = new THREE.Mesh(new THREE.BoxGeometry(36, 0.4, 24), tableMat);
    table.position.set(0, -0.34, -0.6);
    table.receiveShadow = true;
    this.group.add(table);

    // Practical studio desk dressing at far edges (stacked bound books & brass pencil cup)
    const propBookMatA = new THREE.MeshStandardMaterial({ color: 0x2c4e4a, roughness: 0.78 });
    const propBookMatB = new THREE.MeshStandardMaterial({ color: 0x733029, roughness: 0.8 });
    const stackBookA = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.24, 2.25), propBookMatA);
    stackBookA.position.set(-6.15, -0.02, -2.55);
    stackBookA.rotation.y = 0.26;
    stackBookA.castShadow = true;
    stackBookA.receiveShadow = true;
    const stackBookB = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.20, 1.95), propBookMatB);
    stackBookB.position.set(-6.05, 0.20, -2.45);
    stackBookB.rotation.y = -0.14;
    stackBookB.castShadow = true;
    this.group.add(stackBookA, stackBookB);

    // 3. Physical Open Hardcover Storybook (`bookWidth = 9.6, bookDepth = 5.6`)
    const bookGroup = new THREE.Group();
    this.group.add(bookGroup);

    const coverTex = createPaperGrainTexture("#a93e2e", "#5e1c14", 7);
    if (coverTex) this.disposables.push(coverTex);
    const coverMat = new THREE.MeshStandardMaterial({
      color: 0xb24434,
      map: coverTex,
      roughness: 0.78,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xe6bc62,
      metalness: 0.75,
      roughness: 0.28,
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xf5ecd4, roughness: 0.9 });

    const coverBoard = new THREE.Mesh(
      new THREE.BoxGeometry(STORYBOOK_WIDTH + 0.35, 0.14, STORYBOOK_DEPTH + 0.32),
      coverMat,
    );
    coverBoard.position.y = -0.09;
    coverBoard.castShadow = true;
    coverBoard.receiveShadow = true;
    bookGroup.add(coverBoard);

    // 4 Brass Corner Protectors on hardcover corners
    const halfCoverX = (STORYBOOK_WIDTH + 0.35) * 0.5;
    const halfCoverZ = (STORYBOOK_DEPTH + 0.32) * 0.5;
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const capX = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.17, 0.12), brassMat);
        capX.position.set(sx * (halfCoverX - 0.21), -0.09, sz * (halfCoverZ - 0.04));
        const capZ = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.17, 0.46), brassMat);
        capZ.position.set(sx * (halfCoverX - 0.04), -0.09, sz * (halfCoverZ - 0.21));
        bookGroup.add(capX, capZ);
      }
    }

    // Thick curved page block with exact `pageSurfaceY` arch
    const initialTex = createBookSpreadTexture("STUDIO 404 FOLIO", 1, "OPENING");
    if (initialTex) this.spreadTextures.set("STUDIO 404 FOLIO|1", initialTex);
    const pageEdgeMat = new THREE.MeshStandardMaterial({ color: 0xddd0ad, roughness: 0.92 });
    this.pageMat = new THREE.MeshStandardMaterial({
      map: initialTex,
      roughness: 0.92,
    });

    const curvedGeo = createCurvedSpreadGeometry(STORYBOOK_SPREAD_W, STORYBOOK_SPREAD_D);
    const pageMesh = new THREE.Mesh(curvedGeo, [
      pageEdgeMat,
      pageEdgeMat,
      this.pageMat,
      pageEdgeMat,
      pageEdgeMat,
      pageEdgeMat,
    ]);
    pageMesh.castShadow = true;
    pageMesh.receiveShadow = true;
    bookGroup.add(pageMesh);

    // Crimson ribbon bookmark draping over front spine edge
    const ribbonShape = new THREE.Shape();
    ribbonShape.moveTo(-0.16, 0);
    ribbonShape.lineTo(0.16, 0);
    ribbonShape.lineTo(0.16, -0.66);
    ribbonShape.lineTo(0, -0.46);
    ribbonShape.lineTo(-0.16, -0.66);
    ribbonShape.closePath();
    const ribbon = new THREE.Mesh(
      new THREE.ExtrudeGeometry(ribbonShape, { depth: 0.03, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0xc23e32, roughness: 0.76 }),
    );
    ribbon.position.set(0, 0.02, STORYBOOK_DEPTH * 0.5 + 0.14);
    ribbon.rotation.x = -0.24;
    ribbon.castShadow = true;
    bookGroup.add(ribbon);

    // 4. Real 3D Vertex-Curled Animated Page-Turn Leaf (`PlaneGeometry(4.65, 5.3, 20, 6)`)
    this.leafGeo = new THREE.PlaneGeometry(STORYBOOK_LEAF_W, STORYBOOK_LEAF_D, 20, 6);
    this.leafGeo.rotateX(-Math.PI / 2);
    this.leafGeo.translate(STORYBOOK_LEAF_W * 0.5, 0, 0); // Hinge at spine `x = 0`!
    const pos = this.leafGeo.attributes.position;
    this.leafBaseU = new Float32Array(pos.count);
    this.leafBaseZ = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      this.leafBaseU[i] = pos.getX(i) / STORYBOOK_LEAF_W;
      this.leafBaseZ[i] = pos.getZ(i);
    }
    const leafTex = createPaperGrainTexture("#efe4c5", "#b89c72", 19);
    if (leafTex) this.disposables.push(leafTex);
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0xf7edd2,
      map: leafTex,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    this.leafMesh = new THREE.Mesh(this.leafGeo, leafMat);
    this.leafMesh.castShadow = true;
    this.leafMesh.receiveShadow = true;
    this.leafMesh.visible = false;
    bookGroup.add(this.leafMesh);

    // 5. Hinged 3D Folded Cardstock Pop-Up Scenery (`popupRoot`)
    bookGroup.add(this.popupRoot);

    // Hero 3D Lantern Gatehouse centered upstage (`x = 0, z = -1.65`)
    this.gate = buildLanternGatehouse(trimMat);
    this.gate.root.position.set(0, pageSurfaceY(0, STORYBOOK_WIDTH), -1.65);
    this.popupRoot.add(this.gate.root);

    // Layered Folded Mountain Peaks flanking behind the stage wings
    for (const [mx, mz, w, h, lHex, sHex] of [
      [-2.85, -2.02, 2.2, 2.15, 0x528279, 0x39625b],
      [-1.55, -2.14, 1.7, 1.60, 0x45736b, 0x2e534d],
      [2.85, -2.02, 2.2, 2.10, 0x5d8d83, 0x426d65],
      [1.65, -2.16, 1.6, 1.50, 0x45736b, 0x2e534d],
    ] as const) {
      const mtn = buildFoldedMountain(w, h, lHex, sHex);
      mtn.position.set(mx, pageSurfaceY(mx, STORYBOOK_WIDTH), mz);
      this.popupRoot.add(mtn);
    }

    // Glowing Cut-Paper Cyan-Gold Sun Medallion on brass wire rod behind peaks
    this.sunGroup = new THREE.Group();
    this.sunGroup.position.set(-2.15, 2.75, -2.25);
    this.sunCoreMat = new THREE.MeshStandardMaterial({
      color: 0xf2c95c,
      emissive: 0xeba934,
      emissiveIntensity: 0.9,
      roughness: 0.48,
    });
    const sunCore = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.07, 24), this.sunCoreMat);
    sunCore.rotation.x = Math.PI / 2;
    this.sunGroup.add(sunCore);

    this.sunRingMat = new THREE.MeshStandardMaterial({
      color: 0x5cebf7,
      emissive: 0x3ce6f5,
      emissiveIntensity: 1.0,
      roughness: 0.25,
    });
    const sunRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 10, 28), this.sunRingMat);
    this.sunGroup.add(sunRing);

    const sunRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 2.4, 6),
      new THREE.MeshStandardMaterial({ color: 0xbda782, roughness: 0.8 }),
    );
    sunRod.position.set(0, -1.25, -0.04);
    this.sunGroup.add(sunRod);
    this.popupRoot.add(this.sunGroup);

    // Miniature Folded Hillside Cottages with glowing amber windows (clear of performers!)
    const cottageL = buildPaperCottage(1.05, trimMat);
    cottageL.position.set(-3.35, pageSurfaceY(-3.35, STORYBOOK_WIDTH), -0.95);
    cottageL.rotation.y = 0.34;
    this.popupRoot.add(cottageL);

    const cottageR = buildPaperCottage(0.92, trimMat);
    cottageR.position.set(3.42, pageSurfaceY(3.42, STORYBOOK_WIDTH), -1.02);
    cottageR.rotation.y = -0.36;
    this.popupRoot.add(cottageR);

    // Multi-tier Folded Paper Pine Trees framing left & right borders
    const pineSpecs: readonly [number, number, number, number][] = [
      [-4.02, 0.52, 1.12, 0x265441],
      [-3.68, -0.25, 0.92, 0x31664f],
      [-3.52, 1.38, 0.82, 0x2a5c47],
      [-2.18, -1.52, 0.88, 0x356c54],
      [2.18, -1.52, 0.92, 0x285844],
      [3.65, -0.22, 1.06, 0x265441],
      [4.05, 0.65, 1.15, 0x2a5c47],
      [3.48, 1.42, 0.78, 0x356c54],
    ];
    for (const [px, pz, sc, col] of pineSpecs) {
      const pine = buildPaperPine(sc, col, trimMat);
      pine.position.set(px, pageSurfaceY(px, STORYBOOK_WIDTH), pz);
      this.popupRoot.add(pine);
    }

    // Cut-Paper Clouds on wire rods + Origami Paper Swallows
    const cloudA = buildPaperCloud(0.88);
    cloudA.position.set(-3.2, 2.55, -1.95);
    this.popupRoot.add(cloudA);
    const cloudB = buildPaperCloud(0.95);
    cloudB.position.set(2.95, 2.75, -1.85);
    this.popupRoot.add(cloudB);
    this.clouds.push(cloudA, cloudB);

    const birdMat = new THREE.MeshStandardMaterial({ color: 0x4ca1b5, roughness: 0.82, side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) {
      const bg = new THREE.Group();
      const wingGeo = new THREE.ConeGeometry(0.11, 0.40, 3);
      const wL = new THREE.Mesh(wingGeo, birdMat);
      wL.rotation.z = Math.PI * 0.42;
      wL.position.x = -0.13;
      const wR = new THREE.Mesh(wingGeo, birdMat);
      wR.rotation.z = -Math.PI * 0.42;
      wR.position.x = 0.13;
      bg.add(wL, wR);
      bg.position.set(i === 0 ? -1.4 : 1.5, 2.55 - i * 0.15, -1.6);
      this.popupRoot.add(bg);
      this.birds.push(bg);
    }
  }

  /**
   * Real curved-page surface query returning exact `pageSurfaceY(x, 9.6)` + surface normal (`surfaceId: "book"`)
   * across the open spread (`x ∈ [-4.65, +4.65], z ∈ [-2.65, +2.65]`), or floor `0` outside.
   */
  getSurfaceAt(x: number, z: number): SurfaceSample | null {
    if (Math.abs(x) <= STORYBOOK_SPREAD_W * 0.5 && Math.abs(z) <= STORYBOOK_SPREAD_D * 0.5) {
      const { nx, ny } = pageSurfaceNormal(x, STORYBOOK_WIDTH);
      return {
        y: pageSurfaceY(x, STORYBOOK_WIDTH),
        normalX: nx,
        normalY: ny,
        normalZ: 0,
        surfaceId: "book",
      };
    }
    return {
      y: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      surfaceId: "floor",
    };
  }

  private applyPageTurnCurl(progress: number): void {
    const p = clamp(progress, 0, 1);
    if (p >= 0.999) {
      this.leafMesh.visible = false;
      return;
    }
    this.leafMesh.visible = true;
    const t = this.turnDirection >= 0 ? p : 1 - p;
    const baseTheta = smoothstep(0, 1, t) * Math.PI;
    const sinBase = Math.sin(baseTheta);

    const pos = this.leafGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = this.leafBaseU[i];
      const z = this.leafBaseZ[i];
      const lag = sinBase * (0.44 * u * u + 0.14 * Math.sin(u * Math.PI) - (z / 2.65) * 0.07);
      const theta = clamp(baseTheta - lag, 0.008, Math.PI - 0.008);
      const r = u * STORYBOOK_LEAF_W;
      const px = r * Math.cos(theta);
      const py =
        pageSurfaceY(px, STORYBOOK_WIDTH) +
        r * Math.sin(theta) * 0.84 +
        sinBase * 0.14 * Math.sin(u * Math.PI) +
        0.014;
      pos.setXYZ(i, px, py, z);
    }
    pos.needsUpdate = true;
    this.leafGeo.computeVertexNormals();
  }

  update(params: StorybookUpdateParams): void {
    const {
      timeSec,
      dt,
      beat,
      voiceEnergy,
      songTitle,
      sceneIndex,
      sectionName,
      lightingEnabled,
      lightingMood,
    } = params;

    // 1. Update open-book artwork strictly when songTitle or sceneIndex changes
    const spreadKey = `${songTitle}|${sceneIndex}`;
    let spreadTex = this.spreadTextures.get(spreadKey);
    if (!spreadTex) {
      spreadTex = createBookSpreadTexture(songTitle, sceneIndex, sectionName) ?? undefined;
      if (spreadTex) {
        if (this.spreadTextures.size > 16) {
          const oldest = this.spreadTextures.keys().next().value;
          if (oldest) {
            this.spreadTextures.get(oldest)?.dispose();
            this.spreadTextures.delete(oldest);
          }
        }
        this.spreadTextures.set(spreadKey, spreadTex);
      }
    }
    if (spreadTex && this.pageMat.map !== spreadTex) {
      this.pageMat.map = spreadTex;
      this.pageMat.needsUpdate = true;
    }

    // 2. Trigger real 3D vertex-curled page turn + pop-up fold on sceneIndex changes within song
    if (songTitle !== this.currentSongTitle) {
      this.currentSongTitle = songTitle;
      this.currentSceneIndex = sceneIndex;
      this.turnElapsed = STORYBOOK_TURN_SEC;
    } else if (sceneIndex !== this.currentSceneIndex) {
      this.turnDirection = sceneIndex >= this.currentSceneIndex ? 1 : -1;
      this.currentSceneIndex = sceneIndex;
      this.turnElapsed = 0;
    } else if (this.turnElapsed < STORYBOOK_TURN_SEC) {
      this.turnElapsed = Math.min(STORYBOOK_TURN_SEC, this.turnElapsed + clamp(dt, 0.001, 0.05));
    }

    const turnProgress = clamp(this.turnElapsed / STORYBOOK_TURN_SEC, 0, 1);
    this.applyPageTurnCurl(turnProgress);

    // Pop-up cardstock scenery unfolds with `backOut` on chapter turns, resting at 1.0
    const foldY = turnProgress >= 0.999 ? 1 : lerp(0.16, 1, backOut(turnProgress));
    this.popupRoot.scale.y = Math.max(0.08, foldY);

    // 3. Mood-responsive lighting & practical details
    const darkAmt = lightingMood === "standby-dark" ? 0.72 : lightingMood === "phosphor-booth" ? 0.48 : 0.0;
    const tint = this.domeMat.uniforms.uMoodTint.value as THREE.Vector3;
    if (lightingMood === "phosphor-booth") tint.set(0.68, 0.98, 1.10);
    else if (lightingMood === "encore-surge") tint.set(1.12, 1.02, 0.92);
    else if (lightingMood === "arena-lit") tint.set(1.06, 1.04, 1.0);
    else tint.set(1, 1, 1);

    this.domeMat.uniforms.uEnergy.value = voiceEnergy;
    this.domeMat.uniforms.uDarkness.value = darkAmt;
    this.domeMat.uniforms.uLit.value = lightingEnabled ? 1 : 0;

    this.pageMat.color.setHex(
      lightingMood === "standby-dark" ? 0xaab4c8 : lightingMood === "phosphor-booth" ? 0xd2e8ee : 0xffffff,
    );

    // Swinging Brass Bell + Glowing Lanterns + Sun Medallion
    const bellSwing = Math.sin(beat * Math.PI * 0.5) * (0.04 + voiceEnergy * 0.18);
    this.gate.bellPivot.rotation.z = bellSwing;
    this.gate.roseRingMat.emissive.set(
      lightingMood === "phosphor-booth" ? "#57f2da" : lightingMood === "encore-surge" ? "#ffd27a" : "#ff4286",
    );
    this.gate.roseRingMat.emissiveIntensity = 0.55 + voiceEnergy * 1.45;
    this.gate.lanternMat.emissiveIntensity = lerp(0.95, 1.75, darkAmt) + voiceEnergy * 0.45;

    this.sunGroup.position.y = lerp(2.75, 1.85, darkAmt) + voiceEnergy * 0.22;
    this.sunCoreMat.emissiveIntensity = lerp(0.85, 0.25, darkAmt) + voiceEnergy * 0.55;
    this.sunRingMat.emissiveIntensity = 0.55 + voiceEnergy * 1.25;

    // Gentle cloud & origami swallow progression
    const drift = Math.sin(timeSec * 0.35) * 0.28;
    this.clouds[0].position.x = -3.2 + drift;
    this.clouds[1].position.x = 2.95 - drift;
    this.birds[0].position.y = 2.55 + Math.sin(timeSec * 1.4) * 0.08;
    this.birds[1].position.y = 2.40 + Math.cos(timeSec * 1.6) * 0.08;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.spreadTextures.forEach((t) => t.dispose());
    this.spreadTextures.clear();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
