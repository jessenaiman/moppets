import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { audio, useAudio } from "../audio/audio.ts";
import { livePlaybackClock, play, pose, seek, stop, useEnsemble, useTelemetry, ensembleDebug } from "../choir/ensemble.ts";
import { bubbleForTrack, isPadOnlyText } from "../choir/bubbles.ts";
import { useController, handleControl } from "../choir/controller.ts";
import { livePose, useLive } from "../choir/live.ts";
import { makeIntroduction, type Piece } from "../choir/music.ts";
import type { Pose } from "../choir/pose.ts";
import { lessonSlug } from "../choir/stageCast.ts";
import { useMoppet } from "../choir/store.ts";
import { studio404Name } from "../choir/studio404.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import { introIds } from "../choir/voices.ts";
import { LiveStage3D } from "../stage/LiveStage3D.tsx";
import { StageClip, stageCanvasRegistry } from "../stage/recordClip.ts";
import { LiveConsole } from "./LiveConsole.tsx";
import { renderStageNotes, type FloatingNote } from "./studio/stageNoteFx.ts";
import "./moppet.css";

const beatNow = (p: Piece, seconds: number) => Math.max(0, (seconds - LEAD_IN) / beatSeconds(p));

function download(blob: Blob, name: string): void {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

interface LiveStageFrame {
  beat: number;
  timeSec: number;
  performing: boolean;
  poses: Pose[];
}

export function Stage({ cameraFollow }: { cameraFollow: boolean }) {
  const library = useMoppet((s) => s.voices);
  const selectedVoice = useMoppet((s) => s.voices[s.selected]);
  const piece = useMoppet((s) => s.piece);
  const studio404 = useMoppet((s) => s.studio404);
  const lesson = useMoppet((s) => s.lesson);
  const status = useEnsemble((s) => s.status);

  const voices = useMemo(
    () =>
      library.filter(
        (v) =>
          introIds.includes(v.id) ||
          v.id === selectedVoice.id ||
          piece.tracks.some((t) => t.id === v.id) ||
          piece.stage?.includes(v.id),
      ),
    [library, selectedVoice, piece],
  );
  const selected = voices.indexOf(selectedVoice);

  const stageRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const [stageLabel, setStageLabel] = useState("READY WHEN YOU ARE");
  const [frameState, setFrameState] = useState<LiveStageFrame>({
    beat: 0,
    timeSec: 0,
    performing: false,
    poses: [],
  });

  useEffect(() => {
    let raf = 0;
    let lastStage = "";
    let lastT = performance.now() / 1000;
    let lastEmitT = -1;
    let wasActive = true;
    let lastPerforming = false;
    const tickRef = { count: 0 };
    const notes: FloatingNote[] = [];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (now: number, dt: number) => {
      const m = useMoppet.getState();
      const e = useEnsemble.getState();
      const clock = livePlaybackClock();
      const songTime = clock.status === "playing" ? clock.timeSec : e.time;
      const performing =
        clock.status === "playing" ||
        (clock.status === "buffering" && (songTime > 0.01 || e.howPlaying === "live")) ||
        (clock.status === "paused" && songTime > 0.01);
      const beat = performing ? beatNow(m.piece, songTime) : now * 1.1;
      const poses = voices.map((v) => pose(v.id));
      const lp = !performing ? livePose() : null;
      if (lp && selected >= 0) poses[selected] = lp;

      const active: string[] = [];
      voices.forEach((v, i) => {
        if (!poses[i]?.singing) return;
        const track = m.piece.tracks.find((t) => t.id === v.id);
        const hasLyric =
          m.piece.kind === "school"
            ? Boolean(track?.events.some((ev) => !isPadOnlyText(ev.text) && beat >= ev.beat - 0.15 && beat < ev.beat + ev.beats + 0.25))
            : Boolean(
                bubbleForTrack(m.piece, track, beat) &&
                  (m.piece.kind === "skit" ||
                    track?.events.some((ev) => ev.line !== undefined && beat >= ev.beat - 0.15 && beat < ev.beat + ev.beats + 0.25)),
              );
        if (hasLyric) active.push(m.studio404 ? studio404Name(v.id, v.name) : v.name);
      });

      if (frontRef.current && stageRef.current) {
        renderStageNotes(
          frontRef.current,
          stageRef.current.clientWidth,
          stageRef.current.clientHeight,
          dt,
          now,
          still,
          m.piece,
          voices,
          poses,
          m.studio404,
          notes,
          tickRef,
        );
      }

      const liveActive = performing || Boolean(lp);
      if (lastEmitT < 0 || performing !== lastPerforming || (!liveActive && wasActive) || (liveActive && now - lastEmitT >= 1 / 12)) {
        lastEmitT = now;
        wasActive = liveActive;
        lastPerforming = performing;
        setFrameState({ beat: performing ? beat : 0, timeSec: performing ? songTime : 0, performing, poses: poses.map((p) => ({ ...p })) });
      }

      const running = e.status === "playing" || e.status === "buffering";
      if (running) {
        const names = active.length >= 6 ? "ALL TOGETHER" : active.length > 1 ? `${active.length} VOICES IN HARMONY` : active[0] ? `${active[0].toUpperCase()} IS SINGING` : "A LITTLE BREATH";
        if (names !== lastStage) {
          lastStage = names;
          setStageLabel(names);
        }
      } else if (lastStage) {
        lastStage = "";
        setStageLabel("READY WHEN YOU ARE");
      }
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now() / 1000;
      const dt = now - lastT;
      lastT = now;
      draw(now, dt);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voices, selected]);

  return (
    <div className="moppet-stage-wrap" aria-label={status === "playing" || status === "buffering" ? stageLabel : "Stage"}>
      <div className={`stage${studio404 ? " studio404" : ""}`} ref={stageRef}>
        <LiveStage3D
          piece={piece}
          voices={voices}
          studio404={studio404}
          beat={frameState.beat}
          timeSec={frameState.timeSec}
          performing={frameState.performing}
          actors={undefined}
          poses={frameState.poses.length === voices.length ? frameState.poses : undefined}
          cameraFollow={cameraFollow}
          songId={lesson}
        />
        <canvas ref={frontRef} className="stage-fx front" data-layout="overlay" aria-hidden="true" />
      </div>
    </div>
  );
}

export function MoppetRight() {
  return (
    <Suspense fallback={<p role="status">Loading rehearsal…</p>}>
      <RehearsalDesk />
    </Suspense>
  );
}

function RehearsalDesk() {
  const [recordingClip, setRecordingClip] = useState(false);
  const clipRecorderRef = useRef<StageClip | null>(null);
  const piece = useMoppet((s) => s.piece);
  const ensembleStatus = useEnsemble((s) => s.status);
  const startAudio = useAudio((s) => s.start);

  useEffect(() => {
    (window as unknown as { __choir: unknown }).__choir = {
      seek,
      play: () => play(useAudio.getState().start),
      stop,
      debug: ensembleDebug,
      ensemble: useEnsemble,
      moppet: useMoppet,
      audio: useAudio,
      telemetry: useTelemetry,
      live: useLive,
      controller: useController,
      midi: handleControl,
      makeIntroduction,
      bench: () => import("../choir/bench.ts").then((m) => m.benchChoir()),
    };
    return () => {
      clipRecorderRef.current?.cancel();
      clipRecorderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (recordingClip && ensembleStatus === "ended" && clipRecorderRef.current) {
      const active = clipRecorderRef.current;
      clipRecorderRef.current = null;
      setRecordingClip(false);
      void active
        .stop(lessonSlug(piece.title))
        .then((file) => {
          download(file, file.name);
          useEnsemble.setState({ message: `Saved clip ${file.name}` });
        })
        .catch((err) => useEnsemble.setState({ message: `Clip capture: ${err instanceof Error ? err.message : String(err)}` }));
    }
  }, [recordingClip, ensembleStatus, piece.title]);

  const toggleRecordClip = async () => {
    if (recordingClip && clipRecorderRef.current) {
      const active = clipRecorderRef.current;
      clipRecorderRef.current = null;
      setRecordingClip(false);
      try {
        const file = await active.stop(lessonSlug(piece.title));
        download(file, file.name);
        useEnsemble.setState({ message: `Saved clip ${file.name}` });
      } catch (err) {
        useEnsemble.setState({ message: `Clip capture: ${err instanceof Error ? err.message : String(err)}` });
      }
      return;
    }
    try {
      await startAudio();
      const stream = audio.recordStream();
      if (!stream) throw new Error("Audio stream unavailable for clip capture.");
      clipRecorderRef.current = new StageClip(() => stageCanvasRegistry.current, stream);
      setRecordingClip(true);
      useEnsemble.setState({ message: "Recording live stage clip… Press Save Video Clip when done." });
      const cur = useEnsemble.getState().status;
      if (cur !== "playing" && cur !== "buffering") void play(startAudio);
    } catch (err) {
      setRecordingClip(false);
      useEnsemble.setState({ message: `Clip capture: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  return (
    <div className="w-full live-console-theme">
      <LiveConsole
        stageNode={<Stage cameraFollow />}
        recordingClip={recordingClip}
        onToggleRecordClip={() => void toggleRecordClip()}
      />
    </div>
  );
}
