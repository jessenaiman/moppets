/**
 * World 2: Cosmic Observatory / Starlight Drift (`CosmicWorld3D`).
 * Seamless GLSL nebula sky dome, stepped obsidian & brass observatory terrace,
 * etched zodiac dial, astrolabe rings with orbiting moons, telescope & orrery pillars.
 */
import * as THREE from "three";
import type { StageLightingMood } from "../stageDirectorStore.ts";
import {
  SKY_DOME_SPHERE_GEO,
  UNIT_CONE_BEAM_GEO,
  UNIT_CYLINDER_GEO,
  UNIT_PLANE_GEO,
  UNIT_SPHERE_GEO,
  UNIT_TORUS_ORB_GEO,
} from "../stageGeometries.ts";
import {
  createCosmicNebulaMaterial,
  createVolumetricBeamMaterial,
  createZodiacDeckTexture,
} from "../stageTextures.ts";
import type { WorldMoodLightingCurve } from "./worldLightingAndMaterials.ts";

export class CosmicWorld3D {
  readonly group = new THREE.Group();
  private readonly astrolabeOuter: THREE.Mesh;
  private readonly astrolabeInner: THREE.Mesh;
  private readonly orrerySpinner: THREE.Group;
  private readonly nebulaMat: THREE.ShaderMaterial;
  private readonly starBeamMat: THREE.ShaderMaterial;
  private readonly zodiacTex: THREE.CanvasTexture | null;
  private readonly spotPool: THREE.Mesh | null = null;
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];

  constructor(
    brassMat: THREE.MeshStandardMaterial,
    spotPoolTex: THREE.CanvasTexture | null,
  ) {
    this.nebulaMat = createCosmicNebulaMaterial();
    this.zodiacTex = createZodiacDeckTexture();

    const nebulaDome = new THREE.Mesh(SKY_DOME_SPHERE_GEO, this.nebulaMat);
    nebulaDome.renderOrder = 4;
    this.group.add(nebulaDome);

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
    this.ownedGeometries.push(terraceTop.geometry);
    this.group.add(terraceTop);

    const terraceStep = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.78, 0.2, 48), obsidianBaseMat);
    terraceStep.position.set(0, -0.28, 0);
    terraceStep.receiveShadow = true;
    this.ownedGeometries.push(terraceStep.geometry);
    this.group.add(terraceStep);

    const terraceRimGeo = new THREE.TorusGeometry(5.0, 0.042, 10, 64);
    this.ownedGeometries.push(terraceRimGeo);
    const terraceRim = new THREE.Mesh(terraceRimGeo, brassMat);
    terraceRim.rotation.x = Math.PI / 2;
    terraceRim.position.y = 0.002;
    this.group.add(terraceRim);

    const stepRimGeo = new THREE.TorusGeometry(5.6, 0.036, 10, 64);
    this.ownedGeometries.push(stepRimGeo);
    const stepRim = new THREE.Mesh(stepRimGeo, brassMat);
    stepRim.rotation.x = Math.PI / 2;
    stepRim.position.y = -0.18;
    this.group.add(stepRim);

    if (this.zodiacTex) {
      const zodiacGeo = new THREE.CircleGeometry(4.85, 64);
      this.ownedGeometries.push(zodiacGeo);
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
      this.group.add(zodiacRing);
    }

    const pillarGeo = new THREE.CylinderGeometry(0.18, 0.24, 1.05, 16);
    this.ownedGeometries.push(pillarGeo);

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
    this.group.add(scopePillar);

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
    this.group.add(orreryPillar);

    const astrolabeGroup = new THREE.Group();
    astrolabeGroup.position.set(0, 3.05, -4.45);
    const astroOuterGeo = new THREE.TorusGeometry(2.15, 0.055, 16, 84);
    const astroInnerGeo = new THREE.TorusGeometry(1.58, 0.044, 16, 72);
    this.ownedGeometries.push(astroOuterGeo, astroInnerGeo);

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
    this.group.add(astrolabeGroup);

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
      this.group.add(sBeam);
    }

    if (spotPoolTex) {
      this.spotPool = new THREE.Mesh(
        UNIT_PLANE_GEO,
        new THREE.MeshBasicMaterial({
          map: spotPoolTex,
          color: "#57f2da",
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      this.spotPool.rotation.x = -Math.PI / 2;
      this.spotPool.position.set(0, 0.012, 0.2);
      this.spotPool.scale.set(3.2, 2.1, 1);
      this.spotPool.renderOrder = 48;
      this.group.add(this.spotPool);
    }

    this.group.visible = false;
  }

  update(params: {
    timeSec: number;
    voiceEnergy: number;
    lightingEnabled: boolean;
    lightingMood: Exclude<StageLightingMood, "auto">;
    beatPulse: number;
    actorX: number;
    actorZ: number;
    mood: WorldMoodLightingCurve;
  }): void {
    const { timeSec, voiceEnergy, lightingEnabled, lightingMood, beatPulse, actorX, actorZ, mood } = params;

    this.nebulaMat.uniforms.uTime.value = timeSec;
    this.nebulaMat.uniforms.uEnergy.value = voiceEnergy;
    this.nebulaMat.uniforms.uLit.value = lightingEnabled ? 1 : 0;
    const nTint = this.nebulaMat.uniforms.uMoodTint.value as THREE.Vector3;
    if (lightingMood === "standby-dark") nTint.set(0.56, 0.62, 0.82);
    else if (lightingMood === "phosphor-booth") nTint.set(0.65, 1.15, 1.12);
    else if (lightingMood === "encore-surge") nTint.set(1.22, 1.05, 0.95);
    else if (lightingMood === "arena-lit") nTint.set(1.12, 1.1, 1.06);
    else nTint.set(1, 1, 1);

    this.astrolabeOuter.rotation.set(0.25, timeSec * 0.16, 0.18);
    this.astrolabeInner.rotation.set(-0.45, -timeSec * 0.22, 0.5);
    this.orrerySpinner.rotation.y = timeSec * 0.65;
    this.starBeamMat.uniforms.uOpacity.value = lightingEnabled ? mood.beam * 0.62 : 0;
    (this.starBeamMat.uniforms.uColor.value as THREE.Color).set(mood.spotHex);

    if (this.spotPool) {
      this.spotPool.visible = lightingEnabled;
      this.spotPool.position.set(actorX * 0.85, 0.012, actorZ);
      this.spotPool.scale.set(3.1 * beatPulse * mood.spotScale, 2.1 * beatPulse * mood.spotScale, 1);
      (this.spotPool.material as THREE.MeshBasicMaterial).color.set(mood.spotHex);
    }
  }

  dispose(): void {
    for (const g of this.ownedGeometries) g.dispose();
    this.zodiacTex?.dispose();
    this.nebulaMat.dispose();
    this.starBeamMat.dispose();
  }
}
