/**
 * Remotion individual character clip player: mounts real `@remotion/media` `<Video>` alpha WebM loops
 * (`idle`, `sing`, `belt`, `chuckle`) inside frame-accurate `<Sequence>` segments compiled from MIDI & score state.
 */
import React, { useMemo } from "react";
import { Sequence, useVideoConfig } from "remotion";
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

  return (
    <span className="sprite sc-clip-sprite" style={{ ...style, backgroundImage: "none" }} aria-hidden="true">
      {segments.map((seg, idx) => (
        <Sequence
          key={`${voiceId}-${seg.kind}-${seg.startFrame}-${idx}`}
          from={seg.startFrame}
          durationInFrames={seg.durationInFrames}
          layout="none"
        >
          <Video
            src={resolveAsset(manifest.clips[seg.kind])}
            loop
            muted
            playbackRate={seg.playbackRate}
            objectFit="contain"
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              pointerEvents: "none",
            }}
          />
        </Sequence>
      ))}
    </span>
  );
};
