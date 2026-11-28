/**
 * 60 fps Lit Three.js 2.5D Studio 404 Stage for Canon v2 Tabby (Mop #1).
 *
 * Follows Studio 404 World Bible v3 (`LOCATION_BIBLE.md` Law #4 Zero Persian Rug Lock & Law #5
 * wooden riser), `Tabby/character_constraints.json` (non-contact frontline mic beside riser), and
 * `threejs-aaa-graphics-builder` (zero placeholder primitives/cones, authored multiplane stage,
 * responsive DPR, cyan-eye-safe GLSL `#00FF00` + shadow chroma key, 2.5D normal lighting).
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Expression } from "../ui/render/expression.ts";
import type { MopFmvClipSpec, MopFmvManifest } from "../../tools/prepare-mop-fmv.ts";
import type { CameraPreset, MopAction } from "./midiSong.ts";
import type { MopFrameState } from "./player.ts";

export interface MoppetStageProps {
  getFrame: () => MopFrameState;
  cameraOverride: CameraPreset | "auto";
  actionOverride: MopAction | null;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onCaptionFrame?: (text: string) => void;
}

// Pixel-measured 3D multiplane coordinates on `Loc03_RiserShelves_Var1_CenterRiser_REC` (`1600x900` -> `9.0 x 5.0625` at z=-2.0):
// Wooden riser top deck spans x=780..1085 (center 930/1600 = 0.581 -> world x = +0.50 at z=0.04) and y=682/900 -> world y = 0.52.
// Bare concrete floor beside riser right edge (x=1155/1600, y=745/900) -> world x = +1.18, y = 0.30 at z=0.14.
const BG_Z = -2.0;
const BG_CENTER_Y = 1.42;
const BG_W = 9.0;
const BG_H = 5.0625;
const RISER_CENTER_X = 0.50;
const RISER_DECK_Y = 0.52;
const STAGE_FLOOR_Y = 0.30;
const MIC_X = 1.18;
const STAND_WORLD_H = 1.44;

const CAMERA_TARGETS: Record<CameraPreset, { pos: [number, number, number]; look: [number, number, number] }> = {
  wide: { pos: [0, 1.42, 4.6], look: [0, 1.42, 0] },
  closeup: { pos: [RISER_CENTER_X * 0.72, 1.56, 2.88], look: [RISER_CENTER_X * 0.88, 1.46, 0] },
  reaction: { pos: [RISER_CENTER_X + 0.28, 1.48, 3.35], look: [RISER_CENTER_X * 0.9, 1.40, 0] },
  "low-angle": { pos: [RISER_CENTER_X - 0.24, 1.04, 3.55], look: [RISER_CENTER_X * 0.9, 1.48, 0] },
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
  uniform float uIsRgba;
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
    if (uIsRgba < 0.5) {
      // Key out both #00FF00 background and darker olive-green floor shadow while keeping cyan LED eyes (#2FD4A6) solid
      float maxRB = max(raw.r, raw.b * 1.28);
      float greenExcess = raw.g - maxRB;
      alpha = 1.0 - smoothstep(0.065, 0.165, greenExcess);
      if (alpha < 0.04) discard;

      // Cyan-safe green edge despill
      float isCyan = smoothstep(0.30, 0.56, raw.b) * (1.0 - smoothstep(0.28, 0.54, raw.r));
      float despillCeiling = mix(max(raw.r, raw.b) * 1.03, raw.g, isCyan);
      raw.g = min(raw.g, mix(raw.g, despillCeiling, 0.92));
    } else {
      if (alpha < 0.03) discard;
    }

    // Identify glowing cyan pixel eyes (#2FD4A6) so stage contrast never crushes them
    float cyanMask =
      smoothstep(0.40, 0.78, raw.g) *
      smoothstep(0.35, 0.70, raw.b) *
      (1.0 - smoothstep(0.24, 0.52, raw.r));

    vec3 albedo = pow(max(raw.rgb, vec3(0.0)), vec3(2.2));

    // Rounded 2.5D relief normal across character / prop plane
    vec3 bend = vec3((vUv.x - 0.5) * 0.62, (vUv.y - 0.5) * 0.30, 0.0);
    vec3 N = normalize(vWorldNormal + bend);

    vec3 Lkey = normalize(uKeyPos - vWorldPos);
    float ndlKey = max(0.0, dot(N, Lkey)) * 0.76 + 0.24;

    vec3 Lrim = normalize(uRimPos - vWorldPos);
    float edgeMask = smoothstep(0.14, 0.48, abs(vUv.x - 0.5) * 1.85);
    float ndlRim = max(0.0, dot(N, Lrim)) * (0.42 + 0.58 * edgeMask);

    // Warm timber bounce from the wooden riser deck below
    vec3 riserBounce = vec3(0.14, 0.09, 0.05) * (1.0 - smoothstep(0.0, 0.55, vUv.y));
    vec3 lightSum = uAmbientColor + uKeyColor * (ndlKey * uKeyIntensity) + uRimColor * (ndlRim * uRimIntensity) + riserBounce;

    vec3 lit = albedo * lightSum + albedo * cyanMask * (0.28 + uEyeGlow * 0.36);
    lit = lit / (vec3(1.0) + lit * 0.14);

    vec3 srgbOut = pow(max(lit, vec3(0.0)), vec3(1.0 / 2.2));
    gl_FragColor = vec4(srgbOut, alpha);
  }
`;

function makeRadialTexture(innerRgba: string, midRgba: string, outerRgba = "rgba(0,0,0,0)"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, innerRgba);
  g.addColorStop(0.5, midRgba);
  g.addColorStop(1, outerRgba);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export function MoppetStage3D({
  getFrame,
  cameraOverride,
  actionOverride,
  onCanvasReady,
  onCaptionFrame,
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.domElement.className = "moppet-stage-canvas";
    host.replaceChildren(renderer.domElement);
    onCanvasReadyRef.current?.(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d0c10");

    const camera = new THREE.PerspectiveCamera(37, 16 / 9, 0.1, 30);
    camera.position.set(...CAMERA_TARGETS.wide.pos);
    camera.lookAt(...CAMERA_TARGETS.wide.look);

    const updateSize = () => {
      const rect = host.getBoundingClientRect();
      const w = Math.max(320, Math.round(rect.width || 1280));
      const h = Math.max(180, Math.round(rect.height || 720));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(host);

    const keyPos = new THREE.Vector3(-1.8, 4.4, 2.8);
    const rimPos = new THREE.Vector3(2.1, 4.1, 2.0);

    // Verified Studio 404 Location Bible v3 bare-floor riser set plate (`Loc03_RiserShelves_Var1_CenterRiser_REC`)
    const loader = new THREE.TextureLoader();
    const bgTex = loader.load("/moppets/tabby/studio-404-stage.webp");
    bgTex.colorSpace = THREE.SRGBColorSpace;
    bgTex.minFilter = THREE.LinearFilter;
    const bgGeo = new THREE.PlaneGeometry(BG_W, BG_H);
    const bgMat = new THREE.MeshBasicMaterial({ map: bgTex, toneMapped: false });
    const backdrop = new THREE.Mesh(bgGeo, bgMat);
    backdrop.position.set(0, BG_CENTER_Y, BG_Z);
    scene.add(backdrop);

    // Soft radial warm tungsten Fresnel bloom (zero geometric cone seams)
    const glowTex = makeRadialTexture("rgba(255, 206, 132, 0.28)", "rgba(255, 178, 92, 0.08)");
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const spotGlow = new THREE.Sprite(glowMat);
    spotGlow.position.set(RISER_CENTER_X, 1.56, -0.55);
    spotGlow.scale.set(4.2, 3.4, 1);
    scene.add(spotGlow);

    // Soft Gaussian contact shadows on wooden riser & bare concrete floor
    const shadowTex = makeRadialTexture("rgba(6, 4, 5, 0.72)", "rgba(8, 5, 6, 0.28)");
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    const pawShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    });
    const contactShadow = new THREE.Mesh(shadowGeo, pawShadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.scale.set(0.84, 0.32, 1);
    contactShadow.position.set(RISER_CENTER_X, RISER_DECK_Y + 0.004, 0.04);
    scene.add(contactShadow);

    const micShadowMat = pawShadowMat.clone();
    micShadowMat.opacity = 0.78;
    const micShadow = new THREE.Mesh(shadowGeo, micShadowMat);
    micShadow.rotation.x = -Math.PI / 2;
    micShadow.scale.set(0.52, 0.22, 1);
    micShadow.position.set(MIC_X, STAGE_FLOOR_Y + 0.004, 0.14);
    scene.add(micShadow);

    // Confirmed Studio 404 RGBA frontline dynamic stand mic (`NON-CONTACT` beside wooden riser per character_constraints.json)
    const unitPlane = new THREE.PlaneGeometry(1, 1);
    const micTex = loader.load("/moppets/tabby/mic-stand.webp");
    micTex.colorSpace = THREE.NoColorSpace;
    const micMat = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
      toneMapped: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTex: { value: micTex },
        uIsRgba: { value: 1.0 },
        uFlipX: { value: 1.0 },
        uKeyPos: { value: keyPos.clone() },
        uKeyColor: { value: new THREE.Color("#ffd9a8") },
        uKeyIntensity: { value: 0.96 },
        uRimPos: { value: rimPos.clone() },
        uRimColor: { value: new THREE.Color("#ffc37c") },
        uRimIntensity: { value: 0.44 },
        uAmbientColor: { value: new THREE.Color("#292324") },
        uEyeGlow: { value: 0.0 },
      },
    });
    const micH = 1.46;
    const micW = micH * (226 / 900);
    const micMesh = new THREE.Mesh(unitPlane, micMat);
    micMesh.scale.set(micW, micH, 1);
    micMesh.position.set(MIC_X, STAGE_FLOOR_Y + micH * 0.485, 0.14);
    scene.add(micMesh);

    // Tabby 2.5D Lit Canon v2 FMV Plane atop the Studio 404 wooden riser
    const fallbackTex = loader.load("/moppets/tabby/canon-front.webp");
    fallbackTex.colorSpace = THREE.NoColorSpace;

    const puppetMat = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
      toneMapped: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTex: { value: fallbackTex },
        uIsRgba: { value: 1.0 },
        uFlipX: { value: 1.0 },
        uKeyPos: { value: keyPos.clone() },
        uKeyColor: { value: new THREE.Color("#ffdba8") },
        uKeyIntensity: { value: 1.02 },
        uRimPos: { value: rimPos.clone() },
        uRimColor: { value: new THREE.Color("#ffc682") },
        uRimIntensity: { value: 0.44 },
        uAmbientColor: { value: new THREE.Color("#2c2524") },
        uEyeGlow: { value: 1.0 },
      },
    });
    const puppetMesh = new THREE.Mesh(unitPlane, puppetMat);
    puppetMesh.position.set(RISER_CENTER_X, RISER_DECK_Y, 0.04);
    scene.add(puppetMesh);

    // 60 warm golden dust motes drifting softly in the overhead Fresnel light
    const moteCount = 60;
    const motePos = new Float32Array(moteCount * 3);
    const moteSeed = new Float32Array(moteCount);
    for (let i = 0; i < moteCount; i++) {
      motePos[i * 3] = (Math.random() - 0.5) * 4.2;
      motePos[i * 3 + 1] = 0.55 + Math.random() * 2.5;
      motePos[i * 3 + 2] = -0.8 + Math.random() * 1.3;
      moteSeed[i] = Math.random() * Math.PI * 2;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    const moteTex = makeRadialTexture("rgba(255, 232, 180, 0.95)", "rgba(255, 206, 130, 0.35)");
    const moteMat = new THREE.PointsMaterial({
      map: moteTex,
      size: 0.045,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

    const setPlaneFootMetrics = (aspect: number, bodyHeightNorm: number, anchorY: number) => {
      const h = STAND_WORLD_H / Math.max(0.3, bodyHeightNorm);
      const w = h * aspect;
      puppetMesh.scale.set(w, h, 1);
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
    let actorX = RISER_CENTER_X;
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

      const entry = videos.get(activeAction) ?? videos.get("idle");
      const usingVideo = Boolean(entry && entry.video.readyState >= 2 && entry.video.videoWidth > 0);
      if (entry && usingVideo) {
        if (entry.spec.loop && entry.video.paused) {
          void entry.video.play().catch(() => {});
        }
        if (activeAction === "sing" || activeAction === "belt") {
          const targetRate = Math.min(1.25, Math.max(0.85, 0.92 + frame.rms * 0.95));
          if (Math.abs(entry.video.playbackRate - targetRate) > 0.04) {
            entry.video.playbackRate = targetRate;
          }
        } else if (entry.video.playbackRate !== 1) {
          entry.video.playbackRate = 1;
        }
        if (puppetMat.uniforms.uTex.value !== entry.tex) {
          puppetMat.uniforms.uTex.value = entry.tex;
          puppetMat.uniforms.uIsRgba.value = 0.0;
          footOffsetY = setPlaneFootMetrics(entry.spec.aspect, entry.spec.bodyHeightNorm, entry.spec.anchorY);
        }
        entry.tex.needsUpdate = true;
      } else if (puppetMat.uniforms.uTex.value !== fallbackTex) {
        puppetMat.uniforms.uTex.value = fallbackTex;
        puppetMat.uniforms.uIsRgba.value = 1.0;
        footOffsetY = setPlaneFootMetrics(478 / 960, 0.96, 0.985);
      }

      // Bounded lateral blocking atop the Studio 404 wooden riser (RISER_CENTER_X ± 0.16 so both paws stay planted on the wood)
      let targetX = RISER_CENTER_X;
      if (desiredAction === "walk" || frame.moveTarget) {
        if (frame.moveTarget === "left") targetX = RISER_CENTER_X - 0.16;
        else if (frame.moveTarget === "right") targetX = RISER_CENTER_X + 0.16;
        else if (desiredAction === "walk" && !frame.moveTarget) targetX = RISER_CENTER_X + Math.sin(now * 1.35) * 0.18;
      }
      const dx = targetX - actorX;
      if (Math.abs(dx) > 0.015 && desiredAction === "walk") {
        facing = dx >= 0 ? 1 : -1;
      } else if (desiredAction !== "walk") {
        facing = 1;
      }
      actorX += dx * Math.min(1, dt * 3.8);

      // Jump arc + gentle beat groove while singing on the riser
      const jumpY =
        frame.jumpProgress > 0 && frame.jumpProgress < 1
          ? Math.sin(frame.jumpProgress * Math.PI) * 0.26
          : 0;
      const grooveBounce =
        frame.playing && frame.singingNow ? Math.abs(Math.sin(frame.beat * Math.PI)) * 0.018 : 0;

      // Subtle CHIMERA Expression physics (micro nod + tilt + chest breath)
      const puffStretch = 1 + Math.max(-0.02, Math.min(0.03, expr.puff * 0.018));
      const nodAngle = Math.max(-0.04, Math.min(0.04, expr.nod * 0.22));
      const tiltAngle = Math.max(-0.05, Math.min(0.05, expr.tilt * 0.26));

      puppetMesh.position.set(actorX, RISER_DECK_Y + footOffsetY + jumpY + grooveBounce, 0.04);
      puppetMesh.rotation.set(nodAngle, 0, -tiltAngle);
      const spec = entry?.spec;
      if (spec && usingVideo) {
        const h = STAND_WORLD_H / Math.max(0.3, spec.bodyHeightNorm);
        const w = h * spec.aspect;
        puppetMesh.scale.set(w * puffStretch, h / Math.sqrt(puffStretch), 1);
      }

      puppetMat.uniforms.uFlipX.value = facing;
      puppetMat.uniforms.uKeyIntensity.value = 0.98 + Math.min(0.28, frame.rms * 1.15);
      puppetMat.uniforms.uEyeGlow.value =
        0.85 + Math.min(1.5, frame.rms * 5.5) + (frame.artic?.lipAp ?? 0) * 0.16;

      contactShadow.position.x = actorX;
      const shadowScale = Math.max(0.5, 1 - (jumpY + grooveBounce) * 1.35);
      contactShadow.scale.set(0.86 * shadowScale, 0.34 * shadowScale, 1);
      pawShadowMat.opacity = 0.85 * shadowScale;

      glowMat.opacity = 0.36 + Math.min(0.24, frame.rms * 1.05);
      spotGlow.position.x = actorX;

      // Drift golden dust motes lazily
      const posArr = moteGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < moteCount; i++) {
        posArr[i * 3 + 1] += dt * 0.038;
        posArr[i * 3] += Math.sin(now * 0.65 + moteSeed[i]) * dt * 0.012;
        if (posArr[i * 3 + 1] > 3.1) posArr[i * 3 + 1] = 0.55;
      }
      moteGeo.attributes.position.needsUpdate = true;

      // Damped multiplane camera director
      const preset: CameraPreset =
        camOverrideRef.current === "auto" ? frame.camPreset : camOverrideRef.current;
      const targetCam = CAMERA_TARGETS[preset] ?? CAMERA_TARGETS.wide;
      const swayX = (actorX - RISER_CENTER_X) * (preset === "wide" ? 0.12 : 0.35);
      const camEase = Math.min(1, dt * 3.4);
      camPos.lerp(new THREE.Vector3(targetCam.pos[0] + swayX, targetCam.pos[1], targetCam.pos[2]), camEase);
      camLook.lerp(new THREE.Vector3(targetCam.look[0] + swayX, targetCam.look[1], targetCam.look[2]), camEase);
      camera.position.copy(camPos);
      camera.lookAt(camLook);

      renderer.render(scene, camera);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      ro.disconnect();
      cancelAnimationFrame(raf);
      onCanvasReadyRef.current?.(null);
      for (const item of videos.values()) {
        item.video.pause();
        item.video.removeAttribute("src");
        item.video.load();
        item.tex.dispose();
      }
      fallbackTex.dispose();
      micTex.dispose();
      bgTex.dispose();
      glowTex.dispose();
      shadowTex.dispose();
      moteTex.dispose();
      bgGeo.dispose();
      bgMat.dispose();
      glowMat.dispose();
      shadowGeo.dispose();
      pawShadowMat.dispose();
      micShadowMat.dispose();
      unitPlane.dispose();
      micMat.dispose();
      puppetMat.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      renderer.dispose();
    };
  }, []);

  return <div ref={hostRef} className="moppet-stage-host" />;
}
