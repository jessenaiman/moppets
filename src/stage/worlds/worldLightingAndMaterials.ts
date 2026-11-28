/**
 * Shared lighting mood curves, critical camera spring & orbit math, and atmospheric
 * dust-mote / starfield particle system for `StudioWorldRig`.
 */
import * as THREE from "three";
import type { CinemaCameraState } from "../cinemaDirector.ts";
import type { StagePropState } from "../stageAutopilot.ts";
import type { StageLightingMood } from "../stageDirectorStore.ts";
import { resolveStageWorld, type StageWorldId } from "../stageWorlds.ts";

export type CameraMode = "authored" | "wide" | "closeup" | "low-angle";

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

export interface WorldMoodLightingCurve {
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

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function stepCriticalSpring(
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

export function seededRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveWorldMoodLighting(
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

export class StageParticleField {
  readonly points: THREE.Points;
  private readonly seeds: { x: number; y: number; z: number; speed: number; phase: number }[];
  private readonly mat: THREE.PointsMaterial;
  private activeWorld: StageWorldId = "theater";

  constructor() {
    const maxCount = 240;
    const rand = seededRand(9001);
    this.seeds = Array.from({ length: maxCount }, () => ({
      x: (rand() - 0.5) * 24.0,
      y: rand() * 8.4 + 0.25,
      z: (rand() - 0.5) * 20.0 - 2.0,
      speed: 0.12 + rand() * 0.35,
      phase: rand() * Math.PI * 2,
    }));
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxCount * 3), 3));
    this.mat = new THREE.PointsMaterial({
      color: "#ffdba1",
      size: 0.048,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    this.points = new THREE.Points(pGeo, this.mat);
    this.points.renderOrder = 500;
  }

  update(worldId: StageWorldId, timeSec: number, lightingEnabled: boolean): void {
    const activeCount = worldId === "cosmic" ? 240 : 72;
    this.points.geometry.setDrawRange(0, activeCount);
    this.points.visible = lightingEnabled;
    if (this.activeWorld !== worldId) {
      this.activeWorld = worldId;
      this.mat.color.set(
        worldId === "cosmic"
          ? "#b4f2ff"
          : worldId === "playroom"
            ? "#fff5cf"
            : worldId === "caravan"
              ? "#ffe6a6"
              : "#ffdba1",
      );
      this.mat.size = worldId === "cosmic" ? 0.078 : 0.046;
    }
    const posAttr = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < activeCount; i++) {
      const s = this.seeds[i];
      const dy =
        worldId === "cosmic"
          ? ((s.y + timeSec * s.speed * 0.22) % 8.4) - 0.4
          : (s.y % 5.6) + Math.sin(timeSec * s.speed + s.phase) * 0.22;
      const dx = (worldId === "cosmic" ? s.x : s.x * 0.56) + Math.cos(timeSec * s.speed * 0.7 + s.phase) * 0.18;
      const dz = worldId === "cosmic" ? s.z : s.z * 0.26 - 0.8;
      posAttr.setXYZ(i, dx, dy, dz);
    }
    posAttr.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

export class WorldLightRig {
  private readonly bgColor = new THREE.Color("#140a0e");
  private readonly fog = new THREE.FogExp2("#140a0e", 0.022);
  readonly hemiLight: THREE.HemisphereLight;
  readonly keyLight: THREE.DirectionalLight;
  readonly rimLeftLight: THREE.DirectionalLight;
  readonly rimRightLight: THREE.DirectionalLight;
  readonly actorSpot: THREE.PointLight;

  constructor(private readonly scene: THREE.Scene, root: THREE.Group) {
    this.hemiLight = new THREE.HemisphereLight("#fff3df", "#2a1914", 0.72);
    root.add(this.hemiLight);

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
    root.add(this.keyLight);

    this.rimLeftLight = new THREE.DirectionalLight("#ffbf78", 1.35);
    this.rimLeftLight.position.set(-5.0, 4.8, -2.2);
    root.add(this.rimLeftLight);

    this.rimRightLight = new THREE.DirectionalLight("#7de8dc", 1.15);
    this.rimRightLight.position.set(5.0, 4.6, -1.8);
    root.add(this.rimRightLight);

    this.actorSpot = new THREE.PointLight("#ffd28a", 2.2, 9.0, 1.4);
    this.actorSpot.position.set(0, 2.8, 1.5);
    root.add(this.actorSpot);
  }

  apply(params: {
    worldId: StageWorldId;
    mood: WorldMoodLightingCurve;
    lightingEnabled: boolean;
    actorX: number;
    actorY: number;
    voiceEnergy: number;
  }): void {
    const { worldId, mood, lightingEnabled, actorX, actorY, voiceEnergy } = params;
    this.bgColor.set(mood.bgHex);
    if (this.scene.background !== this.bgColor) this.scene.background = this.bgColor;
    this.fog.color.copy(this.bgColor);
    this.fog.density = mood.fogDensity;
    this.scene.fog = this.fog;

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
  }
}

export class WorldCameraController {
  private readonly curPos = new THREE.Vector3(0, 1.65, 9.2);
  private readonly velPos = new THREE.Vector3();
  private readonly curLook = new THREE.Vector3(0, 1.34, 0.1);
  private readonly velLook = new THREE.Vector3();
  private initialized = false;

  update(camera: THREE.PerspectiveCamera, params: StudioWorldUpdateParams): void {
    const {
      worldId,
      dt = 0.016,
      actorX,
      cinema,
      cameraMode,
      aspectRatio,
      orbit,
      snapCamera,
    } = params;

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

    if (snapCamera || !this.initialized) {
      this.curPos.set(camX, camY, camZ);
      this.velPos.set(0, 0, 0);
      this.curLook.set(lookX, lookY, lookZ);
      this.velLook.set(0, 0, 0);
      this.initialized = true;
    } else {
      const stepDt = clamp(dt, 0.001, 0.05);
      const omega = 3.8;
      [this.curPos.x, this.velPos.x] = stepCriticalSpring(this.curPos.x, this.velPos.x, camX, omega, stepDt);
      [this.curPos.y, this.velPos.y] = stepCriticalSpring(this.curPos.y, this.velPos.y, camY, omega, stepDt);
      [this.curPos.z, this.velPos.z] = stepCriticalSpring(this.curPos.z, this.velPos.z, camZ, omega, stepDt);
      [this.curLook.x, this.velLook.x] = stepCriticalSpring(this.curLook.x, this.velLook.x, lookX, omega, stepDt);
      [this.curLook.y, this.velLook.y] = stepCriticalSpring(this.curLook.y, this.velLook.y, lookY, omega, stepDt);
      [this.curLook.z, this.velLook.z] = stepCriticalSpring(this.curLook.z, this.velLook.z, lookZ, omega, stepDt);
    }

    const dLookX = this.curLook.x;
    const dLookY = this.curLook.y;
    const dLookZ = this.curLook.z;
    const dx = this.curPos.x - dLookX;
    const dy = this.curPos.y - dLookY;
    const dz = this.curPos.z - dLookZ;
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
}
