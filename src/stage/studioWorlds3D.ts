/**
 * Real Three.js Multi-World 3D Stage Coordinator (`StudioWorldRig`).
 */
import * as THREE from "three";
import { CaravanSetpiece3D } from "./caravanSetpiece3D.ts";
import type { StageLightingMood } from "./stageDirectorStore.ts";
import {
  STUDIO_RISER_CENTER_Z,
  STUDIO_RISER_TALL_TOP_Y,
  STUDIO_RISER_TOP_Y,
  type SurfaceSample,
} from "./stageSurface.ts";
import { createSoftGlowTexture } from "./stageTextures.ts";
import type { StageWorldId } from "./stageWorlds.ts";
import { StorybookSetpiece3D } from "./storybookSetpiece3D.ts";
import { CosmicWorld3D } from "./worlds/cosmicWorld3D.ts";
import { PlayroomWorld3D } from "./worlds/playroomWorld3D.ts";
import { TheaterWorld3D } from "./worlds/theaterWorld3D.ts";
import {
  resolveWorldMoodLighting,
  StageParticleField,
  WorldCameraController,
  WorldLightRig,
  type CameraMode,
  type OrbitOffset,
  type StudioWorldUpdateParams,
} from "./worlds/worldLightingAndMaterials.ts";
import { WorldPropsManager } from "./worlds/worldProps3D.ts";

export { STUDIO_RISER_CENTER_Z, STUDIO_RISER_TALL_TOP_Y, STUDIO_RISER_TOP_Y };
export type { CameraMode, OrbitOffset, StudioWorldUpdateParams };

export class StudioWorldRig {
  readonly root = new THREE.Group();
  private readonly lightRig: WorldLightRig;
  private readonly theaterWorld: TheaterWorld3D;
  private readonly cosmicWorld: CosmicWorld3D;
  private readonly playroomWorld: PlayroomWorld3D;
  private readonly caravanSetpiece = new CaravanSetpiece3D();
  private readonly storybookSetpiece = new StorybookSetpiece3D();
  private readonly particles = new StageParticleField();
  private readonly propsMgr: WorldPropsManager;
  private readonly cameraCtrl = new WorldCameraController();
  private readonly spotPoolTex: THREE.CanvasTexture | null;
  private readonly softGlowTex: THREE.CanvasTexture | null;

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.root);
    this.lightRig = new WorldLightRig(scene, this.root);
    this.spotPoolTex = createSoftGlowTexture("rgba(255, 232, 184, 0.44)", "rgba(255, 204, 134, 0.16)");
    this.softGlowTex = createSoftGlowTexture("rgba(255,255,255,0.65)", "rgba(255,255,255,0.22)");
    const brassMat = new THREE.MeshStandardMaterial({ color: "#c99a56", metalness: 0.82, roughness: 0.26 });

    this.theaterWorld = new TheaterWorld3D(brassMat, this.spotPoolTex);
    this.cosmicWorld = new CosmicWorld3D(brassMat, this.spotPoolTex);
    this.playroomWorld = new PlayroomWorld3D(brassMat);
    this.caravanSetpiece.group.visible = false;
    this.storybookSetpiece.group.visible = false;
    this.propsMgr = new WorldPropsManager(this.softGlowTex);

    this.root.add(
      this.theaterWorld.group,
      this.cosmicWorld.group,
      this.playroomWorld.group,
      this.caravanSetpiece.group,
      this.storybookSetpiece.group,
      this.particles.points,
      this.propsMgr.group,
    );
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
    if (params.worldId === "caravan") this.caravanSetpiece.update(params);
    else if (params.worldId === "storybook") this.storybookSetpiece.update(params);
  }

  update(camera: THREE.PerspectiveCamera, params: StudioWorldUpdateParams): void {
    const {
      worldId, lightingMood = "warm-spotlight", timeSec, beat, dt = 0.016,
      actorX, actorY, actorZ, voiceEnergy, lightingEnabled, showRiser, riserWidth,
      riserTopY, downstageCount, leftmostActorX, props,
      songTitle = "Studio 404", sceneIndex = 1, sectionName = "", setpiecesPreSynced = false,
    } = params;

    const mood = resolveWorldMoodLighting(worldId, lightingMood);
    this.lightRig.apply({ worldId, mood, lightingEnabled, actorX, actorY, voiceEnergy });

    this.theaterWorld.group.visible = worldId === "theater";
    this.caravanSetpiece.group.visible = worldId === "caravan";
    this.storybookSetpiece.group.visible = worldId === "storybook";
    this.cosmicWorld.group.visible = worldId === "cosmic";
    this.playroomWorld.group.visible = worldId === "playroom";

    const beatPulse = 1 + 0.035 * Math.sin(beat * Math.PI * 2) * (0.4 + voiceEnergy * 0.6);

    if (worldId === "theater") {
      this.theaterWorld.update({
        showRiser, riserWidth, riserTopY, downstageCount, leftmostActorX,
        timeSec, voiceEnergy, lightingMood, lightingEnabled, beatPulse, actorX, actorZ, mood,
      });
    } else if (worldId === "caravan" && !setpiecesPreSynced) {
      this.caravanSetpiece.update({ timeSec, beat, voiceEnergy, sectionName, lightingEnabled, lightingMood });
    } else if (worldId === "storybook" && !setpiecesPreSynced) {
      this.storybookSetpiece.update({
        timeSec, dt, beat, voiceEnergy, songTitle, sceneIndex, sectionName, lightingEnabled, lightingMood,
      });
    } else if (worldId === "cosmic") {
      this.cosmicWorld.update({ timeSec, voiceEnergy, lightingEnabled, lightingMood, beatPulse, actorX, actorZ, mood });
    } else if (worldId === "playroom") {
      this.playroomWorld.update({ showRiser, riserWidth, timeSec, actorY, lightingEnabled, lightingMood, mood });
    }

    this.particles.update(worldId, timeSec, lightingEnabled);
    this.propsMgr.syncAll(props, timeSec, lightingEnabled);
    this.cameraCtrl.update(camera, params);
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.theaterWorld.dispose();
    this.cosmicWorld.dispose();
    this.playroomWorld.dispose();
    this.caravanSetpiece.dispose();
    this.storybookSetpiece.dispose();
    this.spotPoolTex?.dispose();
    this.softGlowTex?.dispose();
    this.particles.dispose();
  }
}
