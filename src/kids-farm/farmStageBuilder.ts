/**
 * Custom Three.js 3D Storybook Farm School Stage (`buildKidsFarmStage`).
 *
 * Models the complete sunlit farm world purely in Three.js + newly generated
 * `/kids-farm/textures/*` textures:
 *  - Panoramic sky dome + 3D rolling meadow hills
 *  - Textured green daisy meadow + cedar timber Barn Porch Stage Deck (y = 0)
 *  - Hero 3D Red Gambrel Barn with white X-braced open doors, warm glowing interior,
 *    wooden-framed Chalkboard School Sign, swinging lantern, and spinning golden weathervane
 *  - Rotating 3D wooden Windmill on the left hill
 *  - Glossy shimmering Duck Pond with lily pads, pebbles, cattails, and rocking toy sailboat
 *  - Layered 3D Apple Orchard trees, white split-rail fences, swaying sunflowers, hay bales,
 *    colorful overhead bunting flags, and painted ABC / 123 wooden toy blocks
 */
import * as THREE from "three";
import { KIDS_FARM_MOODS, type KidsFarmMoodId, type KidsFarmMoodSpec } from "./kidsFarmCatalog.ts";

export interface KidsFarmStageHandle {
  update(elapsedSec: number, dtSec: number): void;
  setMood(moodId: KidsFarmMoodId): void;
  setWindStrength(strength: number): void;
  dispose(): void;
}

