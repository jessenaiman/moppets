import { useAudio } from "../audio/audio";
import foundTiming from "../choir/found-timing.json";
import { Player, type PlayerRef } from "@remotion/player";
import { memo, useEffect, useRef, type RefObject } from "react";
import { compositionDimensions, totalDurationFrames, type MoppetVideoProps } from "../choir/videoProject";
import { MoppetComposition } from "../remotion/MoppetComposition";

/**
 * Pure Remotion <Player> host: holds zero playback clock state and attaches zero
 * playhead listeners. Sibling TransportAndStaff owns all playhead UI and staff sync.
 */
export const PlayerShell = memo(function PlayerShell({
  project,
  playerRef,
  initialFrame,
}: {
  project: MoppetVideoProps;
  playerRef: RefObject<PlayerRef | null>;
  initialFrame?: number;
}) {
  const renders = useRef(0);
  renders.current += 1;

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.setVolume(useAudio.getState().volume);
    return useAudio.subscribe((next, previous) => {
      if (next.volume !== previous.volume) player.setVolume(next.volume);
    });
  }, [playerRef]);

  const { width, height } = compositionDimensions(project.aspect);
  return (
    <div data-player-shell="native" data-renders={renders.current}>
      <Player
        ref={playerRef}
        component={MoppetComposition}
        inputProps={project}
        fps={project.fps}
        durationInFrames={totalDurationFrames(project)}
        initialFrame={initialFrame}
        compositionWidth={width}
        compositionHeight={height}
        moveToBeginningWhenEnded={false}
        style={{ width: "100%" }}
      />
    </div>
  );
});

// Exact ffprobe durations (seconds) of the five published MP3 masters in public/rehearsal/audio/.
const MASTER_DURATIONS_SEC: Record<string, number> = {
  "borrowed-light": 31.0,
  found: 178.391313,
  line: 36.555563,
  "right-on-cue": 46.0,
  "take-two": 45.081646,
};

export function publishedMaster(lesson: string, project: MoppetVideoProps): MoppetVideoProps {
  const duration = MASTER_DURATIONS_SEC[lesson];
  if (duration === undefined) return project;
  return {
    ...project,
    audioUrl: `/rehearsal/audio/${lesson}.mp3`,
    stageDurationSec: Math.ceil(duration * project.fps) / project.fps,
    vocalTiming: lesson === "found" ? foundTiming : undefined,
  };
}
