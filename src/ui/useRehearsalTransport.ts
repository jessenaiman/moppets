import { useEffect, useState, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";

export function useRehearsalTransport(
  playerRef: RefObject<PlayerRef | null>,
  enabled: boolean,
  totalFrames: number,
) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const player = enabled && playerRef.current;
    if (!player) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => setFrame(detail.frame);
    const onPlay = () => { setPlaying(true); setError(""); };
    const onPause = () => { setPlaying(false); setBusy(false); };
    const onWait = () => setBusy(true);
    const onResume = () => setBusy(false);
    const onError = ({ detail }: { detail: { error: Error } }) => {
      onPause();
      setError(detail.error.message);
    };
    setFrame(player.getCurrentFrame());
    setPlaying(player.isPlaying());
    setBusy(false);
    setError("");
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    player.addEventListener("waiting", onWait);
    player.addEventListener("resume", onResume);
    player.addEventListener("error", onError);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
      player.removeEventListener("waiting", onWait);
      player.removeEventListener("resume", onResume);
      player.removeEventListener("error", onError);
    };
  }, [enabled, playerRef]);

  const seekTo = (target: number) => {
    if (!enabled) return;
    playerRef.current?.seekTo(Math.max(0, Math.min(totalFrames - 1, target)));
  };
  const reset = () => {
    if (!enabled) return;
    playerRef.current?.pause();
    seekTo(0);
  };
  return { frame, playing, busy, error, seekTo, reset };
}
