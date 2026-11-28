/**
 * Meadow Caravan 3D Setpiece (`S-54`):
 * Real 3D folded-cardstock parade wagon pulled by an articulated rocking cardstock horse across
 * layered sunset paper hills, pine ridges, and scrolling wooden milepost fence under a warm GLSL
 * sunset sky dome.
 *
 * Exposes `getSurfaceAt(x, z)` and `getRiderSlots(total, riserCount)` so ANY song's 1..13+ cast
 * rides grounded synchronously right on the bouncing corrugated kraft timber carriage deck!
 */
import * as THREE from "three";
import type { StageLightingMood } from "./stageDirectorStore.ts";
import type { SurfaceSample } from "./stageSurface.ts";
import { createKraftCardboardTexture, createRiserOakTexture, createSunsetDomeMaterial } from "./stageTextures.ts";

export const CARAVAN_DECK_BASE_Y = 0.72;
export const CARAVAN_SADDLE_BASE_Y = 1.18;
export const CARAVAN_WAGON_CENTER_X = -0.65;
export const CARAVAN_WAGON_CENTER_Z = -0.15;
export const CARAVAN_WAGON_WIDTH = 4.2;
export const CARAVAN_WAGON_DEPTH = 1.65;
export const CARAVAN_HORSE_X = 2.35;
export const CARAVAN_HORSE_Z = -0.10;

export interface CaravanRiderSlot {
  readonly baseX: number;
  readonly baseZ: number;
  readonly onRiser: boolean;
}

export interface CaravanUpdateParams {
  readonly timeSec: number;
  readonly beat: number;
  readonly voiceEnergy: number;
  readonly sectionName: string;
  readonly lightingEnabled: boolean;
  readonly lightingMood: Exclude<StageLightingMood, "auto">;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function buildWheel(
  radius: number,
  woodMat: THREE.Material,
  brassMat: THREE.Material,
  tireMat: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.11, 10, 26), woodMat);
  rim.castShadow = true;
  rim.receiveShadow = true;
  g.add(rim);

  const outerTire = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.045, radius * 0.032, 8, 26), tireMat);
  g.add(outerTire);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.21, radius * 0.21, 0.15, 14), brassMat);
  hub.rotation.x = Math.PI / 2;
  hub.castShadow = true;
  g.add(hub);

  const spokeGeo = new THREE.BoxGeometry(radius * 1.88, radius * 0.085, 0.048);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(spokeGeo, woodMat);
    spoke.rotation.z = (i * Math.PI) / 4;
    spoke.castShadow = true;
    g.add(spoke);
  }
  return g;
}

function buildCardstockTree(scale: number, greenHex: number, trimMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06 * scale, 0.09 * scale, 0.42 * scale, 6),
    new THREE.MeshStandardMaterial({ color: 0x6f472d, roughness: 0.9 }),
  );
  trunk.position.y = 0.21 * scale;
  trunk.castShadow = true;
  g.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({
    color: greenHex,
    roughness: 0.88,
    flatShading: true,
  });
  for (const [r, h, y] of [
    [0.52, 0.78, 0.72],
    [0.40, 0.68, 1.18],
    [0.27, 0.56, 1.58],
  ] as const) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * scale, h * scale, 6), leafMat);
    cone.position.y = y * scale;
    cone.castShadow = true;
    g.add(cone);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(r * scale * 1.01, r * scale * 1.03, 0.03 * scale, 6),
      trimMat,
    );
    rim.position.y = (y - h * 0.48) * scale;
    g.add(rim);
  }
  return g;
}

interface HorseRig {
  readonly root: THREE.Group;
  readonly rockerRunner: THREE.Mesh;
  readonly bodyPivot: THREE.Group;
  readonly neckPivot: THREE.Group;
  readonly headPivot: THREE.Group;
  readonly earL: THREE.Mesh;
  readonly earR: THREE.Mesh;
  readonly tailPivot: THREE.Group;
  readonly legs: readonly [THREE.Group, THREE.Group, THREE.Group, THREE.Group]; // FL, FR, BL, BR
}

