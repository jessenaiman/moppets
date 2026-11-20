import { useEffect, useRef, type CSSProperties } from "react";
import { useEnsemble } from "../choir/ensemble.ts";
import idle from "../../moppets/tabby/clips/idle.webm";
import sing from "../../moppets/tabby/clips/sing.webm";
import phraseClosed from "../../moppets/tabby/clips/ribbon-closed.webm";
import phraseOpen from "../../moppets/tabby/clips/ribbon-open.webm";
import gruffClosed from "../../moppets/gruff/clips/close-up-closed.webm";
import gruffOpen from "../../moppets/gruff/clips/close-up-open.webm";

const takes = {
  tabby: { idle, sing, closed: phraseClosed, open: phraseOpen, bpm: 112 },
  gruff: { idle: gruffClosed, sing: gruffOpen, closed: gruffClosed, open: gruffOpen, bpm: 76 },
};

interface Props {
  art: keyof typeof takes;
  solo: boolean;
  bpm: number;
  style: CSSProperties;
  onError: () => void;
}

export function SoloPuppet({ art, solo, bpm, style, onError }: Props) {
  const take = takes[art];
  const rig = useRef<HTMLSpanElement>(null);
  const status = useEnsemble(s => s.status);
  const performing = solo && (status === "playing" || status === "paused" || status === "buffering");
  const looping = !performing && art === "tabby";

  useEffect(() => {
    const players = rig.current!.querySelectorAll("video");
    const sync = () => {
      const { time, status } = useEnsemble.getState();
      const at = performing
        ? (time <= 0.4 ? time : 0.4 + (time - 0.4) * bpm / take.bpm)
        : looping ? players[0].currentTime : 0;
      for (const player of players) {
        if (player.readyState < 2) continue;
        const target = Math.min(at, player.duration - 1 / 24);
        if (Math.abs(player.currentTime - target) > 0.09) player.currentTime = target;
        player.playbackRate = performing ? bpm / take.bpm : 1;
        const playing = looping || (performing && status === "playing");
        if (playing && player.paused && !player.ended) void player.play().catch(() => {});
        if (!playing && !player.paused) player.pause();
      }
    };
    for (const player of players) player.addEventListener("loadeddata", sync);
    sync();
    const unsubscribe = useEnsemble.subscribe(sync);
    return () => {
      unsubscribe();
      for (const player of players) player.removeEventListener("loadeddata", sync);
    };
  }, [performing, looping, bpm, take]);

  return (
    <span className="sprite solo-live-rig" style={style} aria-hidden="true" ref={rig}>
      <video key={performing ? take.closed : take.idle} src={performing ? take.closed : take.idle} muted playsInline autoPlay={looping} loop={looping} preload="auto" onError={onError} />
      <video key={performing ? take.open : take.sing} src={performing ? take.open : take.sing} muted playsInline autoPlay={looping} loop={looping} preload="auto" onError={onError} />
    </span>
  );
}
