import type { PlayerRef } from "@remotion/player";
import { useEffect, useState, type RefObject } from "react";
import { beatSeconds, LEAD_IN } from "../choir/timeline";
import { totalDurationFrames, videoFrameLayout, type MoppetVideoProps } from "../choir/videoProject";
import { MusicRack } from "./MusicRack";

/**
 * Sibling playback controls + authored MIDI/ChoirScore staff follower.
 * Subscribes to <Player> frameupdate events here so PlayerShell never re-renders during playback.
 */
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
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const { fps, introFrames } = videoFrameLayout(project);
  const duration = totalDurationFrames(project);
  const seconds = Math.max(0, (frame - introFrames) / fps);

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

  // Explicit user-initiated scrub / section jump only (never called from a playback loop).
  const userJumpToFrame = (target: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.pause();
    player.seekTo(Math.max(0, Math.min(duration - 1, target)));
  };

  const sections = project.piece?.sections;
  const secondsPerBeat = project.piece ? beatSeconds(project.piece) : 0;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3 bg-black px-3 py-2">
        <button
          type="button"
          className="rounded border px-3 py-1"
          disabled={busy}
          onClick={() => (project.audioUrl || !prepare ? playerRef.current?.toggle() : prepare())}
        >
          {playing ? "Pause" : project.audioUrl || !prepare ? "Play" : "Prepare audio"}
        </button>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={duration - 1}
          value={frame}
          aria-label="Seek performance"
          onChange={(e) => userJumpToFrame(Number(e.target.value))}
        />
        <output>
          {(frame / fps).toFixed(1)} / {(duration / fps).toFixed(1)} s
        </output>
      </div>
      {sections && sections.length > 1 && (
        <nav aria-label="Rehearsal scenes" className="flex flex-wrap gap-1 py-2">
          {sections.map((section, i) => (
            <button
              key={`${section.beat}-${i}`}
              type="button"
              className="rounded px-2 py-1 text-xs capitalize"
              onClick={() => userJumpToFrame(introFrames + Math.ceil((LEAD_IN + section.beat * secondsPerBeat) * fps))}
            >
              {section.name}
            </button>
          ))}
        </nav>
      )}
      <MusicRack
        timeSec={seconds}
        playing={playing}
        onSeek={(time) => userJumpToFrame(introFrames + Math.round(time * fps))}
      />
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
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const update = () => setFrame(player.getCurrentFrame());
    update();
    player.addEventListener("frameupdate", update);
    player.addEventListener("seeked", update);
    return () => {
      player.removeEventListener("frameupdate", update);
      player.removeEventListener("seeked", update);
    };
  }, [playerRef]);
  return children(frame / fps);
}
