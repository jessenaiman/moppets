/**
 * Real Three.js Multi-World 3D Stage Architecture (`theater`, `caravan`, `storybook`, `cosmic`, `playroom`).
 *
 * Built with authored procedural 3D geometry, RoomEnvironment PBR IBL, real cast shadows,
 * and zero flat JPEG backdrop fakes:
 *  1. `theater`   — Studio 404 Broadcast Soundstage (bare hardwood/concrete floor with Zero Persian Rug Lock,
 *                   beveled oak riser, real 3D `studio404-broadcast-mic.glb`, physical ribbed timber slats,
 *                   recessed Control Room observation bay & Caretaker Doorway, pleated 3D crimson curtains,
 *                   CRT racks, overhead truss, 3D ConeGeometry volumetric Fresnel shafts, floor wedge monitors)
 *  2. `caravan`   — Meadow Caravan 3D (GLSL sunset dome, layered parallax hills & pines, scrolling fence,
 *                   corrugated kraft parade wagon, articulated rocking cardstock horse)
 *  3. `storybook` — Pop-Up Storybook 3D (walnut workbench, open crimson hardcover, curved rag-paper pages,
 *                   vertex-curled 3D page-turn leaf, folded cardstock gatehouse, pines & cottages)
 *  4. `cosmic`    — Cosmic Observatory (seamless spherical GLSL nebula sky dome, stepped obsidian & brass
 *                   observatory terrace, etched zodiac dial, astrolabe rings with planets, volumetric starlight)
 *  5. `playroom`  — Toybox Soundstage (angled 3D pegboard corner room, sunlit mullioned window & sunbeams,
 *                   birch floor w/ bump+roughness, cubby shelf, toy blocks, desk lamp, birch play riser)
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CaravanSetpiece3D } from "./caravanSetpiece3D.ts";
import type { CinemaCameraState } from "./cinemaDirector.ts";
import type { StagePropState } from "./stageAutopilot.ts";
import {
  SKY_DOME_SPHERE_GEO,
  UNIT_BOX_GEO,
  UNIT_CIRCLE_GEO,
  UNIT_CONE_BEAM_GEO,
  UNIT_CONE_FLAG_GEO,
  UNIT_CONE_SHADE_GEO,
  UNIT_CYLINDER_BASE_GEO,
  UNIT_CYLINDER_DISC_GEO,
  UNIT_CYLINDER_GEO,
  UNIT_ICO_GEO,
  UNIT_PLANE_GEO,
  UNIT_RING_MED_GEO,
  UNIT_RING_THIN_GEO,
  UNIT_SPHERE_GEO,
  UNIT_TORUS_ORB_GEO,
  UNIT_TORUS_STRIPE_GEO,
  UNIT_TORUS_THIN_GEO,
} from "./stageGeometries.ts";
import {
  createAcousticWallTexture,
  createBirchFloorTextures,
  createCosmicNebulaMaterial,
  createPegboardTexture,
  createRackCrtScreenTexture,
  createRiserOakTexture,
  createSoftGlowTexture,
  createStudio404FloorTextures,
  createStudio404SignTexture,
  createVolumetricBeamMaterial,
  createZodiacDeckTexture,
  type RackCrtScreenTexture,
  type StudioFloorTextures,
} from "./stageTextures.ts";
import { resolveStageWorld, type StageWorldId } from "./stageWorlds.ts";
import type { StageLightingMood } from "./stageDirectorStore.ts";
import {
  PLAYROOM_RISER_TOP_Y,
  STUDIO_RISER_CENTER_Z,
  STUDIO_RISER_TALL_TOP_Y,
  STUDIO_RISER_TOP_Y,
  resolveStudioMicPosition,
  type SurfaceSample,
} from "./stageSurface.ts";
import { StorybookSetpiece3D } from "./storybookSetpiece3D.ts";

export type CameraMode = "authored" | "wide" | "closeup" | "low-angle";

export { STUDIO_RISER_CENTER_Z, STUDIO_RISER_TALL_TOP_Y, STUDIO_RISER_TOP_Y };

export interface OrbitOffset {
  azimuth: number;
  polar: number;
  zoom: number;
}

export interface StudioWorldUpdateParams {
  readonly worldId: StageWorldId;
  readonly lightingMood?: Exclude<StageLightingMood, "auto">;
  readonly timeSec: number;
  readonly beat: number;
  readonly dt?: number;
  readonly actorX: number;
  readonly actorY: number;
  readonly actorZ: number;
  readonly targetX?: number;
  readonly targetSpanX?: number;
  readonly snapCamera?: boolean;
  readonly voiceEnergy: number;
  readonly cinema: CinemaCameraState;
  readonly cameraMode: CameraMode;
  readonly lightingEnabled: boolean;
  readonly showRiser: boolean;
  readonly riserWidth: number;
  readonly riserTopY?: number;
  readonly downstageCount?: number;
  readonly leftmostActorX?: number;
  readonly aspectRatio: number;
  readonly props: readonly StagePropState[];
  readonly orbit: OrbitOffset;
  readonly songTitle?: string;
  readonly sceneIndex?: number;
  readonly sectionName?: string;
  readonly setpiecesPreSynced?: boolean;
}

interface WorldMoodLightingCurve {
  readonly hemi: number;
  readonly key: number;
  readonly rimL: number;
  readonly rimR: number;
  readonly spot: number;
  readonly beam: number;
  readonly fogDensity: number;
  readonly keyHex: string;
  readonly hemiSkyHex: string;
  readonly hemiGroundHex: string;
  readonly rimLeftHex: string;
  readonly rimRightHex: string;
  readonly spotHex: string;
  readonly spotScale: number;
  readonly bgHex: string;
}

function resolveWorldMoodLighting(
  worldId: StageWorldId,
  mood: Exclude<StageLightingMood, "auto">,
): WorldMoodLightingCurve {
  const world = resolveStageWorld(worldId);
  let hemi = 1.0;
  let key = 1.0;
  let rimL = 1.0;
  let rimR = 1.0;
  let spot = 1.0;
  let beam = 0.24;
  let spotScale = 1.0;

  let fogDensity =
    worldId === "playroom"
      ? 0.007
      : worldId === "cosmic"
        ? 0.012
        : worldId === "caravan"
          ? 0.010
          : worldId === "storybook"
            ? 0.011
            : 0.022;

  let keyHex =
    worldId === "cosmic"
      ? "#8ce8ff"
      : worldId === "playroom"
        ? "#fff6df"
        : worldId === "caravan"
          ? "#ffdcb0"
          : worldId === "storybook"
            ? "#ffebd0"
            : "#ffe0b0";

  let hemiSkyHex = worldId === "cosmic" ? "#c2d8ff" : "#fff5e4";
  const hemiGroundHex =
    worldId === "cosmic"
      ? "#1e163a"
      : worldId === "caravan"
        ? "#354a36"
        : worldId === "storybook"
          ? "#4a3624"
          : "#3a2216";
  let rimLeftHex = worldId === "cosmic" ? "#6beeff" : worldId === "caravan" ? "#ffbe68" : "#ffbe74";
  let rimRightHex =
    worldId === "cosmic"
      ? "#c084fc"
      : worldId === "playroom"
        ? "#7ae6d4"
        : worldId === "caravan"
          ? "#ff8a62"
          : worldId === "storybook"
            ? "#6be8f2"
            : "#80e8dc";
  let spotHex = world.lighting.spotColorHex;
  let bgHex = world.lighting.backgroundHex;

  if (mood === "standby-dark") {
    hemi = worldId === "playroom" ? 0.52 : 0.36;
    key = worldId === "playroom" ? 0.56 : 0.44;
    rimL = 0.52;
    rimR = 0.42;
    spot = 1.28;
    beam = 0.14;
    fogDensity *= 1.55;
    spotScale = 0.72;
    bgHex =
      worldId === "theater"
        ? "#0a0507"
        : worldId === "cosmic"
          ? "#03040e"
          : worldId === "playroom"
            ? "#120d10"
            : worldId === "caravan"
              ? "#0e0c18"
              : "#0e0a0b";
    keyHex = worldId === "caravan" || worldId === "storybook" ? "#9cb5dc" : keyHex;
  } else if (mood === "arena-lit") {
    hemi = 1.18;
    key = 1.24;
    rimL = 1.32;
    rimR = 1.28;
    spot = 1.18;
    beam = 0.34;
    fogDensity *= 0.72;
    spotScale = 1.18;
  } else if (mood === "phosphor-booth") {
    hemi = 0.48;
    key = 0.58;
    rimL = 0.48;
    rimR = 1.65;
    spot = 1.16;
    beam = 0.20;
    fogDensity *= 1.32;
    keyHex = "#9ef5eb";
    hemiSkyHex = "#b4f8ef";
    rimRightHex = "#57f2da";
    spotHex = "#57f2da";
    spotScale = 0.86;
    bgHex =
      worldId === "theater"
        ? "#071418"
        : worldId === "cosmic"
          ? "#040f1c"
          : worldId === "caravan"
            ? "#0b1720"
            : worldId === "storybook"
              ? "#0c171b"
              : "#111b20";
  } else if (mood === "encore-surge") {
    hemi = 1.34;
    key = 1.40;
    rimL = 1.54;
    rimR = 1.44;
    spot = 1.50;
    beam = 0.44;
    fogDensity *= 0.65;
    keyHex = "#ffebbf";
    rimLeftHex = "#ffd884";
    spotHex = "#ffe099";
    spotScale = 1.34;
  }

  return {
    hemi,
    key,
    rimL,
    rimR,
    spot,
    beam,
    fogDensity,
    keyHex,
    hemiSkyHex,
    hemiGroundHex,
    rimLeftHex,
    rimRightHex,
    spotHex,
    spotScale,
    bgHex,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function stepCriticalSpring(
  cur: number,
  vel: number,
  target: number,
  omega: number,
  dt: number,
): [number, number] {
  const diff = cur - target;
  const temp = (vel + omega * diff) * dt;
  const e = Math.exp(-omega * dt);
  return [target + (diff + temp) * e, (vel - omega * temp) * e];
}

function seededRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a sculpted 3D pleated stage curtain bay from sinusoidal ribbed cylinder columns. */
function buildPleatedCurtain(
  side: -1 | 1,
  mat: THREE.MeshStandardMaterial,
  cordMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const grp = new THREE.Group();
  const pleats = 7;
  const totalW = 2.35;
  const colW = totalW / pleats;
  for (let i = 0; i < pleats; i++) {
    const u = i / (pleats - 1);
    const px = (i - (pleats - 1) * 0.5) * colW * 0.92;
    const pz = Math.sin(u * Math.PI * 3.5) * 0.14;
    const r = colW * 0.56;
    const fold = new THREE.Mesh(UNIT_CYLINDER_GEO, mat);
    fold.position.set(px, 2.42, pz);
    fold.scale.set(r, 4.9, r * 0.72);
    fold.castShadow = true;
    fold.receiveShadow = true;
    grp.add(fold);
  }
  // Upper brass valance rail + gold tie-back band
  const rail = new THREE.Mesh(UNIT_CYLINDER_GEO, cordMat);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 4.78, 0.12);
  rail.scale.set(0.035, totalW + 0.25, 0.035);
  grp.add(rail);

  const tie = new THREE.Mesh(UNIT_TORUS_THIN_GEO, cordMat);
  tie.rotation.x = Math.PI / 2;
  tie.position.set(side * -0.12, 1.52, 0.16);
  tie.scale.set(totalW * 0.48, 0.22, 1.4);
  grp.add(tie);

  return grp;
}

