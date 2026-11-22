import { useEffect, useRef, useState, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { useAudio } from "../audio/audio.ts";
import { pause, play, seek, stop, useEnsemble } from "../choir/ensemble.ts";

export function useRehearsalTransport(
  playerRef: RefObject<PlayerRef | null>,
  enabled: boolean,
  fps: number,
  introFrames: number,
  stageEnd: number,
  totalFrames: number,
  lesson: string,
) {
  const [frame, setFrame] = useState(0);
  const [cardPlaying, setCardPlaying] = useState(false);
  const status = useEnsemble(s => s.status);
  const card = useRef<"intro" | "outro" | null>(null);
  const shownFrame = useRef(0);
  const stageTime = (f: number) => (f - introFrames) / fps;
  const show = (target: number) => {
    const f = Math.max(0, Math.min(totalFrames - 1, target));
    shownFrame.current = f;
    setFrame(f);
    const player = playerRef.current;
    if (player && player.getCurrentFrame() !== f) player.seekTo(f);
  };
  const stopCard = () => {
    if (!card.current) return;
    card.current = null;
    setCardPlaying(false);
    playerRef.current?.pause();
  };
  const playCard = (which: "intro" | "outro", f: number) => {
    show(f);
    card.current = which;
    setCardPlaying(true);
    playerRef.current?.play();
  };

  useEffect(() => {
    if (!enabled) return;
    const player = playerRef.current;
    if (!player) return;
    const onFrame = ({detail}: {detail: {frame: number}}) => {
      if (!card.current) return;
      if (card.current === "intro" && detail.frame >= introFrames) {
        stopCard();
        show(introFrames);
        void play(useAudio.getState().start, 0);
      } else {
        shownFrame.current = detail.frame;
        setFrame(detail.frame);
      }
    };
    const unsubscribe = useEnsemble.subscribe((state, prev) => {
      if (state.status === "preparing" && prev.status !== "preparing") stopCard();
      if (state.status === "ended" && prev.status !== "ended" && stageEnd < totalFrames) {
        playCard("outro", stageEnd);
      } else if (state.status === "idle" && prev.status !== "idle" && state.time === 0) {
        stopCard();
        show(0);
      } else if (!card.current && (state.time !== prev.time || state.status === "preparing" && prev.status !== "preparing")) {
        show(Math.min(stageEnd - 1, introFrames + Math.round(state.time * fps)));
      }
    });
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("ended", stopCard);
    const state = useEnsemble.getState();
    show(state.status === "idle" ? shownFrame.current : Math.min(stageEnd - 1, introFrames + Math.round(state.time * fps)));
    return () => {
      unsubscribe();
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("ended", stopCard);
      stopCard();
    };
  }, [playerRef, enabled, fps, introFrames, stageEnd, totalFrames, lesson]);

  const seekTo = (target: number) => {
    stopCard();
    const f = Math.max(0, Math.min(totalFrames - 1, target));
    if (f >= introFrames && f < stageEnd) seek(stageTime(f));
    else if (["preparing", "rendering"].includes(useEnsemble.getState().status)) stop();
    else pause();
    show(f);
  };

  const toggle = () => {
    if (card.current) return stopCard();
    const state = useEnsemble.getState();
    if (state.status === "playing" || state.status === "buffering") return pause();
    if (state.status === "preparing" || state.status === "rendering") return stop();
    const f = shownFrame.current === totalFrames - 1 ? 0 : shownFrame.current;
    if (f < introFrames || f >= stageEnd) {
      // A title card is silent and uses Remotion's transport before/after the score.
      stop();
      // Unlock Web Audio during the tap, before the silent title card hands off to the choir.
      if (f < introFrames) void useAudio.getState().start().catch(stopCard);
      playCard(f < introFrames ? "intro" : "outro", f);
    } else {
      void play(useAudio.getState().start, stageTime(f));
    }
  };

  const reset = () => {
    stopCard();
    show(0);
  };
  const busy = status === "preparing" || status === "rendering" || status === "buffering";
  return { frame, busy, playing: cardPlaying || status === "playing", seekTo, toggle, reset };
}
