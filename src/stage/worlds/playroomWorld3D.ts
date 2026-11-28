/**
 * World 3: Toybox Soundstage / Playroom Arcade (`PlayroomWorld3D`).
 * Angled 3D pegboard corner walls, sunlit mullioned window & sunbeams, birch plank floor,
 * cubby shelf, wooden toy blocks, articulated desk lamp, bunting pennants, and low birch riser.
 */
import * as THREE from "three";
import type { StageLightingMood } from "../stageDirectorStore.ts";
import {
  UNIT_BOX_GEO,
  UNIT_CONE_BEAM_GEO,
  UNIT_CONE_FLAG_GEO,
  UNIT_CONE_SHADE_GEO,
  UNIT_CYLINDER_BASE_GEO,
  UNIT_CYLINDER_GEO,
  UNIT_PLANE_GEO,
  UNIT_SPHERE_GEO,
} from "../stageGeometries.ts";
import { PLAYROOM_RISER_TOP_Y, STUDIO_RISER_CENTER_Z } from "../stageSurface.ts";
import {
  createBirchFloorTextures,
  createPegboardTexture,
  createVolumetricBeamMaterial,
  type StudioFloorTextures,
} from "../stageTextures.ts";
import type { WorldMoodLightingCurve } from "./worldLightingAndMaterials.ts";

export class PlayroomWorld3D {
  readonly group = new THREE.Group();
  private readonly riserGroup = new THREE.Group();
  private readonly sunbeamMat: THREE.ShaderMaterial;
  private readonly buntingFlags: THREE.Mesh[] = [];
  private readonly birchFloorTextures: StudioFloorTextures | null;
  private readonly pegboardTex: THREE.CanvasTexture | null;