/** Build a real 3D Studio 404 steel equipment rack with stacked glowing CRT monitors & patch units. */
function buildStudioCrtRack(
  side: -1 | 1,
  steelMat: THREE.MeshStandardMaterial,
  chassisMat: THREE.MeshStandardMaterial,
  brassMat: THREE.MeshStandardMaterial,
  screenMatTop: THREE.MeshStandardMaterial,
  screenMatBottom: THREE.MeshStandardMaterial,
): THREE.Group {
  const rack = new THREE.Group();

  // 4 corner steel angle posts
  const rackW = 1.42;
  const rackD = 0.76;
  const rackH = 3.25;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(UNIT_BOX_GEO, steelMat);
      post.position.set(sx * (rackW * 0.5 - 0.04), rackH * 0.5, sz * (rackD * 0.5 - 0.04));
      post.scale.set(0.055, rackH, 0.055);
      post.castShadow = true;
      post.receiveShadow = true;
      rack.add(post);
    }
  }

  // 4 solid metal shelves
  for (const sy of [0.14, 1.05, 2.02, 2.98]) {
    const shelf = new THREE.Mesh(UNIT_BOX_GEO, steelMat);
    shelf.position.set(0, sy, 0);
    shelf.scale.set(rackW, 0.045, rackD);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    rack.add(shelf);
  }

  // Lower rack: vintage 19-inch patch bay + rotary brass knobs + green/amber LEDs
  const ampBox = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
  ampBox.position.set(0, 0.58, 0.02);
  ampBox.scale.set(rackW - 0.14, 0.74, rackD - 0.1);
  ampBox.castShadow = true;
  rack.add(ampBox);
  for (let k = 0; k < 5; k++) {
    const knob = new THREE.Mesh(UNIT_CYLINDER_GEO, brassMat);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(-0.42 + k * 0.21, 0.62, rackD * 0.5 - 0.02);
    knob.scale.set(0.042, 0.05, 0.042);
    rack.add(knob);
  }

  // Middle & Upper shelves: real 3D boxed broadcast CRT monitors with recessed glowing glass
  const addCrtMonitor = (yBase: number, w: number, h: number, d: number, yaw: number, scrMat: THREE.MeshStandardMaterial) => {
    const mon = new THREE.Group();
    mon.position.set(0, yBase + h * 0.5, 0.04);
    mon.rotation.y = yaw;

    const body = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
    body.scale.set(w, h, d);
    body.castShadow = true;
    body.receiveShadow = true;
    mon.add(body);

    // Bezel frame lip around front screen
    const bezel = new THREE.Mesh(UNIT_BOX_GEO, steelMat);
    bezel.position.set(0, 0.02, d * 0.5 + 0.015);
    bezel.scale.set(w * 0.94, h * 0.86, 0.03);
    mon.add(bezel);

    // Glowing phosphor glass face
    const glass = new THREE.Mesh(UNIT_PLANE_GEO, scrMat);
    glass.position.set(0, 0.02, d * 0.5 + 0.034);
    glass.scale.set(w * 0.80, h * 0.68, 1);
    mon.add(glass);

    // Small warm power LED
    const led = new THREE.Mesh(
      UNIT_SPHERE_GEO,
      new THREE.MeshBasicMaterial({ color: side < 0 ? "#42f5d8" : "#ff9d42", toneMapped: false }),
    );
    led.position.set(w * 0.36, -h * 0.36, d * 0.5 + 0.032);
    led.scale.setScalar(0.018);
    mon.add(led);

    rack.add(mon);
  };

  addCrtMonitor(1.08, 1.06, 0.84, 0.64, side * -0.09, screenMatBottom);
  addCrtMonitor(2.05, 0.92, 0.76, 0.58, side * -0.14, screenMatTop);

  return rack;
}

/** Build overhead steel box-truss & articulated barn-door Fresnel stage lamps. */
function buildOverheadTruss(
  steelMat: THREE.MeshStandardMaterial,
  lampMat: THREE.MeshStandardMaterial,
  lensMat: THREE.MeshBasicMaterial,
): THREE.Group {
  const truss = new THREE.Group();
  truss.position.set(0, 4.48, -0.55);

  const span = 12.6;
  // 4 longitudinal chord rails
  for (const dy of [-0.18, 0.18]) {
    for (const dz of [-0.18, 0.18]) {
      const rail = new THREE.Mesh(UNIT_CYLINDER_GEO, steelMat);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, dy, dz);
      rail.scale.set(0.024, span, 0.024);
      truss.add(rail);
    }
  }
  // Vertical & diagonal lacing struts
  const bays = 16;
  const bayW = span / bays;
  for (let i = 0; i <= bays; i++) {
    const bx = -span * 0.5 + i * bayW;
    for (const dz of [-0.18, 0.18]) {
      const v = new THREE.Mesh(UNIT_CYLINDER_GEO, steelMat);
      v.position.set(bx, 0, dz);
      v.scale.set(0.014, 0.36, 0.014);
      truss.add(v);
    }
    if (i < bays) {
      const diag = new THREE.Mesh(UNIT_CYLINDER_GEO, steelMat);
      diag.position.set(bx + bayW * 0.5, 0, 0.18);
      diag.rotation.z = i % 2 === 0 ? 0.58 : -0.58;
      diag.scale.set(0.012, Math.hypot(bayW, 0.36), 0.012);
      truss.add(diag);
    }
  }

  // 4 barn-door Fresnel studio lamps hung underneath the truss
  const lampXs = [-3.4, -1.25, 1.25, 3.4];
  for (const lx of lampXs) {
    const fixture = new THREE.Group();
    fixture.position.set(lx, -0.34, 0.16);
    // Aim gently down & inward toward center stage
    fixture.rotation.set(0.46, lx * -0.14, 0);

    const yoke = new THREE.Mesh(UNIT_BOX_GEO, steelMat);
    yoke.position.set(0, 0.16, 0);
    yoke.scale.set(0.32, 0.04, 0.06);
    fixture.add(yoke);

    const can = new THREE.Mesh(UNIT_CYLINDER_GEO, lampMat);
    can.rotation.x = Math.PI / 2;
    can.scale.set(0.16, 0.34, 0.16);
    fixture.add(can);

    // Warm Fresnel glass lens
    const lens = new THREE.Mesh(UNIT_CIRCLE_GEO, lensMat);
    lens.position.set(0, 0, 0.175);
    lens.scale.set(0.135, 0.135, 1);
    fixture.add(lens);

    // 4 angled barn-door flaps
    const flapOffsets: [number, number, number, number][] = [
      [0, 0.15, 0.22, 0],
      [0, -0.15, 0.22, 0],
      [-0.15, 0, 0.22, Math.PI / 2],
      [0.15, 0, 0.22, Math.PI / 2],
    ];
    for (const [fx, fy, fz, frot] of flapOffsets) {
      const flap = new THREE.Mesh(UNIT_BOX_GEO, lampMat);
      flap.position.set(fx, fy, fz);
      flap.rotation.z = frot;
      flap.scale.set(0.24, 0.09, 0.014);
      fixture.add(flap);
    }

    truss.add(fixture);
  }

  return truss;
}

interface DynamicPropEntry {
  readonly kind: StagePropState["kind"];
  readonly group: THREE.Group;
  readonly sync: (prop: StagePropState, timeSec: number, lightingEnabled: boolean) => void;
}

export class StudioWorldRig {
  readonly root = new THREE.Group();

  private readonly bgColor = new THREE.Color("#140a0e");
  private readonly fog = new THREE.FogExp2("#140a0e", 0.022);

  // Scene Lights
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly rimLeftLight: THREE.DirectionalLight;
  private readonly rimRightLight: THREE.DirectionalLight;
  private readonly actorSpot: THREE.PointLight;

  // World groups
  private readonly theaterGroup = new THREE.Group();
  private readonly cosmicGroup = new THREE.Group();
  private readonly playroomGroup = new THREE.Group();
  private readonly riserGroup = new THREE.Group();
  private readonly playroomRiserGroup = new THREE.Group();
  private readonly propsGroup = new THREE.Group();
  private readonly caravanSetpiece: CaravanSetpiece3D;
  private readonly storybookSetpiece: StorybookSetpiece3D;

  // Animated world elements
  private readonly fresnelLeft: THREE.Mesh;
  private readonly fresnelRight: THREE.Mesh;
  private readonly fresnelLeftMat: THREE.ShaderMaterial;
  private readonly fresnelRightMat: THREE.ShaderMaterial;
  private readonly sunbeamMat: THREE.ShaderMaterial;
  private readonly starBeamMat: THREE.ShaderMaterial;
  private readonly theaterSpotPool: THREE.Mesh | null = null;
  private readonly cosmicSpotPool: THREE.Mesh | null = null;
  private readonly astrolabeOuter: THREE.Mesh;
  private readonly astrolabeInner: THREE.Mesh;
  private readonly orrerySpinner: THREE.Group;
  private readonly nebulaMat: THREE.ShaderMaterial;
  private readonly zodiacTex: THREE.CanvasTexture | null;
  private readonly boothBacklightMat: THREE.MeshBasicMaterial;
  private readonly buntingFlags: THREE.Mesh[] = [];
  private readonly particles: THREE.Points;
  private readonly particleSeeds: { x: number; y: number; z: number; speed: number; phase: number }[];
  private readonly particleMat: THREE.PointsMaterial;
  private particleWorld: StageWorldId = "theater";

  // Procedural textures / disposables
  private readonly floorTextures: StudioFloorTextures | null;
  private readonly birchFloorTextures: StudioFloorTextures | null;
  private readonly riserOakTex: THREE.CanvasTexture | null;
  private readonly wallTex: THREE.CanvasTexture | null;
  private readonly signTex: THREE.CanvasTexture | null;
  private readonly crtScope: RackCrtScreenTexture | null;
  private readonly crtBars: RackCrtScreenTexture | null;
  private readonly spotPoolTex: THREE.CanvasTexture | null;
  private readonly pegboardTex: THREE.CanvasTexture | null;
  private readonly softGlowTex: THREE.CanvasTexture | null;
  private readonly extraDisposables: { dispose(): void }[] = [];

  private readonly propEntries = new Map<string, DynamicPropEntry>();
  private micRoot: THREE.Object3D | null = null;
  private disposed = false;

