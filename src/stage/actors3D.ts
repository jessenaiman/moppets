/**
 * Unified Pure-Three.js 3-Tier Moppet Performer Engine Facade.
 * Re-exports all actor classes, types, clip utilities, and the unified `StageActorsManager`.
 */
export {
  preloadMoppetGlb,
  resolve3DClipName,
  sanitizeThreeAnimationClip,
  type PerformerUpdateInput,
  type RigPreference,
  type StageActor3D,
  type VocalArticSample,
} from "./actors/actorShared.ts";
export { GlbPerformer3D } from "./actors/glbPerformer3D.ts";
export { MultiplaneActor3D, MultiplanePerformer3D } from "./actors/multiplaneActor3D.ts";
export { AtlasPerformer3D, FmvCutoutActor3D } from "./actors/fmvCutoutActor3D.ts";
export { createStageActor3D, StageActorsManager } from "./actors/stageActorsManager.ts";
