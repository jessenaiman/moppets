import React from "react";
import { Composition, registerRoot, type CalculateMetadataFunction, type CompositionProps } from "remotion";
import { MoppetComposition } from "./MoppetComposition.tsx";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MoppetCompProps = CompositionProps<any, MoppetVideoProps>;

export const RemotionRoot: React.FC = () =>
  React.createElement(Composition as React.ComponentType<MoppetCompProps>, {
    id: "MoppetVideo",
    component: MoppetComposition,
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    defaultProps: DEFAULT_VIDEO_PROPS,
    calculateMetadata,
  });

registerRoot(RemotionRoot);