  // Critically-damped 3D cinema camera spring state (damped before applying interactive orbit)
  private readonly camCurPos = new THREE.Vector3(0, 1.65, 9.2);
  private readonly camVelPos = new THREE.Vector3();
  private readonly camCurLook = new THREE.Vector3(0, 1.34, 0.1);
  private readonly camVelLook = new THREE.Vector3();
  private camSpringInit = false;

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.root);

    // ── Real 3D Lights (key casts PCFSoftShadowMap shadows onto bare Studio 404 floor!) ──
    this.hemiLight = new THREE.HemisphereLight("#fff3df", "#2a1914", 0.72);
    this.root.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight("#ffe6be", 2.15);
    this.keyLight.position.set(-3.2, 6.8, 4.8);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 26;
    this.keyLight.shadow.camera.left = -6.2;
    this.keyLight.shadow.camera.right = 6.2;
    this.keyLight.shadow.camera.top = 5.2;
    this.keyLight.shadow.camera.bottom = -3.8;
    this.keyLight.shadow.camera.updateProjectionMatrix();
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 2.0;
    this.root.add(this.keyLight);

    this.rimLeftLight = new THREE.DirectionalLight("#ffbf78", 1.35);
    this.rimLeftLight.position.set(-5.0, 4.8, -2.2);
    this.root.add(this.rimLeftLight);

    this.rimRightLight = new THREE.DirectionalLight("#7de8dc", 1.15);
    this.rimRightLight.position.set(5.0, 4.6, -1.8);
    this.root.add(this.rimRightLight);

    this.actorSpot = new THREE.PointLight("#ffd28a", 2.2, 9.0, 1.4);
    this.actorSpot.position.set(0, 2.8, 1.5);
    this.root.add(this.actorSpot);

    // ── Procedural Textures & Shaders ──
    this.floorTextures = createStudio404FloorTextures();
    this.birchFloorTextures = createBirchFloorTextures();
    this.riserOakTex = createRiserOakTexture();
    this.wallTex = createAcousticWallTexture();
    this.signTex = createStudio404SignTexture();
    this.crtScope = createRackCrtScreenTexture("scope");
    this.crtBars = createRackCrtScreenTexture("bars");
    this.spotPoolTex = createSoftGlowTexture("rgba(255, 232, 184, 0.44)", "rgba(255, 204, 134, 0.16)");
    this.softGlowTex = createSoftGlowTexture("rgba(255,255,255,0.65)", "rgba(255,255,255,0.22)");
    this.pegboardTex = createPegboardTexture();
    this.zodiacTex = createZodiacDeckTexture();
    this.nebulaMat = createCosmicNebulaMaterial();

    // ═══════════════════════════════════════════════════════════════════════
    // WORLD 1: REAL 3D STUDIO 404 BROADCAST SOUNDSTAGE (ZERO FLAT JPEG BACKDROP)
    // ═══════════════════════════════════════════════════════════════════════
    const steelMat = new THREE.MeshStandardMaterial({ color: "#2d323b", metalness: 0.78, roughness: 0.34 });
    const chassisMat = new THREE.MeshStandardMaterial({ color: "#1c1f25", metalness: 0.42, roughness: 0.56 });
    const brassMat = new THREE.MeshStandardMaterial({ color: "#c99a56", metalness: 0.82, roughness: 0.26 });
    const velvetMat = new THREE.MeshStandardMaterial({ color: "#5e1624", metalness: 0.06, roughness: 0.88 });
    const lampMat = new THREE.MeshStandardMaterial({ color: "#16181e", metalness: 0.65, roughness: 0.38 });
    const lensMat = new THREE.MeshBasicMaterial({ color: "#ffe7b5", toneMapped: false });
    const darkTimberMat = new THREE.MeshStandardMaterial({ color: "#2c1d18", roughness: 0.76, metalness: 0.08 });

    // Bare scuffed dark-walnut / concrete studio floor (Zero Persian Rug Lock!)
    const floorMat = new THREE.MeshStandardMaterial({
      color: "#c8b7a8",
      map: this.floorTextures?.map ?? null,
      roughnessMap: this.floorTextures?.roughnessMap ?? null,
      bumpMap: this.floorTextures?.bumpMap ?? null,
      bumpScale: 0.015,
      roughness: 0.72,
      metalness: 0.08,
    });
    const floor = new THREE.Mesh(UNIT_PLANE_GEO, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -0.4);
    floor.scale.set(22, 14, 1);
    floor.receiveShadow = true;
    this.theaterGroup.add(floor);

    // Subtle brass floor stage edge strip + gaffer tape center spike mark
    const apronTrim = new THREE.Mesh(UNIT_BOX_GEO, brassMat);
    apronTrim.position.set(0, 0.008, 2.35);
    apronTrim.scale.set(11.6, 0.016, 0.06);
    this.theaterGroup.add(apronTrim);

    const gafferMat = new THREE.MeshStandardMaterial({ color: "#d6a446", roughness: 0.82, metalness: 0.05 });
    const gafferH = new THREE.Mesh(UNIT_PLANE_GEO, gafferMat);
    gafferH.rotation.x = -Math.PI / 2;
    gafferH.position.set(0, 0.005, 0.24);
    gafferH.scale.set(0.32, 0.04, 1);
    this.theaterGroup.add(gafferH);
    const gafferV = new THREE.Mesh(UNIT_PLANE_GEO, gafferMat);
    gafferV.rotation.x = -Math.PI / 2;
    gafferV.position.set(0, 0.005, 0.24);
    gafferV.scale.set(0.04, 0.22, 1);
    this.theaterGroup.add(gafferV);

    // Rear acoustic backing wall (`z = -4.05`) + flanking left/right acoustic bays around recessed Control Room
    const backWallMat = new THREE.MeshStandardMaterial({
      color: "#d4c8ce",
      map: this.wallTex ?? null,
      roughness: 0.86,
      metalness: 0.08,
    });
    for (const [bx, bw, by, bh] of [
      [-5.95, 7.2, 2.9, 6.2],
      [5.95, 7.2, 2.9, 6.2],
      [0, 4.8, 0.72, 1.44],
      [0, 4.8, 4.65, 2.7],
    ] as const) {
      const panel = new THREE.Mesh(UNIT_BOX_GEO, backWallMat);
      panel.position.set(bx, by, -3.95);
      panel.scale.set(bw, bh, 0.24);
      panel.receiveShadow = true;
      this.theaterGroup.add(panel);
    }

    // Physical 3D ribbed acoustic timber slats projecting off the rear wall
    const slatGeo = new THREE.BoxGeometry(0.09, 5.5, 0.09);
    this.extraDisposables.push(slatGeo);
    for (let sx = -7.6; sx <= 7.6; sx += 0.36) {
      if (Math.abs(sx) < 2.45) continue; // Clear center Control Room observation bay
      if (sx > 3.7 && sx < 5.1) continue; // Clear Caretaker Doorway bay
      const slat = new THREE.Mesh(slatGeo, darkTimberMat);
      slat.position.set(sx, 2.88, -3.81);
      slat.castShadow = true;
      slat.receiveShadow = true;
      this.theaterGroup.add(slat);
    }

    // Recessed Control Room Observation Bay (`z = -4.35`) with warm glowing interior booth backlight
    this.boothBacklightMat = new THREE.MeshBasicMaterial({ color: "#ffbe73", toneMapped: false });
    const boothBackWall = new THREE.Mesh(UNIT_PLANE_GEO, this.boothBacklightMat);
    boothBackWall.position.set(0, 2.38, -4.48);
    boothBackWall.scale.set(4.6, 1.85, 1);
    this.theaterGroup.add(boothBackWall);

    const boothConsole = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
    boothConsole.position.set(0, 1.66, -4.22);
    boothConsole.scale.set(3.8, 0.32, 0.48);
    this.theaterGroup.add(boothConsole);

    const vuGlow = new THREE.Mesh(
      UNIT_BOX_GEO,
      new THREE.MeshBasicMaterial({ color: "#4af5d6", toneMapped: false }),
    );
    vuGlow.position.set(-0.65, 1.84, -4.18);
    vuGlow.scale.set(1.4, 0.05, 0.08);
    this.theaterGroup.add(vuGlow);

    // Control Room steel frame, center mullion & double-pane studio glass
    const obsGlass = new THREE.Mesh(
      UNIT_PLANE_GEO,
      new THREE.MeshStandardMaterial({
        color: "#8ab6c4",
        transparent: true,
        opacity: 0.24,
        roughness: 0.14,
        metalness: 0.18,
      }),
    );
    obsGlass.position.set(0, 2.36, -3.92);
    obsGlass.scale.set(4.5, 1.72, 1);
    this.theaterGroup.add(obsGlass);

    for (const [fx, fy, fw, fh] of [
      [0, 1.48, 4.75, 0.10],
      [0, 3.24, 4.75, 0.10],
      [-2.32, 2.36, 0.12, 1.85],
      [2.32, 2.36, 0.12, 1.85],
      [0, 2.36, 0.07, 1.76],
    ] as const) {
      const frame = new THREE.Mesh(UNIT_BOX_GEO, steelMat);
      frame.position.set(fx, fy, -3.87);
      frame.scale.set(fw, fh, 0.18);
      this.theaterGroup.add(frame);
    }

    // Caretaker Doorway Bay (`x = +4.4, z = -3.82`) with frosted transom & brass lever
    const doorFrame = new THREE.Mesh(UNIT_BOX_GEO, darkTimberMat);
    doorFrame.position.set(4.4, 1.55, -3.86);
    doorFrame.scale.set(1.22, 2.86, 0.16);
    this.theaterGroup.add(doorFrame);
    const doorSlab = new THREE.Mesh(UNIT_BOX_GEO, new THREE.MeshStandardMaterial({ color: "#3d271c", roughness: 0.72 }));
    doorSlab.position.set(4.4, 1.48, -3.81);
    doorSlab.scale.set(1.04, 2.66, 0.08);
    this.theaterGroup.add(doorSlab);
    const doorTransom = new THREE.Mesh(
      UNIT_PLANE_GEO,
      new THREE.MeshBasicMaterial({ color: "#ffdca0", toneMapped: false }),
    );
    doorTransom.position.set(4.4, 2.48, -3.76);
    doorTransom.scale.set(0.68, 0.36, 1);
    this.theaterGroup.add(doorTransom);
    const doorHandle = new THREE.Mesh(UNIT_BOX_GEO, brassMat);
    doorHandle.position.set(4.02, 1.24, -3.74);
    doorHandle.scale.set(0.14, 0.035, 0.07);
    this.theaterGroup.add(doorHandle);

    const baseboard = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
    baseboard.position.set(0, 0.14, -3.78);
    baseboard.scale.set(19, 0.28, 0.12);
    this.theaterGroup.add(baseboard);

    // Side wing acoustic walls creating a genuine 3D soundstage room envelope
    for (const side of [-1, 1] as const) {
      const wing = new THREE.Mesh(UNIT_BOX_GEO, backWallMat);
      wing.position.set(side * 8.4, 2.9, -0.5);
      wing.rotation.y = side * -0.18;
      wing.scale.set(0.24, 6.2, 9.0);
      wing.receiveShadow = true;
      this.theaterGroup.add(wing);

      // Sculpted 3D pleated crimson curtains flanking the broadcast bay
      const curtain = buildPleatedCurtain(side, velvetMat, brassMat);
      curtain.position.set(side * 5.25, 0, -2.95);
      curtain.rotation.y = side * -0.22;
      this.theaterGroup.add(curtain);
    }

    // Left & Right 3D steel studio racks with live glowing CRT monitors
    const scopeMat = new THREE.MeshStandardMaterial({
      color: "#091214",
      roughness: 0.18,
      metalness: 0.08,
      emissive: "#ffffff",
      emissiveMap: this.crtScope?.texture ?? null,
      emissiveIntensity: 1.35,
    });
    const barsMat = new THREE.MeshStandardMaterial({
      color: "#091214",
      roughness: 0.18,
      metalness: 0.08,
      emissive: "#ffffff",
      emissiveMap: this.crtBars?.texture ?? null,
      emissiveIntensity: 1.15,
    });
    const leftRack = buildStudioCrtRack(-1, steelMat, chassisMat, brassMat, scopeMat, barsMat);
    leftRack.position.set(-3.35, 0, -2.75);
    leftRack.rotation.y = 0.24;
    this.theaterGroup.add(leftRack);

    const rightRack = buildStudioCrtRack(1, steelMat, chassisMat, brassMat, barsMat, scopeMat);
    rightRack.position.set(3.35, 0, -2.75);
    rightRack.rotation.y = -0.24;
    this.theaterGroup.add(rightRack);

    // Asymmetric studio dressing clear of actors: 2 angled floor wedge monitors at far wings + coiled XLR cables
    const grilleMat = new THREE.MeshStandardMaterial({ color: "#15181d", metalness: 0.55, roughness: 0.45 });
    for (const side of [-1, 1] as const) {
      const wedge = new THREE.Group();
      wedge.position.set(side * 3.8, 0, 1.45);
      wedge.rotation.y = side * -2.42; // angled back toward performers
      const cab = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
      cab.position.set(0, 0.12, 0);
      cab.rotation.x = -0.42;
      cab.scale.set(0.68, 0.24, 0.44);
      cab.castShadow = true;
      cab.receiveShadow = true;
      wedge.add(cab);
      const grille = new THREE.Mesh(UNIT_PLANE_GEO, grilleMat);
      grille.position.set(0, 0.18, 0.18);
      grille.rotation.x = -1.12;
      grille.scale.set(0.58, 0.32, 1);
      wedge.add(grille);
      this.theaterGroup.add(wedge);
    }

    // Subtle coiled XLR cable loops near mic & racks
    const xlrMat = new THREE.MeshStandardMaterial({ color: "#121418", roughness: 0.65 });
    for (const [cx, cz, cr] of [
      [-2.78, 0.68, 0.19],
      [-2.82, -2.18, 0.22],
      [2.85, -2.18, 0.20],
    ] as const) {
      const coil = new THREE.Mesh(UNIT_TORUS_ORB_GEO, xlrMat);
      coil.rotation.x = Math.PI / 2;
      coil.position.set(cx, 0.014, cz);
      coil.scale.set(cr, cr, 0.5);
      this.theaterGroup.add(coil);
    }

    // Studio 404 illuminated proscenium sign box mounted cleanly above the Control Room window
    if (this.signTex) {
      const signHousing = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
      signHousing.position.set(0, 3.82, -3.65);
      signHousing.scale.set(3.15, 0.78, 0.18);
      this.theaterGroup.add(signHousing);

      const signFace = new THREE.Mesh(
        UNIT_PLANE_GEO,
        new THREE.MeshBasicMaterial({ map: this.signTex, toneMapped: false }),
      );
      signFace.position.set(0, 3.82, -3.55);
      signFace.scale.set(3.04, 0.70, 1);
      this.theaterGroup.add(signFace);
    }

    // Overhead steel box-truss & 4 barn-door Fresnel studio lamps
    this.theaterGroup.add(buildOverheadTruss(steelMat, lampMat, lensMat));

    // Real 3D beveled wooden upstage band/choir riser (multi-piece carpentry: plinth + deck + brass edge; top = 0.28)
    const riserPlinth = new THREE.Mesh(
      UNIT_BOX_GEO,
      new THREE.MeshStandardMaterial({ color: "#1d120e", roughness: 0.78, metalness: 0.12 }),
    );
    riserPlinth.position.set(0, 0.11, STUDIO_RISER_CENTER_Z);
    riserPlinth.scale.set(1, 0.22, 1.32);
    riserPlinth.castShadow = true;
    riserPlinth.receiveShadow = true;
    this.riserGroup.add(riserPlinth);

    const riserDeck = new THREE.Mesh(
      UNIT_BOX_GEO,
      new THREE.MeshStandardMaterial({
        color: "#b9926c",
        map: this.riserOakTex ?? null,
        roughness: 0.56,
        metalness: 0.08,
      }),
    );
    riserDeck.position.set(0, 0.25, STUDIO_RISER_CENTER_Z);
    riserDeck.scale.set(1.03, 0.06, 1.44);
    riserDeck.castShadow = true;
    riserDeck.receiveShadow = true;
    this.riserGroup.add(riserDeck);

    const riserEdge = new THREE.Mesh(UNIT_BOX_GEO, brassMat);
    riserEdge.position.set(0, 0.252, STUDIO_RISER_CENTER_Z + 0.725);
    riserEdge.scale.set(1.034, 0.044, 0.028);
    this.riserGroup.add(riserEdge);
    this.theaterGroup.add(this.riserGroup);

    // Real 3D open-ended ConeGeometry volumetric Fresnel shafts (never collapse into flat lines on 3D orbit!)
    this.fresnelLeftMat = createVolumetricBeamMaterial("#ffda96", 0.22);
    this.fresnelLeft = new THREE.Mesh(UNIT_CONE_BEAM_GEO, this.fresnelLeftMat);
    this.fresnelLeft.position.set(-2.05, 2.25, -0.75);
    this.fresnelLeft.rotation.set(0.18, 0, -0.34);
    this.fresnelLeft.scale.set(1.65, 5.4, 1.65);
    this.fresnelLeft.renderOrder = 32;
    this.theaterGroup.add(this.fresnelLeft);

    this.fresnelRightMat = createVolumetricBeamMaterial("#ffd590", 0.19);
    this.fresnelRight = new THREE.Mesh(UNIT_CONE_BEAM_GEO, this.fresnelRightMat);
    this.fresnelRight.position.set(2.15, 2.22, -0.75);
    this.fresnelRight.rotation.set(0.18, 0, 0.34);
    this.fresnelRight.scale.set(1.55, 5.2, 1.55);
    this.fresnelRight.renderOrder = 32;
    this.theaterGroup.add(this.fresnelRight);

    if (this.spotPoolTex) {
      this.theaterSpotPool = new THREE.Mesh(
        UNIT_PLANE_GEO,
        new THREE.MeshBasicMaterial({
          map: this.spotPoolTex,
          color: "#ffd28c",
          transparent: true,
          opacity: 0.44,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      this.theaterSpotPool.rotation.x = -Math.PI / 2;
      this.theaterSpotPool.position.set(0, 0.01, 0.2);
      this.theaterSpotPool.scale.set(3.6, 2.1, 1);
      this.theaterSpotPool.renderOrder = 42;
      this.theaterGroup.add(this.theaterSpotPool);
    }

    // Load real 3D Studio 404 broadcast mic GLB non-contact frontline beside the riser!
    this.loadBroadcastMic();

    this.root.add(this.theaterGroup);

    // ═══════════════════════════════════════════════════════════════════════
    // WORLD 2: COSMIC OBSERVATORY / STARLIGHT DRIFT (360° DOME + OBSIDIAN TERRACE)
    // ═══════════════════════════════════════════════════════════════════════
    const nebulaDome = new THREE.Mesh(SKY_DOME_SPHERE_GEO, this.nebulaMat);
    nebulaDome.renderOrder = 4;
    this.cosmicGroup.add(nebulaDome);

    // Stepped Obsidian & Brushed-Brass Observatory Platform Terrace (upper top = y = 0.0)
    const obsidianTopMat = new THREE.MeshStandardMaterial({
      color: "#141a32",
      metalness: 0.38,
      roughness: 0.34,
    });
    const obsidianBaseMat = new THREE.MeshStandardMaterial({
      color: "#0b0f20",
      metalness: 0.32,
      roughness: 0.44,
    });
    const terraceTop = new THREE.Mesh(new THREE.CylinderGeometry(5.0, 5.14, 0.22, 48), obsidianTopMat);
    terraceTop.position.set(0, -0.11, 0);
    terraceTop.receiveShadow = true;
    this.extraDisposables.push(terraceTop.geometry);
    this.cosmicGroup.add(terraceTop);

    const terraceStep = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.78, 0.20, 48), obsidianBaseMat);
    terraceStep.position.set(0, -0.28, 0);
    terraceStep.receiveShadow = true;
    this.extraDisposables.push(terraceStep.geometry);
    this.cosmicGroup.add(terraceStep);

    const terraceRimGeo = new THREE.TorusGeometry(5.0, 0.042, 10, 64);
    this.extraDisposables.push(terraceRimGeo);
    const terraceRim = new THREE.Mesh(terraceRimGeo, brassMat);
    terraceRim.rotation.x = Math.PI / 2;
    terraceRim.position.y = 0.002;
    this.cosmicGroup.add(terraceRim);

    const stepRimGeo = new THREE.TorusGeometry(5.6, 0.036, 10, 64);
    this.extraDisposables.push(stepRimGeo);
    const stepRim = new THREE.Mesh(stepRimGeo, brassMat);
    stepRim.rotation.x = Math.PI / 2;
    stepRim.position.y = -0.18;
    this.cosmicGroup.add(stepRim);

    if (this.zodiacTex) {
      const zodiacGeo = new THREE.CircleGeometry(4.85, 64);
      this.extraDisposables.push(zodiacGeo);
      const zodiacRing = new THREE.Mesh(
        zodiacGeo,
        new THREE.MeshBasicMaterial({
          map: this.zodiacTex,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      zodiacRing.rotation.x = -Math.PI / 2;
      zodiacRing.position.y = 0.004;
      zodiacRing.renderOrder = 16;
      this.cosmicGroup.add(zodiacRing);
    }

    // Rear corner brass telescope & planetary orrery pillars (`z = -3.1`)
    const pillarGeo = new THREE.CylinderGeometry(0.18, 0.24, 1.05, 16);
    this.extraDisposables.push(pillarGeo);

    // Stage-left Brass Refractor Telescope on Pillar
    const scopePillar = new THREE.Group();
    scopePillar.position.set(-3.45, 0, -3.1);
    const spBase = new THREE.Mesh(pillarGeo, obsidianBaseMat);
    spBase.position.y = 0.525;
    spBase.castShadow = true;
    scopePillar.add(spBase);
    const scopeTube = new THREE.Mesh(UNIT_CYLINDER_GEO, brassMat);
    scopeTube.position.set(0.08, 1.28, 0.05);
    scopeTube.rotation.set(0.55, 0.4, -0.45);
    scopeTube.scale.set(0.075, 0.92, 0.075);
    scopeTube.castShadow = true;
    scopePillar.add(scopeTube);
    this.cosmicGroup.add(scopePillar);

    // Stage-right Planetary Orrery Pillar
    const orreryPillar = new THREE.Group();
    orreryPillar.position.set(3.45, 0, -3.1);
    const orBase = new THREE.Mesh(pillarGeo, obsidianBaseMat);
    orBase.position.y = 0.525;
    orBase.castShadow = true;
    orreryPillar.add(orBase);
    this.orrerySpinner = new THREE.Group();
    this.orrerySpinner.position.set(0, 1.28, 0);
    const orSun = new THREE.Mesh(
      UNIT_SPHERE_GEO,
      new THREE.MeshStandardMaterial({ color: "#ffd870", emissive: "#ffa830", emissiveIntensity: 0.9 }),
    );
    orSun.scale.setScalar(0.11);
    this.orrerySpinner.add(orSun);
    const orRing = new THREE.Mesh(UNIT_TORUS_ORB_GEO, brassMat);
    orRing.rotation.x = Math.PI / 2;
    orRing.scale.setScalar(0.32);
    this.orrerySpinner.add(orRing);
    const orPlanet = new THREE.Mesh(
      UNIT_SPHERE_GEO,
      new THREE.MeshStandardMaterial({ color: "#68f0dc", emissive: "#3ec8b4", emissiveIntensity: 0.65 }),
    );
    orPlanet.position.set(0.32, 0.02, 0);
    orPlanet.scale.setScalar(0.055);
    this.orrerySpinner.add(orPlanet);
    orreryPillar.add(this.orrerySpinner);
    this.cosmicGroup.add(orreryPillar);

    // Thicker engraved dual astrolabe rings + orbiting glowing planet spheres
    const astrolabeGroup = new THREE.Group();
    astrolabeGroup.position.set(0, 3.05, -4.45);
    const astroOuterGeo = new THREE.TorusGeometry(2.15, 0.055, 16, 84);
    const astroInnerGeo = new THREE.TorusGeometry(1.58, 0.044, 16, 72);
    this.extraDisposables.push(astroOuterGeo, astroInnerGeo);

    this.astrolabeOuter = new THREE.Mesh(
      astroOuterGeo,
      new THREE.MeshStandardMaterial({
        color: "#e3bd7f",
        metalness: 0.85,
        roughness: 0.2,
        emissive: "#57e8d4",
        emissiveIntensity: 0.38,
      }),
    );
    const outerMoon = new THREE.Mesh(
      UNIT_SPHERE_GEO,
      new THREE.MeshStandardMaterial({ color: "#76f6e4", emissive: "#48d8c6", emissiveIntensity: 0.9 }),
    );
    outerMoon.position.set(2.15, 0, 0);
    outerMoon.scale.setScalar(0.13);
    this.astrolabeOuter.add(outerMoon);
    astrolabeGroup.add(this.astrolabeOuter);

    this.astrolabeInner = new THREE.Mesh(
      astroInnerGeo,
      new THREE.MeshStandardMaterial({
        color: "#b784ff",
        metalness: 0.65,
        roughness: 0.25,
        emissive: "#9d6bff",
        emissiveIntensity: 0.48,
      }),
    );
    const innerMoon = new THREE.Mesh(
      UNIT_SPHERE_GEO,
      new THREE.MeshStandardMaterial({ color: "#ffd278", emissive: "#f4a438", emissiveIntensity: 0.9 }),
    );
    innerMoon.position.set(-1.58, 0, 0);
    innerMoon.scale.setScalar(0.11);
    this.astrolabeInner.add(innerMoon);
    astrolabeGroup.add(this.astrolabeInner);
    this.cosmicGroup.add(astrolabeGroup);

    // Volumetric starlight cones above observatory terrace
    this.starBeamMat = createVolumetricBeamMaterial("#7ef4ea", 0.14);
    for (const [bx, rz] of [
      [-1.8, -0.22],
      [1.8, 0.22],
    ] as const) {
      const sBeam = new THREE.Mesh(UNIT_CONE_BEAM_GEO, this.starBeamMat);
      sBeam.position.set(bx, 2.75, -0.5);
      sBeam.rotation.z = rz;
      sBeam.scale.set(1.85, 5.8, 1.85);
      sBeam.renderOrder = 30;
      this.cosmicGroup.add(sBeam);
    }

    if (this.spotPoolTex) {
      this.cosmicSpotPool = new THREE.Mesh(
        UNIT_PLANE_GEO,
        new THREE.MeshBasicMaterial({
          map: this.spotPoolTex,
          color: "#57f2da",
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      this.cosmicSpotPool.rotation.x = -Math.PI / 2;
      this.cosmicSpotPool.position.set(0, 0.012, 0.2);
      this.cosmicSpotPool.scale.set(3.2, 2.1, 1);
      this.cosmicSpotPool.renderOrder = 48;
      this.cosmicGroup.add(this.cosmicSpotPool);
    }

    this.cosmicGroup.visible = false;
    this.root.add(this.cosmicGroup);

    // ═══════════════════════════════════════════════════════════════════════
    // WORLD 3: TOYBOX SOUNDSTAGE / PLAYROOM ARCADE (3D CORNER WALLS + WINDOW + PROPS)
    // ═══════════════════════════════════════════════════════════════════════
    const pegWallMat = new THREE.MeshStandardMaterial({
      map: this.pegboardTex ?? undefined,
      color: "#fff7eb",
      roughness: 0.85,
    });
    const pegWall = new THREE.Mesh(UNIT_PLANE_GEO, pegWallMat);
    pegWall.position.set(0, 2.85, -2.9);
    pegWall.scale.set(17.5, 6.2, 1);
    pegWall.receiveShadow = true;
    this.playroomGroup.add(pegWall);

    const playBaseboardMat = new THREE.MeshStandardMaterial({ color: "#b57f4e", roughness: 0.65 });
    const playBaseboard = new THREE.Mesh(UNIT_BOX_GEO, playBaseboardMat);
    playBaseboard.position.set(0, 0.14, -2.82);
    playBaseboard.scale.set(17.5, 0.28, 0.14);
    this.playroomGroup.add(playBaseboard);

    // Angled 3D pastel pegboard/plywood left & right corner walls (`x = ±7.8`)
    for (const side of [-1, 1] as const) {
      const sideWall = new THREE.Mesh(UNIT_PLANE_GEO, pegWallMat);
      sideWall.position.set(side * 7.8, 2.85, 0.9);
      sideWall.rotation.y = side * -Math.PI * 0.44;
      sideWall.scale.set(9.2, 6.2, 1);
      sideWall.receiveShadow = true;
      this.playroomGroup.add(sideWall);

      const sideBase = new THREE.Mesh(UNIT_BOX_GEO, playBaseboardMat);
      sideBase.position.set(side * 7.72, 0.14, 0.9);
      sideBase.rotation.y = side * -Math.PI * 0.44;
      sideBase.scale.set(9.2, 0.28, 0.14);
      this.playroomGroup.add(sideBase);
    }

    // 3D Sunlit Mullioned Studio Window Frame on Stage-Left + Angled Volumetric Sunbeam Cones
    const winGroup = new THREE.Group();
    winGroup.position.set(-7.52, 2.58, -0.35);
    winGroup.rotation.y = Math.PI * 0.44;
    const winPane = new THREE.Mesh(
      UNIT_PLANE_GEO,
      new THREE.MeshBasicMaterial({ color: "#fff4d2", toneMapped: false }),
    );
    winPane.scale.set(2.35, 1.95, 1);
    winGroup.add(winPane);
    const winWoodMat = new THREE.MeshStandardMaterial({ color: "#c48d56", roughness: 0.65 });
    for (const [mx, my, mw, mh] of [
      [0, 1.02, 2.58, 0.14],
      [0, -1.04, 2.74, 0.16],
      [-1.22, 0, 0.14, 2.1],
      [1.22, 0, 0.14, 2.1],
      [0, 0, 0.08, 2.0],
      [0, 0.04, 2.38, 0.08],
    ] as const) {
      const bar = new THREE.Mesh(UNIT_BOX_GEO, winWoodMat);
      bar.position.set(mx, my, 0.05);
      bar.scale.set(mw, mh, 0.14);
      bar.castShadow = true;
      winGroup.add(bar);
    }
    this.playroomGroup.add(winGroup);

    this.sunbeamMat = createVolumetricBeamMaterial("#ffe8ad", 0.16);
    for (const bz of [-0.95, 0.25]) {
      const beam = new THREE.Mesh(UNIT_CONE_BEAM_GEO, this.sunbeamMat);
      beam.position.set(-4.15, 1.55, bz);
      beam.rotation.z = 0.84;
      beam.scale.set(1.45, 7.4, 1.45);
      beam.renderOrder = 32;
      this.playroomGroup.add(beam);
    }

    // Birch plank floor with procedural bump & roughness maps
    const birchFloor = new THREE.Mesh(
      UNIT_PLANE_GEO,
      new THREE.MeshStandardMaterial({
        map: this.birchFloorTextures?.map ?? undefined,
        roughnessMap: this.birchFloorTextures?.roughnessMap ?? undefined,
        bumpMap: this.birchFloorTextures?.bumpMap ?? undefined,
        bumpScale: 0.012,
        color: "#f5e2c4",
        roughness: 0.56,
        metalness: 0.04,
      }),
    );
    birchFloor.rotation.x = -Math.PI / 2;
    birchFloor.position.set(0, 0, -0.1);
    birchFloor.scale.set(22, 13.5, 1);
    birchFloor.receiveShadow = true;
    this.playroomGroup.add(birchFloor);

    // Low beveled birch play-stage riser (`y = 0.14`) when `showRiser` is active
    const playRiserPlinth = new THREE.Mesh(
      UNIT_BOX_GEO,
      new THREE.MeshStandardMaterial({ color: "#b57f4e", roughness: 0.68 }),
    );
    playRiserPlinth.position.set(0, PLAYROOM_RISER_TOP_Y * 0.4, STUDIO_RISER_CENTER_Z);
    playRiserPlinth.scale.set(1, PLAYROOM_RISER_TOP_Y * 0.8, 1.34);
    playRiserPlinth.castShadow = true;
    playRiserPlinth.receiveShadow = true;
    this.playroomRiserGroup.add(playRiserPlinth);

    const playRiserDeck = new THREE.Mesh(
      UNIT_BOX_GEO,
      new THREE.MeshStandardMaterial({
        color: "#f2d6ad",
        map: this.birchFloorTextures?.map ?? undefined,
        roughness: 0.52,
      }),
    );
    playRiserDeck.position.set(0, PLAYROOM_RISER_TOP_Y - 0.015, STUDIO_RISER_CENTER_Z);
    playRiserDeck.scale.set(1.03, 0.03, 1.44);
    playRiserDeck.castShadow = true;
    playRiserDeck.receiveShadow = true;
    this.playroomRiserGroup.add(playRiserDeck);

    const playRiserTrim = new THREE.Mesh(
      UNIT_BOX_GEO,
      new THREE.MeshStandardMaterial({ color: "#ff7e67", roughness: 0.45 }),
    );
    playRiserTrim.position.set(0, PLAYROOM_RISER_TOP_Y - 0.014, STUDIO_RISER_CENTER_Z + 0.722);
    playRiserTrim.scale.set(1.034, 0.028, 0.025);
    this.playroomRiserGroup.add(playRiserTrim);
    this.playroomGroup.add(this.playroomRiserGroup);

    // Low Birch Cubby Shelf along rear wall (`z = -2.52`, clear of riser!)
    const cubbyMat = new THREE.MeshStandardMaterial({ color: "#d5a36e", roughness: 0.64 });
    const cubbyShelf = new THREE.Group();
    cubbyShelf.position.set(0, 0, -2.52);
    const cubbyTop = new THREE.Mesh(UNIT_BOX_GEO, cubbyMat);
    cubbyTop.position.set(0, 0.82, 0);
    cubbyTop.scale.set(4.8, 0.06, 0.48);
    cubbyTop.castShadow = true;
    cubbyTop.receiveShadow = true;
    cubbyShelf.add(cubbyTop);
    const cubbyMid = new THREE.Mesh(UNIT_BOX_GEO, cubbyMat);
    cubbyMid.position.set(0, 0.42, 0);
    cubbyMid.scale.set(4.7, 0.05, 0.44);
    cubbyShelf.add(cubbyMid);
    for (const cx of [-2.34, -0.78, 0.78, 2.34]) {
      const div = new THREE.Mesh(UNIT_BOX_GEO, cubbyMat);
      div.position.set(cx, 0.41, 0);
      div.scale.set(0.06, 0.82, 0.46);
      div.castShadow = true;
      cubbyShelf.add(div);
    }
    // Wooden toys atop cubby shelf
    const toyCols = ["#ff6b6b", "#ffd166", "#51cf96", "#4dabf7"];
    for (let ti = 0; ti < 4; ti++) {
      const boxToy = new THREE.Mesh(
        UNIT_BOX_GEO,
        new THREE.MeshStandardMaterial({ color: toyCols[ti], roughness: 0.48 }),
      );
      boxToy.position.set(-1.7 + ti * 1.15, 0.98, 0);
      boxToy.rotation.y = (ti - 1.5) * 0.25;
      boxToy.scale.set(0.24, 0.24, 0.24);
      boxToy.castShadow = true;
      cubbyShelf.add(boxToy);
    }
    this.playroomGroup.add(cubbyShelf);

    // Stacked painted wooden toy blocks at wings (`x = ±4.25, z = -1.65`)
    for (const [bx, bz, c1, c2, c3] of [
      [-4.25, -1.68, "#ff6b6b", "#ffd166", "#4dabf7"],
      [4.22, -1.58, "#51cf96", "#b197fc", "#ff876b"],
    ] as const) {
      const stack = new THREE.Group();
      stack.position.set(bx, 0, bz);
      const b1 = new THREE.Mesh(UNIT_BOX_GEO, new THREE.MeshStandardMaterial({ color: c1, roughness: 0.5 }));
      b1.position.set(-0.18, 0.20, 0);
      b1.rotation.y = 0.16;
      b1.scale.set(0.40, 0.40, 0.40);
      b1.castShadow = true;
      b1.receiveShadow = true;
      const b2 = new THREE.Mesh(UNIT_BOX_GEO, new THREE.MeshStandardMaterial({ color: c2, roughness: 0.5 }));
      b2.position.set(0.26, 0.18, 0.08);
      b2.rotation.y = -0.22;
      b2.scale.set(0.36, 0.36, 0.36);
      b2.castShadow = true;
      const b3 = new THREE.Mesh(UNIT_BOX_GEO, new THREE.MeshStandardMaterial({ color: c3, roughness: 0.5 }));
      b3.position.set(-0.02, 0.56, 0.02);
      b3.rotation.y = 0.42;
      b3.scale.set(0.34, 0.34, 0.34);
      b3.castShadow = true;
      stack.add(b1, b2, b3);
      this.playroomGroup.add(stack);
    }

    // Articulated brass/mint studio desk lamp on stage-right (`x = +4.65, z = -1.78`)
    const lampGroup = new THREE.Group();
    lampGroup.position.set(4.72, 0, -1.72);
    const mintMat = new THREE.MeshStandardMaterial({ color: "#58d4b2", roughness: 0.42, metalness: 0.12 });
    const lBase = new THREE.Mesh(UNIT_CYLINDER_BASE_GEO, mintMat);
    lBase.position.y = 0.06;
    lBase.scale.set(0.28, 0.12, 0.28);
    lBase.castShadow = true;
    lampGroup.add(lBase);
    const lArm1 = new THREE.Mesh(UNIT_CYLINDER_GEO, brassMat);
    lArm1.position.set(-0.05, 0.52, 0);
    lArm1.rotation.z = 0.16;
    lArm1.scale.set(0.025, 0.92, 0.025);
    lampGroup.add(lArm1);
    const lArm2 = new THREE.Mesh(UNIT_CYLINDER_GEO, brassMat);
    lArm2.position.set(-0.26, 1.12, 0.08);
    lArm2.rotation.z = 0.72;
    lArm2.scale.set(0.022, 0.68, 0.022);
    lampGroup.add(lArm2);
    const lShade = new THREE.Mesh(UNIT_CONE_SHADE_GEO, mintMat);
    lShade.position.set(-0.52, 1.24, 0.12);
    lShade.rotation.z = 0.65;
    lShade.scale.set(0.24, 0.30, 0.24);
    lShade.castShadow = true;
    lampGroup.add(lShade);
    const lBulb = new THREE.Mesh(
      UNIT_SPHERE_GEO,
      new THREE.MeshBasicMaterial({ color: "#fff1be", toneMapped: false }),
    );
    lBulb.position.set(-0.56, 1.18, 0.12);
    lBulb.scale.setScalar(0.07);
    lampGroup.add(lBulb);
    this.playroomGroup.add(lampGroup);

    // Overhead strung felt bunting pennants
    const bunting = new THREE.Group();
    bunting.position.set(0, 3.62, -0.75);
    const stringMesh = new THREE.Mesh(
      UNIT_CYLINDER_GEO,
      new THREE.MeshStandardMaterial({ color: "#8c6239", roughness: 0.9 }),
    );
    stringMesh.rotation.z = Math.PI / 2;
    stringMesh.position.set(0, -0.02, -0.02);
    stringMesh.scale.set(0.012, 9.4, 0.012);
    bunting.add(stringMesh);
    const flagColors = ["#ff6b6b", "#ffd166", "#51cf96", "#4dabf7", "#b197fc"];
    for (let i = 0; i < 11; i++) {
      const bx = (i - 5) * 0.72;
      const sag = -0.22 * Math.cos(((i - 5) / 5) * Math.PI * 0.5);
      const flag = new THREE.Mesh(
        UNIT_CONE_FLAG_GEO,
        new THREE.MeshStandardMaterial({ color: flagColors[i % flagColors.length], roughness: 0.78 }),
      );
      flag.position.set(bx, sag - 0.14, 0);
      flag.rotation.z = Math.PI;
      flag.scale.set(0.18, 0.34, 0.04);
      bunting.add(flag);
      this.buntingFlags.push(flag);
    }
    this.playroomGroup.add(bunting);
    this.playroomGroup.visible = false;
    this.root.add(this.playroomGroup);

    // ═══════════════════════════════════════════════════════════════════════
    // WORLD 4 & 5: MEADOW CARAVAN 3D & POP-UP STORYBOOK 3D SETPIECES
    // ═══════════════════════════════════════════════════════════════════════
    this.caravanSetpiece = new CaravanSetpiece3D();
    this.caravanSetpiece.group.visible = false;
    this.root.add(this.caravanSetpiece.group);

    this.storybookSetpiece = new StorybookSetpiece3D();
    this.storybookSetpiece.group.visible = false;
    this.root.add(this.storybookSetpiece.group);

    // ── Atmospheric Dust Motes / Starfield Particles ──
    const maxCount = 240;
    const rand = seededRand(9001);
    this.particleSeeds = Array.from({ length: maxCount }, () => ({
      x: (rand() - 0.5) * 24.0,
      y: rand() * 8.4 + 0.25,
      z: (rand() - 0.5) * 20.0 - 2.0,
      speed: 0.12 + rand() * 0.35,
      phase: rand() * Math.PI * 2,
    }));
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxCount * 3), 3));
    this.particleMat = new THREE.PointsMaterial({
      color: "#ffdba1",
      size: 0.048,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    this.particles = new THREE.Points(pGeo, this.particleMat);
    this.particles.renderOrder = 500;
    this.root.add(this.particles);

    // Dynamic interactive 3D world props container
    this.root.add(this.propsGroup);
  }

  /** Expose custom 3D heightfield surface sampler for `caravan` and `storybook`. */
  getCustomSurfaceSampler(worldId: StageWorldId): ((x: number, z: number) => SurfaceSample | null) | undefined {
    if (worldId === "caravan") return (x, z) => this.caravanSetpiece.getSurfaceAt(x, z);
    if (worldId === "storybook") return (x, z) => this.storybookSetpiece.getSurfaceAt(x, z);
    return undefined;
  }

  /** Pre-sync Caravan/Storybook setpiece kinematics before sampling `getCustomSurfaceSampler`. */
  syncSetpieces(params: {
    readonly worldId: StageWorldId;
    readonly timeSec: number;
    readonly dt: number;
    readonly beat: number;
    readonly voiceEnergy: number;
    readonly songTitle: string;
    readonly sceneIndex: number;
    readonly sectionName: string;
    readonly lightingEnabled: boolean;
    readonly lightingMood: Exclude<StageLightingMood, "auto">;
  }): void {
    if (params.worldId === "caravan") {
      this.caravanSetpiece.update(params);
    } else if (params.worldId === "storybook") {
      this.storybookSetpiece.update(params);
    }
  }

  private loadBroadcastMic(): void {
    const loader = new GLTFLoader();
    loader.load(
      "/cast/props/studio404-broadcast-mic.glb",
      (gltf) => {
        if (this.disposed) return;
        const micHolder = new THREE.Group();
        const mic = gltf.scene;
        const box = new THREE.Box3().setFromObject(mic);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const targetH = 1.62;
        const s = targetH / Math.max(0.001, size.y);
        mic.scale.setScalar(s);
        mic.position.set(-center.x * s, -box.min.y * s, -center.z * s);
        mic.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = obj as THREE.Mesh;
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        micHolder.add(mic);
        micHolder.position.set(-2.35, 0, 0.35);
        micHolder.rotation.y = 0.36;
        this.micRoot = micHolder;
        this.theaterGroup.add(micHolder);
      },
      undefined,
      () => {
        // Non-fatal fallback if mic GLB is unavailable
      },
    );
  }

  private getOrCreateProp(prop: StagePropState): DynamicPropEntry | null {
    const existing = this.propEntries.get(prop.id);
    if (existing && existing.kind === prop.kind) return existing;
    if (existing) {
      this.propsGroup.remove(existing.group);
      this.propEntries.delete(prop.id);
    }

    const group = new THREE.Group();
    let entry: DynamicPropEntry | null = null;

    if (prop.kind === "beat-pad") {
      const rim = new THREE.Mesh(
        UNIT_RING_MED_GEO,
        new THREE.MeshStandardMaterial({ color: "#b68846", metalness: 0.72, roughness: 0.3 }),
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.004;
      group.add(rim);

      const coreMat = new THREE.MeshStandardMaterial({
        color: prop.color,
        emissive: prop.color,
        emissiveIntensity: 0.4,
        roughness: 0.35,
      });
      const core = new THREE.Mesh(UNIT_CYLINDER_DISC_GEO, coreMat);
      core.scale.set(prop.radius * 0.86, 0.036, prop.radius * 0.86);
      core.receiveShadow = true;
      group.add(core);

      const rippleMat = new THREE.MeshBasicMaterial({
        color: prop.color,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const ripple = new THREE.Mesh(UNIT_RING_THIN_GEO, rippleMat);
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.y = 0.025;
      group.add(ripple);

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          group.position.set(p.x, 0.018 - p.compression * 0.04, p.z);
          rim.scale.set(p.radius, p.radius, 1);
          coreMat.emissiveIntensity = lit ? 0.28 + p.energy * 1.15 : 0.12;
          const rs = p.radius * (1.06 + (1 - p.energy) * 0.68);
          ripple.scale.set(rs, rs, 1);
          rippleMat.opacity = lit ? clamp(0.14 + p.energy * 0.62, 0, 0.8) : 0.1;
        },
      };
    } else if (prop.kind === "hanging-chime") {
      const cord = new THREE.Mesh(
        UNIT_CYLINDER_GEO,
        new THREE.MeshStandardMaterial({ color: "#7a5e3b", metalness: 0.6, roughness: 0.4 }),
      );
      cord.position.y = -0.6;
      cord.scale.set(0.012, 1.2, 0.012);
      group.add(cord);

      const bellMat = new THREE.MeshStandardMaterial({
        color: "#e6c178",
        metalness: 0.85,
        roughness: 0.22,
        emissive: prop.color,
        emissiveIntensity: 0.2,
      });
      const bell = new THREE.Mesh(UNIT_CONE_SHADE_GEO, bellMat);
      bell.position.y = -1.25;
      bell.scale.set(0.16, 0.28, 0.16);
      bell.castShadow = true;
      group.add(bell);

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          group.position.set(p.x, p.y + 1.25, p.z);
          group.rotation.z = p.rotZ;
          bellMat.emissiveIntensity = lit ? 0.18 + p.energy * 0.95 : 0.08;
        },
      };
    } else if (prop.kind === "glass-ripple") {
      const outerMat = new THREE.MeshBasicMaterial({
        color: prop.color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const outer = new THREE.Mesh(UNIT_RING_THIN_GEO, outerMat);
      group.add(outer);

      const innerMat = new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const inner = new THREE.Mesh(UNIT_RING_THIN_GEO, innerMat);
      group.add(inner);

      entry = {
        kind: prop.kind,
        group,
        sync: (p) => {
          group.visible = p.energy > 0.08;
          group.position.set(p.x, p.y, p.z);
          const outerR = p.radius * (0.45 + (1 - p.energy) * 1.1);
          const innerR = outerR * 0.65;
          outer.scale.set(outerR, outerR, 1);
          inner.scale.set(innerR, innerR, 1);
          outerMat.opacity = p.energy * 0.65;
          innerMat.opacity = p.energy * 0.44;
        },
      };
    } else if (prop.kind === "lunar-disc") {
      const discMat = new THREE.MeshStandardMaterial({
        color: "#1a2142",
        metalness: 0.42,
        roughness: 0.55,
        emissive: "#253b6e",
        emissiveIntensity: 0.35,
      });
      const disc = new THREE.Mesh(UNIT_CYLINDER_DISC_GEO, discMat);
      disc.receiveShadow = true;
      group.add(disc);

      const runeMat = new THREE.MeshBasicMaterial({
        color: "#64f0d8",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const rune = new THREE.Mesh(UNIT_RING_THIN_GEO, runeMat);
      rune.position.y = 0.064;
      group.add(rune);

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          group.position.set(p.x, -0.06, p.z);
          group.rotation.z = p.rotZ;
          disc.scale.set(p.radius, 0.12, p.radius);
          discMat.emissiveIntensity = lit ? 0.35 + p.energy * 0.4 : 0.15;
          rune.rotation.set(-Math.PI / 2, 0, p.rotY);
          rune.scale.set(p.radius * 0.99, p.radius * 0.99, 1);
          runeMat.opacity = lit ? 0.55 + p.energy * 0.35 : 0.25;
        },
      };
    } else if (prop.kind === "cosmic-orb") {
      const coreMat = new THREE.MeshStandardMaterial({
        color: prop.color,
        metalness: 0.28,
        roughness: 0.18,
        emissive: prop.color,
        emissiveIntensity: 0.55,
      });
      const core = new THREE.Mesh(UNIT_ICO_GEO, coreMat);
      group.add(core);

      const ringMat = new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const ring = new THREE.Mesh(UNIT_TORUS_ORB_GEO, ringMat);
      group.add(ring);

      let aura: THREE.Mesh | null = null;
      let auraMat: THREE.MeshBasicMaterial | null = null;
      if (this.softGlowTex) {
        auraMat = new THREE.MeshBasicMaterial({
          map: this.softGlowTex,
          color: prop.color,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        aura = new THREE.Mesh(UNIT_PLANE_GEO, auraMat);
        aura.position.z = -0.04;
        group.add(aura);
      }

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          const pulse = 1 + p.energy * 0.26;
          const coreR = p.radius * 0.68 * pulse;
          const ringR = p.radius * 1.02 * pulse;
          group.position.set(p.x, p.y, p.z);
          core.rotation.set(0.4, p.rotY, 0.2);
          core.scale.setScalar(coreR);
          coreMat.emissiveIntensity = lit ? 0.55 + p.energy * 1.15 : 0.2;
          ring.rotation.set(Math.PI * 0.38, p.rotY * 1.4, 0.3);
          ring.scale.setScalar(ringR);
          ringMat.opacity = lit ? 0.52 + p.energy * 0.42 : 0.25;
          if (aura && auraMat) {
            aura.visible = lit;
            const s = p.radius * 4.4 * pulse;
            aura.scale.set(s, s, 1);
            auraMat.opacity = clamp(0.38 + p.energy * 0.45, 0, 0.85);
          }
        },
      };
    } else if (prop.kind === "xylo-tile") {
      const tileMat = new THREE.MeshStandardMaterial({
        color: prop.color,
        roughness: 0.42,
        metalness: 0.08,
        emissive: prop.color,
        emissiveIntensity: 0,
      });
      const tile = new THREE.Mesh(UNIT_BOX_GEO, tileMat);
      tile.scale.set(0.98, 0.08, 0.92);
      tile.receiveShadow = true;
      group.add(tile);

      const pinMat = new THREE.MeshStandardMaterial({ color: "#f5e6cc", metalness: 0.65, roughness: 0.3 });
      for (const pz of [-0.32, 0.32]) {
        const pin = new THREE.Mesh(UNIT_CYLINDER_GEO, pinMat);
        pin.position.set(0, 0.045, pz);
        pin.scale.set(0.045, 0.02, 0.045);
        group.add(pin);
      }

      entry = {
        kind: prop.kind,
        group,
        sync: (p, _t, lit) => {
          group.position.set(p.x, 0.04 - p.compression * 0.065, p.z);
          tileMat.emissiveIntensity = lit ? p.energy * 0.58 : 0;
        },
      };
    } else if (prop.kind === "toy-ball") {
      const shadowMat = new THREE.MeshBasicMaterial({
        color: "#2a160c",
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      });
      const shadow = new THREE.Mesh(UNIT_CIRCLE_GEO, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      group.add(shadow);

      const ballMat = new THREE.MeshStandardMaterial({
        color: prop.color,
        roughness: 0.35,
        metalness: 0.05,
        emissive: "#ffd166",
        emissiveIntensity: 0,
      });
      const ball = new THREE.Mesh(UNIT_SPHERE_GEO, ballMat);
      ball.castShadow = true;
      group.add(ball);

      const stripe = new THREE.Mesh(
        UNIT_TORUS_STRIPE_GEO,
        new THREE.MeshStandardMaterial({ color: "#ffe066", roughness: 0.3 }),
      );
      group.add(stripe);

      entry = {
        kind: prop.kind,
        group,
        sync: (p, t, lit) => {
          group.position.set(p.x, p.y, p.z);
          const sr = p.radius * clamp(1 - p.y * 0.16, 0.35, 1.05);
          shadow.position.set(0, -p.y + 0.015, 0);
          shadow.scale.set(sr, sr, 1);
          shadowMat.opacity = clamp(0.45 - p.y * 0.09, 0.08, 0.45);
          ball.rotation.set(0.3, t * 1.1, p.rotZ);
          ball.scale.setScalar(p.radius);
          ballMat.emissiveIntensity = lit ? p.energy * 0.42 : 0;
          stripe.rotation.set(0.3, t * 1.1, p.rotZ);
          stripe.scale.setScalar(p.radius * 0.99);
        },
      };
    } else if (prop.kind === "pinwheel") {
      const stick = new THREE.Mesh(
        UNIT_CYLINDER_GEO,
        new THREE.MeshStandardMaterial({ color: "#d4a373", roughness: 0.7 }),
      );
      group.add(stick);
      const base = new THREE.Mesh(
        UNIT_CYLINDER_BASE_GEO,
        new THREE.MeshStandardMaterial({ color: "#bc8a5f", roughness: 0.65 }),
      );
      base.position.y = 0.04;
      base.scale.set(0.3, 0.08, 0.3);
      group.add(base);

      const hub = new THREE.Group();
      const colors = ["#ff6b6b", "#ffd166", "#51cf96", "#4dabf7"];
      colors.forEach((c, i) => {
        const blade = new THREE.Mesh(UNIT_BOX_GEO, new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 }));
        blade.rotation.z = (i * Math.PI) / 2;
        blade.scale.set(0.42, 0.14, 0.025);
        hub.add(blade);
      });
      const pin = new THREE.Mesh(
        UNIT_SPHERE_GEO,
        new THREE.MeshStandardMaterial({ color: "#fff3d6", roughness: 0.3 }),
      );
      pin.position.z = 0.03;
      pin.scale.setScalar(0.075);
      hub.add(pin);
      group.add(hub);

      entry = {
        kind: prop.kind,
        group,
        sync: (p) => {
          group.position.set(p.x, 0, p.z);
          stick.position.y = p.y * 0.5;
          stick.scale.set(0.04, p.y, 0.04);
          hub.position.set(0, p.y, 0.05);
          hub.rotation.z = p.rotZ;
        },
      };
    }

    if (entry) {
      this.propsGroup.add(group);
      this.propEntries.set(prop.id, entry);
    }
    return entry;
  }

  update(camera: THREE.PerspectiveCamera, params: StudioWorldUpdateParams): void {
    const {
      worldId,
      lightingMood = "warm-spotlight",
      timeSec,
      beat,
      dt = 0.016,
      actorX,
      actorY,
      actorZ,
      voiceEnergy,
      cinema,
      cameraMode,
      lightingEnabled,
      showRiser,
      riserWidth,
      downstageCount,
      leftmostActorX,
      aspectRatio,
      props,
      orbit,
      songTitle = "Studio 404",
      sceneIndex = 1,
      sectionName = "",
      setpiecesPreSynced = false,
    } = params;

    // Per-scene Variable Stage mood lighting curves applied across ALL 5 worlds
    const mood = resolveWorldMoodLighting(worldId, lightingMood);

    // 1. Scene background & subtle atmospheric depth fog
    this.bgColor.set(mood.bgHex);
    if (this.scene.background !== this.bgColor) {
      this.scene.background = this.bgColor;
    }
    this.fog.color.copy(this.bgColor);
    this.fog.density = mood.fogDensity;
    this.scene.fog = this.fog;

    // 2. Toggle active 3D world
    this.theaterGroup.visible = worldId === "theater";
    this.caravanSetpiece.group.visible = worldId === "caravan";
    this.storybookSetpiece.group.visible = worldId === "storybook";
    this.cosmicGroup.visible = worldId === "cosmic";
    this.playroomGroup.visible = worldId === "playroom";

    // 3. World-specific PBR lighting
    this.hemiLight.color.set(mood.hemiSkyHex);
    this.hemiLight.groundColor.set(mood.hemiGroundHex);
    this.hemiLight.intensity = (lightingEnabled ? (worldId === "playroom" ? 1.05 : 0.82) : 0.95) * mood.hemi;

    this.keyLight.color.set(mood.keyHex);
    this.keyLight.intensity = (lightingEnabled ? (worldId === "playroom" ? 2.35 : 2.18) : 1.0) * mood.key;

    this.rimLeftLight.color.set(mood.rimLeftHex);
    this.rimLeftLight.intensity = (lightingEnabled ? 1.35 : 0.5) * mood.rimL;

    this.rimRightLight.color.set(mood.rimRightHex);
    this.rimRightLight.intensity = (lightingEnabled ? 1.15 : 0.5) * mood.rimR;

    this.actorSpot.color.set(mood.spotHex);
    this.actorSpot.position.set(actorX, 2.6 + actorY * 0.4, 1.55);
    this.actorSpot.intensity = (lightingEnabled ? 2.1 + voiceEnergy * 0.75 : 0.4) * mood.spot;

    const beatPulse = 1 + 0.035 * Math.sin(beat * Math.PI * 2) * (0.4 + voiceEnergy * 0.6);

    // 4. Theater-specific live updates
    if (worldId === "theater") {
      this.riserGroup.visible = showRiser;
      if (showRiser) {
        const riserScaleY = (params.riserTopY ?? STUDIO_RISER_TOP_Y) / STUDIO_RISER_TOP_Y;
        this.riserGroup.scale.set(riserWidth, riserScaleY, 1);
      }
      if (this.micRoot) {
        this.micRoot.visible = true;
        const wideEnsemble = (downstageCount ?? 1) >= 4 || (showRiser && riserWidth >= 4.4);
        const micPos = resolveStudioMicPosition({
          showRiser,
          riserWidth,
          downstageCount: downstageCount ?? 1,
          leftmostActorX: leftmostActorX ?? (wideEnsemble ? -1.9 : -1.4),
        });
        this.micRoot.position.set(micPos.x, 0, micPos.z);
        this.micRoot.rotation.y = wideEnsemble ? 0.46 : 0.36;
      }
      this.crtScope?.update(timeSec, voiceEnergy);
      this.crtBars?.update(timeSec, voiceEnergy);

      this.boothBacklightMat.color.set(
        lightingMood === "phosphor-booth"
          ? "#4de8d0"
          : lightingMood === "standby-dark"
            ? "#5a3d28"
            : "#ffbe73",
      );

      this.fresnelLeft.visible = lightingEnabled;
      this.fresnelLeft.scale.set(1.65 * beatPulse, 5.4, 1.65 * beatPulse);
      (this.fresnelLeftMat.uniforms.uColor.value as THREE.Color).set(mood.spotHex);
      this.fresnelLeftMat.uniforms.uOpacity.value = mood.beam;

      this.fresnelRight.visible = lightingEnabled;
      this.fresnelRight.scale.set(1.55 * beatPulse, 5.2, 1.55 * beatPulse);
      (this.fresnelRightMat.uniforms.uColor.value as THREE.Color).set(mood.spotHex);
      this.fresnelRightMat.uniforms.uOpacity.value = mood.beam * 0.85;

      if (this.theaterSpotPool) {
        this.theaterSpotPool.visible = lightingEnabled;
        this.theaterSpotPool.position.set(actorX * 0.92, 0.01, actorZ);
        this.theaterSpotPool.scale.set(3.4 * beatPulse * mood.spotScale, 2.0 * beatPulse * mood.spotScale, 1);
        const sm = this.theaterSpotPool.material as THREE.MeshBasicMaterial;
        sm.color.set(mood.spotHex);
        sm.opacity = (0.42 + voiceEnergy * 0.14) * clamp(mood.spot, 0.6, 1.35);
      }
    }

    // 5. Caravan-specific live updates
    if (worldId === "caravan" && !setpiecesPreSynced) {
      this.caravanSetpiece.update({
        timeSec,
        beat,
        voiceEnergy,
        sectionName,
        lightingEnabled,
        lightingMood,
      });
    }

    // 6. Storybook-specific live updates
    if (worldId === "storybook" && !setpiecesPreSynced) {
      this.storybookSetpiece.update({
        timeSec,
        dt,
        beat,
        voiceEnergy,
        songTitle,
        sceneIndex,
        sectionName,
        lightingEnabled,
        lightingMood,
      });
    }

    // 7. Cosmic-specific live updates
    if (worldId === "cosmic") {
      this.nebulaMat.uniforms.uTime.value = timeSec;
      this.nebulaMat.uniforms.uEnergy.value = voiceEnergy;
      this.nebulaMat.uniforms.uLit.value = lightingEnabled ? 1 : 0;
      const nTint = this.nebulaMat.uniforms.uMoodTint.value as THREE.Vector3;
      if (lightingMood === "standby-dark") nTint.set(0.56, 0.62, 0.82);
      else if (lightingMood === "phosphor-booth") nTint.set(0.65, 1.15, 1.12);
      else if (lightingMood === "encore-surge") nTint.set(1.22, 1.05, 0.95);
      else if (lightingMood === "arena-lit") nTint.set(1.12, 1.10, 1.06);
      else nTint.set(1, 1, 1);

      this.astrolabeOuter.rotation.set(0.25, timeSec * 0.16, 0.18);
      this.astrolabeInner.rotation.set(-0.45, -timeSec * 0.22, 0.5);
      this.orrerySpinner.rotation.y = timeSec * 0.65;
      this.starBeamMat.uniforms.uOpacity.value = lightingEnabled ? mood.beam * 0.62 : 0;
      (this.starBeamMat.uniforms.uColor.value as THREE.Color).set(mood.spotHex);

      if (this.cosmicSpotPool) {
        this.cosmicSpotPool.visible = lightingEnabled;
        this.cosmicSpotPool.position.set(actorX * 0.85, 0.012, actorZ);
        this.cosmicSpotPool.scale.set(3.1 * beatPulse * mood.spotScale, 2.1 * beatPulse * mood.spotScale, 1);
        (this.cosmicSpotPool.material as THREE.MeshBasicMaterial).color.set(mood.spotHex);
      }
    }

    // 8. Playroom live updates (bunting sway + sunbeams + low birch riser)
    if (worldId === "playroom") {
      this.playroomRiserGroup.visible = showRiser;
      if (showRiser) {
        this.playroomRiserGroup.scale.set(riserWidth, 1, 1);
      }
      this.sunbeamMat.uniforms.uOpacity.value = lightingEnabled ? mood.beam * 0.66 : 0;
      (this.sunbeamMat.uniforms.uColor.value as THREE.Color).set(
        lightingMood === "phosphor-booth" ? "#9ef5eb" : "#ffe8ad",
      );
      for (let i = 0; i < this.buntingFlags.length; i++) {
        this.buntingFlags[i].rotation.x = Math.sin(timeSec * 2.2 + i * 0.65) * 0.1 + actorY * 0.08;
      }
    }

    // 9. Dust motes / starfield
    const activeParticleCount = worldId === "cosmic" ? 240 : 72;
    this.particles.geometry.setDrawRange(0, activeParticleCount);
    this.particles.visible = lightingEnabled;
    if (this.particleWorld !== worldId) {
      this.particleWorld = worldId;
      this.particleMat.color.set(
        worldId === "cosmic"
          ? "#b4f2ff"
          : worldId === "playroom"
            ? "#fff5cf"
            : worldId === "caravan"
              ? "#ffe6a6"
              : "#ffdba1",
      );
      this.particleMat.size = worldId === "cosmic" ? 0.078 : 0.046;
    }
    const posAttr = this.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < activeParticleCount; i++) {
      const s = this.particleSeeds[i];
      const dy =
        worldId === "cosmic"
          ? ((s.y + timeSec * s.speed * 0.22) % 8.4) - 0.4
          : (s.y % 5.6) + Math.sin(timeSec * s.speed + s.phase) * 0.22;
      const dx = (worldId === "cosmic" ? s.x : s.x * 0.56) + Math.cos(timeSec * s.speed * 0.7 + s.phase) * 0.18;
      const dz = worldId === "cosmic" ? s.z : s.z * 0.26 - 0.8;
      posAttr.setXYZ(i, dx, dy, dz);
    }
    posAttr.needsUpdate = true;

    // 10. Sync interactive 3D world props
    const activePropIds = new Set<string>();
    for (const p of props) {
      activePropIds.add(p.id);
      const entry = this.getOrCreateProp(p);
      if (entry) {
        entry.group.visible = true;
        entry.sync(p, timeSec, lightingEnabled);
      }
    }
    for (const [id, entry] of this.propEntries.entries()) {
      if (!activePropIds.has(id)) {
        entry.group.visible = false;
      }
    }

    // 11. Critically-damped 3D Perspective Cinema Camera + interactive orbit offset (zero actorY bob!)
    const effectiveShot = cameraMode === "authored" ? cinema.shotType : cameraMode;
    const zoom =
      cameraMode === "wide"
        ? 1.0
        : cameraMode === "closeup"
          ? 1.24
          : cameraMode === "low-angle"
            ? 1.12
            : cinema.zoom;
    const portraitPull = aspectRatio < 1 ? 1.48 : 1.0;
    const focusX = params.targetX ?? actorX;
    const spanX = Math.max(0, params.targetSpanX ?? 0);

    const worldYBias = worldId === "caravan" ? 0.34 : worldId === "storybook" ? 1.28 : 0;
    const worldLookYBias = worldId === "caravan" ? 0.32 : worldId === "storybook" ? -0.06 : 0;
    const worldZDist = worldId === "caravan" ? 10.5 : worldId === "storybook" ? 10.4 : 9.2;

    let camX = 0;
    let camY = 1.65 + worldYBias;
    let camZ = worldZDist * portraitPull;
    let lookX = 0;
    let lookY = 1.34 + worldLookYBias;
    const lookZ = 0.1;

    if (effectiveShot === "closeup" || effectiveShot === "reaction") {
      const push = clamp((zoom - 1) / 0.35, 0.35, 1.0);
      camX = clamp(focusX * 0.68, -1.55, 1.55);
      camY = 1.66 + worldYBias * 0.72;
      camZ = (worldZDist - 1.75 * push) * portraitPull;
      lookX = clamp(focusX * 0.9, -1.75, 1.75);
      lookY = 1.4 + worldLookYBias;
    } else if (effectiveShot === "two-shot") {
      camX = clamp(focusX * 0.72, -1.35, 1.35);
      camY = 1.62 + worldYBias * 0.85;
      camZ = clamp((worldZDist - 1.9 + spanX * 0.78) * portraitPull, 7.4, worldZDist + 0.3);
      lookX = clamp(focusX * 0.88, -1.5, 1.5);
      lookY = 1.36 + worldLookYBias;
    } else if (effectiveShot === "low-angle") {
      camX = clamp(focusX * 0.72, -1.6, 1.6);
      camY = 0.72 + (worldId === "caravan" ? 0.42 : worldId === "storybook" ? 0.34 : 0);
      camZ = (worldId === "caravan" || worldId === "storybook" ? 7.2 : 6.35) * portraitPull;
      lookX = clamp(focusX * 0.88, -1.75, 1.75);
      lookY = 1.42 + worldLookYBias;
    } else {
      const wideTrack = (cinema.focusXNorm - 0.5) * 1.8;
      camX = clamp(wideTrack + (worldId === "caravan" ? 0.15 : 0), -0.85, 0.95);
      camY = 1.65 + worldYBias;
      camZ = (worldZDist / Math.max(0.95, Math.min(1.08, zoom))) * portraitPull;
      lookX = clamp(focusX * 0.35 + wideTrack * 0.45 + (worldId === "caravan" ? 0.15 : 0), -0.85, 0.95);
      lookY = 1.34 + worldLookYBias;
    }

    if (params.snapCamera || !this.camSpringInit) {
      this.camCurPos.set(camX, camY, camZ);
      this.camVelPos.set(0, 0, 0);
      this.camCurLook.set(lookX, lookY, lookZ);
      this.camVelLook.set(0, 0, 0);
      this.camSpringInit = true;
    } else {
      const stepDt = clamp(dt, 0.001, 0.05);
      const omega = 3.8;
      [this.camCurPos.x, this.camVelPos.x] = stepCriticalSpring(this.camCurPos.x, this.camVelPos.x, camX, omega, stepDt);
      [this.camCurPos.y, this.camVelPos.y] = stepCriticalSpring(this.camCurPos.y, this.camVelPos.y, camY, omega, stepDt);
      [this.camCurPos.z, this.camVelPos.z] = stepCriticalSpring(this.camCurPos.z, this.camVelPos.z, camZ, omega, stepDt);
      [this.camCurLook.x, this.camVelLook.x] = stepCriticalSpring(this.camCurLook.x, this.camVelLook.x, lookX, omega, stepDt);
      [this.camCurLook.y, this.camVelLook.y] = stepCriticalSpring(this.camCurLook.y, this.camVelLook.y, lookY, omega, stepDt);
      [this.camCurLook.z, this.camVelLook.z] = stepCriticalSpring(this.camCurLook.z, this.camVelLook.z, lookZ, omega, stepDt);
    }

    // Apply user drag-orbit / wheel-zoom around the damped look target so orbit stays instant and responsive
    const dLookX = this.camCurLook.x;
    const dLookY = this.camCurLook.y;
    const dLookZ = this.camCurLook.z;
    const dx = this.camCurPos.x - dLookX;
    const dy = this.camCurPos.y - dLookY;
    const dz = this.camCurPos.z - dLookZ;
    const rawDist = Math.hypot(dx, dy, dz);
    const baseDist = rawDist * clamp(orbit.zoom, 0.55, 1.65);
    const baseAz = Math.atan2(dx, dz) + orbit.azimuth;
    const baseElev = clamp(
      Math.asin(clamp(dy / Math.max(0.001, rawDist), -0.95, 0.95)) + orbit.polar,
      -0.18,
      0.85,
    );

    const cosE = Math.cos(baseElev);
    camera.position.set(
      dLookX + Math.sin(baseAz) * cosE * baseDist,
      Math.max(0.45, dLookY + Math.sin(baseElev) * baseDist),
      dLookZ + Math.cos(baseAz) * cosE * baseDist,
    );

    const targetFov = aspectRatio < 1 ? 42 : 34;
    let dirty = false;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov = targetFov;
      dirty = true;
    }
    if (Math.abs(camera.aspect - aspectRatio) > 0.001) {
      camera.aspect = aspectRatio;
      dirty = true;
    }
    if (dirty) camera.updateProjectionMatrix();
    camera.lookAt(dLookX, dLookY, dLookZ);
    camera.updateMatrixWorld();
  }

  dispose(): void {
    this.disposed = true;
    this.scene.remove(this.root);
    this.caravanSetpiece.dispose();
    this.storybookSetpiece.dispose();
    this.floorTextures?.dispose();
    this.birchFloorTextures?.dispose();
    this.riserOakTex?.dispose();
    this.wallTex?.dispose();
    this.signTex?.dispose();
    this.crtScope?.dispose();
    this.crtBars?.dispose();
    this.spotPoolTex?.dispose();
    this.softGlowTex?.dispose();
    this.pegboardTex?.dispose();
    this.zodiacTex?.dispose();
    this.nebulaMat.dispose();
    this.fresnelLeftMat.dispose();
    this.fresnelRightMat.dispose();
    this.sunbeamMat.dispose();
    this.starBeamMat.dispose();
    for (const d of this.extraDisposables) d.dispose();
    this.particles.geometry.dispose();
    this.particleMat.dispose();
  }
}
