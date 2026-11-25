import type { PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMoppet } from "../choir/store";
import { buildVideoProject, totalDurationFrames, type MoppetVideoProps } from "../choir/videoProject";
import { beatSeconds, LEAD_IN } from "../choir/timeline";
import { exportWav } from "../choir/ensemble";
import { useAudio } from "../audio/audio";
import { PlayerShell, publishedMaster } from "./PlayerShell";
import { TransportAndStaff } from "./TransportAndStaff";
import { buildCatalog } from "./SongNavigator";

function LivePerformance({ id }: { id: string }) {
  const piece = useMoppet((s) => s.piece);
  const lesson = useMoppet((s) => s.lesson);
  const recordedPiece = useMoppet((s) => s.recordedPiece);
  const voices = useMoppet((s) => s.voices);
  const studio = useMoppet((s) => s.studio404);
  const playerRef = useRef<PlayerRef>(null);
  const [mix, setMix] = useState<Pick<MoppetVideoProps, "audioUrl" | "vocalTiming" | "stageDurationSec">>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    useMoppet.getState().setLesson(id);
  }, [id]);

  useEffect(
    () => () => {
      if (mix?.audioUrl) URL.revokeObjectURL(mix.audioUrl);
    },
    [mix],
  );

  const project = useMemo(() => {
    const video = buildVideoProject(piece, voices, studio);
    video.intro.enabled = false;
    video.outro.enabled = false;
    return mix ? { ...video, ...mix } : recordedPiece === piece ? publishedMaster(id, video) : video;
  }, [piece, voices, studio, id, recordedPiece, mix]);

  const prepare = async () => {
    setBusy(true);
    setMessage("");
    try {
      const out = await exportWav(useAudio.getState().start);
      if (useMoppet.getState().piece !== piece) return;
      setMix({
        audioUrl: URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: "audio/wav" })),
        stageDurationSec: out.durationSec,
        vocalTiming: out.vocalTiming,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare audio.");
    } finally {
      setBusy(false);
    }
  };

  if (lesson !== id) return null;
  const sceneName = new URLSearchParams(window.location.search).get("scene");
  const scene = sceneName && piece.sections?.find((section) => section.name === sceneName);
  const initialFrame = scene
    ? Math.min(totalDurationFrames(project) - 1, Math.ceil((LEAD_IN + beatSeconds(piece) * scene.beat) * project.fps))
    : 0;

  return (
    <>
      <PlayerShell project={project} playerRef={playerRef} initialFrame={initialFrame} />
      <TransportAndStaff project={project} playerRef={playerRef} prepare={() => void prepare()} busy={busy} />
      {busy && <p role="status">Preparing audio…</p>}
      {message && <p role="alert">{message}</p>}
    </>
  );
}

export function ScreeningRoom({ id }: { id: string }) {
  const catalog = useMemo(() => buildCatalog(true), []);
  const act = catalog.find((entry) => entry.id === id) ?? catalog.find((entry) => entry.id === "take-two")!;

  return (
    <main className="min-h-screen bg-[#17110f] px-3 py-4 text-[#fff4df] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-3 flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold">{act.title}</h1>
          <div className="flex gap-2 text-sm underline">
            <a className="p-2" href="?cast">
              Cast
            </a>
            <a className="p-2" href={`?act=${act.id}`}>
              Rehearse this act
            </a>
          </div>
        </header>
        <LivePerformance key={act.id} id={act.id} />
        <nav aria-label="Animated performances" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {catalog.map((item) => (
            <a
              key={item.id}
              href={`?watch=${item.id}`}
              aria-current={item.id === act.id ? "page" : undefined}
              className="rounded-md border border-[#775846] px-3 py-2 aria-[current=page]:border-[#70d7b8] aria-[current=page]:bg-[#263c32]"
            >
              <strong className="block">{item.title}</strong>
            </a>
          ))}
        </nav>
      </div>
    </main>
  );
}
