/**
 * World 1: Real 3D Studio 404 Broadcast Soundstage (`TheaterWorld3D`).
 * Bare scuffed floor (Zero Persian Rug Lock), beveled oak riser, 3D broadcast mic,
 * pleated curtains, CRT equipment racks, overhead truss, and volumetric Fresnel beams.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { StageLightingMood } from "../stageDirectorStore.ts";
import {
  UNIT_BOX_GEO,
  UNIT_CIRCLE_GEO,
  UNIT_CONE_BEAM_GEO,
  UNIT_CYLINDER_GEO,
  UNIT_PLANE_GEO,
  UNIT_SPHERE_GEO,
  UNIT_TORUS_ORB_GEO,
  UNIT_TORUS_THIN_GEO,
} from "../stageGeometries.ts";
import { resolveStudioMicPosition, STUDIO_RISER_CENTER_Z, STUDIO_RISER_TOP_Y } from "../stageSurface.ts";
import {
  createAcousticWallTexture,
  createRackCrtScreenTexture,
  createRiserOakTexture,
  createStudio404FloorTextures,
  createStudio404SignTexture,
  createVolumetricBeamMaterial,
  type RackCrtScreenTexture,
  type StudioFloorTextures,
} from "../stageTextures.ts";
import { clamp, type WorldMoodLightingCurve } from "./worldLightingAndMaterials.ts";

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

function buildStudioCrtRack(
  side: -1 | 1,
  steelMat: THREE.MeshStandardMaterial,
  chassisMat: THREE.MeshStandardMaterial,
  brassMat: THREE.MeshStandardMaterial,
  screenMatTop: THREE.MeshStandardMaterial,
  screenMatBottom: THREE.MeshStandardMaterial,
): THREE.Group {
  const rack = new THREE.Group();
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
  for (const sy of [0.14, 1.05, 2.02, 2.98]) {
    const shelf = new THREE.Mesh(UNIT_BOX_GEO, steelMat);
    shelf.position.set(0, sy, 0);
    shelf.scale.set(rackW, 0.045, rackD);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    rack.add(shelf);
  }
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

  const addCrtMonitor = (yBase: number, w: number, h: number, d: number, yaw: number, scrMat: THREE.MeshStandardMaterial) => {
    const mon = new THREE.Group();
    mon.position.set(0, yBase + h * 0.5, 0.04);
    mon.rotation.y = yaw;

    const body = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
    body.scale.set(w, h, d);
    body.castShadow = true;
    body.receiveShadow = true;
    mon.add(body);

    const bezel = new THREE.Mesh(UNIT_BOX_GEO, steelMat);
    bezel.position.set(0, 0.02, d * 0.5 + 0.015);
    bezel.scale.set(w * 0.94, h * 0.86, 0.03);
    mon.add(bezel);

    const glass = new THREE.Mesh(UNIT_PLANE_GEO, scrMat);
    glass.position.set(0, 0.02, d * 0.5 + 0.034);
    glass.scale.set(w * 0.8, h * 0.68, 1);
    mon.add(glass);

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

function buildOverheadTruss(
  steelMat: THREE.MeshStandardMaterial,
  lampMat: THREE.MeshStandardMaterial,
  lensMat: THREE.MeshBasicMaterial,
): THREE.Group {
  const truss = new THREE.Group();
  truss.position.set(0, 4.48, -0.55);

  const span = 12.6;
  for (const dy of [-0.18, 0.18]) {
    for (const dz of [-0.18, 0.18]) {
      const rail = new THREE.Mesh(UNIT_CYLINDER_GEO, steelMat);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, dy, dz);
      rail.scale.set(0.024, span, 0.024);
      truss.add(rail);
    }
  }
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

  for (const lx of [-3.4, -1.25, 1.25, 3.4]) {
    const fixture = new THREE.Group();
    fixture.position.set(lx, -0.34, 0.16);
    fixture.rotation.set(0.46, lx * -0.14, 0);

    const yoke = new THREE.Mesh(UNIT_BOX_GEO, steelMat);
    yoke.position.set(0, 0.16, 0);
    yoke.scale.set(0.32, 0.04, 0.06);
    fixture.add(yoke);

    const can = new THREE.Mesh(UNIT_CYLINDER_GEO, lampMat);
    can.rotation.x = Math.PI / 2;
    can.scale.set(0.16, 0.34, 0.16);
    fixture.add(can);

    const lens = new THREE.Mesh(UNIT_CIRCLE_GEO, lensMat);
    lens.position.set(0, 0, 0.175);
    lens.scale.set(0.135, 0.135, 1);
    fixture.add(lens);

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

export class TheaterWorld3D {
  readonly group = new THREE.Group();
  private readonly proceduralShell = new THREE.Group();
  private readonly riserGroup = new THREE.Group();
  private readonly fresnelLeft: THREE.Mesh;
  private readonly fresnelRight: THREE.Mesh;
  private readonly fresnelLeftMat: THREE.ShaderMaterial;
  private readonly fresnelRightMat: THREE.ShaderMaterial;
  private readonly spotPool: THREE.Mesh | null = null;
  private readonly boothBacklightMat: THREE.MeshBasicMaterial;

  private readonly floorTextures: StudioFloorTextures | null;
  private readonly riserOakTex: THREE.CanvasTexture | null;
  private readonly wallTex: THREE.CanvasTexture | null;
  private readonly signTex: THREE.CanvasTexture | null;
  private readonly crtScope: RackCrtScreenTexture | null;
  private readonly crtBars: RackCrtScreenTexture | null;
  private readonly slatGeo: THREE.BoxGeometry;

  private micRoot: THREE.Object3D | null = null;
  private disposed = false;

  constructor(
    brassMat: THREE.MeshStandardMaterial,
    spotPoolTex: THREE.CanvasTexture | null,
  ) {
    this.floorTextures = createStudio404FloorTextures();
    this.riserOakTex = createRiserOakTexture();
    this.wallTex = createAcousticWallTexture();
    this.signTex = createStudio404SignTexture();
    this.crtScope = createRackCrtScreenTexture("scope");
    this.crtBars = createRackCrtScreenTexture("bars");

    this.group.add(this.proceduralShell);
    const steelMat = new THREE.MeshStandardMaterial({ color: "#2d323b", metalness: 0.78, roughness: 0.34 });
    const chassisMat = new THREE.MeshStandardMaterial({ color: "#1c1f25", metalness: 0.42, roughness: 0.56 });
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
    this.proceduralShell.add(floor);

    const apronTrim = new THREE.Mesh(UNIT_BOX_GEO, brassMat);
    apronTrim.position.set(0, 0.008, 2.35);
    apronTrim.scale.set(11.6, 0.016, 0.06);
    this.proceduralShell.add(apronTrim);

    const gafferMat = new THREE.MeshStandardMaterial({ color: "#d6a446", roughness: 0.82, metalness: 0.05 });
    const gafferH = new THREE.Mesh(UNIT_PLANE_GEO, gafferMat);
    gafferH.rotation.x = -Math.PI / 2;
    gafferH.position.set(0, 0.005, 0.24);
    gafferH.scale.set(0.32, 0.04, 1);
    this.proceduralShell.add(gafferH);
    const gafferV = new THREE.Mesh(UNIT_PLANE_GEO, gafferMat);
    gafferV.rotation.x = -Math.PI / 2;
    gafferV.position.set(0, 0.005, 0.24);
    gafferV.scale.set(0.04, 0.22, 1);
    this.proceduralShell.add(gafferV);

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
      this.proceduralShell.add(panel);
    }

    this.slatGeo = new THREE.BoxGeometry(0.09, 5.5, 0.09);
    for (let sx = -7.6; sx <= 7.6; sx += 0.36) {
      if (Math.abs(sx) < 2.45) continue;
      if (sx > 3.7 && sx < 5.1) continue;
      const slat = new THREE.Mesh(this.slatGeo, darkTimberMat);
      slat.position.set(sx, 2.88, -3.81);
      slat.castShadow = true;
      slat.receiveShadow = true;
      this.proceduralShell.add(slat);
    }

    this.boothBacklightMat = new THREE.MeshBasicMaterial({ color: "#ffbe73", toneMapped: false });
    const boothBackWall = new THREE.Mesh(UNIT_PLANE_GEO, this.boothBacklightMat);
    boothBackWall.position.set(0, 2.38, -4.48);
    boothBackWall.scale.set(4.6, 1.85, 1);
    this.proceduralShell.add(boothBackWall);

    const boothConsole = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
    boothConsole.position.set(0, 1.66, -4.22);
    boothConsole.scale.set(3.8, 0.32, 0.48);
    this.proceduralShell.add(boothConsole);

    const vuGlow = new THREE.Mesh(UNIT_BOX_GEO, new THREE.MeshBasicMaterial({ color: "#4af5d6", toneMapped: false }));
    vuGlow.position.set(-0.65, 1.84, -4.18);
    vuGlow.scale.set(1.4, 0.05, 0.08);
    this.proceduralShell.add(vuGlow);

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
    this.proceduralShell.add(obsGlass);

    for (const [fx, fy, fw, fh] of [
      [0, 1.48, 4.75, 0.1],
      [0, 3.24, 4.75, 0.1],
      [-2.32, 2.36, 0.12, 1.85],
      [2.32, 2.36, 0.12, 1.85],
      [0, 2.36, 0.07, 1.76],
    ] as const) {
      const frame = new THREE.Mesh(UNIT_BOX_GEO, steelMat);
      frame.position.set(fx, fy, -3.87);
      frame.scale.set(fw, fh, 0.18);
      this.proceduralShell.add(frame);
    }

    const doorFrame = new THREE.Mesh(UNIT_BOX_GEO, darkTimberMat);
    doorFrame.position.set(4.4, 1.55, -3.86);
    doorFrame.scale.set(1.22, 2.86, 0.16);
    this.proceduralShell.add(doorFrame);
    const doorSlab = new THREE.Mesh(UNIT_BOX_GEO, new THREE.MeshStandardMaterial({ color: "#3d271c", roughness: 0.72 }));
    doorSlab.position.set(4.4, 1.48, -3.81);
    doorSlab.scale.set(1.04, 2.66, 0.08);
    this.proceduralShell.add(doorSlab);
    const doorTransom = new THREE.Mesh(
      UNIT_PLANE_GEO,
      new THREE.MeshBasicMaterial({ color: "#ffdca0", toneMapped: false }),
    );
    doorTransom.position.set(4.4, 2.48, -3.76);
    doorTransom.scale.set(0.68, 0.36, 1);
    this.proceduralShell.add(doorTransom);
    const doorHandle = new THREE.Mesh(UNIT_BOX_GEO, brassMat);
    doorHandle.position.set(4.02, 1.24, -3.74);
    doorHandle.scale.set(0.14, 0.035, 0.07);
    this.proceduralShell.add(doorHandle);

    const baseboard = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
    baseboard.position.set(0, 0.14, -3.78);
    baseboard.scale.set(19, 0.28, 0.12);
    this.proceduralShell.add(baseboard);

    for (const side of [-1, 1] as const) {
      const wing = new THREE.Mesh(UNIT_BOX_GEO, backWallMat);
      wing.position.set(side * 8.4, 2.9, -0.5);
      wing.rotation.y = side * -0.18;
      wing.scale.set(0.24, 6.2, 9.0);
      wing.receiveShadow = true;
      this.proceduralShell.add(wing);

      const curtain = buildPleatedCurtain(side, velvetMat, brassMat);
      curtain.position.set(side * 5.25, 0, -2.95);
      curtain.rotation.y = side * -0.22;
      this.proceduralShell.add(curtain);
    }

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
    this.proceduralShell.add(leftRack);

    const rightRack = buildStudioCrtRack(1, steelMat, chassisMat, brassMat, barsMat, scopeMat);
    rightRack.position.set(3.35, 0, -2.75);
    rightRack.rotation.y = -0.24;
    this.proceduralShell.add(rightRack);

    const grilleMat = new THREE.MeshStandardMaterial({ color: "#15181d", metalness: 0.55, roughness: 0.45 });
    for (const side of [-1, 1] as const) {
      const wedge = new THREE.Group();
      wedge.position.set(side * 3.8, 0, 1.45);
      wedge.rotation.y = side * -2.42;
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
      this.proceduralShell.add(wedge);
    }

    const xlrMat = new THREE.MeshStandardMaterial({ color: "#121418", roughness: 0.65 });
    for (const [cx, cz, cr] of [
      [-2.78, 0.68, 0.19],
      [-2.82, -2.18, 0.22],
      [2.85, -2.18, 0.2],
    ] as const) {
      const coil = new THREE.Mesh(UNIT_TORUS_ORB_GEO, xlrMat);
      coil.rotation.x = Math.PI / 2;
      coil.position.set(cx, 0.014, cz);
      coil.scale.set(cr, cr, 0.5);
      this.proceduralShell.add(coil);
    }

    if (this.signTex) {
      const signHousing = new THREE.Mesh(UNIT_BOX_GEO, chassisMat);
      signHousing.position.set(0, 3.82, -3.65);
      signHousing.scale.set(3.15, 0.78, 0.18);
      this.proceduralShell.add(signHousing);

      const signFace = new THREE.Mesh(
        UNIT_PLANE_GEO,
        new THREE.MeshBasicMaterial({ map: this.signTex, toneMapped: false }),
      );
      signFace.position.set(0, 3.82, -3.55);
      signFace.scale.set(3.04, 0.7, 1);
      this.proceduralShell.add(signFace);
    }

    this.proceduralShell.add(buildOverheadTruss(steelMat, lampMat, lensMat));

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
    this.group.add(this.riserGroup);

    this.fresnelLeftMat = createVolumetricBeamMaterial("#ffda96", 0.22);
    this.fresnelLeft = new THREE.Mesh(UNIT_CONE_BEAM_GEO, this.fresnelLeftMat);
    this.fresnelLeft.position.set(-2.05, 2.25, -0.75);
    this.fresnelLeft.rotation.set(0.18, 0, -0.34);
    this.fresnelLeft.scale.set(1.65, 5.4, 1.65);
    this.fresnelLeft.renderOrder = 32;
    this.group.add(this.fresnelLeft);

    this.fresnelRightMat = createVolumetricBeamMaterial("#ffd590", 0.19);
    this.fresnelRight = new THREE.Mesh(UNIT_CONE_BEAM_GEO, this.fresnelRightMat);
    this.fresnelRight.position.set(2.15, 2.22, -0.75);
    this.fresnelRight.rotation.set(0.18, 0, 0.34);
    this.fresnelRight.scale.set(1.55, 5.2, 1.55);
    this.fresnelRight.renderOrder = 32;
    this.group.add(this.fresnelRight);

    if (spotPoolTex) {
      this.spotPool = new THREE.Mesh(
        UNIT_PLANE_GEO,
        new THREE.MeshBasicMaterial({
          map: spotPoolTex,
          color: "#ffd28c",
          transparent: true,
          opacity: 0.44,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      this.spotPool.rotation.x = -Math.PI / 2;
      this.spotPool.position.set(0, 0.01, 0.2);
      this.spotPool.scale.set(3.6, 2.1, 1);
      this.spotPool.renderOrder = 42;
      this.group.add(this.spotPool);
    }

    this.loadBroadcastMic();
    this.loadStudio404StageV3();
  }

  private loadStudio404StageV3(): void {
    const loader = new GLTFLoader();
    loader.load(
      "/cast/props/studio404-stage-v3.glb",
      (gltf) => {
        if (this.disposed) return;
        const stageRoot = gltf.scene;
        stageRoot.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = obj as THREE.Mesh;
            const mat = m.material as THREE.Material | undefined;
            const isGlass = Boolean(mat && (mat.transparent || (mat.name ?? "").includes("Glass")));
            m.castShadow = !isGlass && !m.name.startsWith("StageFloor");
            m.receiveShadow = true;
          }
        });
        this.group.add(stageRoot);
        this.proceduralShell.visible = false;
      },
      undefined,
      () => {},
    );
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
        this.group.add(micHolder);
      },
      undefined,
      () => {},
    );
  }

  update(params: {
    showRiser: boolean;
    riserWidth: number;
    riserTopY?: number;
    downstageCount?: number;
    leftmostActorX?: number;
    timeSec: number;
    voiceEnergy: number;
    lightingMood: Exclude<StageLightingMood, "auto">;
    lightingEnabled: boolean;
    beatPulse: number;
    actorX: number;
    actorZ: number;
    mood: WorldMoodLightingCurve;
  }): void {
    const {
      showRiser,
      riserWidth,
      riserTopY,
      downstageCount,
      leftmostActorX,
      timeSec,
      voiceEnergy,
      lightingMood,
      lightingEnabled,
      beatPulse,
      actorX,
      actorZ,
      mood,
    } = params;

    this.riserGroup.visible = showRiser;
    if (showRiser) {
      const riserScaleY = (riserTopY ?? STUDIO_RISER_TOP_Y) / STUDIO_RISER_TOP_Y;
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

    if (this.spotPool) {
      this.spotPool.visible = lightingEnabled;
      this.spotPool.position.set(actorX * 0.92, 0.01, actorZ);
      this.spotPool.scale.set(3.4 * beatPulse * mood.spotScale, 2.0 * beatPulse * mood.spotScale, 1);
      const sm = this.spotPool.material as THREE.MeshBasicMaterial;
      sm.color.set(mood.spotHex);
      sm.opacity = (0.42 + voiceEnergy * 0.14) * clamp(mood.spot, 0.6, 1.35);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.floorTextures?.dispose();
    this.riserOakTex?.dispose();
    this.wallTex?.dispose();
    this.signTex?.dispose();
    this.crtScope?.dispose();
    this.crtBars?.dispose();
    this.slatGeo.dispose();
    this.fresnelLeftMat.dispose();
    this.fresnelRightMat.dispose();
  }
}
