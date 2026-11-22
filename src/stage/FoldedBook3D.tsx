/**
 * Real Three.js 3D Pop-Up Tabletop Storybook Diorama for Neon ("The Folded Songbook").
 *
 * Built with authored procedural paper-craft geometry, canvas rag-paper textures,
 * PCFSoftShadowMap tabletop lighting, ACESFilmicToneMapping, and Motion-Doctrine
 * choreographed camera-with-intent (zero CSS transitions, zero idle wobble, 100%
 * deterministic from `beat` & `state` for both Live Puppets and Remotion export).
 *
 * Uses Neon's EXISTING keyed 48-frame crimson-scarf rig (`/rehearsal/pins/neon/*.webp`)
 * or any S-27 sliced Flow FMV manifest atlas directly as a shadow-casting 3D standee.
 */
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import type { WorldState } from "./worlds.ts";

export interface FoldedBook3DProps {
  state: WorldState;
  beat: number;
  userOrbit: { azimuth: number; elevation: number } | null;
  bellImpulse: number;
  resolveAsset: (path: string) => string;
  motionSeconds?: number;
  tabbyWalk?: boolean;
}

// Reviewed Neon step: eight transparent cels in row-major order.
const NEON_STEP = { atlasUrl: "/rehearsal/performances/neon/step.webp", cols: 4, rows: 2, frames: 8, fps: 8 };
const TABBY_WALK = { atlasUrl: "/rehearsal/performances/tabby/walk-right.webp", cols: 4, rows: 2, frames: 8, fps: 12 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** Motion-doctrine back.out(1.5) pop-up fold curve */
const backOut = (t: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  const u = clamp01(t) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

/** Procedural matte paper grain canvas texture (zero external downloads). */
function createPaperGrainTexture(baseHex: string, speckHex: string, seed = 1): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);
  let s = seed * 9301 + 49297;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  ctx.fillStyle = speckHex;
  for (let i = 0; i < 2400; i++) {
    ctx.globalAlpha = 0.03 + rand() * 0.06;
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Illustrated open-book top spread texture (cream borders, meadow turf, winding path, plate stamps). */
function createBookSpreadTexture(stampLeft: string, stampRight: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 640;
  const ctx = c.getContext("2d")!;

  // Warm archival rag-paper margin
  ctx.fillStyle = "#ebe0c0";
  ctx.fillRect(0, 0, 1024, 640);

  // Subtle paper fibers
  for (let i = 0; i < 3000; i++) {
    const x = ((i * 73) % 1024);
    const y = ((i * 197) % 640);
    ctx.fillStyle = i % 2 === 0 ? "rgba(120,96,64,0.035)" : "rgba(255,250,235,0.05)";
    ctx.fillRect(x, y, 2, 2);
  }

  // Printed page border rule
  ctx.strokeStyle = "rgba(130, 108, 76, 0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, 976, 592);

  // Cut-paper meadow polygon (warm sage/moss greens with scalloped hillside edge)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(64, 530);
  ctx.lineTo(74, 155);
  ctx.quadraticCurveTo(280, 96, 512, 148);
  ctx.quadraticCurveTo(750, 98, 948, 155);
  ctx.lineTo(958, 530);
  ctx.quadraticCurveTo(740, 548, 512, 524);
  ctx.quadraticCurveTo(280, 548, 64, 530);
  ctx.closePath();
  const meadowGrad = ctx.createLinearGradient(0, 110, 0, 540);
  meadowGrad.addColorStop(0, "#8ea970");
  meadowGrad.addColorStop(0.55, "#b3c283");
  meadowGrad.addColorStop(1, "#c9cf93");
  ctx.fillStyle = meadowGrad;
  ctx.fill();
  ctx.strokeStyle = "#f4ecd4";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  // Illustrated winding sandstone footpath crossing the book spine
  ctx.save();
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(210, 495);
  ctx.bezierCurveTo(255, 395, 365, 365, 512, 398);
  ctx.bezierCurveTo(645, 428, 720, 380, 685, 290);
  ctx.strokeStyle = "#e8d7ad";
  ctx.lineWidth = 48;
  ctx.stroke();
  ctx.strokeStyle = "#d3be8d";
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 10]);
  ctx.stroke();
  ctx.restore();

  // Soft center spine gutter shading + stitched binding thread ticks
  const gutter = ctx.createLinearGradient(476, 0, 548, 0);
  gutter.addColorStop(0, "rgba(74,56,34,0)");
  gutter.addColorStop(0.47, "rgba(62,46,28,0.22)");
  gutter.addColorStop(0.5, "rgba(42,30,18,0.42)");
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

  // Printed editorial stamps at page bottom corners
  ctx.fillStyle = "rgba(104, 86, 58, 0.78)";
  ctx.font = "600 18px ui-monospace, 'JetBrains Mono', monospace";
  ctx.letterSpacing = "3px";
  ctx.textAlign = "left";
  ctx.fillText(stampLeft, 58, 592);
  ctx.textAlign = "right";
  ctx.fillText(stampRight, 966, 592);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Gently arched open-book page geometry so pages curve naturally into the spine gutter. */
function createCurvedSpreadGeometry(width: number, depth: number, thickness: number): THREE.BufferGeometry {
  const segX = 48;
  const segZ = 16;
  const geo = new THREE.BoxGeometry(width, thickness, depth, segX, 1, segZ);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const norm = Math.abs(x) / (width * 0.5); // 0 at spine, 1 at outer page edge
    // Smooth book-page arch: dips cleanly at spine, rises gently mid-page, settles at outer edge
    const arch = Math.sin(norm * Math.PI * 0.88) * 0.24 - (1 - Math.min(1, norm * 4.5)) * 0.14;
    pos.setY(i, y + arch);
  }
  geo.computeVertexNormals();
  return geo;
}

