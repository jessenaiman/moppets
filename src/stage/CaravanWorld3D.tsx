/**
 * Meadow Caravan 3D (`S-30` · `D-67` / `D-68` / `D-69`):
 * A Three.js 3D Folded Cardstock Parade Caravan pulled by a rocking cardboard horse
 * across rolling sunset paper hills, carrying ANY song's polymorphic cast (1 solo hero
 * up to an 8-voice choir) cleanly on the beat!
 *
 * Interactive toys (100% deterministic for Remotion MP4 export):
 *  - Caravan Horn impulse -> joyful wagon hop + expanding paper dust puff + horn ring flash
 *  - Click-a-Rider Spotlight -> highlights a chosen cast member front-and-center
 *  - Drag-to-orbit camera
 */
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import type { WorldState } from "./worlds.ts";

export interface CaravanWorld3DProps {
  state: WorldState;
  beat: number;
  userOrbit: { azimuth: number; elevation: number } | null;
  hornImpulse: number;
  spotlightId: string | null;
  resolveAsset: (path: string) => string;
}

const MAX_RIDERS = 8;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function buildWheel(radius: number, woodMat: THREE.Material, brassMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.12, 8, 22), woodMat);
  rim.castShadow = true;
  g.add(rim);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, 0.14, 12), brassMat);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);

  const spokeGeo = new THREE.BoxGeometry(radius * 1.85, radius * 0.09, 0.05);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(spokeGeo, woodMat);
    spoke.rotation.z = (i * Math.PI) / 4;
    spoke.castShadow = true;
    g.add(spoke);
  }
  return g;
}

/** Hand-cut folded cardstock rocking horse pulling the parade wagon. */
function buildCardstockHorse(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe6cfa8, roughness: 0.88 });
  const maneMat = new THREE.MeshStandardMaterial({ color: 0x8f3e2d, roughness: 0.82 });
  const saddleMat = new THREE.MeshStandardMaterial({ color: 0x2d7f76, roughness: 0.78 });
  const rockerMat = new THREE.MeshStandardMaterial({ color: 0xb65c3e, roughness: 0.85 });

  // Curved wooden rocker runner underneath
  const rocker = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.06, 8, 24, Math.PI * 0.56), rockerMat);
  rocker.rotation.z = Math.PI * 1.22;
  rocker.position.set(0, 1.12, 0);
  rocker.castShadow = true;
  g.add(rocker);

  // Legs
  const legGeo = new THREE.BoxGeometry(0.16, 0.72, 0.14);
  for (const [lx, rot] of [
    [-0.42, 0.18],
    [0.42, -0.18],
  ] as const) {
    const legL = new THREE.Mesh(legGeo, bodyMat);
    legL.position.set(lx, 0.55, 0.18);
    legL.rotation.z = rot;
    legL.castShadow = true;
    const legR = legL.clone();
    legR.position.z = -0.18;
    g.add(legL, legR);
  }

  // Barrel torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.56, 0.52), bodyMat);
  torso.position.set(0, 0.98, 0);
  torso.castShadow = true;
  g.add(torso);

  // Painted felt saddle blanket
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.34, 0.58), saddleMat);
  saddle.position.set(-0.04, 1.12, 0);
  saddle.castShadow = true;
  g.add(saddle);

  // Angled neck & head
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.68, 0.34), bodyMat);
  neck.position.set(0.56, 1.38, 0);
  neck.rotation.z = -0.45;
  neck.castShadow = true;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.32, 0.32), bodyMat);
  head.position.set(0.86, 1.62, 0);
  head.rotation.z = -0.25;
  head.castShadow = true;
  g.add(head);

  // Folded paper ears & mane
  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), maneMat);
  ear.position.set(0.68, 1.84, 0.09);
  const ear2 = ear.clone();
  ear2.position.z = -0.09;
  g.add(ear, ear2);

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.52, 0.12), maneMat);
  mane.position.set(0.42, 1.48, 0);
  mane.rotation.z = -0.45;
  g.add(mane);

  // Swishing paper tail
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 5), maneMat);
  tail.position.set(-0.76, 1.02, 0);
  tail.rotation.z = 0.72;
  g.add(tail);

  return g;
}

