/**
 * Interactive Sunny Meadow Farm School 3D Kids Stage (`?kids`).
 *
 * Strictly isolated from Studio 404 Moppets: uses only `KIDS_FARM_CAST`,
 * `/kids-farm/models/*.glb`, `/kids-farm/textures/*.png`, and the pure
 * Web-Audio `farmMusic` sing-along synth routed through `src/audio/audio.ts`.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FARM_TUNES, farmMusic, type FarmTuneId } from "./farmMusicPlayer.ts";
import { buildKidsFarmStage, type KidsFarmStageHandle } from "./farmStageBuilder.ts";
import {
  KIDS_FARM_ACTIVITIES,
  KIDS_FARM_CAST,
  KIDS_FARM_MOODS,
  sanitizeFarmClip,
  type KidsFarmActivityId,
  type KidsFarmFriendSpec,
  type KidsFarmMoodId,
} from "./kidsFarmCatalog.ts";

type CameraPresetId = "wide" | "porch" | "windmill" | "pond";

const CAMERA_PRESETS: Readonly<Record<CameraPresetId, { label: string; pos: [number, number, number]; look: [number, number, number] }>> = {
  wide: { label: "Wide Barnyard", pos: [0, 2.08, 8.35], look: [0, 1.28, -0.9] },
  porch: { label: "Porch Close-Up", pos: [0, 1.48, 6.75], look: [0, 0.78, -0.15] },
  windmill: { label: "Windmill Hill", pos: [-2.8, 2.25, 6.8], look: [-2.6, 1.45, -2.1] },
  pond: { label: "Duck Pond", pos: [3.1, 1.35, 4.35], look: [3.2, 0.25, 0.35] },
};

interface FarmPerformerEntry {
  readonly spec: KidsFarmFriendSpec;
  readonly holder: THREE.Group;
  readonly bodyWrap: THREE.Group;
  readonly badge: THREE.Sprite;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Map<string, THREE.AnimationAction>;
  activeAction: THREE.AnimationAction | null;
  baseY: number;
}

function makeNameBadgeSprite(spec: KidsFarmFriendSpec): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 280;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(255, 250, 236, 0.94)";
    ctx.fillRect(4, 4, 272, 64);
    ctx.strokeStyle = spec.accentColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 268, 60);
    ctx.fillStyle = "#1f402a";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(spec.displayName, 140, 30);
    ctx.fillStyle = spec.accentColor;
    ctx.font = "bold 17px sans-serif";
    ctx.fillText(spec.soundBadge, 140, 54);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.68, 0.175, 1);
  return spr;
}

function pickActionForFriend(
  actions: ReadonlyMap<string, THREE.AnimationAction>,
  activityId: KidsFarmActivityId,
  spec: KidsFarmFriendSpec,
): THREE.AnimationAction | undefined {
  if (activityId === "band") {
    const bandMatch = actions.get(spec.bandClip.toLowerCase());
    if (bandMatch) return bandMatch;
  }
  const actSpec = KIDS_FARM_ACTIVITIES.find((a) => a.id === activityId);
  if (actSpec) {
    for (const candidate of actSpec.preferredClips) {
      const hit = actions.get(candidate.toLowerCase());
      if (hit) return hit;
    }
  }
  return actions.get("happy-idle") ?? actions.get("idle") ?? actions.values().next().value;
}

export default function KidsFarmStagePage(): React.ReactElement {
  const [moodId, setMoodId] = useState<KidsFarmMoodId>("morning");
  const [activityId, setActivityId] = useState<KidsFarmActivityId>("wave");
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>("wide");
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState<number>(0);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Musical Sing-Along & Stage Animation Settings
  const [musicPlaying, setMusicPlaying] = useState<boolean>(false);
  const [tuneId, setTuneId] = useState<FarmTuneId>("old-macdonald");
  const [tempoScale, setTempoScale] = useState<number>(1.0);
  const [musicVolume, setMusicVolume] = useState<number>(0.65);
  const [liveLyric, setLiveLyric] = useState<string>(FARM_TUNES[0]!.bars[0]!.lyric);
  const [liveSoloId, setLiveSoloId] = useState<string | null>(null);
  const [animSpeed, setAnimSpeed] = useState<number>(1.0);
  const [windStrength, setWindStrength] = useState<number>(1.0);
  const [showBadges, setShowBadges] = useState<boolean>(true);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<KidsFarmStageHandle | null>(null);
  const performersRef = useRef<FarmPerformerEntry[]>([]);
  const activityRef = useRef<KidsFarmActivityId>(activityId);
  activityRef.current = activityId;
  const animSpeedRef = useRef<number>(animSpeed);
  animSpeedRef.current = animSpeed;

  const cameraTargetRef = useRef<{ pos: THREE.Vector3; look: THREE.Vector3 }>({
    pos: new THREE.Vector3(...CAMERA_PRESETS.wide.pos),
    look: new THREE.Vector3(...CAMERA_PRESETS.wide.look),
  });

  const activeActivity = useMemo(
    () => KIDS_FARM_ACTIVITIES.find((a) => a.id === activityId) ?? KIDS_FARM_ACTIVITIES[0]!,
    [activityId],
  );
  const spotlightFriend = useMemo(
    () => KIDS_FARM_CAST.find((f) => f.id === spotlightId) ?? null,
    [spotlightId],
  );

  // Stop farm music cleanly on unmount
  useEffect(() => {
    return () => {
      farmMusic.stop();
    };
  }, []);

  // Poll lyric banner while music plays
  useEffect(() => {
    if (!musicPlaying) {
      setLiveSoloId(null);
      const spec = FARM_TUNES.find((t) => t.id === tuneId) ?? FARM_TUNES[0]!;
      setLiveLyric(spec.bars[0]?.lyric ?? "");
      return;
    }
    const id = window.setInterval(() => {
      const st = farmMusic.getBeatState();
      setLiveLyric(st.lyric);
      setLiveSoloId(st.soloFriendId);
    }, 100);
    return () => clearInterval(id);
  }, [musicPlaying, tuneId]);

  const toggleMusic = async () => {
    if (musicPlaying) {
      farmMusic.stop();
      setMusicPlaying(false);
      return;
    }
    try {
      await farmMusic.start(tuneId);
      setMusicPlaying(true);
      if (tuneId === "barn-dance" && activityId === "wave") {
        setActivityId("dance");
      } else if (tuneId === "starry-lullaby") {
        setMoodId("lullaby");
      } else if (tuneId === "old-macdonald" && activityId === "wave") {
        setActivityId("clap");
      }
    } catch {
      setMusicPlaying(false);
    }
  };

  const selectTune = (nextTune: FarmTuneId) => {
    setTuneId(nextTune);
    farmMusic.setTune(nextTune);
    if (nextTune === "starry-lullaby") {
      setMoodId("lullaby");
      setActivityId("lullaby");
    } else if (nextTune === "barn-dance") {
      setMoodId("morning");
      setActivityId("dance");
    } else {
      setMoodId("morning");
      setActivityId("clap");
    }
  };

  // Mount Three.js Kids Farm World once and load the 6 isolated Farm School GLBs
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

    const width = host.clientWidth || 1100;
    const height = host.clientHeight || 540;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / Math.max(1, height), 0.1, 60);
    camera.position.copy(cameraTargetRef.current.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(cameraTargetRef.current.look);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.0;
    controls.maxDistance = 16.0;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.update();

    const farmStage = buildKidsFarmStage(scene, renderer);
    stageRef.current = farmStage;

    const castGroup = new THREE.Group();
    castGroup.name = "KidsFarmCastGroup";
    scene.add(castGroup);
    performersRef.current = [];
    setLoadedCount(0);

    const loader = new GLTFLoader();
    KIDS_FARM_CAST.forEach((spec, idx) => {
      loader.load(
        spec.modelUrl,
        (gltf) => {
          if (cancelled) return;
          const holder = new THREE.Group();
          holder.name = `farm-${spec.id}`;
          const bodyWrap = new THREE.Group();
          holder.add(bodyWrap);

          const model = gltf.scene;
          model.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });
          bodyWrap.add(model);

          holder.updateMatrixWorld(true);
          const rawBox = new THREE.Box3().setFromObject(model);
          const rawH = Math.max(0.05, rawBox.max.y - rawBox.min.y);
          const targetH = (spec.heightDu / 100) * 1.32;
          model.scale.multiplyScalar(targetH / rawH);
          model.rotation.y = (spec.yawDeg * Math.PI) / 180;
          holder.updateMatrixWorld(true);

          const scaledBox = new THREE.Box3().setFromObject(model);
          model.position.x -= (scaledBox.min.x + scaledBox.max.x) * 0.5;
          model.position.z -= (scaledBox.min.z + scaledBox.max.z) * 0.5;
          model.position.y -= scaledBox.min.y;

          holder.position.set(spec.stageX, 0, spec.stageZ);
          const badge = makeNameBadgeSprite(spec);
          badge.position.set(0, 0.14, 0.54);
          holder.add(badge);
          castGroup.add(holder);

          const mixer = new THREE.AnimationMixer(model);
          mixer.timeScale = animSpeedRef.current;
          const actions = new Map<string, THREE.AnimationAction>();
          for (const rawClip of gltf.animations) {
            const clean = sanitizeFarmClip(rawClip);
            actions.set(clean.name.toLowerCase(), mixer.clipAction(clean));
          }
          const initialAction = pickActionForFriend(actions, activityRef.current, spec);
          if (initialAction) {
            initialAction.time = (idx * 0.27) % Math.max(0.5, initialAction.getClip().duration || 1);
            initialAction.play();
          }

          performersRef.current.push({
            spec,
            holder,
            bodyWrap,
            badge,
            mixer,
            actions,
            activeAction: initialAction ?? null,
            baseY: 0,
          });
          setLoadedCount((c) => c + 1);
        },
        undefined,
        () => {
          setLoadedCount((c) => c + 1);
        },
      );
    });

    const onResize = () => {
      if (!host) return;
      const w = host.clientWidth || 1100;
      const h = host.clientHeight || 540;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    let elapsed = 0;
    let rafId = 0;
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      elapsed += dt;

      farmStage.update(elapsed, dt);

      const act = KIDS_FARM_ACTIVITIES.find((a) => a.id === activityRef.current) ?? KIDS_FARM_ACTIVITIES[0]!;
      const beatState = farmMusic.getBeatState();

      for (let i = 0; i < performersRef.current.length; i++) {
        const entry = performersRef.current[i]!;
        entry.mixer.timeScale = animSpeedRef.current;
        entry.mixer.update(dt);

        if (beatState.playing) {
          const isSolo = beatState.soloFriendId === entry.spec.id;
          const phase = beatState.beat * Math.PI * 2 + (isSolo ? 0 : i * 0.55);
          const groove = (0.5 - 0.5 * Math.cos(phase)) * (isSolo ? 0.042 : 0.02);
          const sy = 1 - groove;
          const sx = 1 / Math.sqrt(sy);
          entry.bodyWrap.scale.set(sx, sy, sx);
          entry.bodyWrap.rotation.z = Math.sin(phase * 0.5) * (isSolo ? 0.055 : 0.025);
          entry.holder.position.y = entry.baseY + (isSolo ? Math.abs(Math.sin(phase * 0.5)) * 0.03 : 0);
        } else {
          entry.bodyWrap.scale.set(1, 1, 1);
          entry.bodyWrap.rotation.z = 0;
          entry.holder.position.y =
            entry.baseY +
            Math.abs(Math.sin(elapsed * act.bounceHz * animSpeedRef.current * Math.PI + i * 0.7)) * act.bounceAmp;
        }
      }

      camera.position.lerp(cameraTargetRef.current.pos, Math.min(1, dt * 4.5));
      controls.target.lerp(cameraTargetRef.current.look, Math.min(1, dt * 5.0));
      controls.update();

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      for (const entry of performersRef.current) {
        entry.mixer.stopAllAction();
      }
      performersRef.current = [];
      farmStage.dispose();
      stageRef.current = null;
      castGroup.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x?.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    stageRef.current?.setMood(moodId);
  }, [moodId]);

  useEffect(() => {
    stageRef.current?.setWindStrength(windStrength);
  }, [windStrength]);

  useEffect(() => {
    for (const entry of performersRef.current) {
      entry.badge.visible = showBadges;
    }
  }, [showBadges, loadedCount]);

  useEffect(() => {
    farmMusic.setTempoScale(tempoScale);
  }, [tempoScale]);

  useEffect(() => {
    farmMusic.setVolume(musicVolume);
  }, [musicVolume]);

  // Crossfade all 6 Farm friends into chosen activity clip
  useEffect(() => {
    const actSpec = KIDS_FARM_ACTIVITIES.find((a) => a.id === activityId);
    if (actSpec?.moodHint) {
      setMoodId(actSpec.moodHint);
    }
    for (const entry of performersRef.current) {
      const nextAction = pickActionForFriend(entry.actions, activityId, entry.spec);
      if (!nextAction || nextAction === entry.activeAction) continue;
      nextAction.reset().play();
      if (entry.activeAction) {
        entry.activeAction.crossFadeTo(nextAction, 0.35, true);
      }
      entry.activeAction = nextAction;
    }
  }, [activityId]);

  // Pan camera smoothly to spotlight one friend or selected barnyard camera preset
  useEffect(() => {
    if (!spotlightId) {
      const preset = CAMERA_PRESETS[cameraPreset];
      cameraTargetRef.current = {
        pos: new THREE.Vector3(...preset.pos),
        look: new THREE.Vector3(...preset.look),
      };
      return;
    }
    const spec = KIDS_FARM_CAST.find((f) => f.id === spotlightId);
    if (!spec) return;
    const focusY = Math.max(0.28, (spec.heightDu / 100) * 0.62);
    cameraTargetRef.current = {
      pos: new THREE.Vector3(spec.stageX * 0.85, focusY + 0.42, spec.stageZ + 2.55),
      look: new THREE.Vector3(spec.stageX, focusY, spec.stageZ),
    };
  }, [spotlightId, cameraPreset]);

  return (
    <div className="min-h-screen bg-[#fff8ea] text-[#1f3d29] p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-[#d9b87a] bg-[#fffdf7] px-5 py-4 shadow-sm">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#c84335]">
              Children’s Education 3D World · Isolated From Studio 404 Moppets
            </p>
            <h1 className="text-2xl md:text-3xl font-extrabold text-[#1f402a] mt-0.5">
              Sunny Meadow Farm School Stage
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {KIDS_FARM_MOODS.map((mood) => (
              <button
                key={mood.id}
                type="button"
                onClick={() => setMoodId(mood.id)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition cursor-pointer ${
                  moodId === mood.id
                    ? "bg-[#2e7d47] border-[#1f5932] text-white"
                    : "bg-[#fff6e3] border-[#e2c68f] text-[#35543e] hover:bg-[#ffedc8]"
                }`}
              >
                {mood.emoji} {mood.label}
              </button>
            ))}
            <a
              href="/"
              className="ml-2 px-3 py-2 rounded-xl text-xs font-bold border-2 border-[#394d66] bg-[#162233] text-[#e8f0fa] hover:bg-[#22344d]"
            >
              Back to Studio 404 (Moppets)
            </a>
          </div>
        </header>

        {/* Musical Sing-Along Console */}
        <section className="rounded-2xl border-2 border-[#d9b87a] bg-[#fffdf7] px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleMusic()}
              data-testid="kids-farm-play-music"
              className={`px-4 py-2 rounded-xl text-xs font-extrabold border-2 transition cursor-pointer ${
                musicPlaying
                  ? "bg-[#b83227] border-[#821f17] text-white"
                  : "bg-[#2e7d47] border-[#1f5932] text-white hover:bg-[#25693b]"
              }`}
            >
              {musicPlaying ? "⏹ Stop Sing-Along" : "▶ Play Sing-Along Music"}
            </button>
            {FARM_TUNES.map((tune) => (
              <button
                key={tune.id}
                type="button"
                onClick={() => selectTune(tune.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 cursor-pointer ${
                  tuneId === tune.id
                    ? "bg-[#f3b63a] border-[#c48814] text-[#233b28]"
                    : "bg-[#fff6e5] border-[#e5cb98] text-[#35543e] hover:bg-[#ffebc2]"
                }`}
              >
                {tune.title}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-[#35543e]">
            <div className="flex items-center gap-1">
              <span>Tempo:</span>
              {([
                [0.85, "Gentle"],
                [1.0, "Normal"],
                [1.15, "Peppy"],
              ] as const).map(([val, lbl]) => (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => setTempoScale(val)}
                  className={`px-2 py-1 rounded-lg border cursor-pointer ${
                    Math.abs(tempoScale - val) < 0.01
                      ? "bg-[#2e8bc0] border-[#1e648c] text-white"
                      : "bg-[#fff8ea] border-[#dec593]"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5">
              <span>Vol</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={musicVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))}
                className="w-20 accent-[#2e7d47]"
              />
            </label>
          </div>
        </section>

        {/* Main 3D Farm Stage + Animation & Stage Settings */}
        <section className="rounded-2xl border-2 border-[#d9b87a] bg-[#fffdf7] p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {KIDS_FARM_ACTIVITIES.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => setActivityId(act.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition cursor-pointer ${
                    activityId === act.id
                      ? "bg-[#d9483b] border-[#a82d22] text-white shadow-sm"
                      : "bg-[#fff6e5] border-[#e5cb98] text-[#2a4a33] hover:bg-[#ffe9be]"
                  }`}
                >
                  {act.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((cid) => (
                <button
                  key={cid}
                  type="button"
                  onClick={() => {
                    setSpotlightId(null);
                    setCameraPreset(cid);
                  }}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border-2 cursor-pointer ${
                    spotlightId === null && cameraPreset === cid
                      ? "bg-[#2e8bc0] border-[#1e648c] text-white"
                      : "bg-[#eef7fc] border-[#9ccde8] text-[#1e5270]"
                  }`}
                >
                  {CAMERA_PRESETS[cid].label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative rounded-2xl border-2 border-[#b9d9eb] bg-[#c8ecff] overflow-hidden">
            {webglError ? (
              <div className="p-8 text-sm font-semibold text-[#a82d22]">WebGL error: {webglError}</div>
            ) : (
              <div ref={canvasHostRef} className="w-full h-[540px]" data-testid="kids-farm-canvas" />
            )}
            <div className="absolute top-3 left-3 px-3.5 py-1.5 rounded-xl bg-[#fffaf0]/92 border-2 border-[#e2c68f] text-xs font-bold text-[#22472e]">
              {loadedCount < KIDS_FARM_CAST.length
                ? `Waking up Farm School friends (${loadedCount}/${KIDS_FARM_CAST.length})…`
                : musicPlaying
                  ? liveLyric
                  : `${activeActivity.label}: ${activeActivity.description}`}
            </div>
            {spotlightFriend && (
              <div className="absolute bottom-3 left-3 right-3 md:right-auto md:max-w-md px-4 py-3 rounded-xl bg-[#fffdf8]/95 border-2 border-[#e69f24] shadow">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold" style={{ color: spotlightFriend.accentColor }}>
                    {spotlightFriend.displayName} · “{spotlightFriend.soundBadge}”
                  </span>
                  <span className="text-xs font-mono text-[#526e5a]">{spotlightFriend.species}</span>
                </div>
                <p className="text-xs text-[#284732] mt-1">{spotlightFriend.funFact}</p>
              </div>
            )}
          </div>

          {/* Stage & Motion Settings Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs font-bold text-[#35543e]">
            <div className="flex flex-wrap items-center gap-2">
              <span>Motion Speed:</span>
              {([
                [0.6, "0.6× Gentle"],
                [1.0, "1.0× Normal"],
                [1.3, "1.3× Lively"],
              ] as const).map(([spd, lbl]) => (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => setAnimSpeed(spd)}
                  className={`px-2.5 py-1 rounded-lg border cursor-pointer ${
                    Math.abs(animSpeed - spd) < 0.01
                      ? "bg-[#2e7d47] border-[#1f5932] text-white"
                      : "bg-[#fff8ea] border-[#dec593]"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span>Meadow Breeze:</span>
              {([
                [0.4, "Calm"],
                [1.0, "Breezy"],
                [2.1, "Festive Gust"],
              ] as const).map(([w, lbl]) => (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => setWindStrength(w)}
                  className={`px-2.5 py-1 rounded-lg border cursor-pointer ${
                    Math.abs(windStrength - w) < 0.01
                      ? "bg-[#e69f24] border-[#b87a10] text-white"
                      : "bg-[#fff8ea] border-[#dec593]"
                  }`}
                >
                  {lbl}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowBadges((b) => !b)}
                className={`ml-2 px-2.5 py-1 rounded-lg border cursor-pointer ${
                  showBadges
                    ? "bg-[#2e8bc0] border-[#1e648c] text-white"
                    : "bg-[#fff8ea] border-[#dec593]"
                }`}
              >
                {showBadges ? "Labels: On" : "Labels: Off"}
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-extrabold text-[#1f402a] mb-3">
            Meet the 6 Sunny Meadow Farm Friends (Click Any Friend for Close-Up &amp; Musical Chime)
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {KIDS_FARM_CAST.map((friend, idx) => {
              const active = spotlightId === friend.id || liveSoloId === friend.id;
              return (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => {
                    const next = spotlightId === friend.id ? null : friend.id;
                    setSpotlightId(next);
                    if (next) void farmMusic.playFriendChime(idx);
                  }}
                  className={`text-left rounded-2xl border-2 p-3.5 transition cursor-pointer ${
                    active
                      ? "bg-[#fff1d0] border-[#d9483b] shadow-md -translate-y-0.5"
                      : "bg-[#fffdf7] border-[#e4cca0] hover:border-[#e69f24] hover:bg-[#fff8e6]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-extrabold text-[#1f402a]">{friend.displayName}</span>
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: friend.accentColor }}
                    >
                      {friend.soundBadge}
                    </span>
                  </div>
                  <p className="text-xs text-[#4b6b54] mt-1">{friend.species}</p>
                  <p className="text-xs font-mono text-[#6a8571] mt-2">
                    Scale {friend.heightDu} DU · Jam: {friend.bandClip}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
