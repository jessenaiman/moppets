/**
 * Unified Live Theater Screening Room (`?watch=<id>`, `S-4`, `D-8`):
 * Plays any Moppet performance directly on the single live `motion/react` + 2D Character Bible stage
 * with instant CHIMERA WASM `ensemble.ts` singing (zero offline WAV bounce wait)
 * plus 1-click CHIMERA `MediaRecorder` clip capture (`StageClip`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Pause, Play, Square, Video } from "lucide-react";
import { audio, useAudio } from "../audio/audio.ts";
import { play, seek, stop as stopEnsemble, useEnsemble } from "../choir/ensemble.ts";
import { lessonSlug } from "../choir/stageCast.ts";
import { useMoppet, type Lesson } from "../choir/store.ts";
import { pieceSeconds } from "../choir/timeline.ts";
import { StageClip, canRecordClip, stageCanvasRegistry } from "../stage/recordClip.ts";
import { isStageWorldId, resolveStageWorld } from "../stage/stageWorlds.ts";
import { Stage } from "./MoppetPanel.tsx";
import { buildCatalog } from "./SongNavigator.tsx";

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LiveTheaterView({ id }: { id: string }) {
  const piece = useMoppet((s) => s.piece);
  const lesson = useMoppet((s) => s.lesson);
  const status = useEnsemble((s) => s.status);
  const time = useEnsemble((s) => s.time);
  const duration = useEnsemble((s) => s.duration);
  const startAudio = useAudio((s) => s.start);
  const worldId = useAudio((s) => s.world);
  const setWorld = useAudio((s) => s.setWorld);

  const clipRef = useRef<StageClip | null>(null);
  const [recording, setRecording] = useState(false);
  const [clipNotice, setClipNotice] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("world");
    if (isStageWorldId(q)) {
      setWorld(q);
    }
  }, [setWorld]);

  useEffect(() => {
    stopEnsemble();
    useMoppet.getState().setLesson(id as Lesson);
    return () => {
      clipRef.current?.cancel();
      clipRef.current = null;
      stopEnsemble();
    };
  }, [id]);

  // Automatically finalize clip recording when song ends naturally
  useEffect(() => {
    if (recording && status === "ended" && clipRef.current) {
      const active = clipRef.current;
      clipRef.current = null;
      setRecording(false);
      void active
        .stop(lessonSlug(piece.title))
        .then((file) => {
          downloadFile(file);
          setClipNotice(`Saved ${file.name}`);
        })
        .catch((err) => setClipNotice(err instanceof Error ? err.message : String(err)));
    }
  }, [recording, status, piece.title]);

  const toggleRecordClip = async () => {
    if (recording && clipRef.current) {
      const active = clipRef.current;
      clipRef.current = null;
      setRecording(false);
      try {
        const file = await active.stop(lessonSlug(piece.title));
        downloadFile(file);
        setClipNotice(`Saved ${file.name}`);
      } catch (err) {
        setClipNotice(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    try {
      await startAudio();
      const stream = audio.recordStream();
      if (!stream) throw new Error("Audio stream unavailable for clip capture.");
      clipRef.current = new StageClip(() => stageCanvasRegistry.current, stream);
      setRecording(true);
      setClipNotice("Recording live clip…");
      if (status !== "playing" && status !== "buffering") {
        void play(startAudio);
      }
    } catch (err) {
      setRecording(false);
      setClipNotice(err instanceof Error ? err.message : String(err));
    }
  };

  if (lesson !== id) return null;
  const shown = duration || pieceSeconds(piece);
  const isPlaying = status === "playing" || status === "buffering";

  return (
    <div className="space-y-3" data-testid="screening-room-stage">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="font-mono text-xs text-[#9decd5]">
          {resolveStageWorld(worldId).label} · {resolveStageWorld(worldId).acousticBadge}
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="overflow-hidden rounded-xl border border-[#775846]/70 bg-[#0d070a] shadow-2xl"
      >
        <Stage cameraFollow />
      </motion.div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#775846]/65 bg-[#211612] px-3.5 py-2.5">
        <button
          type="button"
          data-testid="moppet-play"
          onClick={() => void play(startAudio)}
          aria-label={isPlaying ? "Pause performance" : "Play performance"}
          style={{ color: "#04140e" }}
          className="moppet-play inline-flex items-center gap-1.5 rounded-lg border border-emerald-400 bg-emerald-500 px-3.5 py-1.5 text-sm font-bold text-[#04140e] hover:bg-emerald-400 cursor-pointer"
        >
          {isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
          {isPlaying ? "Pause" : "Play Live"}
        </button>
        <button
          type="button"
          aria-label="Stop playback"
          disabled={status === "idle"}
          onClick={stopEnsemble}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-[#775846] bg-[#17110f] text-[#fff4df] disabled:opacity-40 cursor-pointer"
        >
          <Square className="size-3.5 fill-current" />
        </button>

        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <span className="font-mono text-xs text-[#d5c5b2]">{fmt(time)}</span>
          <input
            aria-label="Song position"
            type="range"
            min={0}
            max={shown}
            step={0.05}
            value={Math.min(time, shown)}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 accent-emerald-400 cursor-pointer"
          />
          <span className="font-mono text-xs text-[#d5c5b2]">{fmt(shown)}</span>
        </div>

        {canRecordClip() && (
          <button
            type="button"
            onClick={() => void toggleRecordClip()}
            aria-pressed={recording}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold cursor-pointer ${
              recording
                ? "border-rose-400 bg-rose-500/25 text-rose-100 animate-pulse"
                : "border-[#775846] bg-[#17110f] text-[#fff4df] hover:border-emerald-400/60"
            }`}
          >
            <Video className="size-3.5" />
            {recording ? "Stop & Save Clip" : "Record Clip"}
          </button>
        )}
      </div>

      {clipNotice && (
        <p role="status" className="font-mono text-xs text-[#9decd5]">
          {clipNotice}
        </p>
      )}
    </div>
  );
}

export function ScreeningRoom({ id }: { id: string }) {
  const catalog = useMemo(() => buildCatalog(true), []);
  const act = catalog.find((entry) => entry.id === id) ?? catalog.find((entry) => entry.id === "tabby-solo")!;

  return (
    <main className="min-h-screen bg-[#17110f] px-3 py-4 text-[#fff4df] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-2xl font-bold">{act.title}</h1>
          <div className="flex gap-2 text-sm underline">
            <a className="p-2" href="?cast">
              Cast
            </a>
            <a className="p-2" href={`?act=${act.id}`}>
              Open in Live Console
            </a>
          </div>
        </header>
        <LiveTheaterView key={act.id} id={act.id} />
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
