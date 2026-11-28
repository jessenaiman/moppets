/**
 * Pure Three.js-free Stage Surface Heightfield & XZ Collision Resolver (`S-53`):
 *  - `getSurfaceSampleAt(x, z, ctx)` resolves exact floor, Studio 404 beveled oak riser,
 *    reactive beat-pad, Playroom xylophone tile, and tilted Cosmic lunar-disc surface heights
 *    + surface normals, with an optional `customSurface` hook for future stage decks (Caravan/Storybook).
 *  - `resolveStageCollisions(positions, ctx)` prevents downstage performers from stepping inside
 *    the oak riser, clamps riser band members cleanly within the riser footprint, keeps actors clear
 *    of the broadcast mic stand & CRT studio racks, and gently resolves inter-actor XZ overlaps.
 */
import type { StagePropState } from "./stageAutopilot.ts";
import type { StageWorldId } from "./stageWorlds.ts";

/** Exact top surface Y of the beveled Studio 404 oak riser (`riserDeck` center 0.25 + height 0.06 / 2). */
export const STUDIO_RISER_TOP_Y = 0.28;
/** Elevated oak riser top Y for 8-cast scenes (`>= 4` downstage + `>= 4` riser) clearing downstage sightlines cleanly. */
export const STUDIO_RISER_TALL_TOP_Y = 0.56;
/** Low beveled birch play-stage riser top Y for Playroom world when `showRiser` is active. */
export const PLAYROOM_RISER_TOP_Y = 0.14;
/** Center Z of the upstage Studio 404 beveled oak riser (`z = -2.10..-0.66`). */
export const STUDIO_RISER_CENTER_Z = -1.38;
/** Half-depth of the upstage Studio 404 beveled oak riser deck (`1.44 * 0.5`). */
export const STUDIO_RISER_HALF_D = 0.72;

export type StageSurfaceId = "floor" | "riser" | "pad" | "xylo" | "disc" | "wagon" | "book";

export interface SurfaceSample {
  readonly y: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly surfaceId: StageSurfaceId;
}

export interface StageSurfaceContext {
  readonly worldId: StageWorldId;
  readonly showRiser: boolean;
  readonly riserWidth: number;
  readonly riserTopY: number;
  readonly props: readonly StagePropState[];
  readonly customSurface?: (x: number, z: number) => SurfaceSample | null;
}

export interface StageActorXZ {
  x: number;
  z: number;
  readonly onRiser: boolean;
}

export interface StageCollisionContext {
  readonly worldId: StageWorldId;
  readonly showRiser: boolean;
  readonly riserWidth: number;
  readonly micPos?: { readonly x: number; readonly z: number } | null;
  readonly totalCount?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const FLOOR_SAMPLE: SurfaceSample = {
  y: 0,
  normalX: 0,
  normalY: 1,
  normalZ: 0,
  surfaceId: "floor",
};

/** Resolve exact Studio 404 non-contact broadcast mic XZ position so collisions match the 3D stand. */
export function resolveStudioMicPosition(params: {
  readonly showRiser: boolean;
  readonly riserWidth: number;
  readonly downstageCount: number;
  readonly leftmostActorX: number;
}): { readonly x: number; readonly z: number } {
  const wideEnsemble = params.downstageCount >= 4 || (params.showRiser && params.riserWidth >= 4.4);
  const x = wideEnsemble
    ? Math.min(-2.78, params.leftmostActorX - 0.86, -params.riserWidth * 0.5 - 0.24)
    : Math.min(-2.22, params.leftmostActorX - 0.82);
  const z = wideEnsemble ? -0.52 : 0.35;
  return { x, z };
}

/** Sample exact world support height & surface normal under `(x, z)` across worlds & interactive props. */
export function getSurfaceSampleAt(x: number, z: number, ctx: StageSurfaceContext): SurfaceSample {
  if (ctx.customSurface) {
    const custom = ctx.customSurface(x, z);
    if (custom) return custom;
  }

  if (ctx.worldId === "theater") {
    if (
      ctx.showRiser &&
      Math.abs(x) <= ctx.riserWidth * 0.515 &&
      z >= STUDIO_RISER_CENTER_Z - STUDIO_RISER_HALF_D &&
      z <= STUDIO_RISER_CENTER_Z + STUDIO_RISER_HALF_D
    ) {
      return {
        y: ctx.riserTopY,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        surfaceId: "riser",
      };
    }

    let bestPad: SurfaceSample | null = null;
    for (const p of ctx.props) {
      if (p.kind !== "beat-pad") continue;
      if (Math.hypot(x - p.x, z - p.z) <= p.radius * 0.92) {
        const y = Math.max(0, 0.036 * (1 - clamp(p.compression, 0, 1)));
        if (!bestPad || y > bestPad.y) {
          bestPad = { y, normalX: 0, normalY: 1, normalZ: 0, surfaceId: "pad" };
        }
      }
    }
    if (bestPad) return bestPad;
    return FLOOR_SAMPLE;
  }

  if (ctx.worldId === "playroom") {
    if (
      ctx.showRiser &&
      Math.abs(x) <= ctx.riserWidth * 0.515 &&
      z >= STUDIO_RISER_CENTER_Z - STUDIO_RISER_HALF_D &&
      z <= STUDIO_RISER_CENTER_Z + STUDIO_RISER_HALF_D
    ) {
      return {
        y: PLAYROOM_RISER_TOP_Y,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        surfaceId: "riser",
      };
    }

    let bestTile: SurfaceSample | null = null;
    for (const p of ctx.props) {
      if (p.kind !== "xylo-tile") continue;
      if (Math.abs(x - p.x) <= 0.49 && Math.abs(z - p.z) <= 0.46) {
        const y = 0.08 - clamp(p.compression, 0, 1) * 0.065;
        if (!bestTile || y > bestTile.y) {
          bestTile = { y, normalX: 0, normalY: 1, normalZ: 0, surfaceId: "xylo" };
        }
      }
    }
    if (bestTile) return bestTile;
    return FLOOR_SAMPLE;
  }

  if (ctx.worldId === "cosmic") {
    for (const p of ctx.props) {
      if (p.kind !== "lunar-disc") continue;
      if (Math.hypot(x - p.x, z - p.z) <= p.radius) {
        const sinR = Math.sin(p.rotZ);
        const cosR = Math.cos(p.rotZ);
        return {
          y: (x - p.x) * sinR,
          normalX: -sinR,
          normalY: cosR,
          normalZ: 0,
          surfaceId: "disc",
        };
      }
    }
    return FLOOR_SAMPLE;
  }

  return FLOOR_SAMPLE;
}

function pushOutOfCircle(
  actor: StageActorXZ,
  cx: number,
  cz: number,
  minRadius: number,
): void {
  const dx = actor.x - cx;
  const dz = actor.z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= minRadius) return;
  if (d < 1e-4) {
    actor.x = cx + minRadius;
    return;
  }
  const s = minRadius / d;
  actor.x = cx + dx * s;
  actor.z = cz + dz * s;
}

