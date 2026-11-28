/**
 * Storyboard Scene Card, Stage Snapshotter, Variable Stage Controls, and Image/Copy Helpers.
 */
import { useState } from "react";
import { Camera, Check, Clapperboard, Copy, Film, Play, SlidersHorizontal, Sparkles } from "lucide-react";
import { useAudio } from "../../audio/audio.ts";
import type { CinemaShotPreset } from "../../choir/music.ts";
import type { IllustratedSongbookSpec, SongbookSceneSpec } from "../../choir/songbookStoryboard.ts";
import { LEAD_IN } from "../../choir/timeline.ts";
import { stageCanvasRegistry } from "../../stage/recordClip.ts";
import {
  STAGE_LIGHTING_MOODS,
  useStageDirector,
  type StageLightingMood,
} from "../../stage/stageDirectorStore.ts";
import { STAGE_WORLD_LIST, type StageWorldId } from "../../stage/stageWorlds.ts";

export const fmtTime = (sec: number) => {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? "0" : ""}${rem.toFixed(1)}`;
};

export function sanitizeDisplayPath(raw: string): string {
  return raw
    .replace(/^\/run\/media\/[^/]+\/[^/]+\/Work\/moppet-choir\//, "")
    .replace(/^\/run\/media\/[^/]+\/[^/]+\//, "");
}

export function StoryboardImg({
  src,
  alt,
  fallbackText,
  className,
  loading,
}: {
  src: string | null | undefined;
  alt: string;
  fallbackText: string;
  className: string;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState(false);
  const cleanSrc = src?.trim() ?? "";
  if (!cleanSrc || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`${className} flex items-center justify-center bg-[#1e1510] font-mono text-xs font-bold text-[#e3bd7f]`}
      >
        {fallbackText}
      </div>
    );
  }
  return <img src={cleanSrc} alt={alt} className={className} loading={loading} onError={() => setFailed(true)} />;
}

export function CopyPromptButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      data-sb-tone="light"
      onClick={onCopy}
      className="inline-flex items-center gap-1 rounded border border-[#ccbda6] bg-[#fffdf9] px-2 py-0.5 text-[11px] font-semibold text-[#473425] hover:border-[#8c6438] hover:bg-[#f6efe3] cursor-pointer"
    >
      {copied ? <Check className="size-3 text-emerald-700" /> : <Copy className="size-3 text-[#8c6438]" />}
      {copied ? "Copied" : label}
    </button>
  );
}

const CAMERA_SHOT_OPTIONS: readonly { id: CinemaShotPreset | ""; label: string }[] = [
  { id: "", label: "Cam: Score" },
  { id: "wide", label: "Wide" },
  { id: "two-shot", label: "Two-Shot" },
  { id: "closeup", label: "Closeup" },
  { id: "low-angle", label: "Low-Angle" },
  { id: "reaction", label: "Reaction" },
];

export function captureStageSnapshot(): string | null {
  const src = stageCanvasRegistry.current;
  if (!src || src.width === 0 || src.height === 0) return null;
  const out = document.createElement("canvas");
  out.width = 480;
  out.height = 270;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#10080b";
  ctx.fillRect(0, 0, out.width, out.height);
  const k = Math.min(out.width / src.width, out.height / src.height);
  const w = src.width * k;
  const h = src.height * k;
  ctx.drawImage(src, (out.width - w) / 2, (out.height - h) / 2, w, h);
  try {
    return out.toDataURL("image/webp", 0.86);
  } catch {
    return out.toDataURL("image/png");
  }
}