  constructor(brassMat: THREE.MeshStandardMaterial) {
    this.birchFloorTextures = createBirchFloorTextures();
    this.pegboardTex = createPegboardTexture();

    const pegWallMat = new THREE.MeshStandardMaterial({
      map: this.pegboardTex ?? undefined,
      color: "#fff7eb",
      roughness: 0.85,
    });
    const pegWall = new THREE.Mesh(UNIT_PLANE_GEO, pegWallMat);
    pegWall.position.set(0, 2.85, -2.9);
    pegWall.scale.set(17.5, 6.2, 1);
    pegWall.receiveShadow = true;
    this.group.add(pegWall);

    const playBaseboardMat = new THREE.MeshStandardMaterial({ color: "#b57f4e", roughness: 0.65 });
    const playBaseboard = new THREE.Mesh(UNIT_BOX_GEO, playBaseboardMat);
    playBaseboard.position.set(0, 0.14, -2.82);
    playBaseboard.scale.set(17.5, 0.28, 0.14);
    this.group.add(playBaseboard);

    for (const side of [-1, 1] as const) {
      const sideWall = new THREE.Mesh(UNIT_PLANE_GEO, pegWallMat);
      sideWall.position.set(side * 7.8, 2.85, 0.9);
      sideWall.rotation.y = side * -Math.PI * 0.44;
      sideWall.scale.set(9.2, 6.2, 1);
      sideWall.receiveShadow = true;
      this.group.add(sideWall);

      const sideBase = new THREE.Mesh(UNIT_BOX_GEO, playBaseboardMat);
      sideBase.position.set(side * 7.72, 0.14, 0.9);
      sideBase.rotation.y = side * -Math.PI * 0.44;
      sideBase.scale.set(9.2, 0.28, 0.14);
      this.group.add(sideBase);
    }

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
    this.group.add(winGroup);

    this.sunbeamMat = createVolumetricBeamMaterial("#ffe8ad", 0.16);
    for (const bz of [-0.95, 0.25]) {
      const beam = new THREE.Mesh(UNIT_CONE_BEAM_GEO, this.sunbeamMat);
      beam.position.set(-4.15, 1.55, bz);
      beam.rotation.z = 0.84;
      beam.scale.set(1.45, 7.4, 1.45);
      beam.renderOrder = 32;
      this.group.add(beam);
    }

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
    this.group.add(birchFloor);

    const playRiserPlinth = new THREE.Mesh(
      UNIT_BOX_GEO,
      new THREE.MeshStandardMaterial({ color: "#b57f4e", roughness: 0.68 }),
    );
    playRiserPlinth.position.set(0, PLAYROOM_RISER_TOP_Y * 0.4, STUDIO_RISER_CENTER_Z);
    playRiserPlinth.scale.set(1, PLAYROOM_RISER_TOP_Y * 0.8, 1.34);
    playRiserPlinth.castShadow = true;
    playRiserPlinth.receiveShadow = true;
    this.riserGroup.add(playRiserPlinth);

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
    this.riserGroup.add(playRiserDeck);

    const playRiserTrim = new THREE.Mesh(
      UNIT_BOX_GEO,
      new THREE.MeshStandardMaterial({ color: "#ff7e67", roughness: 0.45 }),
    );
    playRiserTrim.position.set(0, PLAYROOM_RISER_TOP_Y - 0.014, STUDIO_RISER_CENTER_Z + 0.722);
    playRiserTrim.scale.set(1.034, 0.028, 0.025);
    this.riserGroup.add(playRiserTrim);
    this.group.add(this.riserGroup);

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
    this.group.add(cubbyShelf);

    for (const [bx, bz, c1, c2, c3] of [
      [-4.25, -1.68, "#ff6b6b", "#ffd166", "#4dabf7"],
      [4.22, -1.58, "#51cf96", "#b197fc", "#ff876b"],
    ] as const) {
      const stack = new THREE.Group();
      stack.position.set(bx, 0, bz);
      const b1 = new THREE.Mesh(UNIT_BOX_GEO, new THREE.MeshStandardMaterial({ color: c1, roughness: 0.5 }));
      b1.position.set(-0.18, 0.2, 0);
      b1.rotation.y = 0.16;
      b1.scale.set(0.4, 0.4, 0.4);
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
      this.group.add(stack);
    }

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
    lShade.scale.set(0.24, 0.3, 0.24);
    lShade.castShadow = true;
    lampGroup.add(lShade);
    const lBulb = new THREE.Mesh(
      UNIT_SPHERE_GEO,
      new THREE.MeshBasicMaterial({ color: "#fff1be", toneMapped: false }),
    );
    lBulb.position.set(-0.56, 1.18, 0.12);
    lBulb.scale.setScalar(0.07);
    lampGroup.add(lBulb);
    this.group.add(lampGroup);

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
    this.group.add(bunting);
    this.group.visible = false;
  }

  update(params: {
    showRiser: boolean;
    riserWidth: number;
    timeSec: number;
    actorY: number;
    lightingEnabled: boolean;
    lightingMood: Exclude<StageLightingMood, "auto">;
    mood: WorldMoodLightingCurve;
  }): void {
    const { showRiser, riserWidth, timeSec, actorY, lightingEnabled, lightingMood, mood } = params;
    this.riserGroup.visible = showRiser;
    if (showRiser) {
      this.riserGroup.scale.set(riserWidth, 1, 1);
    }
    this.sunbeamMat.uniforms.uOpacity.value = lightingEnabled ? mood.beam * 0.66 : 0;
    (this.sunbeamMat.uniforms.uColor.value as THREE.Color).set(
      lightingMood === "phosphor-booth" ? "#9ef5eb" : "#ffe8ad",
    );
    for (let i = 0; i < this.buntingFlags.length; i++) {
      this.buntingFlags[i].rotation.x = Math.sin(timeSec * 2.2 + i * 0.65) * 0.1 + actorY * 0.08;
    }
  }

  dispose(): void {
    this.birchFloorTextures?.dispose();
    this.pegboardTex?.dispose();
    this.sunbeamMat.dispose();
  }
}