function pageSurfaceY(x: number, bookWidth: number): number {
  const norm = Math.min(1, Math.abs(x) / (bookWidth * 0.5));
  const arch = Math.sin(norm * Math.PI * 0.88) * 0.24 - (1 - Math.min(1, norm * 4.5)) * 0.14;
  return 0.16 + arch;
}

/** Layered low-poly folded paper pine tree casting crisp oblique tabletop shadows. */
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

  const tiers = [
    { r: 0.44, h: 0.62, y: 0.52 },
    { r: 0.35, h: 0.56, y: 0.88 },
    { r: 0.24, h: 0.48, y: 1.22 },
  ];
  for (const t of tiers) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(t.r * scale, t.h * scale, 6), leafMat);
    cone.position.y = t.y * scale;
    cone.castShadow = true;
    cone.receiveShadow = true;
    g.add(cone);

    // Crisp cream cut-paper rim band
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(t.r * scale * 1.01, t.r * scale * 1.03, 0.025 * scale, 6),
      trimMat,
    );
    rim.position.y = (t.y - t.h * 0.48) * scale;
    g.add(rim);
  }
  return g;
}

/** Miniature folded cardstock hillside cottage with glowing amber window. */
function buildPaperCottage(scale: number, trimMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xede2c4, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xc24836, roughness: 0.85, flatShading: true });
  const winMat = new THREE.MeshStandardMaterial({
    color: 0xffd27a,
    emissive: 0xffb347,
    emissiveIntensity: 0.65,
    roughness: 0.4,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62 * scale, 0.46 * scale, 0.54 * scale), wallMat);
  body.position.y = 0.23 * scale;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Gable pitched roof via 4-sided pyramid stretched along Z
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-0.42 * scale, 0);
  roofShape.lineTo(0, 0.36 * scale);
  roofShape.lineTo(0.42 * scale, 0);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
    depth: 0.66 * scale,
    bevelEnabled: false,
  });
  roofGeo.translate(0, 0, -0.33 * scale);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = 0.44 * scale;
  roof.castShadow = true;
  g.add(roof);

  // Cream front gable trim
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.66 * scale, 0.03 * scale, 0.58 * scale), trimMat);
  trim.position.y = 0.46 * scale;
  g.add(trim);

  // Glowing front window
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.14 * scale, 0.16 * scale), winMat);
  win.position.set(0, 0.24 * scale, 0.275 * scale);
  g.add(win);

  return g;
}