function enforceStageConstraints(actor: StageActorXZ, ctx: StageCollisionContext): void {
  if ((ctx.worldId === "theater" || ctx.worldId === "playroom") && ctx.showRiser) {
    if (actor.onRiser) {
      const halfW = Math.max(0.4, ctx.riserWidth * 0.48);
      actor.x = clamp(actor.x, -halfW, halfW);
      actor.z = clamp(actor.z, STUDIO_RISER_CENTER_Z - 0.52, STUDIO_RISER_CENTER_Z + 0.52);
    } else {
      actor.z = Math.max(actor.z, STUDIO_RISER_CENTER_Z + STUDIO_RISER_HALF_D + 0.22);
    }
  }
  if (ctx.worldId === "caravan") {
    if (actor.x > 1.72) {
      actor.x = clamp(actor.x, 1.92, 2.68);
      actor.z = clamp(actor.z, -0.45, 0.25);
    } else {
      actor.x = clamp(actor.x, -2.65, 1.38);
      actor.z = clamp(actor.z, -0.90, 0.62);
    }
    return;
  }
  if (ctx.worldId === "storybook") {
    actor.x = clamp(actor.x, -3.15, 3.15);
    actor.z = clamp(actor.z, -0.95, 1.85);
    return;
  }
  if (ctx.worldId === "cosmic") {
    const r = Math.hypot(actor.x, actor.z);
    if (r > 4.35) {
      const s = 4.35 / r;
      actor.x *= s;
      actor.z *= s;
    }
    return;
  }
  actor.x = clamp(actor.x, -4.1, 4.1);
  actor.z = clamp(actor.z, -3.2, 1.85);
}

/**
 * Resolve floor/riser boundaries, theater mic & CRT rack clearances, and gentle inter-actor XZ separation
 * so performers never hang off the oak riser or clip through props/ensemble mates during blocking cues.
 */
export function resolveStageCollisions<T extends StageActorXZ>(
  positions: readonly T[],
  ctx: StageCollisionContext,
): T[] {
  const out = positions.map((p) => ({ ...p }));
  const total = ctx.totalCount ?? out.length;
  const minSep =
    ctx.worldId === "caravan"
      ? total <= 4
        ? 0.62
        : 0.46
      : total <= 6
        ? 0.68
        : 0.54;
  const micRadius = 0.44;
  const rackRadius = 0.62;

  for (let pass = 0; pass < 3; pass++) {
    // 1. Inter-actor separation
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= minSep) continue;
        const push = (minSep - d) * 0.5;
        if (d < 1e-4) {
          a.x -= push;
          b.x += push;
        } else {
          const nx = dx / d;
          const nz = dz / d;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }

    // 2. World obstacle clearances + riser/deck boundaries
    for (const actor of out) {
      if (ctx.worldId === "theater") {
        if (ctx.micPos && (!actor.onRiser || !ctx.showRiser)) {
          pushOutOfCircle(actor, ctx.micPos.x, ctx.micPos.z, micRadius);
        }
        pushOutOfCircle(actor, -3.35, -2.75, rackRadius);
        pushOutOfCircle(actor, 3.35, -2.75, rackRadius);
      } else if (ctx.worldId === "storybook") {
        // Keep performers clear of the upstage center Lantern Gatehouse
        pushOutOfCircle(actor, 0, -1.65, 1.32);
      } else if (ctx.worldId === "cosmic") {
        // Keep performers clear of rear brass telescope & orrery pillars
        pushOutOfCircle(actor, -3.45, -3.1, 0.72);
        pushOutOfCircle(actor, 3.45, -3.1, 0.72);
      }
      enforceStageConstraints(actor, ctx);
    }
  }

  return out;
}
