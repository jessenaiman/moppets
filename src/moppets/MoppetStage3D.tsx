/**
 * 60 fps Three.js 2.5D Studio 404 Stage for Tabby (Mop #1).
 *
 * Samples pre-verified RGBA WebP atlases (`idle`, `sing`, `belt`, `chuckle`, `walk`, `bow`)
 * with 0.4% UV cell inset (`0 ms` seek latency), applies CHIMERA `Expression` physics
 * (`nod`, `tilt`, `puff`, real `beatStep`), smooth damped camera shots, lateral walk blocking,
 * and a live 60 fps CHIMERA Acoustic Lip & Formant Scope painted onto Tabby's riser monitor.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Expression } from "../ui/render/expression.ts";
import type { MopClipManifest, MopClipSpec } from "../../tools/pack-mop-fmv.ts";
import type { CameraPreset, MopAction } from "./midiSong.ts";
import type { MopFrameState } from "./player.ts";

export interface MoppetStageProps {
  getFrame: () => MopFrameState;
  cameraOverride: CameraPreset | "auto";
  actionOverride: MopAction | null;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onCaptionFrame?: (text: string) => void;
}

const LOGICAL_W = 1280;
const LOGICAL_H = 720;

const CAMERA_TARGETS: Record<CameraPreset, { pos: [number, number, number]; look: [number, number, number] }> = {
  wide: { pos: [0, 1.55, 5.4], look: [0, 1.32, 0] },
  closeup: { pos: [0, 1.85, 2.75], look: [0, 1.72, 0] },
  reaction: { pos: [0.45, 1.72, 3.3], look: [0, 1.55, 0] },
  "low-angle": { pos: [-0.25, 0.92, 3.65], look: [0, 1.58, 0] },
};

function drawScopeScreen(
  ctx: CanvasRenderingContext2D,
  frame: MopFrameState,
  expr: Expression,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = "#0b0e12";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(47, 191, 160, 0.28)";
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  const artic = frame.artic;
  const lipAp = Math.max(0.05, Math.min(2.4, artic?.lipAp ?? (frame.rms > 0.01 ? frame.rms * 7 : 0.08)));
  const lipW = Math.max(0.4, Math.min(2.2, artic?.lipWidth ?? 0.95));
  const f0 = frame.f0 > 40 ? `${Math.round(frame.f0)} Hz` : "REST";
  const syllable = frame.wordText || (frame.playing ? "…" : "CHIMERA");

  // Left: live physical lip aperture oval driven directly by CHIMERA HumanArtic
  const mx = 74;
  const my = h / 2;
  const rx = 18 + lipW * 12;
  const ry = 4 + lipAp * 13;

  ctx.save();
  ctx.strokeStyle = "#2fbfa0";
  ctx.lineWidth = 3;
  ctx.fillStyle = frame.rms > 0.01 ? "rgba(47, 191, 160, 0.25)" : "rgba(47, 191, 160, 0.08)";
  ctx.beginPath();
  ctx.ellipse(mx, my, rx, Math.min(34, ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Cheek puff indicator dots
  const puff = Math.max(0, expr.puff);
  if (puff > 0.05) {
    ctx.fillStyle = `rgba(230, 162, 76, ${Math.min(0.9, puff)})`;
    ctx.beginPath();
    ctx.arc(mx - rx - 10, my, 4 + puff * 4, 0, Math.PI * 2);
    ctx.arc(mx + rx + 10, my, 4 + puff * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Right: live syllable + F0 + RMS bar
  ctx.fillStyle = "#f2efe9";
  ctx.font = '700 26px "JetBrains Mono", monospace';
  ctx.textBaseline = "middle";
  ctx.fillText(syllable.toUpperCase(), 148, 36);

  ctx.fillStyle = "#2fbfa0";
  ctx.font = '600 18px "JetBrains Mono", monospace';
  ctx.fillText(`F0 ${f0}  ·  JAW ${(artic?.jaw ?? 0).toFixed(2)}`, 148, 70);

  const barW = Math.max(4, Math.min(200, frame.rms * 950));
  ctx.fillStyle = "#1d262c";
  ctx.fillRect(148, 90, 200, 10);
  ctx.fillStyle = "#e6a24c";
  ctx.fillRect(148, 90, barW, 10);
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
    renderer.setPixelRatio(1);
    renderer.setSize(LOGICAL_W, LOGICAL_H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.domElement.className = "moppet-stage-canvas";
    renderer.domElement.setAttribute("data-testid", "moppet-stage-canvas");
    host.replaceChildren(renderer.domElement);
    onCanvasReadyRef.current?.(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111014");
    scene.fog = new THREE.Fog("#111014", 6.5, 13.5);

    const camera = new THREE.PerspectiveCamera(38, LOGICAL_W / LOGICAL_H, 0.1, 40);
    camera.position.set(...CAMERA_TARGETS.wide.pos);
    camera.lookAt(...CAMERA_TARGETS.wide.look);

    // Lighting
    const hemi = new THREE.HemisphereLight("#ffe4be", "#1c1824", 1.15);
    scene.add(hemi);
    const keyLight = new THREE.SpotLight("#ffd8a6", 36, 16, Math.PI / 4, 0.45, 1.5);
    keyLight.position.set(-2.4, 5.2, 4.2);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const rimLight = new THREE.SpotLight("#2fbfa0", 22, 14, Math.PI / 4, 0.5, 1.5);
    rimLight.position.set(2.8, 4.3, 2.8);
    scene.add(rimLight);

    // Stage floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 10),
      new THREE.MeshStandardMaterial({ color: "#1d171c", roughness: 0.85, metalness: 0.08 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Studio 404 backdrop plane
    const loader = new THREE.TextureLoader();
    const bgTex = loader.load("/moppets/tabby/studio-404-stage.webp");
    bgTex.colorSpace = THREE.SRGBColorSpace;
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(11.4, 6.4),
      new THREE.MeshBasicMaterial({ map: bgTex, color: "#d8cfc7" }),
    );
    backdrop.position.set(0, 2.7, -3.2);
    scene.add(backdrop);

    // Volumetric spotlight beams (subtle additive cones)
    const beamMatL = new THREE.MeshBasicMaterial({
      color: "#ffcf8c",
      transparent: true,
      opacity: 0.075,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beamL = new THREE.Mesh(new THREE.ConeGeometry(1.75, 5.8, 24, 1, true), beamMatL);
    beamL.position.set(-1.35, 2.55, 0.1);
    beamL.rotation.z = -0.34;
    scene.add(beamL);

    const beamMatR = beamMatL.clone();
    beamMatR.color.set("#2fbfa0");
    beamMatR.opacity = 0.055;
    const beamR = new THREE.Mesh(new THREE.ConeGeometry(1.65, 5.6, 24, 1, true), beamMatR);
    beamR.position.set(1.45, 2.55, 0.1);
    beamR.rotation.z = 0.34;
    scene.add(beamR);

    // Tabby's Wooden Stage Riser Crate (raises her to frontline mic height per character_constraints.json)
    const riserGroup = new THREE.Group();
    const riserMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.38, 0.34, 0.84),
      new THREE.MeshStandardMaterial({ color: "#5f3e26", roughness: 0.78, metalness: 0.06 }),
    );
    riserMesh.position.y = 0.17;
    riserMesh.castShadow = true;
    riserMesh.receiveShadow = true;
    riserGroup.add(riserMesh);

    const trimMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.42, 0.04, 0.88),
      new THREE.MeshStandardMaterial({ color: "#8b5f3c", roughness: 0.65 }),
    );
    trimMesh.position.y = 0.34;
    riserGroup.add(trimMesh);

    // Live 60 fps CHIMERA Acoustic Lip & Formant Scope mounted on front of riser
    const scopeCanvas = document.createElement("canvas");
    scopeCanvas.width = 384;
    scopeCanvas.height = 116;
    const scopeCtx = scopeCanvas.getContext("2d")!;
    const scopeTex = new THREE.CanvasTexture(scopeCanvas);
    scopeTex.colorSpace = THREE.SRGBColorSpace;
    const scopeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.26),
      new THREE.MeshBasicMaterial({ map: scopeTex }),
    );
    scopeMesh.position.set(0, 0.17, 0.425);
    riserGroup.add(scopeMesh);
    scene.add(riserGroup);

    // Chrome Frontline Stand Mic positioned respectfully beside Tabby (NON-CONTACT)
    const micGroup = new THREE.Group();
    micGroup.position.set(0.76, 0, 0.34);
    const micMat = new THREE.MeshStandardMaterial({ color: "#b6bec8", metalness: 0.82, roughness: 0.26 });
    const micBase = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 24), micMat);
    micBase.position.y = 0.02;
    const micPole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.56, 16), micMat);
    micPole.position.y = 0.78;
    const micBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.42, 12), micMat);
    micBoom.position.set(-0.14, 1.58, -0.06);
    micBoom.rotation.z = 1.15;
    const micHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.052, 16, 16),
      new THREE.MeshStandardMaterial({ color: "#d6dce2", metalness: 0.9, roughness: 0.22 }),
    );
    micHead.position.set(-0.33, 1.66, -0.1);
    micGroup.add(micBase, micPole, micBoom, micHead);
    scene.add(micGroup);

    // Grounded contact shadow & #2fbfa0 vocal halo on riser top
    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.46, 32),
      new THREE.MeshBasicMaterial({ color: "#050408", transparent: true, opacity: 0.52, depthWrite: false }),
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.scale.set(1, 0.42, 1);
    contactShadow.position.set(0, 0.365, 0.02);
    scene.add(contactShadow);

    const haloMat = new THREE.MeshBasicMaterial({
      color: "#2fbfa0",
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const haloRing = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.5, 40), haloMat);
    haloRing.rotation.x = -Math.PI / 2;
    haloRing.scale.set(1, 0.44, 1);
    haloRing.position.set(0, 0.366, 0.02);
    scene.add(haloRing);

    // Tabby 2.5D Puppet Plane (448:560 aspect -> 1.62w x 2.025h world units, bottom origin)
    const puppetW = 1.62;
    const puppetH = puppetW * (560 / 448);
    const puppetGeo = new THREE.PlaneGeometry(puppetW, puppetH);
    puppetGeo.translate(0, puppetH / 2, 0);

    const fallbackTex = loader.load("/moppets/tabby/bible-hero.webp");
    fallbackTex.colorSpace = THREE.SRGBColorSpace;
    const puppetMat = new THREE.MeshBasicMaterial({
      map: fallbackTex,
      transparent: true,
      alphaTest: 0.03,
      side: THREE.DoubleSide,
    });
    const puppetMesh = new THREE.Mesh(puppetGeo, puppetMat);
    puppetMesh.position.set(0, 0.36, 0.04);
    scene.add(puppetMesh);

    // Load verified manifest + preload every action RGBA WebP atlas
    let manifest: MopClipManifest | null = null;
    const atlasTextures = new Map<string, THREE.Texture>();
    let disposed = false;

    void fetch("/moppets/tabby/manifest.json")
      .then((r) => r.json() as Promise<MopClipManifest>)
      .then((mf) => {
        if (disposed) return;
        manifest = mf;
        for (const [action, spec] of Object.entries(mf.actions)) {
          const tex = loader.load(spec.atlasUrl);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          atlasTextures.set(action, tex);
        }
      })
      .catch((err) => console.error("Failed to load Tabby manifest:", err));

    const expr = new Expression();
    const camPos = new THREE.Vector3(...CAMERA_TARGETS.wide.pos);
    const camLook = new THREE.Vector3(...CAMERA_TARGETS.wide.look);
    let actorX = 0;
    let facing = 1;
    let activeAction: MopAction = "idle";
    let actionElapsed = 0;
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

      // Select action (manual trigger pad overrides song cue while active)
      const desiredAction: MopAction = actOverrideRef.current ?? frame.cueAction;
      if (desiredAction !== activeAction) {
        activeAction = desiredAction;
        actionElapsed = 0;
      } else {
        actionElapsed += dt;
      }

      // Walk blocking & facing
      let targetX = 0;
      if (desiredAction === "walk" || frame.moveTarget) {
        if (frame.moveTarget === "left") targetX = -0.34;
        else if (frame.moveTarget === "right") targetX = 0.34;
        else if (desiredAction === "walk") targetX = Math.sin(now * 1.4) * 0.28;
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
          ? Math.sin(frame.jumpProgress * Math.PI) * 0.32
          : 0;

      // Sample verified WebP atlas cell (0.4% inset prevents neighbor-cell bleed)
      const spec: MopClipSpec | undefined = manifest?.actions[activeAction] ?? manifest?.actions.idle;
      const tex = spec ? atlasTextures.get(activeAction) ?? atlasTextures.get("idle") : undefined;
      if (spec && tex && tex.image) {
        if (puppetMat.map !== tex) {
          puppetMat.map = tex;
          puppetMat.needsUpdate = true;
        }
        const total = Math.max(1, spec.frames);
        const rawIdx = Math.floor(actionElapsed * spec.fps);
        const idx = activeAction === "bow" ? Math.min(total - 1, rawIdx) : rawIdx % total;
        const col = idx % spec.cols;
        const row = Math.floor(idx / spec.cols);
        const cellU = 1 / spec.cols;
        const cellV = 1 / spec.rows;
        const insetU = cellU * 0.004;
        const insetV = cellV * 0.004;

        const u0 = col * cellU + insetU;
        const uW = cellU - insetU * 2;
        const v0 = 1 - (row + 1) * cellV + insetV;
        const vH = cellV - insetV * 2;

        if (facing < 0) {
          tex.repeat.set(-uW, vH);
          tex.offset.set(u0 + uW, v0);
        } else {
          tex.repeat.set(uW, vH);
          tex.offset.set(u0, v0);
        }
      }

      // Subtle CHIMERA Expression motion (nod + tilt + breath stretch)
      const puffStretch = 1 + Math.max(-0.04, Math.min(0.06, expr.puff * 0.035));
      const nodAngle = Math.max(-0.08, Math.min(0.08, expr.nod * 0.45));
      const tiltAngle = Math.max(-0.09, Math.min(0.09, expr.tilt * 0.55));
      puppetMesh.position.set(actorX, 0.36 + jumpY, 0.04);
      puppetMesh.rotation.set(nodAngle, 0, -tiltAngle);
      puppetMesh.scale.set(puffStretch, 1 / Math.sqrt(puffStretch), 1);

      contactShadow.position.x = actorX;
      const shadowScale = Math.max(0.5, 1 - jumpY * 1.4);
      contactShadow.scale.set(shadowScale, 0.42 * shadowScale, 1);

      haloRing.position.x = actorX;
      haloMat.opacity = Math.min(0.75, 0.16 + frame.rms * 3.8);

      // Pulse spotlight cones subtly with voice RMS
      beamMatL.opacity = 0.055 + Math.min(0.08, frame.rms * 0.5);
      beamMatR.opacity = 0.04 + Math.min(0.075, frame.rms * 0.45);

      // Update live CHIMERA Acoustic Lip & Formant Scope on riser
      drawScopeScreen(scopeCtx, frame, expr);
      scopeTex.needsUpdate = true;

      // Damped camera director
      const preset: CameraPreset =
        camOverrideRef.current === "auto" ? frame.camPreset : camOverrideRef.current;
      const targetCam = CAMERA_TARGETS[preset] ?? CAMERA_TARGETS.wide;
      const camEase = Math.min(1, dt * 3.5);
      camPos.lerp(new THREE.Vector3(...targetCam.pos), camEase);
      camLook.lerp(new THREE.Vector3(...targetCam.look), camEase);
      camera.position.copy(camPos);
      camera.lookAt(camLook);

      renderer.render(scene, camera);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      onCanvasReadyRef.current?.(null);
      for (const tex of atlasTextures.values()) tex.dispose();
      fallbackTex.dispose();
      bgTex.dispose();
      scopeTex.dispose();
      puppetGeo.dispose();
      puppetMat.dispose();
      renderer.dispose();
    };
  }, []);

  return <div ref={hostRef} className="moppet-stage-host" />;
}