/** Hero 3D Lantern Gatehouse with stone-paper arch, red shingled roof, pennant, lanterns & swinging rose/brass bell. */
function buildLanternGatehouse(trimMat: THREE.Material) {
  const root = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xcab895, roughness: 0.92, flatShading: true });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4b2a, roughness: 0.88 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xc44332, roughness: 0.82, flatShading: true });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xf2c55c,
    emissive: 0xd99b26,
    emissiveIntensity: 0.3,
    metalness: 0.45,
    roughness: 0.35,
  });
  const roseRingMat = new THREE.MeshStandardMaterial({
    color: 0xff5e99,
    emissive: 0xff4286,
    emissiveIntensity: 1.3,
    roughness: 0.25,
  });
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffdc80,
    emissive: 0xffae33,
    emissiveIntensity: 1.1,
    roughness: 0.3,
  });

  // Left & Right thick cardstock stone pillars
  const pillarGeo = new THREE.BoxGeometry(0.46, 1.52, 0.42);
  const leftPillar = new THREE.Mesh(pillarGeo, stoneMat);
  leftPillar.position.set(-0.78, 0.76, 0);
  leftPillar.castShadow = true;
  leftPillar.receiveShadow = true;
  root.add(leftPillar);

  const rightPillar = new THREE.Mesh(pillarGeo, stoneMat);
  rightPillar.position.set(0.78, 0.76, 0);
  rightPillar.castShadow = true;
  rightPillar.receiveShadow = true;
  root.add(rightPillar);

  // Arch lintel header
  const header = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.46, 0.46), stoneMat);
  header.position.set(0, 1.54, 0);
  header.castShadow = true;
  header.receiveShadow = true;
  root.add(header);

  // Recessed timber double doors inside the gate
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.16, 1.34, 0.12), woodMat);
  door.position.set(0, 0.67, -0.1);
  door.receiveShadow = true;
  root.add(door);

  // Door brass knobs & vertical timber seam
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.34, 0.14), new THREE.MeshStandardMaterial({ color: 0x452815, roughness: 0.9 }));
  seam.position.set(0, 0.67, -0.09);
  root.add(seam);
  for (const sx of [-0.14, 0.14]) {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), brassMat);
    knob.position.set(sx, 0.62, -0.02);
    root.add(knob);
  }

  // Dramatic pitched terracotta cardstock gable roof
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

  // Cream cut-paper gable pediment infill + brass diamond crest
  const pedShape = new THREE.Shape();
  pedShape.moveTo(-1.05, 0);
  pedShape.lineTo(0, 0.68);
  pedShape.lineTo(1.05, 0);
  pedShape.closePath();
  const ped = new THREE.Mesh(new THREE.ShapeGeometry(pedShape), new THREE.MeshStandardMaterial({ color: 0x8f5932, roughness: 0.88 }));
  ped.position.set(0, 1.72, 0.43);
  root.add(ped);

  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), brassMat);
  diamond.scale.set(1, 1, 0.3);
  diamond.position.set(0, 2.02, 0.46);
  root.add(diamond);

  // White paper eaves strip
  const eave = new THREE.Mesh(new THREE.BoxGeometry(2.88, 0.05, 0.88), trimMat);
  eave.position.set(0, 1.71, 0);
  root.add(eave);

  // Roof flagpole + fluttering red pennant
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

  // Twin side hanging wall lanterns
  for (const sx of [-1.06, 1.06]) {
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.24, 6), lanternMat);
    lantern.position.set(sx, 1.06, 0.22);
    root.add(lantern);
  }

  // Swinging Brass Bell + Answering Rose Neon Filament Ring suspended in the archway
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

  // Glowing rose neon ring framing the brass bell (Neon's answering partner motif!)
  const roseRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.036, 10, 28), roseRingMat);
  roseRing.position.set(0, -0.34, 0.04);
  bellPivot.add(roseRing);

  root.add(bellPivot);

  return { root, bellPivot, roseRingMat, lanternMat, flag };
}

