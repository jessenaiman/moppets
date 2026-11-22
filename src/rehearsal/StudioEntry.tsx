import { Composition, registerRoot } from "remotion";
import { BenchPack, cycleLength } from "./BenchPack";
import { CastExposure, exposureCatalog } from "./CastExposure";
import { ActionStrip } from "./NeonActions";
import { MoppetComposition } from "../remotion/MoppetComposition";
import { DEFAULT_VIDEO_PROPS, compositionDimensions, totalDurationFrames } from "../choir/videoProject";

function Root() {
  const project = DEFAULT_VIDEO_PROPS;
  const dimensions = compositionDimensions(project.aspect);
  return <>
    <Composition id="Rehearsal" component={MoppetComposition} {...dimensions} fps={project.fps}
      durationInFrames={totalDurationFrames(project)} defaultProps={project} />
    <Composition id="Cue-Bench-Pack" component={BenchPack} width={1280} height={720} fps={24}
      durationInFrames={2 * cycleLength} />
    {exposureCatalog.map(study => <Composition key={study.id} id={study.id} component={CastExposure}
      width={960} height={720} fps={24} durationInFrames={study.count * study.hold} defaultProps={{study}} />)}
    <Composition id="Neon-Actions" component={ActionStrip} width={820} height={680} fps={24}
      durationInFrames={720} defaultProps={{review:true}} />
  </>;
}
registerRoot(Root);
