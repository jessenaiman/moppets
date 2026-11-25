import React from "react";
import { Composition, Folder, type CalculateMetadataFunction } from "remotion";
import { MoppetComposition } from "./MoppetComposition.tsx";
import { BenchPack, cycleLength } from "../rehearsal/BenchPack.tsx";
import { CastExposure, exposureCatalog } from "../rehearsal/CastExposure.tsx";
import { ActionStrip } from "../rehearsal/NeonActions.tsx";
import {
  compositionDimensions,
  DEFAULT_VIDEO_PROPS,
  totalDurationFrames,
  type MoppetVideoProps,
} from "../choir/videoProject.ts";

const calculateMetadata: CalculateMetadataFunction<MoppetVideoProps> = ({ props }) => {
  const dims = compositionDimensions(props.aspect);
  return {
    width: dims.width,
    height: dims.height,
    fps: Math.max(1, props.fps || 30),
    durationInFrames: totalDurationFrames(props),
  };
};

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Stage">
      <Composition
        id="MoppetVideo"
        component={MoppetComposition}
        fps={30}
        width={1920}
        height={1080}
        durationInFrames={300}
        defaultProps={DEFAULT_VIDEO_PROPS}
        calculateMetadata={calculateMetadata}
      />
    </Folder>
    <Folder name="Rigs">
      <Composition
        id="Cue-Bench-Pack"
        component={BenchPack}
        width={1280}
        height={720}
        fps={24}
        durationInFrames={2 * cycleLength}
      />
      <Composition
        id="Neon-Actions"
        component={ActionStrip}
        width={820}
        height={680}
        fps={24}
        durationInFrames={720}
        defaultProps={{ review: true }}
      />
    </Folder>
    <Folder name="Studies">
      {exposureCatalog.map((study) => (
        <Composition
          key={study.id}
          id={study.id}
          component={CastExposure}
          width={960}
          height={720}
          fps={24}
          durationInFrames={study.count * study.hold}
          defaultProps={{ study }}
        />
      ))}
    </Folder>
  </>
);