/** Scalloped cut-paper cloud mounted on a thin diorama dowel. */
function buildPaperCloud(scale: number): THREE.Group {
  const g = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf4ebd2, roughness: 0.92 });
  const rodMat = new THREE.MeshStandardMaterial({ color: 0xbda782, roughness: 0.85 });

  const puffs: [number, number, number][] = [
    [-0.36, 0, 0.22],
    [-0.1, 0.14, 0.28],
    [0.2, 0.1, 0.25],
    [0.42, -0.02, 0.18],
  ];
  for (const [x, y, r] of puffs) {
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

/** Layered folded cardstock mountain peak with lit/shaded facets and cream cut border. */
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

const MAX_STANDEES = 8;

interface StandeeSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

interface SceneHandles {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  keyLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  accentLightA: THREE.PointLight;
  accentLightB: THREE.PointLight;
  bookGroup: THREE.Group;
  popupPivot: THREE.Group;
  sunGroup: THREE.Group;
  sunCoreMat: THREE.MeshStandardMaterial;
  sunRingMat: THREE.MeshStandardMaterial;
  gate: ReturnType<typeof buildLanternGatehouse>;
  standees: StandeeSlot[];
  pageMat: THREE.MeshStandardMaterial;
  spreadTextures: Map<string, THREE.CanvasTexture>;
  atlasTextures: Map<string, THREE.Texture>;
  loader: THREE.TextureLoader;
  clouds: THREE.Group[];
  birds: THREE.Group[];
}

export const FoldedBook3D: React.FC<FoldedBook3DProps> = ({
  state,
  beat,
  userOrbit,
  bellImpulse,
  resolveAsset,
  motionSeconds,
  tabbyWalk,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<SceneHandles | null>(null);
  const latestPropsRef = useRef({ state, beat, userOrbit, bellImpulse, resolveAsset, motionSeconds, tabbyWalk });
  latestPropsRef.current = { state, beat, userOrbit, bellImpulse, resolveAsset, motionSeconds, tabbyWalk };

  const renderNow = () => {
    const h = handlesRef.current;
    if (!h) return;
    const { state: st, beat: b, userOrbit: orbit, bellImpulse: chime, resolveAsset: resolveUrl } = latestPropsRef.current;

    const { motionSeconds: seconds } = latestPropsRef.current;
    if (hostRef.current) delete hostRef.current.dataset.castMotion;
    const loadAtlas = (url: string) => {
      let texture = h.atlasTextures.get(url);
      if (!texture) {
        texture = h.loader.load(url, () => renderNow(), undefined, () => {});
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        h.atlasTextures.set(url, texture);
      }
      return texture;
    };

    // 1. Dynamic open-book spread stamp texture for the current song & plate
    const spreadKey = `${st.plate.stampLeft}|${st.plate.stampRight}`;
    let desiredSpread = h.spreadTextures.get(spreadKey);
    if (!desiredSpread) {
      desiredSpread = createBookSpreadTexture(st.plate.stampLeft, st.plate.stampRight);
      h.spreadTextures.set(spreadKey, desiredSpread);
    }
    if (h.pageMat.map !== desiredSpread) {
      h.pageMat.map = desiredSpread;
      h.pageMat.needsUpdate = true;
    }

    // 2. Motion-Doctrine Camera With Intent (NO idle sine wobble — smooth act choreography!)
    const actProgress = clamp01((b - st.plate.startBeat) / Math.max(4, st.plate.endBeat - st.plate.startBeat));
    const castCount = Math.max(1, Math.min(MAX_STANDEES, st.cast.length));
    const ensembleBackoff = castCount >= 3 ? 0.9 : 0;
    let targetAzimuth = 0;
    let targetElevation = 0.42;
    let targetDist = 13.5 + ensembleBackoff;
    let targetLookX = 0;

    if (st.plateIndex === 0) {
      targetAzimuth = lerp(-0.1, 0.08, smoothstep(0, 1, actProgress));
      targetElevation = lerp(0.45, 0.4, smoothstep(0, 1, actProgress));
      targetDist = lerp(13.8 + ensembleBackoff, 12.9 + ensembleBackoff, smoothstep(0, 1, actProgress));
      targetLookX = castCount === 1 ? lerp(-0.15, -0.35, smoothstep(0, 1, actProgress)) : 0;
    } else if (st.plateIndex === 1) {
      targetAzimuth = lerp(0.12, -0.12, smoothstep(0, 1, actProgress));
      targetElevation = 0.4;
      targetDist = 12.9 + ensembleBackoff;
      targetLookX = lerp(-0.2, 0.2, smoothstep(0, 1, actProgress));
    } else if (st.plateIndex === 2) {
      targetAzimuth = lerp(-0.07, 0.04, smoothstep(0.55, 1, actProgress));
      targetElevation = 0.36;
      targetDist = lerp(12.8 + ensembleBackoff, 12.1 + ensembleBackoff, smoothstep(0, 0.45, actProgress));
      targetLookX = lerp(-0.15, 0.12, smoothstep(0.5, 1, actProgress));
    } else {
      targetAzimuth = lerp(0.15, -0.1, smoothstep(0, 1, actProgress));
      targetElevation = lerp(0.4, 0.46, smoothstep(0, 1, actProgress));
      targetDist = lerp(12.9 + ensembleBackoff, 13.8 + ensembleBackoff, smoothstep(0, 1, actProgress));
      targetLookX = 0;
    }

    const az = orbit ? orbit.azimuth : targetAzimuth;
    const el = orbit ? orbit.elevation : targetElevation;
    h.camera.position.set(
      targetLookX + Math.sin(az) * Math.cos(el) * targetDist,
      Math.sin(el) * targetDist + 0.95,
      Math.cos(az) * Math.cos(el) * targetDist,
    );
    h.camera.lookAt(targetLookX, 1.05, 0.05);

    // 3. Causal Pop-Up Cardstock Unfold on Chapter Turn (always upright at rest; unfolds on live chapter turns)
    const isInitialRest = st.plateIndex === 0 && st.plateTurn < 0.02;
    const fold = isInitialRest || st.plateTurn >= 0.999 ? 1 : lerp(0.15, 1, backOut(st.plateTurn));
    h.popupPivot.scale.y = Math.max(0.08, fold);

    // 4. Lighting & Atmosphere Mood Shift tinted to the active cast's real accent palette
    const darkAmt = st.darkness;
    h.keyLight.intensity = lerp(2.45, 0.38, darkAmt);
    h.keyLight.color.setHex(darkAmt > 0.4 ? 0x7ea6d9 : 0xfff0d1);
    h.hemiLight.intensity = lerp(1.15, 0.34, darkAmt);
    h.pageMat.color.setHex(darkAmt > 0.4 ? 0x6f8299 : 0xffffff);

    h.accentLightA.color.set(st.primaryAccent);
    h.accentLightB.color.set(st.secondaryAccent);
    h.sunRingMat.color.set(st.primaryAccent);
    h.sunRingMat.emissive.set(st.primaryAccent);
    h.gate.roseRingMat.color.set(st.secondaryAccent);
    h.gate.roseRingMat.emissive.set(st.secondaryAccent);

    // Rising cut-paper Sun Disc behind the peaks
    h.sunGroup.position.y = lerp(2.85, 1.35, darkAmt) + st.energyA * 0.25;
    h.sunCoreMat.emissiveIntensity = lerp(0.85, 0.12, darkAmt) + st.energyA * 0.65;
    h.sunRingMat.emissiveIntensity = 0.55 + st.energyA * 1.4;

    // Swinging 3D Brass Bell & Accent Ring inside the Lantern Gate
    const bellSwing = Math.sin(b * Math.PI * 0.5 + chime * 1.9) * (0.04 + st.energyB * 0.22 + (st.sharedLight > 0.4 ? 0.14 : 0));
    h.gate.bellPivot.rotation.z = bellSwing;
    h.gate.roseRingMat.emissiveIntensity = 0.45 + st.energyB * 1.85 + st.sharedLight * 0.9;
    h.gate.lanternMat.emissiveIntensity = lerp(0.9, 1.65, darkAmt) + st.sharedLight * 0.5;

    // 5. Polymorphic N-Performer 3D Standee Staging (Solo hero, Duet pair, or Full Choir arc!)
    let leadX = -1.1;
    let leadZ = 0.72;
    let leadY = pageSurfaceY(leadX, 8.6);

    for (let idx = 0; idx < MAX_STANDEES; idx++) {
      const slot = h.standees[idx];
      const performer = st.cast[idx];
      if (!performer) {
        slot.mesh.visible = false;
        continue;
      }
      slot.mesh.visible = true;

      // Compute clean non-overlapping stage position on the open curved book
      let x = -1.25;
      let z = 0.78;
      let scale = 1.0;

      if (castCount === 1) {
        // Solo hero stands cleanly on the left-center winding paper road
        const travel = lerp(-1.55, -0.55, actProgress);
        x = travel;
        z = lerp(0.82, 0.58, actProgress);
        scale = 1.08;
      } else if (castCount === 2) {
        // Duet spans cleanly across the stitched spine
        x = idx === 0 ? -1.65 : 0.48;
        z = idx === 0 ? 0.85 : 0.92;
        scale = 0.96;
      } else {
        // Ensemble curved arc across both open pages (readable, grounded, zero overlap)
        const u = castCount > 1 ? idx / (castCount - 1) : 0.5;
        x = lerp(-2.75, 2.55, u);
        const arc = Math.sin(u * Math.PI);
        z = lerp(1.22, 0.45, arc) + (idx % 2 === 0 ? 0.12 : -0.06);
        scale = castCount >= 6 ? 0.68 : 0.78;
      }

      // Causal singing step-forward & lift (strictly driven by live vocal level, never idle wobble)
      const singLift = performer.singing ? 0.06 + performer.level * 0.14 : 0;
      const singPopZ = performer.singing ? 0.18 : 0;
      const groundY = pageSurfaceY(x, 8.6);
      const cardHeight = 2.42 * scale;
      slot.mesh.scale.set(scale, scale, 1);
      slot.mesh.position.set(x, groundY + cardHeight * 0.5 + singLift, z + singPopZ);

      if (performer.id === st.lead.id) {
        leadX = x;
        leadY = groundY;
        leadZ = z + singPopZ;
      }

      // Keep the existing standee while the reviewed atlas decodes.
      const action = performer.artKey === "neon" ? NEON_STEP
        : performer.artKey === "tabby" && latestPropsRef.current.tabbyWalk ? TABBY_WALK : undefined;
      const reviewedTexture = action && seconds !== undefined ? loadAtlas(resolveUrl(action.atlasUrl)) : undefined;
      const reviewed = reviewedTexture?.image ? action : undefined;
      const tex = reviewedTexture?.image ? reviewedTexture : loadAtlas(resolveUrl(performer.cel.atlasUrl));
      if (slot.mat.map !== tex) {
        slot.mat.map = tex;
        slot.mat.needsUpdate = true;
      }
      const { cols, rows } = reviewed ?? performer.cel;
      const frame = reviewed
        ? Math.floor(Math.max(0, seconds ?? 0) * reviewed.fps) % reviewed.frames
        : performer.cel.frame;
      if (reviewed && hostRef.current) hostRef.current.dataset.castMotion = `${performer.artKey}:${frame}`;
      const col = frame % cols;
      const row = Math.floor(frame / cols);
      tex.repeat.set(1 / cols, 1 / rows);
      tex.offset.set(col / cols, 1 - (row + 1) / rows);

      // Highlight the currently singing performer(s) subtly in emissive warmth
      slot.mat.emissive.set(performer.singing ? performer.color : "#000000");
      slot.mat.emissiveIntensity = performer.singing ? 0.14 + performer.level * 0.22 : 0;
    }

    // Dynamic Accent PointLights casting real colored light onto the paper diorama!
    h.accentLightA.position.set(leadX - 0.2, leadY + 1.9, leadZ + 0.95);
    h.accentLightA.intensity = 1.4 + st.energyA * 3.8 + (st.mouthOpen ? st.vocalLevel * 1.6 : 0);

    h.accentLightB.position.set(1.65, 1.55, 0.6);
    h.accentLightB.intensity = 1.2 + st.energyB * 3.2 + st.sharedLight * 2.8;

    // Subtle paper-bird & cloud progress tied to song progression (forward story travel, not sine wobble)
    h.birds[0].position.set(lerp(-3.2, -1.6, actProgress), 2.35 + actProgress * 0.2, -1.2);
    h.birds[1].position.set(lerp(-0.9, 0.5, actProgress), 2.25 + actProgress * 0.15, -1.45);
    h.clouds[0].position.x = lerp(-3.1, -2.55, actProgress);
    h.clouds[1].position.x = lerp(2.25, 2.75, actProgress);

    h.renderer.render(h.scene, h.camera);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 60);

    // Lighting Rig: Warm Tabletop Sun Key + Matte Emerald Ambient Fill + Live Cyan/Rose Neon Lights
    const hemiLight = new THREE.HemisphereLight(0xfff5e0, 0x1a382c, 1.15);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff0d1, 2.45);
    keyLight.position.set(-5.8, 9.5, 5.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 26;
    keyLight.shadow.camera.left = -6.5;
    keyLight.shadow.camera.right = 6.5;
    keyLight.shadow.camera.top = 5.5;
    keyLight.shadow.camera.bottom = -5.5;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const accentLightA = new THREE.PointLight(0x3ce6f5, 2.2, 6.5, 1.6);
    scene.add(accentLightA);

    const accentLightB = new THREE.PointLight(0xff5294, 2.0, 6.5, 1.6);
    scene.add(accentLightB);

    // Subtle tabletop shadow-catcher plane beneath the hardcover book
    const tablePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 16),
      new THREE.ShadowMaterial({ opacity: 0.36 }),
    );
    tablePlane.rotation.x = -Math.PI / 2;
    tablePlane.position.y = -0.14;
    tablePlane.receiveShadow = true;
    scene.add(tablePlane);

    const bookGroup = new THREE.Group();
    scene.add(bookGroup);

    // 1. Terracotta Hardcover Board + Stacked Cream Page Block + Draped Crimson Ribbon Bookmark
    const coverMat = new THREE.MeshStandardMaterial({
      color: 0xb65c3e,
      roughness: 0.82,
      map: createPaperGrainTexture("#b65c3e", "#7a3620", 7),
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xf5ecd4, roughness: 0.9 });

    const coverBoard = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.16, 5.45), coverMat);
    coverBoard.position.y = -0.05;
    coverBoard.castShadow = true;
    coverBoard.receiveShadow = true;
    bookGroup.add(coverBoard);

    // Thick stacked pages side block (textures generated lazily per song & chapter stamp)
    const spreadTextures = new Map<string, THREE.CanvasTexture>();
    const initialSpread = createBookSpreadTexture("FOLDED SONGBOOK", "PLATE 01");
    spreadTextures.set("FOLDED SONGBOOK|PLATE 01", initialSpread);
    const pageEdgeMat = new THREE.MeshStandardMaterial({ color: 0xddd0ad, roughness: 0.92 });
    const pageMat = new THREE.MeshStandardMaterial({
      map: initialSpread,
      roughness: 0.94,
    });
    const curvedSpreadGeo = createCurvedSpreadGeometry(8.6, 5.1, 0.24);
    const pageMesh = new THREE.Mesh(curvedSpreadGeo, [
      pageEdgeMat,
      pageEdgeMat,
      pageMat,
      pageEdgeMat,
      pageEdgeMat,
      pageEdgeMat,
    ]);
    pageMesh.position.y = 0.08;
    pageMesh.castShadow = true;
    pageMesh.receiveShadow = true;
    bookGroup.add(pageMesh);

    // Crimson ribbon bookmark draping over the front spine edge
    const ribbonShape = new THREE.Shape();
    ribbonShape.moveTo(-0.16, 0);
    ribbonShape.lineTo(0.16, 0);
    ribbonShape.lineTo(0.16, -0.64);
    ribbonShape.lineTo(0, -0.46);
    ribbonShape.lineTo(-0.16, -0.64);
    ribbonShape.closePath();
    const ribbon = new THREE.Mesh(
      new THREE.ExtrudeGeometry(ribbonShape, { depth: 0.03, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0xc24034, roughness: 0.78 }),
    );
    ribbon.position.set(0, 0.02, 2.72);
    ribbon.rotation.x = -0.22;
    ribbon.castShadow = true;
    bookGroup.add(ribbon);

    // 2. Pop-Up Cardstock Scenery Layer (hinges smoothly on chapter turns)
    const popupPivot = new THREE.Group();
    bookGroup.add(popupPivot);

    // Layered Folded Teal Mountain Range (back-left)
    const m1 = buildFoldedMountain(2.3, 2.25, 0x528279, 0x39625b);
    m1.position.set(-2.05, pageSurfaceY(-2.05, 8.6), -1.55);
    popupPivot.add(m1);

    const m2 = buildFoldedMountain(1.9, 1.75, 0x45736b, 0x2e534d);
    m2.position.set(-0.65, pageSurfaceY(-0.65, 8.6), -1.7);
    popupPivot.add(m2);

    const m3 = buildFoldedMountain(1.65, 1.45, 0x5d8d83, 0x426d65);
    m3.position.set(-3.1, pageSurfaceY(-3.1, 8.6), -1.25);
    popupPivot.add(m3);

    // Glowing Cut-Paper Cyan-Gold Sun Disc on brass wire rod behind the central peak
    const sunGroup = new THREE.Group();
    sunGroup.position.set(-1.95, 2.85, -1.9);
    const sunCoreMat = new THREE.MeshStandardMaterial({
      color: 0xf2c95c,
      emissive: 0xeba934,
      emissiveIntensity: 0.9,
      roughness: 0.5,
    });
    const sunCore = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.07, 24), sunCoreMat);
    sunCore.rotation.x = Math.PI / 2;
    sunGroup.add(sunCore);

    const sunRingMat = new THREE.MeshStandardMaterial({
      color: 0x5cebf7,
      emissive: 0x3ce6f5,
      emissiveIntensity: 1.0,
      roughness: 0.25,
    });
    const sunRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 10, 28), sunRingMat);
    sunGroup.add(sunRing);

    const sunRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 2.5, 6),
      new THREE.MeshStandardMaterial({ color: 0xbda782, roughness: 0.8 }),
    );
    sunRod.position.set(0, -1.35, -0.04);
    sunGroup.add(sunRod);
    popupPivot.add(sunGroup);

    // Two Miniature Folded Cottages on the Left Meadow
    const c1 = buildPaperCottage(1.0, trimMat);
    c1.position.set(-2.35, pageSurfaceY(-2.35, 8.6), -0.45);
    c1.rotation.y = 0.24;
    popupPivot.add(c1);

    const c2 = buildPaperCottage(0.78, trimMat);
    c2.position.set(-1.72, pageSurfaceY(-1.72, 8.6), -0.78);
    c2.rotation.y = -0.18;
    popupPivot.add(c2);

    // Hero 3D Lantern Gatehouse on Right Page
    const gate = buildLanternGatehouse(trimMat);
    gate.root.position.set(1.68, pageSurfaceY(1.68, 8.6), -0.45);
    gate.root.rotation.y = -0.14;
    popupPivot.add(gate.root);

    // Forest of Folded Paper Pine Trees framing both pages
    const pineSpecs: [number, number, number, number][] = [
      [-3.55, 0.55, 1.12, 0x265441],
      [-3.15, -0.15, 0.92, 0x31664f],
      [-2.75, 1.15, 0.76, 0x2a5c47],
      [-1.08, -0.95, 0.82, 0x356c54],
      [0.45, -1.15, 0.95, 0x285844],
      [2.92, -0.92, 1.14, 0x265441],
      [3.38, -0.22, 0.96, 0x31664f],
      [3.12, 0.72, 0.84, 0x2b5d47],
      [3.62, 0.92, 0.7, 0x387056],
    ];
    for (const [px, pz, sc, col] of pineSpecs) {
      const pine = buildPaperPine(sc, col, trimMat);
      pine.position.set(px, pageSurfaceY(px, 8.6), pz);
      popupPivot.add(pine);
    }

    // Glowing Miniature Path Lantern Posts + Wooden Signpost
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6f4b2f, roughness: 0.88 });
    const lampGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffe08a,
      emissive: 0xffb83d,
      emissiveIntensity: 1.15,
      roughness: 0.3,
    });
    for (const [lx, lz] of [
      [-2.55, 0.52],
      [0.62, 0.35],
    ]) {
      const postGroup = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.72, 6), postMat);
      stem.position.y = 0.36;
      stem.castShadow = true;
      postGroup.add(stem);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.13), lampGlowMat);
      lamp.position.y = 0.76;
      postGroup.add(lamp);
      postGroup.position.set(lx, pageSurfaceY(lx, 8.6), lz);
      popupPivot.add(postGroup);
    }

    // Wooden Waypost on right foreground ("TWIN TAKE")
    const signGroup = new THREE.Group();
    const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.62, 6), postMat);
    signPost.position.y = 0.31;
    signPost.castShadow = true;
    signGroup.add(signPost);
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.22, 0.04), new THREE.MeshStandardMaterial({ color: 0x9b683e, roughness: 0.85 }));
    signBoard.position.set(0.06, 0.48, 0);
    signBoard.rotation.z = -0.08;
    signBoard.castShadow = true;
    signGroup.add(signBoard);
    signGroup.position.set(2.95, pageSurfaceY(2.95, 8.6), 1.38);
    signGroup.rotation.y = -0.25;
    popupPivot.add(signGroup);

    // Cut-Paper Clouds on Diorama Wire Rods
    const cloudA = buildPaperCloud(0.88);
    cloudA.position.set(-2.9, 2.55, -1.65);
    popupPivot.add(cloudA);
    const cloudB = buildPaperCloud(0.95);
    cloudB.position.set(2.45, 2.82, -1.35);
    popupPivot.add(cloudB);

    // Pair of Folded Origami Paper Swallows gliding over the peaks
    const birdMat = new THREE.MeshStandardMaterial({ color: 0x4ca1b5, roughness: 0.82, side: THREE.DoubleSide });
    const makeBird = () => {
      const bg = new THREE.Group();
      const wingGeo = new THREE.ConeGeometry(0.12, 0.42, 3);
      const wL = new THREE.Mesh(wingGeo, birdMat);
      wL.rotation.z = Math.PI * 0.42;
      wL.position.x = -0.14;
      const wR = new THREE.Mesh(wingGeo, birdMat);
      wR.rotation.z = -Math.PI * 0.42;
      wR.position.x = 0.14;
      bg.add(wL, wR);
      return bg;
    };
    const birdA = makeBird();
    const birdB = makeBird();
    popupPivot.add(birdA, birdB);

    // 3. Polymorphic Pool of N Performer 3D Cardstock Standees on the Open Book
    const standees: StandeeSlot[] = Array.from({ length: MAX_STANDEES }, () => {
      const mat = new THREE.MeshStandardMaterial({
        transparent: true,
        alphaTest: 0.35,
        roughness: 0.72,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.15, 2.46), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.visible = false;
      popupPivot.add(mesh);
      return { mesh, mat };
    });

    const handles: SceneHandles = {
      renderer,
      scene,
      camera,
      keyLight,
      hemiLight,
      accentLightA,
      accentLightB,
      bookGroup,
      popupPivot,
      sunGroup,
      sunCoreMat,
      sunRingMat,
      gate,
      standees,
      pageMat,
      spreadTextures,
      atlasTextures: new Map(),
      loader: new THREE.TextureLoader(),
      clouds: [cloudA, cloudB],
      birds: [birdA, birdB],
    };
    handlesRef.current = handles;

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const ht = Math.max(1, host.clientHeight);
      camera.aspect = w / ht;
      camera.updateProjectionMatrix();
      renderer.setSize(w, ht, false);
      renderNow();
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      ro.disconnect();
      handlesRef.current = null;
      spreadTextures.forEach((t) => t.dispose());
      handles.atlasTextures.forEach((t) => t.dispose());
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Deterministic re-render whenever beat, plate, orbit, or Neon frame updates
  useEffect(() => {
    renderNow();
  });

  return <div ref={hostRef} className="nw-three-host" aria-hidden="true" />;
};