function makePaintedBlockTexture(letter: string, bgHex: string, borderHex: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = borderHex;
    ctx.lineWidth = 22;
    ctx.strokeRect(11, 11, 234, 234);
    ctx.fillStyle = "#fffdf6";
    ctx.font = "bold 148px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, 128, 134);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildKidsFarmStage(scene: THREE.Scene, renderer: THREE.WebGLRenderer): KidsFarmStageHandle {
  const stageRoot = new THREE.Group();
  stageRoot.name = "KidsFarmWorld";
  scene.add(stageRoot);

  const texLoader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];

  const loadTex = (url: string, repeatX = 1, repeatY = 1): THREE.Texture => {
    const t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    textures.push(t);
    return t;
  };

  const skyTex = loadTex("/kids-farm/textures/farm-sky-panorama.png", 1, 1);
  skyTex.wrapS = THREE.ClampToEdgeWrapping;
  skyTex.wrapT = THREE.ClampToEdgeWrapping;
  const meadowTex = loadTex("/kids-farm/textures/farm-meadow-ground.png", 12, 10);
  const barnWoodTex = loadTex("/kids-farm/textures/farm-red-barn-wood.png", 3, 2);
  const signTex = loadTex("/kids-farm/textures/farm-chalkboard-sign.png", 1, 1);
  signTex.wrapS = THREE.ClampToEdgeWrapping;
  signTex.wrapT = THREE.ClampToEdgeWrapping;

  // Lighting rig (dynamically re-themed by morning / afternoon / lullaby moods)
  const fog = new THREE.Fog(0xd8f1ff, 12, 30);
  scene.fog = fog;
  scene.background = new THREE.Color(0xbce7ff);

  const hemi = new THREE.HemisphereLight(0xc8ebff, 0x6f994a, 1.05);
  stageRoot.add(hemi);

  const sunKey = new THREE.DirectionalLight(0xfff7e0, 2.35);
  sunKey.position.set(5.5, 9.0, 6.2);
  sunKey.castShadow = true;
  sunKey.shadow.mapSize.set(2048, 2048);
  sunKey.shadow.camera.near = 1;
  sunKey.shadow.camera.far = 26;
  sunKey.shadow.camera.left = -6.5;
  sunKey.shadow.camera.right = 6.5;
  sunKey.shadow.camera.top = 5.5;
  sunKey.shadow.camera.bottom = -3.5;
  sunKey.shadow.bias = -0.0006;
  stageRoot.add(sunKey);

  const fillLight = new THREE.DirectionalLight(0xfff0d4, 0.72);
  fillLight.position.set(-5.0, 3.8, 4.5);
  stageRoot.add(fillLight);

  const barnLantern = new THREE.PointLight(0xffb857, 1.4, 9, 1.6);
  barnLantern.position.set(0, 2.25, -1.35);
  stageRoot.add(barnLantern);

  // Curved Panoramic Sky Backdrop
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false });
  const skyDome = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 16, 12.5, 48, 1, true, Math.PI * 0.55, Math.PI * 0.9),
    skyMat,
  );
  skyDome.position.set(0, 4.2, -1.5);
  stageRoot.add(skyDome);

  // Ground Meadow & Rolling Hills
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(17, 48),
    new THREE.MeshStandardMaterial({ map: meadowTex, roughness: 0.92, metalness: 0.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.14;
  ground.receiveShadow = true;
  stageRoot.add(ground);

  const hillMatA = new THREE.MeshStandardMaterial({ color: 0x6ea94a, roughness: 0.9 });
  const hillMatB = new THREE.MeshStandardMaterial({ color: 0x5c963d, roughness: 0.92 });
  const hillSpecs: Array<[number, number, number, number, number, THREE.Material]> = [
    [-7.5, -1.1, -8.5, 5.2, 0.36, hillMatA],
    [7.2, -1.2, -8.2, 5.5, 0.38, hillMatA],
    [0.0, -1.35, -10.5, 7.2, 0.42, hillMatB],
  ];
  for (const [x, y, z, r, sy, m] of hillSpecs) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 14), m);
    hill.scale.set(1.4, sy, 0.9);
    hill.position.set(x, y, z);
    hill.receiveShadow = true;
    stageRoot.add(hill);
  }

  // Cedar Barn Porch Stage Deck (top surface strictly at y = 0.0)
  const plankDeckMat = new THREE.MeshStandardMaterial({ color: 0xb87b48, roughness: 0.78 });
  const timberTrimMat = new THREE.MeshStandardMaterial({ color: 0x8b562e, roughness: 0.8 });
  const porchGroup = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.14, 2.75), plankDeckMat);
  deck.position.set(0, -0.07, -0.1);
  deck.receiveShadow = true;
  deck.castShadow = true;
  porchGroup.add(deck);

  // Sculpted plank seams across top of porch for storybook detail
  for (let i = -3; i <= 3; i++) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(6.85, 0.008, 0.025), timberTrimMat);
    seam.position.set(0, 0.001, -1.25 + (i + 3) * 0.38);
    seam.receiveShadow = true;
    porchGroup.add(seam);
  }
  const frontStep = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 0.42), timberTrimMat);
  frontStep.position.set(0, -0.1, 1.46);
  frontStep.receiveShadow = true;
  frontStep.castShadow = true;
  porchGroup.add(frontStep);
  stageRoot.add(porchGroup);

  // Hero Red Storybook Barn (z = -2.25)
  const barnGroup = new THREE.Group();
  barnGroup.position.set(0, -0.14, -2.55);
  const barnWallMat = new THREE.MeshStandardMaterial({ map: barnWoodTex, color: 0xee4c3e, roughness: 0.82 });
  const whiteTrimMat = new THREE.MeshStandardMaterial({ color: 0xf9f5eb, roughness: 0.65 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x5c3a2b, roughness: 0.84 });

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.5, 2.1), barnWallMat);
  leftWall.position.set(-2.05, 1.25, 0);
  leftWall.castShadow = true;
  leftWall.receiveShadow = true;
  barnGroup.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.5, 2.1), barnWallMat);
  rightWall.position.set(2.05, 1.25, 0);
  rightWall.castShadow = true;
  rightWall.receiveShadow = true;
  barnGroup.add(rightWall);

  const upperFrontWall = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.05, 2.1), barnWallMat);
  upperFrontWall.position.set(0, 3.02, 0);
  upperFrontWall.castShadow = true;
  barnGroup.add(upperFrontWall);

  // Warm cozy glowing barn interior alcove visible between open double doors
  const interiorBack = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 2.5),
    new THREE.MeshStandardMaterial({ color: 0xffe4ad, emissive: 0xffaa44, emissiveIntensity: 0.35 }),
  );
  interiorBack.position.set(0, 1.25, -0.45);
  barnGroup.add(interiorBack);

  // Two open X-braced Red Barn Doors folded outward
  const addBarnDoor = (side: -1 | 1) => {
    const doorPivot = new THREE.Group();
    doorPivot.position.set(side * 1.04, 1.22, 1.06);
    doorPivot.rotation.y = side * -0.52;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.38, 0.08), barnWallMat);
    panel.position.x = side * 0.48;
    panel.castShadow = true;
    doorPivot.add(panel);
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.1, 0.1), whiteTrimMat);
    frameTop.position.set(side * 0.48, 1.12, 0);
    const frameBot = frameTop.clone();
    frameBot.position.y = -1.12;
    doorPivot.add(frameTop, frameBot);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.1), whiteTrimMat);
    brace.position.set(side * 0.48, 0, 0);
    brace.rotation.z = side * 0.38;
    doorPivot.add(brace);
    barnGroup.add(doorPivot);
  };
  addBarnDoor(-1);
  addBarnDoor(1);

  // Classic Gambrel Roof + Hayloft Trim + Spinning Weathervane
  const roofLowerL = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 2.7), roofMat);
  roofLowerL.position.set(-2.35, 3.75, 0.1);
  roofLowerL.rotation.z = 0.62;
  roofLowerL.castShadow = true;
  const roofLowerR = roofLowerL.clone();
  roofLowerR.position.x = 2.35;
  roofLowerR.rotation.z = -0.62;
  const roofTop = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 2.7), roofMat);
  roofTop.position.set(0, 4.45, 0.1);
  roofTop.castShadow = true;
  barnGroup.add(roofLowerL, roofLowerR, roofTop);

  // School Chalkboard Sign above doors
  const signFrame = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.18, 0.12), timberTrimMat);
  signFrame.position.set(0, 3.1, 1.09);
  signFrame.castShadow = true;
  const signBoard = new THREE.Mesh(
    new THREE.PlaneGeometry(2.48, 0.98),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.55 }),
  );
  signBoard.position.set(0, 3.1, 1.16);
  barnGroup.add(signFrame, signBoard);

  // Glowing hanging lantern orb on porch
  const lanternBulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe49e,
    emissive: 0xffa73b,
    emissiveIntensity: 1.5,
  });
  const lanternBody = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), lanternBulbMat);
  lanternBody.position.set(0, 2.42, 1.24);
  barnGroup.add(lanternBody);

  // Golden spinning weathervane on roof ridge
  const vaneGroup = new THREE.Group();
  vaneGroup.position.set(0, 4.78, 0.2);
  const vanePost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.52, 8), timberTrimMat);
  const vaneArrow = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.06, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xf2b735, roughness: 0.35, metalness: 0.6 }),
  );
  vaneArrow.position.y = 0.22;
  vaneGroup.add(vanePost, vaneArrow);
  barnGroup.add(vaneGroup);
  stageRoot.add(barnGroup);

  // Spinning 3D Wooden Windmill (stage left back)
  const windmillGroup = new THREE.Group();
  windmillGroup.position.set(-4.15, -0.14, -2.95);
  const wmTower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.62, 2.6, 8),
    new THREE.MeshStandardMaterial({ color: 0xc9965c, roughness: 0.85 }),
  );
  wmTower.position.y = 1.3;
  wmTower.castShadow = true;
  const wmRoof = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.65, 8), roofMat);
  wmRoof.position.y = 2.9;
  const wmHub = new THREE.Group();
  wmHub.position.set(0, 2.4, 0.45);
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xf7efd8, roughness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const armWrap = new THREE.Group();
    armWrap.rotation.z = (i * Math.PI) / 2;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.25, 0.04), timberTrimMat);
    spar.position.y = 0.62;
    const sail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.96, 0.02), sailMat);
    sail.position.set(0.16, 0.72, 0.02);
    sail.castShadow = true;
    armWrap.add(spar, sail);
    wmHub.add(armWrap);
  }
  windmillGroup.add(wmTower, wmRoof, wmHub);
  stageRoot.add(windmillGroup);

  // White Split-Rail Pasture Fences framing meadow flanks
  const addFenceSegment = (x: number, z: number, yaw: number) => {
    const f = new THREE.Group();
    f.position.set(x, -0.14, z);
    f.rotation.y = yaw;
    for (const px of [-0.65, 0.65]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), whiteTrimMat);
      post.position.set(px, 0.42, 0);
      post.castShadow = true;
      f.add(post);
    }
    for (const ry of [0.34, 0.65]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.08, 0.05), whiteTrimMat);
      rail.position.set(0, ry, 0);
      rail.castShadow = true;
      f.add(rail);
    }
    stageRoot.add(f);
  };
  addFenceSegment(-4.4, -0.7, 0.25);
  addFenceSegment(-5.7, 0.1, 0.55);
  addFenceSegment(4.45, -1.1, -0.28);

  // Shimmering Duck Pond with Lily Pads & Rocking Sailboat (stage right)
  const pondGroup = new THREE.Group();
  pondGroup.position.set(3.85, -0.12, 0.38);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x3ea6d6,
    roughness: 0.12,
    metalness: 0.25,
    emissive: 0x0b3147,
    emissiveIntensity: 0.25,
  });
  const pondWater = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.32, 0.04, 28), waterMat);
  pondWater.scale.set(1.22, 1, 0.86);
  pondWater.receiveShadow = true;
  pondGroup.add(pondWater);

  const rippleRing = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.52, 24),
    new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  rippleRing.rotation.x = -Math.PI / 2;
  rippleRing.position.set(-0.2, 0.03, 0.1);
  pondGroup.add(rippleRing);

  const lilyMat = new THREE.MeshStandardMaterial({ color: 0x4ca64c, roughness: 0.7 });
  for (const [lx, lz, sc] of [[-0.65, -0.25, 0.22], [0.58, 0.28, 0.18], [0.22, -0.45, 0.16]] as const) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(sc, sc, 0.015, 16, 1, false, 0, Math.PI * 1.75), lilyMat);
    pad.position.set(lx, 0.03, lz);
    pondGroup.add(pad);
  }

  const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x9fa8a3, roughness: 0.85 });
  for (let a = 0; a < 14; a++) {
    const ang = (a / 14) * Math.PI * 2;
    const peb = new THREE.Mesh(new THREE.SphereGeometry(0.11 + (a % 3) * 0.03, 10, 8), pebbleMat);
    peb.scale.set(1.2, 0.55, 1.0);
    peb.position.set(Math.cos(ang) * 1.62, 0.02, Math.sin(ang) * 1.15);
    pondGroup.add(peb);
  }

  // Toy Wooden Sailboat floating in the duck pond
  const boat = new THREE.Group();
  boat.position.set(0.15, 0.04, 0.08);
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.42, 6),
    new THREE.MeshStandardMaterial({ color: 0xe64d3b, roughness: 0.6 }),
  );
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1.0, 1.0, 0.42);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 8), timberTrimMat);
  mast.position.y = 0.21;
  const boatSail = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xfff8e6, side: THREE.DoubleSide }),
  );
  boatSail.position.set(0.12, 0.26, 0);
  boat.add(hull, mast, boatSail);
  pondGroup.add(boat);
  stageRoot.add(pondGroup);

  // Apple Orchard Trees + Swaying Sunflowers
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x70482b, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x45923c, roughness: 0.85 });
  const appleMat = new THREE.MeshStandardMaterial({ color: 0xe33b2d, roughness: 0.35 });
  const addAppleTree = (tx: number, tz: number, scale = 1.0) => {
    const tree = new THREE.Group();
    tree.position.set(tx, -0.14, tz);
    tree.scale.setScalar(scale);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.75, 10), trunkMat);
    trunk.position.y = 0.87;
    trunk.castShadow = true;
    tree.add(trunk);
    const crowns: Array<[number, number, number, number]> = [
      [0, 2.25, 0, 1.05],
      [-0.62, 1.9, 0.25, 0.72],
      [0.64, 1.92, -0.18, 0.74],
      [0.05, 2.75, -0.1, 0.68],
    ];
    for (const [cx, cy, cz, cr] of crowns) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(cr, 14, 12), leafMat);
      puff.position.set(cx, cy, cz);
      puff.castShadow = true;
      tree.add(puff);
    }
    for (const [ax, ay, az] of [
      [-0.45, 2.0, 0.75],
      [0.48, 2.25, 0.72],
      [0.02, 1.75, 0.88],
      [-0.75, 1.78, 0.45],
      [0.65, 1.85, 0.48],
    ] as const) {
      const apple = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), appleMat);
      apple.position.set(ax, ay, az);
      tree.add(apple);
    }
    stageRoot.add(tree);
  };
  addAppleTree(-4.2, -1.85, 1.05);
  addAppleTree(4.25, -2.25, 1.12);
  addAppleTree(5.4, -0.8, 0.86);

  // Swaying Sunflowers
  const sunflowers: THREE.Group[] = [];
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3b8032, roughness: 0.85 });
  const petalMat = new THREE.MeshStandardMaterial({ color: 0xffc425, roughness: 0.55 });
  const flowerCenterMat = new THREE.MeshStandardMaterial({ color: 0x4f2f16, roughness: 0.9 });
  const flowerSpots: Array<[number, number]> = [
    [-3.6, 0.85], [-3.25, 1.15], [-3.85, 1.28], [3.1, 1.22], [3.55, 1.38], [2.95, 1.55],
  ];
  for (const [fx, fz] of flowerSpots) {
    const fl = new THREE.Group();
    fl.position.set(fx, -0.14, fz);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.62, 8), stemMat);
    stem.position.y = 0.31;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12), flowerCenterMat);
    head.rotation.x = Math.PI / 2 - 0.25;
    head.position.y = 0.64;
    const petals = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.055, 8, 12), petalMat);
    petals.rotation.x = -0.25;
    petals.position.y = 0.64;
    fl.add(stem, head, petals);
    sunflowers.push(fl);
    stageRoot.add(fl);
  }

  // Painted Wooden ABC / 123 Learning Blocks & Golden Hay Bales on Porch Flanks
  const hayMat = new THREE.MeshStandardMaterial({ color: 0xe3b94c, roughness: 0.92 });
  const hayA = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, 0.48), hayMat);
  hayA.position.set(-3.05, 0.21, -0.92);
  hayA.rotation.y = 0.22;
  hayA.castShadow = true;
  const hayB = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.38, 0.46), hayMat);
  hayB.position.set(3.02, 0.19, -0.96);
  hayB.rotation.y = -0.18;
  hayB.castShadow = true;
  stageRoot.add(hayA, hayB);

  const blockDefs: Array<[string, string, string, number, number, number, number]> = [
    ["A", "#e24a3b", "#fff5e1", -3.42, 0.14, 0.82, 0.18],
    ["B", "#328cc1", "#fff5e1", -3.08, 0.14, 0.92, -0.24],
    ["C", "#3ea34d", "#fff5e1", -3.25, 0.42, 0.86, 0.08],
    ["1", "#e69f24", "#fff5e1", 3.42, 0.14, 0.80, -0.2],
    ["2", "#8e54b5", "#fff5e1", 3.08, 0.14, 0.90, 0.22],
    ["3", "#e06c88", "#fff5e1", 3.25, 0.42, 0.84, -0.06],
  ];
  for (const [ch, bg, brd, bx, by, bz, yaw] of blockDefs) {
    const tex = makePaintedBlockTexture(ch, bg, brd);
    textures.push(tex);
    const blk = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, 0.28),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }),
    );
    blk.position.set(bx, by, bz);
    blk.rotation.y = yaw;
    blk.castShadow = true;
    blk.receiveShadow = true;
    stageRoot.add(blk);
  }

  // Festive Bunting Flags Across the Barn Eaves
  const flagColors = [0xe8483c, 0xf6b93b, 0x3ba356, 0x3b8be8, 0xe86c9f];
  const flagMats = flagColors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide }),
  );
  for (let i = 0; i < 15; i++) {
    const u = i / 14;
    const fx = -3.3 + u * 6.6;
    const sag = Math.sin(u * Math.PI) * 0.28;
    const fy = 2.65 - sag;
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.22, 3), flagMats[i % flagMats.length]!);
    tri.rotation.x = Math.PI;
    tri.position.set(fx, fy, -1.25);
    stageRoot.add(tri);
  }

  // Soft Glowing Fireflies for Starry Lullaby mode
  const fireflyCount = 32;
  const fireflyPos = new Float32Array(fireflyCount * 3);
  for (let i = 0; i < fireflyCount; i++) {
    fireflyPos[i * 3] = (Math.random() - 0.5) * 9.5;
    fireflyPos[i * 3 + 1] = 0.25 + Math.random() * 2.5;
    fireflyPos[i * 3 + 2] = -2.0 + Math.random() * 4.5;
  }
  const fireflyGeo = new THREE.BufferGeometry();
  fireflyGeo.setAttribute("position", new THREE.BufferAttribute(fireflyPos, 3));
  const fireflies = new THREE.Points(
    fireflyGeo,
    new THREE.PointsMaterial({ color: 0xffe47a, size: 0.09, transparent: true, opacity: 0.9 }),
  );
  fireflies.visible = false;
  stageRoot.add(fireflies);

  let windStrength = 1.0;
  const setWindStrength = (strength: number) => {
    windStrength = Math.max(0.2, Math.min(2.6, strength));
  };

  const setMood = (moodId: KidsFarmMoodId) => {
    const spec: KidsFarmMoodSpec = KIDS_FARM_MOODS.find((m) => m.id === moodId) ?? KIDS_FARM_MOODS[0]!;
    skyMat.color.setHex(spec.skyTintHex);
    fog.color.setHex(spec.fogHex);
    (scene.background as THREE.Color).setHex(spec.fogHex);
    sunKey.color.setHex(spec.keyColorHex);
    sunKey.intensity = spec.keyIntensity;
    hemi.color.setHex(spec.hemiSkyHex);
    hemi.groundColor.setHex(spec.hemiGroundHex);
    hemi.intensity = spec.hemiIntensity;
    renderer.toneMappingExposure = spec.exposure;
    barnLantern.intensity = spec.barnLanternIntensity;
    fireflies.visible = spec.firefliesVisible;
  };
  setMood("morning");

  const update = (elapsedSec: number, dtSec: number) => {
    wmHub.rotation.z += dtSec * 0.72 * windStrength;
    vaneGroup.rotation.y = Math.sin(elapsedSec * 0.55 * windStrength) * 0.65;
    boat.rotation.z = Math.sin(elapsedSec * 1.4 * windStrength) * 0.08 * windStrength;
    boat.rotation.x = Math.cos(elapsedSec * 1.1) * 0.05;
    boat.position.y = 0.04 + Math.sin(elapsedSec * 2.0) * 0.012;
    rippleRing.scale.setScalar(1.0 + Math.sin(elapsedSec * 1.9) * 0.14);
    for (let i = 0; i < sunflowers.length; i++) {
      sunflowers[i]!.rotation.z = Math.sin(elapsedSec * 1.3 * windStrength + i * 0.9) * 0.055 * windStrength;
    }
    if (fireflies.visible) {
      const posAttr = fireflyGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < fireflyCount; i++) {
        const baseY = posAttr.getY(i);
        posAttr.setY(i, baseY + Math.sin(elapsedSec * 2.1 + i) * dtSec * 0.12);
      }
      posAttr.needsUpdate = true;
    }
  };

  const dispose = () => {
    textures.forEach((t) => t.dispose());
    stageRoot.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x?.dispose());
      else if (mat) mat.dispose();
    });
    scene.remove(stageRoot);
  };

  return { update, setMood, setWindStrength, dispose };
}