function buildArticulatedHorse(kraftTex: THREE.Texture | null): HorseRig {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xe6cfa8,
    map: kraftTex,
    roughness: 0.84,
  });
  const maneMat = new THREE.MeshStandardMaterial({ color: 0x9b3e2e, roughness: 0.8 });
  const saddleMat = new THREE.MeshStandardMaterial({ color: 0x257b74, roughness: 0.76 });
  const rockerMat = new THREE.MeshStandardMaterial({ color: 0xb65c3e, roughness: 0.82 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xe8bc5b, metalness: 0.7, roughness: 0.3 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1513, roughness: 0.35 });

  // Curved wooden rocker runner underneath
  const rockerRunner = new THREE.Mesh(
    new THREE.TorusGeometry(1.16, 0.058, 10, 28, Math.PI * 0.56),
    rockerMat,
  );
  rockerRunner.rotation.z = Math.PI * 1.22;
  rockerRunner.position.set(0, 1.15, 0);
  rockerRunner.castShadow = true;
  root.add(rockerRunner);

  // Body pivot centered at barrel center
  const bodyPivot = new THREE.Group();
  bodyPivot.position.set(0, 0.96, 0);
  root.add(bodyPivot);

  // Barrel torso (top sits at ~0.96 + 0.22 = 1.18 = saddleY)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.44, 0.50), bodyMat);
  torso.castShadow = true;
  torso.receiveShadow = true;
  bodyPivot.add(torso);

  // Painted turquoise felt saddle blanket + trim + brass stud
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.26, 0.55), saddleMat);
  saddle.position.set(-0.04, 0.11, 0);
  saddle.castShadow = true;
  saddle.receiveShadow = true;
  bodyPivot.add(saddle);

  const saddleStrap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.47, 0.56), maneMat);
  saddleStrap.position.set(-0.04, 0, 0);
  bodyPivot.add(saddleStrap);

  // 4 Articulated Legs pivoted at shoulders & hips
  const makeLeg = (lx: number, lz: number, baseRot: number) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(lx, -0.16, lz);
    legPivot.rotation.z = baseRot;

    const legMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.64, 0.14), bodyMat);
    legMesh.position.set(0, -0.32, 0);
    legMesh.castShadow = true;
    legPivot.add(legMesh);

    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.10, 0.16), maneMat);
    hoof.position.set(0.02, -0.62, 0);
    hoof.castShadow = true;
    legPivot.add(hoof);

    bodyPivot.add(legPivot);
    return legPivot;
  };

  const frontL = makeLeg(0.42, 0.17, -0.18);
  const frontR = makeLeg(0.42, -0.17, -0.10);
  const backL = makeLeg(-0.42, 0.17, 0.18);
  const backR = makeLeg(-0.42, -0.17, 0.10);

  // Neck -> Head -> Ears hierarchy
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0.46, 0.14, 0);
  neckPivot.rotation.z = -0.44;
  bodyPivot.add(neckPivot);

  const neckMesh = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.64, 0.32), bodyMat);
  neckMesh.position.set(0, 0.28, 0);
  neckMesh.castShadow = true;
  neckPivot.add(neckMesh);

  // Folded paper mane ridge
  for (let m = 0; m < 4; m++) {
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 4), maneMat);
    crest.position.set(-0.15, 0.12 + m * 0.13, 0);
    crest.rotation.z = Math.PI * 0.55;
    neckPivot.add(crest);
  }

  const headPivot = new THREE.Group();
  headPivot.position.set(0.06, 0.56, 0);
  headPivot.rotation.z = 0.22;
  neckPivot.add(headPivot);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.30, 0.32), bodyMat);
  head.position.set(0.22, 0.02, 0);
  head.castShadow = true;
  headPivot.add(head);

  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.24, 0.28), maneMat);
  muzzle.position.set(0.46, -0.02, 0);
  headPivot.add(muzzle);

  for (const sz of [-0.165, 0.165]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 10), eyeMat);
    eye.position.set(0.26, 0.08, sz);
    headPivot.add(eye);
  }

  const bridleRing = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 16), brassMat);
  bridleRing.position.set(0.42, -0.06, 0.16);
  headPivot.add(bridleRing);

  const earGeo = new THREE.ConeGeometry(0.075, 0.21, 4);
  const earL = new THREE.Mesh(earGeo, maneMat);
  earL.position.set(0.06, 0.22, 0.10);
  earL.rotation.z = 0.12;
  const earR = new THREE.Mesh(earGeo, maneMat);
  earR.position.set(0.06, 0.22, -0.10);
  earR.rotation.z = 0.12;
  headPivot.add(earL, earR);

  // Swishing paper cone tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(-0.56, 0.08, 0);
  tailPivot.rotation.z = 0.72;
  bodyPivot.add(tailPivot);

  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.56, 5), maneMat);
  tailCone.position.set(0, -0.26, 0);
  tailCone.rotation.z = Math.PI;
  tailCone.castShadow = true;
  tailPivot.add(tailCone);

  return {
    root,
    rockerRunner,
    bodyPivot,
    neckPivot,
    headPivot,
    earL,
    earR,
    tailPivot,
    legs: [frontL, frontR, backL, backR],
  };
}

