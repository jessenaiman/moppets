/**
 * 60 fps Lit Three.js 2.5D Studio 404 Stage for Canon v2 Tabby (Mop #1).
 *
 * Streams audited 24 fps `#00FF00` Canon v2 MP4 clips via `THREE.VideoTexture`, applies a custom
 * cyan-protected GLSL chroma key + green despill + 2.5D normal-wrapped stage lighting shader,
 * mounts Tabby atop her weathered steamer-trunk riser beside a vintage brass mic & XLR cable
 * matching `Tabby_StageRiser_MagicTrick_CANON.jpg`, and layers CHIMERA Expression physics.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Expression } from "../ui/render/expression.ts";
import type { MopFmvClipSpec, MopFmvManifest } from "../../tools/prepare-mop-fmv.ts";
import type { CameraPreset, MopAction } from "./midiSong.ts";
import type { MopFrameState } from "./player.ts";

export interface StageDebugInfo {
  activeAction: MopAction;
  videoCurrentTime: number;
  videoDuration: number;
  frameIndex: number;
  totalFrames: number;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  usingVideoTexture: boolean;
}

export interface MoppetStageProps {
  getFrame: () => MopFrameState;
  cameraOverride: CameraPreset | "auto";
  actionOverride: MopAction | null;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onCaptionFrame?: (text: string) => void;
  onStageDebug?: (dbg: StageDebugInfo) => void;
}

const LOGICAL_W = 1280;
const LOGICAL_H = 720;

const CAMERA_TARGETS: Record<CameraPreset, { pos: [number, number, number]; look: [number, number, number] }> = {
  wide: { pos: [0, 1.52, 5.25], look: [0, 1.28, 0] },
  closeup: { pos: [0, 1.72, 2.7], look: [0, 1.56, 0] },
  reaction: { pos: [0.42, 1.62, 3.25], look: [0, 1.44, 0] },
  "low-angle": { pos: [-0.22, 0.88, 3.55], look: [0, 1.46, 0] },
};

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uIsRgbaFallback;
  uniform float uFlipX;
  uniform vec3 uKeyPos;
  uniform vec3 uKeyColor;
  uniform float uKeyIntensity;
  uniform vec3 uRimPos;
  uniform vec3 uRimColor;
  uniform float uRimIntensity;
  uniform vec3 uAmbientColor;
  uniform float uEyeGlow;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec2 suv = vec2(uFlipX < 0.0 ? 1.0 - vUv.x : vUv.x, vUv.y);
    vec4 raw = texture2D(uTex, suv);

    float alpha = raw.a;
    if (uIsRgbaFallback < 0.5) {
      // Discriminate green screen against cyan pixel eyes (high G AND high B)
      float maxRB = max(raw.r, raw.b * 1.08);
      float greenExcess = raw.g - maxRB;
      alpha = 1.0 - smoothstep(0.13, 0.30, greenExcess);
      if (alpha < 0.04) discard;

      // Soft edge feather + cyan-safe despill
      float isCyan = smoothstep(0.30, 0.56, raw.b) * (1.0 - smoothstep(0.28, 0.54, raw.r));
      float despillCeiling = mix(max(raw.r, raw.b) * 1.04, raw.g, isCyan);
      raw.g = min(raw.g, mix(raw.g, despillCeiling, 0.90));
    } else {
      if (alpha < 0.04) discard;
    }

    // Identify glowing cyan pixel eyes (#2FD4A6) so stage darkness never crushes them
    float cyanMask =
      smoothstep(0.40, 0.78, raw.g) *
      smoothstep(0.35, 0.70, raw.b) *
      (1.0 - smoothstep(0.24, 0.52, raw.r));

    // Convert sRGB texel to linear space for physically consistent lighting
    vec3 albedo = pow(max(raw.rgb, vec3(0.0)), vec3(2.2));

    // Rounded 2.5D plush relief normal across puppet plane
    vec3 bend = vec3((vUv.x - 0.5) * 0.65, (vUv.y - 0.5) * 0.32, 0.0);
    vec3 N = normalize(vWorldNormal + bend);

    vec3 Lkey = normalize(uKeyPos - vWorldPos);
    float ndlKey = max(0.0, dot(N, Lkey)) * 0.78 + 0.22;

    vec3 Lrim = normalize(uRimPos - vWorldPos);
    float edgeMask = smoothstep(0.15, 0.48, abs(vUv.x - 0.5) * 1.8);
    float ndlRim = max(0.0, dot(N, Lrim)) * (0.45 + 0.55 * edgeMask);

    vec3 floorBounce = vec3(0.16, 0.11, 0.08) * (1.0 - smoothstep(0.0, 0.65, vUv.y));
    vec3 lightSum = uAmbientColor + uKeyColor * (ndlKey * uKeyIntensity) + uRimColor * (ndlRim * uRimIntensity) + floorBounce;

    // Gentle highlight compression + cyan eye self-emissive vocal pulse
    vec3 lit = albedo * lightSum + albedo * cyanMask * (0.24 + uEyeGlow * 0.35);
    lit = lit / (vec3(1.0) + lit * 0.14);

    vec3 srgbOut = pow(max(lit, vec3(0.0)), vec3(1.0 / 2.2));
    gl_FragColor = vec4(srgbOut, alpha);
  }
`;

export function MoppetStage3D({
  getFrame,
  cameraOverride,
  actionOverride,
  onCanvasReady,
  onCaptionFrame,
  onStageDebug,
}: MoppetStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const getFrameRef = useRef(getFrame);
  getFrameRef.current = getFrame;
  const camOverrideRef = useRef(cameraOverride);
  camOverrideRef.current = cameraOverride;
  const actOverrideRef = useRef(actionOverride);
  actOverrideRef.current = actionOverride;
  const onCanvasReadyRef = useRef(onCanvasReady);
  onCanvasReadyRef.current = onCanvasReady;
  const captionCbRef = useRef(onCaptionFrame);
  captionCbRef.current = onCaptionFrame;
  const stageDebugRef = useRef(onStageDebug);
  stageDebugRef.current = onStageDebug;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(LOGICAL_W, LOGICAL_H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "moppet-stage-canvas";
    renderer.domElement.setAttribute("data-testid", "moppet-stage-canvas");
    host.replaceChildren(renderer.domElement);
    onCanvasReadyRef.current?.(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#110f12");
    scene.fog = new THREE.Fog("#110f12", 6.5, 13.5);

    const camera = new THREE.PerspectiveCamera(38, LOGICAL_W / LOGICAL_H, 0.1, 40);
    camera.position.set(...CAMERA_TARGETS.wide.pos);
    camera.lookAt(...CAMERA_TARGETS.wide.look);

    // Stage lighting (2700K tungsten key + amber/teal fill + back rim)
    const hemi = new THREE.HemisphereLight("#ffe4be", "#1c1824", 1.1);
    scene.add(hemi);

    const keyLight = new THREE.SpotLight("#ffd296", 44, 18, Math.PI / 4, 0.45, 1.35);
    keyLight.position.set(-2.5, 5.1, 3.8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const rimLight = new THREE.SpotLight("#ffbc78", 24, 15, Math.PI / 4, 0.5, 1.4);
    rimLight.position.set(2.7, 4.4, 2.3);
    scene.add(rimLight);

    // Stage rug/timber floor receiving shadows
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 10),
      new THREE.MeshStandardMaterial({ color: "#1d1514", roughness: 0.88, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Studio 404 empty stage backdrop plate
    const loader = new THREE.TextureLoader();
    const bgTex = loader.load("/moppets/tabby/studio-404-stage.webp");
    bgTex.colorSpace = THREE.SRGBColorSpace;
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(11.4, 6.4),
      new THREE.MeshBasicMaterial({ map: bgTex, color: "#dfd3c8" }),
    );
    backdrop.position.set(0, 2.75, -3.25);
    scene.add(backdrop);

    // Subtle atmospheric spotlight cones (warm tungsten Fresnel behind performer)
    const beamMatL = new THREE.MeshBasicMaterial({
      color: "#ffd194",
      transparent: true,
      opacity: 0.042,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beamL = new THREE.Mesh(new THREE.ConeGeometry(1.85, 5.8, 24, 1, true), beamMatL);
    beamL.position.set(-1.35, 2.55, -0.75);
    beamL.rotation.z = -0.34;
    scene.add(beamL);

    const beamMatR = beamMatL.clone();
    beamMatR.color.set("#ffbf78");
    beamMatR.opacity = 0.03;
    const beamR = new THREE.Mesh(new THREE.ConeGeometry(1.75, 5.6, 24, 1, true), beamMatR);
    beamR.position.set(1.45, 2.55, -0.75);
    beamR.rotation.z = 0.34;
    scene.add(beamR);

    // 70 drifting golden dust motes in spotlight beams
    const moteCount = 70;
    const motePos = new Float32Array(moteCount * 3);
    const moteSeed = new Float32Array(moteCount);
    for (let i = 0; i < moteCount; i++) {
      motePos[i * 3] = (Math.random() - 0.5) * 4.4;
      motePos[i * 3 + 1] = 0.3 + Math.random() * 2.8;
      motePos[i * 3 + 2] = -0.6 + Math.random() * 1.4;
      moteSeed[i] = Math.random() * Math.PI * 2;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.PointsMaterial({
      color: "#ffe1ad",
      size: 0.028,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

    // Vintage Weathered Steamer-Trunk Stage Riser (matches Tabby_StageRiser_MagicTrick_CANON.jpg)
    const riserGroup = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: "#4d2f1c", roughness: 0.82, metalness: 0.06 });
    const trimWoodMat = new THREE.MeshStandardMaterial({ color: "#361f12", roughness: 0.74, metalness: 0.08 });
    const brassMat = new THREE.MeshStandardMaterial({ color: "#c4944e", roughness: 0.36, metalness: 0.82 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: "#2b1a10", roughness: 0.68, metalness: 0.05 });

    const trunkBody = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.30, 0.88), woodMat);
    trunkBody.position.y = 0.15;
    trunkBody.castShadow = true;
    trunkBody.receiveShadow = true;
    riserGroup.add(trunkBody);

    const trunkLid = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.05, 0.94), trimWoodMat);
    trunkLid.position.y = 0.315;
    trunkLid.castShadow = true;
    trunkLid.receiveShadow = true;
    riserGroup.add(trunkLid);

    // Leather belt straps + aged brass corner brackets + clasp
    for (const sx of [-0.46, 0.46]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.345, 0.90), leatherMat);
      strap.position.set(sx, 0.172, 0.0);
      riserGroup.add(strap);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.065, 0.02), brassMat);
      buckle.position.set(sx, 0.24, 0.455);
      riserGroup.add(buckle);
    }
    const centerClasp = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.10, 0.025), brassMat);
    centerClasp.position.set(0, 0.275, 0.462);
    riserGroup.add(centerClasp);
    for (const cx of [-0.73, 0.73]) {
      for (const cy of [0.03, 0.315]) {
        const corner = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.95), brassMat);
        corner.position.set(cx, cy, 0);
        riserGroup.add(corner);
      }
    }
    scene.add(riserGroup);

    // Vintage Brass Frontline Stand Mic & XLR Cable (NON-CONTACT beside Tabby per character_constraints.json)
    const micGroup = new THREE.Group();
    micGroup.position.set(0.84, 0, 0.24);
    const ironBaseMat = new THREE.MeshStandardMaterial({ color: "#2b241d", metalness: 0.72, roughness: 0.42 });
    const micBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.038, 24), ironBaseMat);
    micBase.position.y = 0.019;
    micBase.castShadow = true;
    const micPole = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 1.50, 16), brassMat);
    micPole.position.y = 0.75;
    micPole.castShadow = true;
    const micClutch = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 16), ironBaseMat);
    micClutch.position.y = 1.02;
    const micBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.36, 12), brassMat);
    micBoom.position.set(-0.12, 1.52, -0.04);
    micBoom.rotation.z = 1.18;
    const micHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 16, 16),
      new THREE.MeshStandardMaterial({ color: "#c8cbd0", metalness: 0.88, roughness: 0.28 }),
    );
    micHead.position.set(-0.28, 1.59, -0.07);
    micGroup.add(micBase, micPole, micClutch, micBoom, micHead);

    // Coiled black XLR cable trailing across the stage rug
    const cableCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.28, 1.55, -0.07),
      new THREE.Vector3(-0.04, 1.10, -0.02),
      new THREE.Vector3(0.04, 0.35, 0.02),
      new THREE.Vector3(0.18, 0.02, 0.14),
      new THREE.Vector3(0.68, 0.016, 0.32),
      new THREE.Vector3(1.65, 0.016, 0.12),
    ]);
    const cableMesh = new THREE.Mesh(
      new THREE.TubeGeometry(cableCurve, 32, 0.009, 8, false),
      new THREE.MeshStandardMaterial({ color: "#151418", roughness: 0.85, metalness: 0.1 }),
    );
    micGroup.add(cableMesh);
    scene.add(micGroup);

    // Grounded paw contact shadow atop trunk lid (no neon ring)
    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 32),
      new THREE.MeshBasicMaterial({ color: "#080504", transparent: true, opacity: 0.54, depthWrite: false }),
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.scale.set(1, 0.42, 1);
    contactShadow.position.set(0, 0.343, 0.02);
    scene.add(contactShadow);

    // Tabby 2.5D Lit FMV Plane
    // Manifest normalizes standing height = 516/720 (0.7167) inside 576x720 with foot baseline anchorY = 0.9306.
    // Target standing height on riser = 1.62 world units -> total plane height = 2.26w * (576/720) = 1.808 x 2.26.
    const STAND_WORLD_H = 1.62;
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    const fallbackTex = loader.load("/moppets/tabby/canon-front.webp");
    fallbackTex.colorSpace = THREE.NoColorSpace;

    const puppetMat = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTex: { value: fallbackTex },
        uIsRgbaFallback: { value: 1.0 },
        uFlipX: { value: 1.0 },
        uKeyPos: { value: keyLight.position.clone() },
        uKeyColor: { value: new THREE.Color("#ffd9a8") },
        uKeyIntensity: { value: 1.02 },
        uRimPos: { value: rimLight.position.clone() },
        uRimColor: { value: new THREE.Color("#ffc682") },
        uRimIntensity: { value: 0.42 },
        uAmbientColor: { value: new THREE.Color("#2b2321") },
        uEyeGlow: { value: 1.0 },
      },
    });
    const puppetMesh = new THREE.Mesh(planeGeo, puppetMat);
    puppetMesh.position.set(0, 0.34, 0.04);
    scene.add(puppetMesh);

    const setPlaneFootMetrics = (aspect: number, bodyHeightNorm: number, anchorY: number) => {
      const h = STAND_WORLD_H / Math.max(0.3, bodyHeightNorm);
      const w = h * aspect;
      puppetMesh.scale.set(w, h, 1);
      // Center of plane shifted so normalized top-down anchorY touches y=0 in parent space (0.34 on trunk lid)
      return h * (anchorY - 0.5);
    };
    let footOffsetY = setPlaneFootMetrics(478 / 960, 0.96, 0.985);

    // Load Canon v2 FMV manifest & preload hidden HTMLVideoElement + THREE.VideoTexture pool
    const videos = new Map<string, { video: HTMLVideoElement; tex: THREE.VideoTexture; spec: MopFmvClipSpec }>();
    let disposed = false;

    void fetch("/moppets/tabby/manifest.json")
      .then((r) => r.json() as Promise<MopFmvManifest>)
      .then((mf) => {
        if (disposed) return;
        for (const [action, spec] of Object.entries(mf.actions)) {
          const video = document.createElement("video");
          video.src = spec.videoUrl;
          video.muted = true;
          video.playsInline = true;
          video.loop = spec.loop;
          video.preload = "auto";
          video.crossOrigin = "anonymous";
          video.load();
          if (action === "idle") {
            void video.play().catch(() => {});
          }
          const tex = new THREE.VideoTexture(video);
          tex.colorSpace = THREE.NoColorSpace;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          videos.set(action, { video, tex, spec });
        }
      })
      .catch((err) => console.error("Failed to load Tabby FMV manifest:", err));

    const expr = new Expression();
    const camPos = new THREE.Vector3(...CAMERA_TARGETS.wide.pos);
    const camLook = new THREE.Vector3(...CAMERA_TARGETS.wide.look);
    let actorX = 0;
    let facing = 1;
    let activeAction: MopAction = "idle";
    let lastNow = performance.now() / 1000;
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now() / 1000;
      const dt = Math.min(0.05, Math.max(0.001, now - lastNow));
      lastNow = now;

      const frame = getFrameRef.current();
      expr.update(frame.tele, dt);
      captionCbRef.current?.(frame.phraseText);

      const desiredAction: MopAction = actOverrideRef.current ?? frame.cueAction;
      if (desiredAction !== activeAction) {
        const prevEntry = videos.get(activeAction);
        if (prevEntry && prevEntry.video !== videos.get(desiredAction)?.video) {
          prevEntry.video.pause();
        }
        activeAction = desiredAction;
        const nextEntry = videos.get(activeAction) ?? videos.get("idle");
        if (nextEntry) {
          if (!nextEntry.spec.loop || nextEntry.video.ended) {
            try {
              nextEntry.video.currentTime = 0;
            } catch {
              // ignore seek before metadata
            }
          }
          void nextEntry.video.play().catch(() => {});
        }
      }

      // Keep active video advancing cleanly
      const entry = videos.get(activeAction) ?? videos.get("idle");
      const usingVideo = Boolean(entry && entry.video.readyState >= 2 && entry.video.videoWidth > 0);
      if (entry && usingVideo) {
        if (entry.spec.loop && entry.video.paused) {
          void entry.video.play().catch(() => {});
        }
        if (puppetMat.uniforms.uTex.value !== entry.tex) {
          puppetMat.uniforms.uTex.value = entry.tex;
          puppetMat.uniforms.uIsRgbaFallback.value = 0.0;
          footOffsetY = setPlaneFootMetrics(entry.spec.aspect, entry.spec.bodyHeightNorm, entry.spec.anchorY);
        }
        entry.tex.needsUpdate = true;
      } else {
        if (puppetMat.uniforms.uTex.value !== fallbackTex) {
          puppetMat.uniforms.uTex.value = fallbackTex;
          puppetMat.uniforms.uIsRgbaFallback.value = 1.0;
          footOffsetY = setPlaneFootMetrics(478 / 960, 0.96, 0.985);
        }
      }

      // Lateral walk blocking & flipX
      let targetX = 0;
      if (desiredAction === "walk" || frame.moveTarget) {
        if (frame.moveTarget === "left") targetX = -0.34;
        else if (frame.moveTarget === "right") targetX = 0.34;
        else if (desiredAction === "walk") targetX = Math.sin(now * 1.35) * 0.28;
      }
      const dx = targetX - actorX;
      if (Math.abs(dx) > 0.015 && desiredAction === "walk") {
        facing = dx >= 0 ? 1 : -1;
      } else if (desiredAction !== "walk") {
        facing = 1;
      }
      actorX += dx * Math.min(1, dt * 4.2);

      // Jump arc
      const jumpY =
        frame.jumpProgress > 0 && frame.jumpProgress < 1
          ? Math.sin(frame.jumpProgress * Math.PI) * 0.30
          : 0;

      // Subtle CHIMERA Expression physics (micro nod + tilt + chest breath, FMV drives the limbs & eyes)
      const puffStretch = 1 + Math.max(-0.025, Math.min(0.035, expr.puff * 0.02));
      const nodAngle = Math.max(-0.045, Math.min(0.045, expr.nod * 0.25));
      const tiltAngle = Math.max(-0.055, Math.min(0.055, expr.tilt * 0.3));

      puppetMesh.position.set(actorX, 0.34 + footOffsetY + jumpY, 0.04);
      puppetMesh.rotation.set(nodAngle, 0, -tiltAngle);
      const spec = entry?.spec;
      if (spec && usingVideo) {
        const h = STAND_WORLD_H / Math.max(0.3, spec.bodyHeightNorm);
        const w = h * spec.aspect;
        puppetMesh.scale.set(w * puffStretch, h / Math.sqrt(puffStretch), 1);
      }

      puppetMat.uniforms.uFlipX.value = facing;
      puppetMat.uniforms.uKeyIntensity.value = 0.98 + Math.min(0.28, frame.rms * 1.15);
      puppetMat.uniforms.uEyeGlow.value = 0.8 + Math.min(1.6, frame.rms * 6.0) + (frame.artic?.lipAp ?? 0) * 0.18;

      contactShadow.position.x = actorX;
      const shadowScale = Math.max(0.55, 1 - jumpY * 1.3);
      contactShadow.scale.set(shadowScale, 0.42 * shadowScale, 1);

      beamMatL.opacity = 0.038 + Math.min(0.045, frame.rms * 0.32);
      beamMatR.opacity = 0.026 + Math.min(0.038, frame.rms * 0.28);

      // Drift golden dust motes lazily
      const posArr = moteGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < moteCount; i++) {
        posArr[i * 3 + 1] += dt * 0.045;
        posArr[i * 3] += Math.sin(now * 0.7 + moteSeed[i]) * dt * 0.015;
        if (posArr[i * 3 + 1] > 3.15) posArr[i * 3 + 1] = 0.35;
      }
      moteGeo.attributes.position.needsUpdate = true;

      // Damped camera director
      const preset: CameraPreset =
        camOverrideRef.current === "auto" ? frame.camPreset : camOverrideRef.current;
      const targetCam = CAMERA_TARGETS[preset] ?? CAMERA_TARGETS.wide;
      const camEase = Math.min(1, dt * 3.5);
      camPos.lerp(new THREE.Vector3(...targetCam.pos), camEase);
      camLook.lerp(new THREE.Vector3(...targetCam.look), camEase);
      camera.position.copy(camPos);
      camera.lookAt(camLook);

      if (stageDebugRef.current) {
        const curTime = entry?.video.currentTime ?? 0;
        const fps = entry?.spec.fps ?? 24;
        const totF = entry?.spec.frames ?? 0;
        stageDebugRef.current({
          activeAction,
          videoCurrentTime: curTime,
          videoDuration: entry?.video.duration ?? 0,
          frameIndex: totF ? Math.min(totF - 1, Math.floor(curTime * fps)) : 0,
          totalFrames: totF,
          readyState: entry?.video.readyState ?? 0,
          videoWidth: entry?.video.videoWidth ?? 0,
          videoHeight: entry?.video.videoHeight ?? 0,
          usingVideoTexture: usingVideo,
        });
      }

      renderer.render(scene, camera);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      onCanvasReadyRef.current?.(null);
      for (const item of videos.values()) {
        item.video.pause();
        item.video.removeAttribute("src");
        item.video.load();
        item.tex.dispose();
      }
      fallbackTex.dispose();
      bgTex.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      planeGeo.dispose();
      puppetMat.dispose();
      renderer.dispose();
    };
  }, []);

  return <div ref={hostRef} className="moppet-stage-host" />;
}