interface RiderSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

interface CaravanHandles {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  keyLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  spotLight: THREE.PointLight;
  accentLight: THREE.PointLight;
  wagonGroup: THREE.Group;
  horseGroup: THREE.Group;
  wheels: THREE.Group[];
  hornRing: THREE.Mesh;
  hornMat: THREE.MeshStandardMaterial;
  dustGroup: THREE.Group;
  fenceGroup: THREE.Group;
  hillNear: THREE.Group;
  hillFar: THREE.Group;
  sunDisc: THREE.Mesh;
  sunMat: THREE.MeshStandardMaterial;
  riders: RiderSlot[];
  textures: Map<string, THREE.Texture>;
  loader: THREE.TextureLoader;
}

export const CaravanWorld3D: React.FC<CaravanWorld3DProps> = ({
  state,
  beat,
  userOrbit,
  hornImpulse,
  spotlightId,
  resolveAsset,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<CaravanHandles | null>(null);
  const latestRef = useRef({ state, beat, userOrbit, hornImpulse, spotlightId, resolveAsset });
  latestRef.current = { state, beat, userOrbit, hornImpulse, spotlightId, resolveAsset };

  const renderNow = () => {
    const h = handlesRef.current;
    if (!h) return;
    const { state: st, beat: b, userOrbit: orbit, hornImpulse: horn, spotlightId: spotId, resolveAsset: resolveUrl } = latestRef.current;

    const castCount = Math.max(1, Math.min(MAX_RIDERS, st.cast.length));
    const darkAmt = st.darkness;
    const secName = st.plate.sectionName.toLowerCase();
    const isSaddleUp = secName.includes("saddle");
    const isGallop = secName.includes("trot") || secName.includes("chorus") || secName.includes("reprise");
    const isHornBreak = secName.includes("horn");
    const actProgress = clamp01((b - st.plate.startBeat) / Math.max(4, st.plate.endBeat - st.plate.startBeat));

    // 1. Camera with intent (sweeping push-in on [horn break], wide joyous gallop on chorus!)
    const baseAz = isHornBreak
      ? lerp(-0.18, 0.16, actProgress)
      : lerp(-0.12, 0.14, clamp01(st.plateIndex / Math.max(1, st.plates.length - 1)));
    const az = orbit ? orbit.azimuth : baseAz;
    const el = orbit ? orbit.elevation : isHornBreak ? 0.2 : 0.24;
    const dist = (castCount >= 5 ? 12.8 : 11.4) - (isHornBreak ? 1.15 : 0);
    h.camera.position.set(
      Math.sin(az) * Math.cos(el) * dist + 0.3,
      Math.sin(el) * dist + 1.45,
      Math.cos(az) * Math.cos(el) * dist,
    );
    h.camera.lookAt(isHornBreak ? 0.65 : 0.25, 1.45, 0);

    // 2. Beat-locked story choreography (walk -> gallop trot -> automated horn break hop -> sunset cruise!)
    const speedMul = isGallop ? 1.55 : isHornBreak ? 1.85 : 1.05;
    const travel = b * speedMul;
    const stepBounce = Math.abs(Math.sin(b * Math.PI * (isGallop ? 2 : 1))) * (isGallop ? 0.16 : st.singing ? 0.1 : 0.04);
    const autoHornHop = isHornBreak ? Math.abs(Math.sin(b * Math.PI * 2)) * 0.26 : 0;
    const manualHornHop = horn > 0 ? Math.abs(Math.sin(horn * 1.7 + b * 2)) * 0.24 : 0;
    const hornHop = Math.max(autoHornHop, manualHornHop);

    h.wagonGroup.position.y = stepBounce + hornHop;
    h.wagonGroup.rotation.z = Math.sin(b * Math.PI * (isGallop ? 1 : 0.5)) * (isGallop ? 0.04 : 0.024) + (hornHop > 0.08 ? 0.055 : 0);

    h.horseGroup.position.y = stepBounce * 0.9 + hornHop * 0.75;
    h.horseGroup.rotation.z = Math.sin(b * Math.PI * (isGallop ? 2 : 1)) * (isGallop ? 0.22 : 0.14);

    for (const wheel of h.wheels) {
      wheel.rotation.z = -travel * 1.45;
    }

    // Repeating wooden milepost fence scrolling smoothly behind the road
    const fenceWrap = (travel * 1.45) % 2.4;
    h.fenceGroup.position.x = -fenceWrap;

    // Parallax folded sunset hills
    h.hillNear.position.x = -((travel * 0.5) % 6) + 3;
    h.hillFar.position.x = -((travel * 0.22) % 8) + 4;

    // Horn brass ring flash & playful paper dust puff behind the rear wheel
    h.hornMat.emissive.set(isHornBreak ? "#ffcb47" : st.primaryAccent);
    h.hornMat.emissiveIntensity = 0.55 + st.energyA * 1.4 + (isHornBreak ? 1.8 : 0) + (manualHornHop > 0.04 ? 1.5 : 0);
    const puffScale = 0.74 + Math.abs(Math.sin(b * Math.PI)) * 0.35 + (isGallop ? 0.28 : 0) + hornHop * 2.1;
    h.dustGroup.scale.setScalar(puffScale);

    // 3. Sunset-to-Golden-Hour atmosphere lighting tinted to the cast
    h.keyLight.intensity = lerp(2.5, 0.65, darkAmt) + (isHornBreak ? 0.35 : 0);
    h.keyLight.color.setHex(darkAmt > 0.4 ? 0x89a8de : isHornBreak ? 0xffe29c : 0xffd7a1);
    h.hemiLight.intensity = lerp(1.15, 0.45, darkAmt);
    h.sunDisc.position.y = lerp(3.4, 1.3, darkAmt) + st.energyA * 0.22;
    h.sunMat.emissiveIntensity = lerp(0.95, 0.22, darkAmt) + st.energyA * 0.5 + (isHornBreak ? 0.45 : 0);

    h.spotLight.color.set(st.primaryAccent);
    h.accentLight.color.set(st.secondaryAccent);
    h.spotLight.intensity = 1.9 + st.energyA * 3.6;
    h.accentLight.intensity = 1.3 + st.energyB * 2.6;

    // 4. Mount EVERY onstage performer in `state.cast` inside the parade caravan!
    let spotX = -0.8;
    for (let idx = 0; idx < MAX_RIDERS; idx++) {
      const slot = h.riders[idx];
      const performer = st.cast[idx];
      if (!performer) {
        slot.mesh.visible = false;
        continue;
      }
      slot.mesh.visible = true;

      const isSpot = spotId ? performer.id === spotId : performer.id === st.lead.id;
      const u = castCount === 1 ? 0.5 : idx / (castCount - 1);
      // Wagon deck spans x = -3.25 .. +1.45; solo rides center, 4-pack spreads cleanly across wagon + front saddle!
      const rx = castCount === 1 ? -0.95 : lerp(-3.2, 1.45, u);
      const rz = castCount <= 2 ? 0.1 : idx % 2 === 0 ? 0.34 : -0.26;
      const baseScale = castCount === 1 ? 1.05 : castCount <= 4 ? 0.86 : castCount <= 5 ? 0.74 : 0.64;
      const scale = isSpot ? baseScale * 1.12 : baseScale;

      // Sequential joyous boarding pop during [saddle up] (each rider hops cleanly up on their 8-beat turn!)
      const boardPop = isSaddleUp && b > 0.05
        ? clamp01((b - idx * 8 + 1.5) / 1.5)
        : 1;
      const gallopPairBounce = isGallop ? Math.abs(Math.sin(b * Math.PI + idx * 1.4)) * 0.12 : 0;
      const singBounce = performer.singing ? 0.14 + performer.level * 0.2 : 0;
      const riderY = 1.15 + (2.35 * scale) * 0.46 + singBounce + gallopPairBounce - (1 - boardPop) * 0.55;

      slot.mesh.scale.set(scale, scale * Math.max(0.55, boardPop), 1);
      slot.mesh.position.set(rx, riderY, rz + (isSpot || performer.singing ? 0.24 : 0));
      slot.mesh.rotation.z = performer.singing
        ? Math.sin(b * Math.PI * 1.5 + idx) * 0.07
        : isHornBreak
          ? Math.sin(b * Math.PI * 2 + idx) * 0.08
          : 0;

      if (isSpot) spotX = rx;

      const fullUrl = resolveUrl(performer.cel.atlasUrl);
      let tex = h.textures.get(fullUrl);
      if (!tex) {
        tex = h.loader.load(fullUrl, () => renderNow());
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        h.textures.set(fullUrl, tex);
      }
      if (slot.mat.map !== tex) {
        slot.mat.map = tex;
        slot.mat.needsUpdate = true;
      }
      const { cols, rows, frame } = performer.cel;
      const col = frame % cols;
      const row = Math.floor(frame / cols);
      tex.repeat.set(1 / cols, 1 / rows);
      tex.offset.set(col / cols, 1 - (row + 1) / rows);

      slot.mat.emissive.set(performer.singing || isSpot ? performer.color : "#000000");
      slot.mat.emissiveIntensity = performer.singing ? 0.16 + performer.level * 0.24 : isSpot ? 0.1 : 0;
    }

    h.spotLight.position.set(spotX, 3.1, 1.6);

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

    const hemiLight = new THREE.HemisphereLight(0xffe9c7, 0x264436, 1.15);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffd7a1, 2.5);
    keyLight.position.set(-5, 9, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 6;
    keyLight.shadow.camera.bottom = -4;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const spotLight = new THREE.PointLight(0x57d3e8, 2.2, 8, 1.6);
    scene.add(spotLight);

    const accentLight = new THREE.PointLight(0xf2c15a, 1.6, 8, 1.6);
    accentLight.position.set(3.2, 2.4, 1.4);
    scene.add(accentLight);

    // Golden Road & Meadow Ground Strip
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x4b7454, roughness: 0.94 }),
    );
    ground.position.set(0, -0.22, 0);
    ground.receiveShadow = true;
    scene.add(ground);

    const road = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.05, 2.6),
      new THREE.MeshStandardMaterial({ color: 0xd9c297, roughness: 0.95 }),
    );
    road.position.set(0, 0.01, 0.1);
    road.receiveShadow = true;
    scene.add(road);

    // Layered Folded Cardstock Hills (background parallax)
    const hillFar = new THREE.Group();
    const hillFarMat = new THREE.MeshStandardMaterial({ color: 0x385e58, roughness: 0.92, flatShading: true });
    for (let i = -3; i <= 3; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 3.2, 4), hillFarMat);
      cone.position.set(i * 4.2, 1.4, -3.9);
      cone.rotation.y = Math.PI * 0.25;
      hillFar.add(cone);
    }
    scene.add(hillFar);

    const hillNear = new THREE.Group();
    const hillNearMat = new THREE.MeshStandardMaterial({ color: 0x47775f, roughness: 0.92, flatShading: true });
    for (let i = -4; i <= 4; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.0, 4), hillNearMat);
      cone.position.set(i * 3.1, 0.8, -2.55);
      cone.rotation.y = Math.PI * 0.22;
      hillNear.add(cone);
    }
    scene.add(hillNear);

    // Setting Golden Sun Disc
    const sunMat = new THREE.MeshStandardMaterial({
      color: 0xf6cf6b,
      emissive: 0xee9d38,
      emissiveIntensity: 0.9,
      roughness: 0.45,
    });
    const sunDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.08, 28), sunMat);
    sunDisc.rotation.x = Math.PI / 2;
    sunDisc.position.set(-3.2, 3.4, -4.6);
    scene.add(sunDisc);

    // Scrolling Wooden Fenceposts along the back edge of the road
    const fenceGroup = new THREE.Group();
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.88 });
    const postGeo = new THREE.BoxGeometry(0.11, 0.72, 0.11);
    for (let i = -6; i <= 7; i++) {
      const post = new THREE.Mesh(postGeo, fenceMat);
      post.position.set(i * 2.4, 0.36, -1.45);
      post.castShadow = true;
      fenceGroup.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(34, 0.07, 0.06), fenceMat);
    rail.position.set(0, 0.56, -1.45);
    fenceGroup.add(rail);
    scene.add(fenceGroup);

    // Parade Caravan Wagon Group
    const wagonGroup = new THREE.Group();
    scene.add(wagonGroup);

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x9b5434, roughness: 0.85 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xf4e7cc, roughness: 0.88 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xe3b85d, metalness: 0.55, roughness: 0.35 });

    // Wooden wagon bed + side rails + red banner apron
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.24, 1.85), woodMat);
    deck.position.set(-1.05, 0.88, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    wagonGroup.add(deck);

    const sideWallBack = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.72, 0.1), woodMat);
    sideWallBack.position.set(-1.05, 1.32, -0.88);
    sideWallBack.castShadow = true;
    wagonGroup.add(sideWallBack);

    const sideWallFront = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.42, 0.1), trimMat);
    sideWallFront.position.set(-1.05, 1.15, 0.88);
    sideWallFront.castShadow = true;
    wagonGroup.add(sideWallFront);

    // Hitch shafts connecting wagon to the rocking horse
    const hitchGeo = new THREE.BoxGeometry(1.7, 0.08, 0.08);
    for (const hz of [-0.36, 0.36]) {
      const shaft = new THREE.Mesh(hitchGeo, woodMat);
      shaft.position.set(2.45, 0.94, hz);
      shaft.castShadow = true;
      wagonGroup.add(shaft);
    }

    // Brass Caravan Horn Ring mounted at front rail
    const hornMat = new THREE.MeshStandardMaterial({
      color: 0xf4cf71,
      emissive: 0x57d3e8,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });
    const hornRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.055, 10, 20), hornMat);
    hornRing.position.set(1.72, 1.48, 0.94);
    wagonGroup.add(hornRing);

    // 4 Spinning Spoked Wooden Wheels
    const wheels: THREE.Group[] = [];
    for (const [wx, wz, r] of [
      [-2.85, 0.98, 0.62],
      [0.65, 0.98, 0.56],
      [-2.85, -0.98, 0.62],
      [0.65, -0.98, 0.56],
    ] as const) {
      const w = buildWheel(r, woodMat, brassMat);
      w.position.set(wx, r, wz);
      wagonGroup.add(w);
      wheels.push(w);
    }

    // Playful paper dust-puff cluster trailing behind the wagon
    const dustGroup = new THREE.Group();
    const dustMat = new THREE.MeshStandardMaterial({ color: 0xf7efe1, roughness: 0.95 });
    for (const [dx, dy, dr] of [
      [0, 0.25, 0.22],
      [-0.28, 0.36, 0.18],
      [-0.52, 0.22, 0.14],
    ] as const) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(dr, 1), dustMat);
      puff.position.set(dx, dy, 0.35);
      dustGroup.add(puff);
    }
    dustGroup.position.set(-4.05, 0.08, 0.25);
    scene.add(dustGroup);

    // Cardstock Rocking Horse at the front
    const horseGroup = buildCardstockHorse();
    horseGroup.position.set(3.45, 0.04, 0);
    scene.add(horseGroup);

    // Polymorphic Rider Pool (mounted inside the moving wagon!)
    const riders: RiderSlot[] = Array.from({ length: MAX_RIDERS }, () => {
      const mat = new THREE.MeshStandardMaterial({
        transparent: true,
        alphaTest: 0.35,
        roughness: 0.72,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 2.35), mat);
      mesh.castShadow = true;
      mesh.visible = false;
      wagonGroup.add(mesh);
      return { mesh, mat };
    });

    const handles: CaravanHandles = {
      renderer,
      scene,
      camera,
      keyLight,
      hemiLight,
      spotLight,
      accentLight,
      wagonGroup,
      horseGroup,
      wheels,
      hornRing,
      hornMat,
      dustGroup,
      fenceGroup,
      hillNear,
      hillFar,
      sunDisc,
      sunMat,
      riders,
      textures: new Map(),
      loader: new THREE.TextureLoader(),
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
      handles.textures.forEach((t) => t.dispose());
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

  useEffect(() => {
    renderNow();
  });

  return <div ref={hostRef} className="nw-three-host" aria-hidden="true" />;
};