export class CaravanSetpiece3D {
  readonly group = new THREE.Group();

  private readonly domeMat: THREE.ShaderMaterial;
  private readonly sunDisc: THREE.Mesh;
  private readonly sunMat: THREE.MeshStandardMaterial;
  private readonly hillFar: THREE.Group;
  private readonly hillMid: THREE.Group;
  private readonly hillNear: THREE.Group;
  private readonly fenceGroup: THREE.Group;
  private readonly wagonGroup: THREE.Group;
  private readonly wagonSuspendGroup: THREE.Group;
  private readonly wheels: THREE.Group[] = [];
  private readonly hornRing: THREE.Mesh;
  private readonly hornMat: THREE.MeshStandardMaterial;
  private readonly dustGroup: THREE.Group;
  private readonly dustPuffs: THREE.Mesh[] = [];
  private readonly horse: HorseRig;

  private readonly kraftTex: THREE.CanvasTexture | null;
  private readonly deckOakTex: THREE.CanvasTexture | null;
  private readonly disposables: { dispose(): void }[] = [];

  private currentWagonHopY = 0;
  private currentHorseHopY = 0;

  constructor() {
    this.kraftTex = createKraftCardboardTexture();
    this.deckOakTex = createRiserOakTexture();
    if (this.kraftTex) this.disposables.push(this.kraftTex);
    if (this.deckOakTex) this.disposables.push(this.deckOakTex);

    // 1. Curved GLSL Sunset Sky Dome (`SphereGeometry(38, 32, 18)` BackSide)
    this.domeMat = createSunsetDomeMaterial();
    this.disposables.push(this.domeMat);
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(38, 32, 18), this.domeMat);
    skyDome.renderOrder = 1;
    this.group.add(skyDome);