export function SceneVariableStageControls({
  songId,
  sceneIndex,
  compact = false,
  onChanged,
}: {
  songId: string;
  sceneIndex: number;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const override = useStageDirector((s) => s.overrides[`${songId}:${sceneIndex}`]);
  const setSceneOverride = useStageDirector((s) => s.setSceneOverride);
  const setVariableStageEnabled = useStageDirector((s) => s.setVariableStageEnabled);

  const selectClass = compact
    ? "rounded border border-[#cbb99f] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#3a2a1d]"
    : "rounded-md border border-[#cbb99f] bg-[#fffdf9] px-2 py-0.5 text-[11px] font-semibold text-[#3a2a1d]";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <SlidersHorizontal className="size-3 text-[#8c432b] shrink-0" />
      <select
        aria-label={`Scene ${sceneIndex} 3D world`}
        value={override?.worldId ?? ""}
        onChange={(e) => {
          setVariableStageEnabled(true);
          const v = e.target.value as StageWorldId | "";
          setSceneOverride(songId, sceneIndex, { worldId: v || undefined });
          if (v) useAudio.getState().setWorld(v);
          useStageDirector.getState().setPreviewSceneKey(`${songId}:${sceneIndex}`);
          onChanged?.();
        }}
        className={selectClass}
      >
        <option value="">World: Default</option>
        {STAGE_WORLD_LIST.map((w) => (
          <option key={w.id} value={w.id}>
            {w.shortLabel}
          </option>
        ))}
      </select>

      <select
        aria-label={`Scene ${sceneIndex} lighting mood`}
        value={override?.mood ?? "auto"}
        onChange={(e) => {
          setVariableStageEnabled(true);
          const v = e.target.value as StageLightingMood;
          setSceneOverride(songId, sceneIndex, { mood: v });
          onChanged?.();
        }}
        className={selectClass}
      >
        {STAGE_LIGHTING_MOODS.map((m) => (
          <option key={m.id} value={m.id}>
            Mood: {m.shortLabel}
          </option>
        ))}
      </select>

      <select
        aria-label={`Scene ${sceneIndex} camera shot`}
        value={override?.cameraPreset ?? ""}
        onChange={(e) => {
          setVariableStageEnabled(true);
          const v = e.target.value as CinemaShotPreset | "";
          setSceneOverride(songId, sceneIndex, { cameraPreset: v || undefined });
          onChanged?.();
        }}
        className={selectClass}
      >
        {CAMERA_SHOT_OPTIONS.map((c) => (
          <option key={c.id || "default"} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SceneCard({
  spec,
  scene,
  onSeekStageSec,
  onSnapScene,
  snapping = false,
}: {
  spec: IllustratedSongbookSpec;
  scene: SongbookSceneSpec;
  onSeekStageSec?: (stageSec: number) => void;
  onSnapScene?: (scene: SongbookSceneSpec) => void;
  snapping?: boolean;
}) {
  const captured = useStageDirector((s) => s.captures[`${spec.id}:${scene.index}`]);
  const override = useStageDirector((s) => s.overrides[`${spec.id}:${scene.index}`]);

  const effectiveHeroUrl = captured?.heroUrl ?? scene.heroUrl;
  const effectiveCamera = override?.cameraPreset ?? scene.cameraPreset;

  const cleanAnchors = scene.refAnchors.map(sanitizeDisplayPath);
  const fullBrief = [
    `[${scene.code} — ${scene.title} | ${scene.barsLabel} | ${fmtTime(scene.startSec)}–${fmtTime(scene.endSec)}]`,
    `Camera/Lens: ${effectiveCamera} · ${scene.lensSpec}`,
    override?.worldId ? `3D Stage World: ${override.worldId}` : "",
    override?.mood && override.mood !== "auto" ? `Lighting Mood: ${override.mood}` : "",
    `Blocking: ${scene.blockingSummary.join(" | ") || "Standard ensemble groove"}`,
    scene.takesSummary.length ? `Directed Takes: ${scene.takesSummary.join(" | ")}` : "",
    `Lyrics/Dialogue: ${scene.lines.map((l) => `${l.speaker}: "${l.text}"`).join(" / ") || "(Instrumental)"}`,
    `Image Prompt: ${scene.imagePrompt}`,
    `I2V Motion Prompt: ${scene.motionPrompt}`,
    `Refs:\n${cleanAnchors.join("\n")}`,
    `Bookend Guard: ${scene.bookendRule}`,
  ]
    .filter(Boolean)
    .join("\n");

  const seekOrWatch = (sec: number) => {
    useStageDirector.getState().setVariableStageEnabled(true);
    useStageDirector.getState().setPreviewSceneKey(`${spec.id}:${scene.index}`);
    if (onSeekStageSec) {
      onSeekStageSec(Math.max(0, sec - LEAD_IN));
    } else {
      window.location.href = `${spec.watchUrl}&scene=${encodeURIComponent(scene.title)}`;
    }
  };

  return (
    <article className="rounded-2xl border border-[#d7c8b2] bg-[#faf7f1] text-[#1c1410] shadow-sm overflow-hidden print:break-inside-avoid">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dfd2be] bg-[#f2eadc] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-[#1c1410] px-2 py-0.5 font-mono text-xs font-bold text-[#faf7f1]">
            {scene.code}
          </span>
          <h3 className="font-serif text-lg font-bold tracking-tight text-[#1c1410] m-0">
            {scene.title}
          </h3>
          <span className="font-mono text-xs text-[#6d5946]">
            {scene.barsLabel} · {fmtTime(scene.startSec)}–{fmtTime(scene.endSec)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SceneVariableStageControls
            songId={spec.id}
            sceneIndex={scene.index}
            onChanged={() => seekOrWatch(scene.startSec)}
          />
          {onSnapScene && (
            <button
              type="button"
              disabled={snapping}
              onClick={() => onSnapScene(scene)}
              className="inline-flex items-center gap-1 rounded-full border border-[#8c6438] bg-[#fffaf0] px-2.5 py-0.5 text-[11px] font-semibold text-[#5a3d20] hover:bg-[#f2e5cf] disabled:opacity-50 cursor-pointer"
            >
              <Camera className="size-3 text-[#9a442b]" />
              {snapping ? "Snapping…" : "Snap 3D Strip"}
            </button>
          )}
          <button
            type="button"
            data-sb-tone="teal"
            onClick={() => seekOrWatch(scene.startSec)}
            className="inline-flex items-center gap-1 rounded-full bg-[#203832] px-2.5 py-0.5 text-[11px] font-semibold text-[#e9fff7] hover:bg-[#2b4d45] cursor-pointer"
          >
            <Play className="size-3 fill-current" />
            {onSeekStageSec ? "Jump 3D Stage" : "Watch beat"}
          </button>
          <CopyPromptButton text={fullBrief} label="Copy Brief" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
        <div className="flex flex-col gap-3">
          {effectiveHeroUrl ? (
            <div className="overflow-hidden rounded-xl border border-[#cbb99f] bg-[#160d0a] shadow-inner">
              <div className="flex items-center justify-between border-b border-[#3a2519] bg-[#1e120d] px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[#d9c3a5]">
                <span>
                  {scene.code} Hero Keyframe ({captured?.heroUrl ? "Live 3D Capture" : "Three.js Stage Plate"})
                </span>
                <span>{effectiveCamera} · {scene.lensSpec.split("·")[0]}</span>
              </div>
              <StoryboardImg
                src={effectiveHeroUrl}
                alt={`${spec.title} ${scene.code} hero`}
                fallbackText={scene.code}
                className="aspect-video w-full object-cover"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-[#cbb99f] bg-white p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#6d5946]">
                <span>Stage Blueprint &amp; Linked Cast Composition</span>
                <span className="font-mono">{spec.locationRef.setId}</span>
              </div>
              <div className="relative overflow-hidden rounded-lg border border-[#dfd2be] bg-[#170d0a]">
                <StoryboardImg
                  src={spec.locationRef.plateUrl}
                  alt={spec.locationRef.label}
                  fallbackText={spec.locationRef.setId}
                  className="aspect-video w-full object-cover opacity-80"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-3 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-2 pt-8">
                  {spec.castRefs.slice(0, 5).map((c) => (
                    <div key={c.castId} className="flex flex-col items-center gap-0.5">
                      <StoryboardImg
                        src={c.portraitUrl}
                        alt={c.displayName}
                        fallbackText={c.displayName.slice(0, 2).toUpperCase()}
                        className="h-14 w-14 rounded-lg border border-white/25 bg-black/50 object-contain p-0.5"
                        loading="lazy"
                      />
                      <span className="font-mono text-[10px] font-semibold text-[#fff3dd]">{c.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-[#d7c8b2] bg-[#1b1411] p-2.5 text-[#f6ead7]">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-[#cdb79a]">
              <span className="inline-flex items-center gap-1">
                <Film className="size-3 text-[#e3bd7f]" />
                35mm 4-Panel Action Strip
              </span>
              <span>{scene.lensSpec}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {scene.stripTimestampsSec.map((t, i) => {
                const thumbUrl = captured?.frames[i] ?? scene.stripFrameUrls?.[i];
                return (
                  <button
                    key={`${scene.code}-f-${i}`}
                    type="button"
                    onClick={() => seekOrWatch(t)}
                    className="group relative overflow-hidden rounded border border-[#4a3629] bg-[#2a1d17] text-left hover:border-[#e3bd7f] cursor-pointer"
                  >
                    {thumbUrl ? (
                      <StoryboardImg
                        src={thumbUrl}
                        alt={`${scene.code} frame ${i + 1}`}
                        fallbackText={`F${i + 1}`}
                        className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-[#231712] px-1 text-center font-mono text-[10px] text-[#e3bd7f]">
                        Beat @{fmtTime(t)}
                      </div>
                    )}
                    <div className="flex items-center justify-between bg-[#140e0b] px-1.5 py-0.5 font-mono text-[9px] text-[#d9c3a5]">
                      <span>F{i + 1}</span>
                      <span>{fmtTime(t)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-[#d8cbb8] bg-white p-3">
            <div className="mb-2 flex items-center justify-between border-b border-[#efe5d6] pb-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#6e5641]">
                Timed Lyrics &amp; Stage Blocking
              </span>
              {scene.takesSummary.length > 0 && (
                <span className="font-mono text-[10px] font-semibold text-[#097364]">
                  {scene.takesSummary.join(" · ")}
                </span>
              )}
            </div>
            {scene.lines.length > 0 ? (
              <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">
                {scene.lines.map((ln, li) => (
                  <li key={`${scene.code}-l-${li}`} className="flex items-baseline gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => seekOrWatch(ln.timeSec)}
                      className="shrink-0 rounded bg-[#f4ede1] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#6e5641] hover:bg-[#e7dac6] cursor-pointer"
                    >
                      {fmtTime(ln.timeSec)}
                    </button>
                    <span className="shrink-0 font-bold" style={{ color: ln.color }}>
                      {ln.speaker}:
                    </span>
                    <span className="font-serif text-[13px] text-[#1c1410]">{ln.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-xs italic text-[#7a6450]">Instrumental / stage transition cue.</p>
            )}
            {scene.blockingSummary.length > 0 && (
              <p className="mt-2 mb-0 border-t border-[#f1e9db] pt-1.5 font-mono text-[10px] text-[#5e4b3a]">
                Moves: {scene.blockingSummary.join(" · ")}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-[#d8cbb8] bg-white p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#8c432b]">
                <Sparkles className="size-3" />
                Image / Keyframe Prompt
              </span>
              <CopyPromptButton text={scene.imagePrompt} />
            </div>
            <p className="m-0 text-xs leading-relaxed text-[#2d2119]">{scene.imagePrompt}</p>
          </div>

          <div className="rounded-xl border border-[#d8cbb8] bg-white p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#097364]">
                <Clapperboard className="size-3" />
                I2V / EffectCraft Motion Prompt
              </span>
              <CopyPromptButton text={scene.motionPrompt} />
            </div>
            <p className="m-0 text-xs leading-relaxed text-[#2d2119]">{scene.motionPrompt}</p>
          </div>

          <div className="rounded-xl border border-[#d8cbb8] bg-[#f5efe4] p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#584534]">
                @Ref Anchors &amp; Continuity Guard
              </span>
              <CopyPromptButton text={cleanAnchors.join("\n")} label="Copy Refs" />
            </div>
            <p className="m-0 mb-1.5 text-[11px] font-semibold text-[#3f3023]">{scene.bookendRule}</p>
            <div className="flex flex-col gap-0.5 font-mono text-[10px] text-[#695645] break-all">
              {cleanAnchors.map((r) => (
                <div key={r}>{r}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
