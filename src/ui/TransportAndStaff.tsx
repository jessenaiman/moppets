import type { PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState, type RefObject } from "react";
import { beatSeconds, LEAD_IN } from "../choir/timeline";
import { totalDurationFrames, videoFrameLayout, type MoppetVideoProps } from "../choir/videoProject";
import { MusicRack } from "./MusicRack";

/** Hook shared by sibling playhead controls so PlayerShell never holds frame state or re-renders. */
function usePlayerClock(playerRef: RefObject<PlayerRef | null>) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const updateFrame = () => setFrame(player.getCurrentFrame());
    const updatePlaying = () => setPlaying(player.isPlaying());
    updateFrame();
    updatePlaying();
    player.addEventListener("frameupdate", updateFrame);
    player.addEventListener("seeked", updateFrame);
    player.addEventListener("play", updatePlaying);
    player.addEventListener("pause", updatePlaying);
    player.addEventListener("ended", updatePlaying);
    return () => {
      player.removeEventListener("frameupdate", updateFrame);
      player.removeEventListener("seeked", updateFrame);
      player.removeEventListener("play", updatePlaying);
      player.removeEventListener("pause", updatePlaying);
      player.removeEventListener("ended", updatePlaying);
    };
  }, [playerRef]);

  return { frame, playing };
}

/**
 * Sibling playback transport & scene jump bar rendered directly below the 16:9 stage.
 * Auto-plays once Prepare audio resolves, and offers instant Live CHIMERA switching.
 */
export function PlayerTransport({
  project,
  playerRef,
  stageRef,
  prepare,
  busy,
  onOpenLive,
}: {
  project: MoppetVideoProps;
  playerRef: RefObject<PlayerRef | null>;
  stageRef?: RefObject<HTMLDivElement | null>;
  prepare?: () => void;
  busy?: boolean;
  onOpenLive?: () => void;
}) {
  const { frame, playing } = usePlayerClock(playerRef);
  const autoPlayAfterPrepare = useRef(false);
  const { fps, introFrames } = videoFrameLayout(project);
  const duration = totalDurationFrames(project);
  const stageSec = Math.max(0, (frame - introFrames) / fps);

  useEffect(() => {
    if (!autoPlayAfterPrepare.current || !project.audioUrl) return;
    autoPlayAfterPrepare.current = false;
    const raf = requestAnimationFrame(() => {
      const player = playerRef.current;
      if (player && !player.isPlaying()) player.play();
    });
    return () => cancelAnimationFrame(raf);
  }, [project.audioUrl, playerRef]);

  // Explicit user-initiated scrub / section jump only (never called from a playback loop).
  const userJumpToFrame = (target: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.pause();
    player.seekTo(Math.max(0, Math.min(duration - 1, target)));
  };

  const handlePrimaryClick = () => {
    if (project.audioUrl || !prepare) {
      playerRef.current?.toggle();
      return;
    }
    autoPlayAfterPrepare.current = true;
    prepare();
  };

  const toggleFullscreen = () => {
    if (!stageRef?.current) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current.requestFullscreen();
  };

  const sections = project.piece?.sections;
  const secondsPerBeat = project.piece ? beatSeconds(project.piece) : 0;

  return (
    <div className="vs-transport-wrap">
      <div className="vs-transport-bar" role="group" aria-label="Rehearsal transport">
        <button
          type="button"
          className="vs-play-btn"
          disabled={busy}
          onClick={handlePrimaryClick}
        >
          {busy ? "Preparing…" : playing ? "Pause" : project.audioUrl || !prepare ? "Play" : "Prepare & Play"}
        </button>
        {onOpenLive && (
          <button
            type="button"
            className="vs-live-btn"
            title="Play this score immediately with real-time MIDI-driven CHIMERA voices"
            onClick={onOpenLive}
          >
            Live CHIMERA
          </button>
        )}
        <input
          type="range"
          className="vs-scrubber"
          min={0}
          max={Math.max(1, duration - 1)}
          value={Math.min(frame, Math.max(0, duration - 1))}
          aria-label="Seek performance"
          onChange={(e) => userJumpToFrame(Number(e.target.value))}
        />
        <output className="vs-time-readout">
          {(frame / fps).toFixed(1)} / {(duration / fps).toFixed(1)} s
        </output>
        {stageRef && (
          <button
            type="button"
            className="vs-fs-btn"
            aria-label="Toggle fullscreen"
            onClick={toggleFullscreen}
          >
            <span aria-hidden="true">⛶</span>
          </button>
        )}
      </div>
      {sections && sections.length > 1 && (
        <nav aria-label="Rehearsal scenes" className="vs-scene-pills">
          {sections.map((section, i) => {
            const startSec = LEAD_IN + section.beat * secondsPerBeat;
            const next = sections[i + 1];
            const nextSec = next ? LEAD_IN + next.beat * secondsPerBeat : Infinity;
            const active = stageSec >= startSec - 0.05 && stageSec < nextSec - 0.05;
            return (
              <button
                key={`${section.beat}-${i}`}
                type="button"
                aria-current={active ? "step" : undefined}
                className="vs-scene-pill"
                onClick={() => userJumpToFrame(introFrames + Math.ceil(startSec * fps))}
              >
                {section.name}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

/**
 * Dedicated sibling authored-MIDI sheet music follower for the right column of Video Studio.
 * Owns 100% of its grid column so ChoirScore aligns flush with the top of the video without clipping.
 */
export function StaffFollower({
  project,
  playerRef,
}: {
  project: MoppetVideoProps;
  playerRef: RefObject<PlayerRef | null>;
}) {
  const { frame, playing } = usePlayerClock(playerRef);
  const { fps, introFrames } = videoFrameLayout(project);
  const duration = totalDurationFrames(project);
  const seconds = Math.max(0, (frame - introFrames) / fps);

  const userJumpToTime = (time: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.pause();
    player.seekTo(Math.max(0, Math.min(duration - 1, introFrames + Math.round(time * fps))));
  };

  return <MusicRack timeSec={seconds} playing={playing} onSeek={userJumpToTime} />;
}

/** Combined single-column transport + staff stack used by ScreeningRoom (?watch=). */
export function TransportAndStaff({
  project,
  playerRef,
  prepare,
  busy,
}: {
  project: MoppetVideoProps;
  playerRef: RefObject<PlayerRef | null>;
  prepare?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <PlayerTransport project={project} playerRef={playerRef} prepare={prepare} busy={busy} />
      <StaffFollower project={project} playerRef={playerRef} />
    </div>
  );
}

/** Isolated playhead subscriber for collapsible timeline UIs outside PlayerShell. */
export function PlayerPosition({
  playerRef,
  fps,
  children,
}: {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  children: (seconds: number) => React.ReactNode;
}) {
  const { frame } = usePlayerClock(playerRef);
  return children(frame / fps);
}
