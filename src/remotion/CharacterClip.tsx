/**
 * Remotion individual character clip player: mounts real `@remotion/media` `<Video>` alpha WebM loops
 * (`idle`, `sing`, `belt`, `chuckle`) inside frame-accurate `<Sequence>` segments compiled from MIDI & score state.
 */
import ribbonTake from "../../moppets/tabby/clips/ribbon-and-felt.webm";
import React, { useMemo } from "react";
import { Html5Video, Sequence, useCurrentFrame, useRemotionEnvironment, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import type { Piece } from "../choir/music.ts";
import { buildCharacterClipSegments, type CharacterClipManifest } from "../choir/clipTimeline.ts";

export interface CharacterClipProps {
  manifest: CharacterClipManifest;
  piece: Piece;
  voiceId: string;
  stageDurationSec: number;
  resolveAsset: (path: string) => string;
  style?: React.CSSProperties;
}

/** Tabby's recorded 31-second puppet performance follows the score tempo. */
export function RibbonPerformance({bpm}: {bpm: number}) {
  const {isPlayer} = useRemotionEnvironment();
  const clip = {src:ribbonTake, muted:true, playbackRate:bpm/112, style:{
    width:"100%", height:"100%", objectFit:"contain" as const,
  }};
  return <span className="sprite sc-clip-sprite" data-performance="ribbon-and-felt">
    {isPlayer ? <Html5Video {...clip} playsInline pauseWhenBuffering={false}/> : <Video {...clip}/>}
  </span>;
}

export const CharacterClip: React.FC<CharacterClipProps> = ({
  manifest,
  piece,
  voiceId,
  stageDurationSec,
  resolveAsset,
  style,
}) => {
  const { fps } = useVideoConfig();

  const segments = useMemo(
    () => buildCharacterClipSegments(piece, voiceId, fps, stageDurationSec),
    [piece, voiceId, fps, stageDurationSec],
  );

  const frame = useCurrentFrame();
  const { isPlayer } = useRemotionEnvironment();
  const seg = segments.find(s => frame >= s.startFrame && frame < s.startFrame + s.durationInFrames);
  if (!seg) return null;
  const clip = { src: resolveAsset(manifest.clips[seg.kind]), loop: true, muted: true, playbackRate: seg.playbackRate, style: { width: "100%", height: "100%", display: "block", pointerEvents: "none", objectFit: "contain" } as React.CSSProperties };
  return (
    <span className="sprite sc-clip-sprite" style={{ ...style, backgroundImage: "none" }} aria-hidden="true">
      <Sequence key={seg.startFrame} from={seg.startFrame} durationInFrames={seg.durationInFrames} layout="none">
        {isPlayer ? <Html5Video {...clip} pauseWhenBuffering={false}/> : <Video {...clip} objectFit="contain"/>}
      </Sequence>
    </span>
  );
};