    // Glowing 3D Sunset Disc
    this.sunMat = new THREE.MeshStandardMaterial({
      color: 0xffd778,
      emissive: 0xf49d37,
      emissiveIntensity: 0.95,
      roughness: 0.4,
    });
    this.sunDisc = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.12, 32), this.sunMat);
    this.sunDisc.rotation.x = Math.PI / 2;
    this.sunDisc.position.set(-4.6, 3.65, -13.2);
    this.group.add(this.sunDisc);

    // 2. Meadow & Golden Gravel Road Ground (`receiveShadow = true`)
    const meadow = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 32),
      new THREE.MeshStandardMaterial({ color: 0x456d4e, roughness: 0.94 }),
    );
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.set(0, -0.02, -1.2);
    meadow.receiveShadow = true;
    this.group.add(meadow);

    const road = new THREE.Mesh(
      new THREE.BoxGeometry(42, 0.04, 3.3),
      new THREE.MeshStandardMaterial({ color: 0xd9c297, roughness: 0.94 }),
    );
    road.position.set(0, -0.01, -0.08);
    road.receiveShadow = true;
    this.group.add(road);

    // 3. Layered 3D Parallax Sunset Hills & Cardstock Cypress/Pine Trees
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xf5ebd2, roughness: 0.9 });
    this.hillFar = new THREE.Group();
    const hillFarMat = new THREE.MeshStandardMaterial({ color: 0x345858, roughness: 0.92, flatShading: true });
    for (let i = -5; i <= 5; i++) {
      const ridge = new THREE.Mesh(new THREE.ConeGeometry(4.2, 3.8, 5), hillFarMat);
      ridge.position.set(i * 4.8, 1.65, -9.8);
      ridge.rotation.y = i * 0.4 + 0.3;
      this.hillFar.add(ridge);
    }
    this.group.add(this.hillFar);

    this.hillMid = new THREE.Group();
    const hillMidMat = new THREE.MeshStandardMaterial({ color: 0x416e5e, roughness: 0.91, flatShading: true });
    for (let i = -6; i <= 6; i++) {
      const mound = new THREE.Mesh(new THREE.ConeGeometry(3.1, 2.5, 5), hillMidMat);
      mound.position.set(i * 3.6, 1.05, -6.2);
      mound.rotation.y = i * 0.55;
      this.hillMid.add(mound);
      if (i % 2 === 0) {
        const tree = buildCardstockTree(1.05, 0x2a5b48, trimMat);
        tree.position.set(i * 3.6 + 1.4, 0, -5.0);
        this.hillMid.add(tree);
      }
    }
    this.group.add(this.hillMid);

    this.hillNear = new THREE.Group();
    const hillNearMat = new THREE.MeshStandardMaterial({ color: 0x4c7c60, roughness: 0.9, flatShading: true });
    for (let i = -7; i <= 7; i++) {
      const knoll = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.45, 5), hillNearMat);
      knoll.position.set(i * 3.0, 0.55, -3.55);
      knoll.rotation.y = i * 0.35;
      knoll.receiveShadow = true;
      this.hillNear.add(knoll);

      const pine = buildCardstockTree(0.88 + (Math.abs(i) % 3) * 0.14, i % 2 === 0 ? 0x2f684e : 0x377256, trimMat);
      pine.position.set(i * 3.0 + 1.25, 0, -2.95);
      this.hillNear.add(pine);
    }
    this.group.add(this.hillNear);

    // 4. Scrolling Wooden Milepost Fence along Roadside (`z = -1.78`)
    this.fenceGroup = new THREE.Group();
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.88 });
    const postGeo = new THREE.BoxGeometry(0.11, 0.72, 0.11);
    const mileMat = new THREE.MeshStandardMaterial({ color: 0xf4e7cc, roughness: 0.85 });
    for (let i = -9; i <= 9; i++) {
      const px = i * 2.4;
      const post = new THREE.Mesh(postGeo, fenceMat);
      post.position.set(px, 0.36, -1.78);
      post.castShadow = true;
      this.fenceGroup.add(post);

      if (Math.abs(i) % 3 === 1) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.06), mileMat);
        cap.position.set(px, 0.64, -1.70);
        cap.castShadow = true;
        this.fenceGroup.add(cap);
      }
    }
    for (const ry of [0.56, 0.28]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(46, 0.065, 0.055), fenceMat);
      rail.position.set(0, ry, -1.78);
      rail.castShadow = true;
      this.fenceGroup.add(rail);
    }
    this.group.add(this.fenceGroup);

    // 5. Corrugated Kraft-Cardboard Parade Wagon (`x = -0.65, z = -0.15`, `width = 4.2, depth = 1.65`)
    this.wagonGroup = new THREE.Group();
    this.group.add(this.wagonGroup);

    this.wagonSuspendGroup = new THREE.Group();
    this.wagonSuspendGroup.position.set(CARAVAN_WAGON_CENTER_X, 0, CARAVAN_WAGON_CENTER_Z);
    this.wagonGroup.add(this.wagonSuspendGroup);

    const kraftMat = new THREE.MeshStandardMaterial({
      color: 0xdab483,
      map: this.kraftTex,
      roughness: 0.84,
    });
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0xc2986d,
      map: this.deckOakTex,
      roughness: 0.74,
    });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xe3b85d, metalness: 0.72, roughness: 0.28 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x3a322e, metalness: 0.55, roughness: 0.45 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x9b5434, roughness: 0.82 });
    const awningRedMat = new THREE.MeshStandardMaterial({ color: 0xc84b38, roughness: 0.78, side: THREE.DoubleSide });
    const awningCreamMat = new THREE.MeshStandardMaterial({ color: 0xf4ead2, roughness: 0.85, side: THREE.DoubleSide });

    // Thick timber rider deck (top surface strictly at local y = 0.72!)
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(CARAVAN_WAGON_WIDTH, 0.14, CARAVAN_WAGON_DEPTH),
      deckMat,
    );
    deck.position.set(0, CARAVAN_DECK_BASE_Y - 0.07, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.wagonSuspendGroup.add(deck);

    // Lower corrugated chassis apron beneath deck
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.96, 0.22, 1.48), kraftMat);
    chassis.position.set(0, 0.48, 0);
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.wagonSuspendGroup.add(chassis);

    // Rear tall corrugated rail + scalloped cream trim + brass corner rivets
    const rearWall = new THREE.Mesh(new THREE.BoxGeometry(4.18, 0.62, 0.10), kraftMat);
    rearWall.position.set(0, CARAVAN_DECK_BASE_Y + 0.31, -CARAVAN_WAGON_DEPTH * 0.5 + 0.04);
    rearWall.castShadow = true;
    rearWall.receiveShadow = true;
    this.wagonSuspendGroup.add(rearWall);

    const rearTrim = new THREE.Mesh(new THREE.BoxGeometry(4.24, 0.07, 0.12), trimMat);
    rearTrim.position.set(0, CARAVAN_DECK_BASE_Y + 0.63, -CARAVAN_WAGON_DEPTH * 0.5 + 0.04);
    this.wagonSuspendGroup.add(rearTrim);

    // Front-facing scalloped low apron rail (`y = 0.72..0.96` so feet/legs remain visible!)
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(4.18, 0.22, 0.09), kraftMat);
    frontWall.position.set(0, CARAVAN_DECK_BASE_Y + 0.11, CARAVAN_WAGON_DEPTH * 0.5 - 0.04);
    frontWall.castShadow = true;
    frontWall.receiveShadow = true;
    this.wagonSuspendGroup.add(frontWall);

    const frontTrim = new THREE.Mesh(new THREE.BoxGeometry(4.24, 0.055, 0.11), awningRedMat);
    frontTrim.position.set(0, CARAVAN_DECK_BASE_Y + 0.23, CARAVAN_WAGON_DEPTH * 0.5 - 0.04);
    this.wagonSuspendGroup.add(frontTrim);

    // End rails (`±2.05`) + brass corner rivets
    for (const sx of [-1, 1] as const) {
      const endRail = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.38, CARAVAN_WAGON_DEPTH), kraftMat);
      endRail.position.set(sx * (CARAVAN_WAGON_WIDTH * 0.5 - 0.05), CARAVAN_DECK_BASE_Y + 0.19, 0);
      endRail.castShadow = true;
      this.wagonSuspendGroup.add(endRail);

      for (const sz of [-1, 1] as const) {
        const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 8), brassMat);
        rivet.position.set(
          sx * (CARAVAN_WAGON_WIDTH * 0.5 + 0.01),
          CARAVAN_DECK_BASE_Y + 0.18,
          sz * (CARAVAN_WAGON_DEPTH * 0.5 + 0.01),
        );
        this.wagonSuspendGroup.add(rivet);
      }
    }

    // Overhead arched canopy hoops (`y = 3.98` crown, clearing tall riders cleanly!)
    const archTopY = 3.28; // inside wagonSuspendGroup (from y = 0.72 -> world y = 4.00)
    for (const hx of [-2.02, -0.68, 0.68, 2.02]) {
      // Corner/bay upright posts placed along back & outer corners so front sightlines stay open
      for (const sz of [-1, 1] as const) {
        if (sz > 0 && Math.abs(hx) < 1.9) continue; // only outer corner front posts!
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 2.45, 8), woodMat);
        post.position.set(hx, CARAVAN_DECK_BASE_Y + 1.22, sz * (CARAVAN_WAGON_DEPTH * 0.5 - 0.06));
        post.castShadow = true;
        this.wagonSuspendGroup.add(post);
      }
      // Curved wooden arch rib spanning Z
      const hoop = new THREE.Mesh(
        new THREE.TorusGeometry(CARAVAN_WAGON_DEPTH * 0.48, 0.032, 8, 22, Math.PI),
        brassMat,
      );
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(hx, archTopY - 0.06, 0);
      hoop.castShadow = true;
      this.wagonSuspendGroup.add(hoop);
    }

    // Striped open-top parade canopy crown strips high overhead (`y = 3.95`, never blocking faces or key light!)
    const stripes = 7;
    const stripeW = (CARAVAN_WAGON_WIDTH + 0.14) / stripes;
    for (let i = 0; i < stripes; i++) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(stripeW * 0.98, 0.04, 0.92),
        i % 2 === 0 ? awningRedMat : awningCreamMat,
      );
      strip.position.set(-CARAVAN_WAGON_WIDTH * 0.5 + (i + 0.5) * stripeW, archTopY + 0.74, -0.26);
      strip.rotation.x = -0.18;
      strip.castShadow = true;
      this.wagonSuspendGroup.add(strip);
    }

    // Twin wooden hitch shafts connecting front of wagon (`x = +1.42`) to horse (`x = +2.35`)
    for (const hz of [-0.34, 0.34]) {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.075, 0.075), woodMat);
      shaft.position.set(CARAVAN_WAGON_WIDTH * 0.5 + 0.58, CARAVAN_DECK_BASE_Y + 0.14, hz);
      shaft.castShadow = true;
      this.wagonSuspendGroup.add(shaft);
    }

    // Glowing brass Caravan Horn ring on the front-right rail
    this.hornMat = new THREE.MeshStandardMaterial({
      color: 0xf6cf6b,
      emissive: 0x57d3e8,
      emissiveIntensity: 0.75,
      metalness: 0.45,
      roughness: 0.25,
    });
    this.hornRing = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.048, 10, 22), this.hornMat);
    this.hornRing.position.set(
      CARAVAN_WAGON_WIDTH * 0.5 - 0.08,
      CARAVAN_DECK_BASE_Y + 0.52,
      CARAVAN_WAGON_DEPTH * 0.5 + 0.04,
    );
    this.wagonSuspendGroup.add(this.hornRing);

    // 4 Spoked Wooden Wheels (inside `wagonGroup` so they touch road at y=0 and spin accurately!)
    for (const [wx, wz, r] of [
      [CARAVAN_WAGON_CENTER_X - 1.42, CARAVAN_WAGON_CENTER_Z + 0.90, 0.56],
      [CARAVAN_WAGON_CENTER_X + 1.42, CARAVAN_WAGON_CENTER_Z + 0.90, 0.50],
      [CARAVAN_WAGON_CENTER_X - 1.42, CARAVAN_WAGON_CENTER_Z - 0.90, 0.56],
      [CARAVAN_WAGON_CENTER_X + 1.42, CARAVAN_WAGON_CENTER_Z - 0.90, 0.50],
    ] as const) {
      const w = buildWheel(r, woodMat, brassMat, tireMat);
      w.position.set(wx, r, wz);
      this.wagonGroup.add(w);
      this.wheels.push(w);
    }

    // 6. Volumetric `IcosahedronGeometry` Paper Dust Puffs trailing behind rear wheels
    this.dustGroup = new THREE.Group();
    const dustMat = new THREE.MeshStandardMaterial({ color: 0xf8efe0, roughness: 0.95 });
    for (const [dx, dy, dz, dr] of [
      [0, 0.24, 0.35, 0.21],
      [-0.30, 0.36, 0.16, 0.17],
      [-0.58, 0.22, 0.42, 0.13],
      [-0.82, 0.30, 0.05, 0.11],
    ] as const) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(dr, 1), dustMat);
      puff.position.set(dx, dy, dz);
      puff.castShadow = true;
      this.dustGroup.add(puff);
      this.dustPuffs.push(puff);
    }
    this.dustGroup.position.set(CARAVAN_WAGON_CENTER_X - 2.38, 0.02, CARAVAN_WAGON_CENTER_Z + 0.28);
    this.group.add(this.dustGroup);

    // 7. Articulated 3D Folded-Cardstock Rocking Horse at `x = +2.35, z = -0.10`
    this.horse = buildArticulatedHorse(this.kraftTex);
    this.horse.root.position.set(CARAVAN_HORSE_X, 0.02, CARAVAN_HORSE_Z);
    this.group.add(this.horse.root);
  }

  /**
   * Resolve grounded Caravan rider formation slots strictly inside the carriage deck (`x ∈ [-2.65, +1.38]`,
   * `z ∈ [-0.90, +0.62]`) so any 1..13+ song cast stands firmly on the timber wagon bed.
   */
  static getRiderSlots(total: number, riserCount = 0): {
    downstage: readonly CaravanRiderSlot[];
    riser: readonly CaravanRiderSlot[];
  } {
    const downstage: CaravanRiderSlot[] = [];
    if (total <= 1) {
      downstage.push({ baseX: -0.65, baseZ: -0.05, onRiser: false });
    } else if (total === 2) {
      downstage.push(
        { baseX: -1.55, baseZ: 0.04, onRiser: false },
        { baseX: 0.28, baseZ: -0.18, onRiser: false },
      );
    } else if (total === 3) {
      downstage.push(
        { baseX: -0.55, baseZ: 0.24, onRiser: false },
        { baseX: -1.95, baseZ: -0.20, onRiser: false },
        { baseX: 0.82, baseZ: -0.18, onRiser: false },
      );
    } else if (total === 4) {
      // Dedicated non-occluding 4-rider formation (`neon`, `tabby`, `cue`, `gruff`)
      downstage.push(
        { baseX: -0.18, baseZ: 0.26, onRiser: false },
        { baseX: -1.25, baseZ: -0.26, onRiser: false },
        { baseX: 0.88, baseZ: 0.16, onRiser: false },
        { baseX: -2.18, baseZ: 0.12, onRiser: false },
      );
    } else {
      const frontCount = Math.ceil(total * 0.55);
      const backCount = total - frontCount;
      for (let i = 0; i < frontCount; i++) {
        const u = frontCount === 1 ? 0.5 : i / (frontCount - 1);
        downstage.push({
          baseX: lerp(-2.32, 1.12, u),
          baseZ: 0.30 + (i % 2 === 0 ? 0.08 : -0.05),
          onRiser: false,
        });
      }
      for (let bi = 0; bi < backCount; bi++) {
        const u = backCount === 1 ? 0.5 : bi / (backCount - 1);
        downstage.push({
          baseX: lerp(-2.10, 0.92, u),
          baseZ: -0.28 - (bi % 2 === 0 ? 0.06 : 0),
          onRiser: false,
        });
      }
    }

    const riser: CaravanRiderSlot[] = [];
    for (let ri = 0; ri < riserCount; ri++) {
      const u = riserCount <= 1 ? 0.5 : ri / (riserCount - 1);
      riser.push({
        baseX: lerp(-2.28, 1.08, u),
        baseZ: -0.74,
        onRiser: true,
      });
    }
    return { downstage, riser };
  }

  /**
   * Real grounded rider surface height query:
   *  - Carriage bed (`x ∈ [-2.85, +1.55]`, `z ∈ [-1.05, +0.75]`): `0.72 + currentWagonHopY` (`"wagon"`)
   *  - Horse saddle (`x ∈ [1.80, +2.90]`, `z ∈ [-0.55, +0.35]`): `1.18 + currentHorseHopY` (`"wagon"`)
   *  - Meadow ground outside: `0` (`"floor"`)
   */
  getSurfaceAt(x: number, z: number): SurfaceSample | null {
    if (x >= -2.85 && x <= 1.55 && z >= -1.05 && z <= 0.75) {
      return {
        y: CARAVAN_DECK_BASE_Y + this.currentWagonHopY,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        surfaceId: "wagon",
      };
    }
    const distHorse = Math.hypot(x - CARAVAN_HORSE_X, z - CARAVAN_HORSE_Z);
    if (distHorse <= 0.65 || (x >= 1.80 && x <= 2.90 && z >= -0.55 && z <= 0.35)) {
      return {
        y: CARAVAN_SADDLE_BASE_Y + this.currentHorseHopY,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        surfaceId: "wagon",
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

  update(params: CaravanUpdateParams): void {
    const { beat, voiceEnergy, sectionName, lightingEnabled, lightingMood } = params;
    const sec = sectionName.toLowerCase();
    const isGallop = sec.includes("trot") || sec.includes("chorus") || sec.includes("reprise");
    const isHornBreak = sec.includes("horn");

    const speedMul = isGallop ? 1.55 : isHornBreak ? 1.85 : 1.05;
    const travel = beat * speedMul;

    // Suspension bounce & horn break hop (synchronized with getSurfaceAt!)
    const strideBounce = Math.abs(Math.sin(beat * Math.PI * (isGallop ? 2 : 1))) * (isGallop ? 0.085 : 0.036);
    const hornHop = isHornBreak ? Math.abs(Math.sin(beat * Math.PI * 2)) * 0.14 : 0;
    this.currentWagonHopY = strideBounce + hornHop;
    this.currentHorseHopY = strideBounce * 0.85 + hornHop * 0.95;

    this.wagonGroup.position.y = this.currentWagonHopY;
    this.wagonSuspendGroup.rotation.z =
      Math.sin(beat * Math.PI * (isGallop ? 1 : 0.5)) * (isGallop ? 0.022 : 0.012) +
      (hornHop > 0.05 ? 0.024 : 0);

    for (const wheel of this.wheels) {
      wheel.rotation.z = -travel * 1.45;
    }

    // Parallax fence, hills & dust puffs
    this.fenceGroup.position.x = -((travel * 1.45) % 2.4);
    this.hillNear.position.x = -((travel * 0.45) % 6.0) + 3.0;
    this.hillMid.position.x = -((travel * 0.28) % 7.2) + 3.6;
    this.hillFar.position.x = -((travel * 0.15) % 9.6) + 4.8;

    const puffScale = 0.78 + Math.abs(Math.sin(beat * Math.PI)) * 0.34 + (isGallop ? 0.24 : 0) + hornHop * 1.4;
    this.dustGroup.scale.setScalar(puffScale);
    for (let i = 0; i < this.dustPuffs.length; i++) {
      this.dustPuffs[i].rotation.z = -travel * (1.2 + i * 0.35);
      this.dustPuffs[i].position.y = 0.22 + ((i % 2) * 0.1) + Math.abs(Math.sin(travel * 1.8 + i)) * 0.14;
    }

    // Articulated Horse Kinematics (rocker pitch + 4-leg trot/canter + overlapping neck/head/tail lag)
    const gallopPhase = travel * Math.PI;
    const rearBoost = isHornBreak ? Math.max(0, Math.sin(beat * Math.PI * 2)) * 0.22 : 0;
    const bodyPitch = Math.sin(gallopPhase) * (isGallop ? 0.14 : 0.08) + rearBoost;

    this.horse.root.position.y = 0.02 + this.currentHorseHopY * 0.65;
    this.horse.rockerRunner.rotation.z = Math.PI * 1.22 + bodyPitch * 0.55;
    this.horse.bodyPivot.rotation.z = bodyPitch;

    // Diagonal trot leg swing (FL+BR vs FR+BL), flaring upward during horn-break rear!
    const legAmp = isGallop ? 0.42 : 0.26;
    const legPhaseA = Math.sin(gallopPhase) * legAmp;
    const legPhaseB = Math.sin(gallopPhase + Math.PI) * legAmp;
    this.horse.legs[0].rotation.z = -0.16 + legPhaseA + rearBoost * 1.4;
    this.horse.legs[3].rotation.z = 0.16 + legPhaseA;
    this.horse.legs[1].rotation.z = -0.14 + legPhaseB + rearBoost * 1.1;
    this.horse.legs[2].rotation.z = 0.14 + legPhaseB;

    // Overlapping follow-through on neck, head, ears & tail
    this.horse.neckPivot.rotation.z = -0.44 + Math.sin(gallopPhase - 0.5) * 0.09 - rearBoost * 0.35;
    this.horse.headPivot.rotation.z = 0.22 + Math.sin(gallopPhase - 1.0) * 0.12;
    const earPerk = isHornBreak ? 0.24 : Math.sin(gallopPhase * 2 - 1.3) * 0.08;
    this.horse.earL.rotation.z = 0.12 + earPerk;
    this.horse.earR.rotation.z = 0.12 + earPerk * 0.85;
    this.horse.tailPivot.rotation.z = 0.72 + Math.sin(gallopPhase * 1.4 - 0.9) * 0.28 + (isGallop ? 0.22 : 0);

    // Mood-aware Sunset Sky Dome & Brass Horn Glow
    const darkAmt = lightingMood === "standby-dark" ? 0.78 : lightingMood === "phosphor-booth" ? 0.52 : 0.0;
    const tint = this.domeMat.uniforms.uMoodTint.value as THREE.Vector3;
    if (lightingMood === "phosphor-booth") tint.set(0.68, 0.96, 1.08);
    else if (lightingMood === "encore-surge") tint.set(1.12, 1.02, 0.92);
    else if (lightingMood === "arena-lit") tint.set(1.06, 1.03, 0.98);
    else tint.set(1, 1, 1);

    this.domeMat.uniforms.uEnergy.value = voiceEnergy;
    this.domeMat.uniforms.uDarkness.value = darkAmt;
    this.domeMat.uniforms.uLit.value = lightingEnabled ? 1 : 0;

    this.sunDisc.position.y = lerp(3.65, 1.85, darkAmt) + voiceEnergy * 0.22;
    this.sunMat.emissiveIntensity = (lightingEnabled ? lerp(0.95, 0.32, darkAmt) : 0.35) + voiceEnergy * 0.45 + (isHornBreak ? 0.4 : 0);

    this.hornMat.emissive.set(isHornBreak ? "#ffcb47" : lightingMood === "phosphor-booth" ? "#57f2da" : "#f6aa44");
    this.hornMat.emissiveIntensity = 0.55 + voiceEnergy * 1.25 + (isHornBreak ? 1.5 : 0);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
