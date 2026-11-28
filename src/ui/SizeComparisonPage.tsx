/**
 * Interactive Three.js Cast Size Comparison Page (`?scale`).
 *
 * Uses `GlbPerformer3D` from `src/stage/actors3D.ts` so every Studio 404 character
 * renders with its full live CRT/LED/AniCraft animated face, relaxed resting arms,
 * contact shadows, and procedural breathing/singing groove while standing flush on
 * `y = 0.00H` beside canonical `DU` / `H` / `mm` height rails (`Tabby = 100 DU`,
 * `Moonbell = 70 DU`, `Gruff = 200 DU`).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CAST_MANIFEST, type CastCharacterManifest } from "../choir/castManifest.ts";
import { GlbPerformer3D } from "../stage/actors3D.ts";

interface ScalePreset {
  readonly id: string;
  readonly label: string;
  readonly castIds: readonly string[];
}

const SCALE_PRESETS: readonly ScalePreset[] = [
  {
    id: "moonbell-extremes",
    label: "Moonbell & Extremes",
    castIds: ["gruff", "hertz", "tabby", "chip", "tracker", "moonbell"],
  },
  {
    id: "tallest-7",
    label: "Tallest 7",
    castIds: ["gruff", "hertz", "neon", "tally", "clank", "ozzi", "thrum"],
  },
  {
    id: "middle-7",
    label: "Middle 7",
    castIds: ["leadsinger", "tabby", "clacker", "deck", "folio", "zap", "fuzz"],
  },
  {
    id: "smallest-6",
    label: "Smallest 6",
    castIds: ["watt", "cue", "chip", "click", "tracker", "moonbell"],
  },
  {
    id: "spare-parts",
    label: "Spare Parts Band",
    castIds: ["tabby", "neon", "clank", "fuzz", "watt", "thrum"],
  },
];

const CLIP_OPTIONS = [
  "idle",
  "sing",
  "wave",
  "laugh",
  "shrug",
  "gasp",
  "nod",
  "tilt",
  "bow",
  "cheer",
  "dance",
  "sit",
  "sneak",
] as const;

type StudioLightPresetId = "daylight" | "warm404" | "rim";

const LIGHT_PRESETS: Readonly<
  Record<
    StudioLightPresetId,
    { label: string; bgHex: number; ambIntensity: number; keyIntensity: number; keyHex: number; rimIntensity: number; exposure: number }
  >
> = {
  daylight: {
    label: "Bright Inspection",
    bgHex: 0x131b29,
    ambIntensity: 1.35,
    keyIntensity: 2.35,
    keyHex: 0xfff8ee,
    rimIntensity: 1.15,
    exposure: 1.22,
  },
  warm404: {
    label: "Studio 404 Warm",
    bgHex: 0x120e14,
    ambIntensity: 0.95,
    keyIntensity: 2.15,
    keyHex: 0xffdeb0,
    rimIntensity: 0.95,
    exposure: 1.12,
  },
  rim: {
    label: "Stage Rim",
    bgHex: 0x0b1018,
    ambIntensity: 0.75,
    keyIntensity: 1.75,
    keyHex: 0xf4f0ff,
    rimIntensity: 1.65,
    exposure: 1.08,
  },
};

const HEIGHT_RAILS = [
  { h: 2.0, label: "2.00H · Gruff Max (200 DU / 508 mm)", color: 0xd9a84e },
  { h: 1.5, label: "1.50H · Hertz (150 DU / 381 mm)", color: 0x7b9bb8 },
  { h: 1.0, label: "1.00H · Tabby Baseline (100 DU / 254 mm)", color: 0xe66f4c },
  { h: 0.75, label: "0.75H · Tracker (75 DU / 190 mm)", color: 0x6ea89b },
  { h: 0.7, label: "0.70H · Moonbell Min (70 DU / 178 mm)", color: 0x5be3d0 },
] as const;

const MAX_ACTIVE_3D = 8;

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m?.dispose());
    else if (mat) mat.dispose();
  });
}

function makeGuideLabelSprite(text: string, hexColor: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 48;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(11, 16, 24, 0.88)";
    ctx.fillRect(0, 4, 512, 40);
    ctx.strokeStyle = `#${hexColor.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 5, 510, 38);
    ctx.fillStyle = "#eef4ff";
    ctx.font = "600 18px monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 14, 24);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.55, 0.145, 1);
  return sprite;
}

function makeFloorTagSprite(name: string, du: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(13, 18, 26, 0.9)";
    ctx.fillRect(4, 4, 248, 56);
    ctx.strokeStyle = "#4f6888";
    ctx.lineWidth = 2;
    ctx.strokeRect(5, 5, 246, 54);
    ctx.fillStyle = "#f2f6ff";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(name, 128, 26);
    ctx.fillStyle = "#9ec0e6";
    ctx.font = "15px monospace";
    ctx.fillText(`${(du / 100).toFixed(2)}H · ${du} DU`, 128, 47);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.66, 0.165, 1);
  return sprite;
}

interface LoadedPerformerEntry {
  readonly cid: string;
  readonly spec: CastCharacterManifest;
  readonly performer: GlbPerformer3D;
  readonly x: number;
  readonly phaseIndex: number;
}

export default function SizeComparisonPage(): React.ReactElement {
  const sortedCast = useMemo<readonly CastCharacterManifest[]>(() => {
    return Object.values(CAST_MANIFEST.characters).sort(
      (a, b) => b.heightDu - a.heightDu || a.displayName.localeCompare(b.displayName),
    );
  }, []);

  const [presetId, setPresetId] = useState<string>(SCALE_PRESETS[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>([...SCALE_PRESETS[0].castIds]);
  const [clipName, setClipName] = useState<string>("idle");
  const [lightPreset, setLightPreset] = useState<StudioLightPresetId>("daylight");
  const [animSpeed, setAnimSpeed] = useState<number>(1.0);
  const [singingPreview, setSingingPreview] = useState<boolean>(false);
  const [turntableSpin, setTurntableSpin] = useState<boolean>(false);
  const [loadingCount, setLoadingCount] = useState<number>(0);
  const [webglError, setWebglError] = useState<string | null>(null);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<LoadedPerformerEntry[]>([]);
  const lightsRef = useRef<{
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    amb: THREE.AmbientLight;
    key: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
  } | null>(null);

  const clipNameRef = useRef<string>(clipName);
  clipNameRef.current = clipName;
  const animSpeedRef = useRef<number>(animSpeed);
  animSpeedRef.current = animSpeed;
  const singingRef = useRef<boolean>(singingPreview);
  singingRef.current = singingPreview;
  const turntableRef = useRef<boolean>(turntableSpin);
  turntableRef.current = turntableSpin;

  const applyPreset = (preset: ScalePreset) => {
    setPresetId(preset.id);
    setSelectedIds([...preset.castIds]);
  };

  const toggleCast = (cid: string) => {
    setPresetId("custom");
    setSelectedIds((prev) => {
      if (prev.includes(cid)) {
        return prev.length > 1 ? prev.filter((id) => id !== cid) : prev;
      }
      const next = [...prev, cid];
      return next.length > MAX_ACTIVE_3D ? next.slice(next.length - MAX_ACTIVE_3D) : next;
    });
  };

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let cancelled = false;
    setWebglError(null);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : "WebGL unavailable");
      return;
    }
    const lp = LIGHT_PRESETS[lightPreset];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 1100, host.clientHeight || 520);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = lp.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(lp.bgHex);

    const camera = new THREE.PerspectiveCamera(
      36,
      (host.clientWidth || 1100) / Math.max(1, host.clientHeight || 520),
      0.05,
      40,
    );
    camera.position.set(0, 1.38, Math.max(6.4, selectedIds.length * 1.2));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.96, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.6;
    controls.maxDistance = 16;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();

    const amb = new THREE.AmbientLight(0xe4eeff, lp.ambIntensity);
    scene.add(amb);
    scene.add(new THREE.HemisphereLight(0xf6f0e4, 0x263246, 0.95));

    const keyLight = new THREE.DirectionalLight(lp.keyHex, lp.keyIntensity);
    keyLight.position.set(2.8, 5.2, 5.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const frontFill = new THREE.DirectionalLight(0xdceaff, 0.95);
    frontFill.position.set(-2.5, 2.4, 5.2);
    scene.add(frontFill);

    const rimLight = new THREE.DirectionalLight(0x7cc4ff, lp.rimIntensity);
    rimLight.position.set(-4.0, 3.4, -3.5);
    scene.add(rimLight);

    lightsRef.current = { scene, renderer, amb, key: keyLight, rim: rimLight };

    const spanW = Math.max(6.4, selectedIds.length * 1.15 + 1.8);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(spanW + 2, 5.2),
      new THREE.MeshStandardMaterial({ color: 0x2d241d, roughness: 0.76, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(spanW + 1, Math.round(spanW + 1) * 2, 0x4f6482, 0x2a3647);
    grid.position.y = 0.002;
    scene.add(grid);

    const guideGroup = new THREE.Group();
    const halfSpan = spanW * 0.48;
    for (const rail of HEIGHT_RAILS) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-halfSpan, rail.h, -0.58),
        new THREE.Vector3(halfSpan, rail.h, -0.58),
      ]);
      guideGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: rail.color })));
      const lbl = makeGuideLabelSprite(rail.label, rail.color);
      lbl.position.set(-halfSpan + 0.72, rail.h + 0.065, -0.62);
      guideGroup.add(lbl);
    }
    scene.add(guideGroup);

    const loader = new GLTFLoader();
    const rigGroup = new THREE.Group();
    scene.add(rigGroup);
    entriesRef.current = [];
    setLoadingCount(selectedIds.length);

    const spacing = selectedIds.length <= 1 ? 0 : Math.min(1.06, Math.max(0.78, (spanW - 1.5) / selectedIds.length));
    const startX = -((selectedIds.length - 1) * spacing) / 2;

    selectedIds.forEach((cid, idx) => {
      const charSpec = CAST_MANIFEST.characters[cid];
      const m3 = charSpec?.model3d;
      if (!charSpec || !m3?.url) {
        setLoadingCount((c) => Math.max(0, c - 1));
        return;
      }
      const xPos = startX + idx * spacing;
      const tag = makeFloorTagSprite(charSpec.displayName, charSpec.heightDu);
      tag.position.set(xPos, 0.09, 0.56);
      guideGroup.add(tag);

      loader.load(
        m3.url,
        (gltf) => {
          if (cancelled) {
            disposeObject3D(gltf.scene);
            return;
          }
          const performer = new GlbPerformer3D(m3, gltf);
          rigGroup.add(performer.group);
          entriesRef.current.push({
            cid,
            spec: charSpec,
            performer,
            x: xPos,
            phaseIndex: idx,
          });
          setLoadingCount((c) => Math.max(0, c - 1));
        },
        undefined,
        () => {
          setLoadingCount((c) => Math.max(0, c - 1));
        },
      );
    });

    const onResize = () => {
      if (!host) return;
      const w = host.clientWidth || 1100;
      const h = host.clientHeight || 520;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    let animTime = 0;
    let spinRad = 0;
    let rafId = 0;
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      animTime += dt * animSpeedRef.current;
      if (turntableRef.current) {
        spinRad += dt * 0.65;
      } else {
        spinRad *= Math.max(0, 1 - dt * 6);
      }

      const isSinging = singingRef.current || clipNameRef.current === "sing";
      const beat = animTime * 1.8;
      const mouthPulse = isSinging && Math.sin(animTime * 11.0) > -0.15;

      for (const entry of entriesRef.current) {
        entry.performer.update({
          key: entry.cid,
          castId: entry.cid,
          manifest: entry.spec,
          cel: {
            atlasUrl: entry.spec.portraitUrl,
            cols: 1,
            rows: 1,
            frame: 0,
            action: isSinging ? "sing" : "idle",
            source: "fmv-manifest",
          },
          accentColor: entry.spec.color,
          worldId: "theater",
          x: entry.x,
          y: 0,
          z: 0,
          floorY: 0,
          worldHeight: entry.spec.heightDu / 100,
          facing: 1,
          rotY: spinRad,
          squashX: 1,
          stretchY: 1,
          leanRad: 0,
          timeSec: animTime,
          beat,
          performing: true,
          singing: isSinging,
          level: isSinging ? 0.72 : 0,
          mouthOpen: mouthPulse,
          gagActive: false,
          phaseIndex: entry.phaseIndex,
          actionClip: clipNameRef.current,
          rigPreference: "auto-3d",
        });
      }

      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      for (const entry of entriesRef.current) {
        entry.performer.dispose();
      }
      entriesRef.current = [];
      lightsRef.current = null;
      disposeObject3D(scene);
      renderer.dispose();
    };
  }, [selectedIds]);

  // Live lighting preset switch without reloading GLBs
  useEffect(() => {
    const h = lightsRef.current;
    if (!h) return;
    const lp = LIGHT_PRESETS[lightPreset];
    (h.scene.background as THREE.Color).setHex(lp.bgHex);
    h.amb.intensity = lp.ambIntensity;
    h.key.color.setHex(lp.keyHex);
    h.key.intensity = lp.keyIntensity;
    h.rim.intensity = lp.rimIntensity;
    h.renderer.toneMappingExposure = lp.exposure;
  }, [lightPreset]);

  return (
    <div className="min-h-screen bg-[#0a0f17] text-[#e8eef7] p-5 md:p-7">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#253247] pb-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#e6aa4d]">
              Studio 404 Canonical Scale · Tabby Baseline = 1.00H (100 DU / 254 mm)
            </p>
            <h1 className="text-2xl font-bold mt-1">
              Moonbell &amp; {sortedCast.length}-Cast 3D Size Comparison Stage
            </h1>
          </div>
          <nav className="flex flex-wrap gap-3 text-sm">
            <a className="px-3 py-1.5 rounded border border-[#2d3e57] bg-[#121a27] hover:bg-[#1a2538]" href="/">
              Live Console
            </a>
            <a className="px-3 py-1.5 rounded border border-[#2d3e57] bg-[#121a27] hover:bg-[#1a2538]" href="?cast">
              Cast Gallery
            </a>
            <a className="px-3 py-1.5 rounded border border-[#2d3e57] bg-[#121a27] hover:bg-[#1a2538]" href="?watch=tabby-solo">
              Theater
            </a>
            <a className="px-3 py-1.5 rounded border border-[#5a4a24] bg-[#211b0f] text-[#f4d48c] hover:bg-[#2d2515]" href="?kids">
              Kids Farm (Separate)
            </a>
          </nav>
        </header>

        <section className="rounded-lg border border-[#253247] bg-[#0f1622] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {SCALE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold border transition cursor-pointer ${
                    presetId === preset.id
                      ? "bg-[#225c53] border-[#5be3d0] text-white"
                      : "bg-[#141e2e] border-[#2b3b54] text-[#c8d8ee] hover:bg-[#1b283d]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[#9eb5d3] mr-1">Clip:</span>
              {CLIP_OPTIONS.map((cname) => (
                <button
                  key={cname}
                  type="button"
                  onClick={() => setClipName(cname)}
                  className={`px-2.5 py-1 rounded text-xs font-mono border cursor-pointer ${
                    clipName === cname
                      ? "bg-[#b05136] border-[#ff9b7a] text-white"
                      : "bg-[#141e2e] border-[#2b3b54] text-[#b8cae2] hover:bg-[#1b283d]"
                  }`}
                >
                  {cname}
                </button>
              ))}
            </div>
          </div>

          {/* Stage Lighting, Lip-Sync & Turntable Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 py-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[#9eb5d3]">Stage Light:</span>
              {(Object.keys(LIGHT_PRESETS) as StudioLightPresetId[]).map((lid) => (
                <button
                  key={lid}
                  type="button"
                  onClick={() => setLightPreset(lid)}
                  className={`px-2.5 py-1 rounded border cursor-pointer ${
                    lightPreset === lid
                      ? "bg-[#1f3d61] border-[#78b7ff] text-white font-semibold"
                      : "bg-[#141e2e] border-[#2b3b54] text-[#b8cae2]"
                  }`}
                >
                  {LIGHT_PRESETS[lid].label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[#9eb5d3]">Speed:</span>
              {([0.5, 1.0, 1.25] as const).map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setAnimSpeed(spd)}
                  className={`px-2 py-1 rounded font-mono border cursor-pointer ${
                    Math.abs(animSpeed - spd) < 0.01
                      ? "bg-[#225c53] border-[#5be3d0] text-white"
                      : "bg-[#141e2e] border-[#2b3b54] text-[#b8cae2]"
                  }`}
                >
                  {spd}×
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSingingPreview((s) => !s)}
                className={`px-2.5 py-1 rounded border cursor-pointer ${
                  singingPreview
                    ? "bg-[#8a4522] border-[#ffb27a] text-white font-semibold"
                    : "bg-[#141e2e] border-[#2b3b54] text-[#b8cae2]"
                }`}
              >
                {singingPreview ? "Vocal Lip-Sync: ON" : "Vocal Lip-Sync: OFF"}
              </button>
              <button
                type="button"
                onClick={() => setTurntableSpin((t) => !t)}
                className={`px-2.5 py-1 rounded border cursor-pointer ${
                  turntableSpin
                    ? "bg-[#4f3478] border-[#c49bff] text-white font-semibold"
                    : "bg-[#141e2e] border-[#2b3b54] text-[#b8cae2]"
                }`}
              >
                {turntableSpin ? "360° Turntable: ON" : "360° Turntable: OFF"}
              </button>
            </div>
          </div>

          <div className="relative rounded border border-[#243247] bg-[#0b1018] overflow-hidden">
            {webglError ? (
              <div className="p-8 text-sm text-[#f59c87]">WebGL unavailable: {webglError}</div>
            ) : (
              <div ref={canvasHostRef} className="w-full h-[500px]" data-testid="scale-stage-3d" />
            )}
            <div className="absolute top-3 right-3 px-3 py-1 rounded bg-[#0a1019]/85 border border-[#2c3c55] text-xs font-mono text-[#c5d7ee]">
              {loadingCount > 0
                ? `Loading ${loadingCount} GLB rig(s)…`
                : `Active 3D Lineup (${selectedIds.length}/${MAX_ACTIVE_3D}) · Clip: ${clipName} · Orbit to inspect`}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-[#9eb5d3] mr-1">Toggle Cast (up to {MAX_ACTIVE_3D}):</span>
            {sortedCast.map((c) => {
              const active = selectedIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCast(c.id)}
                  className={`px-2.5 py-1 rounded text-xs border cursor-pointer ${
                    active
                      ? "bg-[#1d3954] border-[#78b7ff] text-white font-semibold"
                      : "bg-[#121925] border-[#253247] text-[#a9bbd4] hover:border-[#496285]"
                  }`}
                >
                  {c.displayName} ({c.heightDu})
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-[#253247] bg-[#0f1622] p-4">
          <h2 className="text-lg font-bold mb-3">Canonical {sortedCast.length}-Cast Height Reference Table</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#29374c] text-[#a9bbd4]">
                  <th className="py-2 pr-3">Rank</th>
                  <th className="py-2 pr-3">Character</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Canon DU</th>
                  <th className="py-2 pr-3">Tabby Ratio</th>
                  <th className="py-2 pr-3">Physical mm</th>
                  <th className="py-2">Stage Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedCast.map((c, idx) => {
                  const active = selectedIds.includes(c.id);
                  const ratio = (c.heightDu / 100).toFixed(2);
                  const mm = Math.round(c.heightDu * 2.54);
                  return (
                    <tr key={c.id} className="border-b border-[#1c2636] hover:bg-[#141d2b]">
                      <td className="py-2 pr-3 font-mono text-[#90a7c7]">{idx + 1}</td>
                      <td className="py-2 pr-3 font-semibold" style={{ color: c.color }}>
                        {c.displayName}
                      </td>
                      <td className="py-2 pr-3 text-[#c6d4e8]">{c.role}</td>
                      <td className="py-2 pr-3 font-mono">{c.heightDu} DU</td>
                      <td className="py-2 pr-3 font-mono">{ratio}H</td>
                      <td className="py-2 pr-3 font-mono">{mm} mm</td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => toggleCast(c.id)}
                          className={`px-2.5 py-1 rounded text-xs border cursor-pointer ${
                            active
                              ? "bg-[#225c53] border-[#5be3d0] text-white"
                              : "bg-[#152031] border-[#2c3e58] text-[#c2d4ea]"
                          }`}
                        >
                          {active ? "In 3D Lineup" : "Compare in 3D"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
