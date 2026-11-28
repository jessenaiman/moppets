/**
 * Reusable Performer Rig & Isolated Mouth Contract (`D-4`, `D-6`, `D-7`, `S-4`):
 * Defines the canonical Craft-extracted mouth-only asset contract shared across all
 * Studio 404 Bible mouth families so every future performer swaps in cleanly without
 * whole-head sprite pops or crude procedural circles:
 *  - `felt-decals`: PhotoCraft feathered mouth-only WebP decals (`rest, closed, fv, ee, ah, oh, oo`)
 *    aligned to a single anchor landmark on the character's steady `rig/head.webp`.
 *  - `mechanical-jaw`: PhotoCraft discrete jaw/beak decals + CHIMERA aperture hinge rotation.
 *  - `crt-phosphor`: CHIMERA articulator-shaped phosphor mouth graphics inside a CRT faceplate.
 *
 * Pure data + deterministic modulation math — ZERO Three.js / engine imports (safe in workers & Remotion).
 */
import type { TabbyFacialState, VisemeCode } from "./visemeMapper.ts";

export type BibleMouthFamily = "felt-decals" | "mechanical-jaw" | "crt-phosphor";

export type IsolatedMouthKey = "rest" | "closed" | "fv" | "ee" | "ah" | "oh" | "oo";

export const ISOLATED_MOUTH_KEYS: readonly IsolatedMouthKey[] = [
  "rest",
  "closed",
  "fv",
  "ee",
  "ah",
  "oh",
  "oo",
] as const;

export interface IsolatedMouthPlacement {
  /** Normalized X center (`0 = left`, `1 = right`) on `headTextureUrl`. */
  readonly normCenterX: number;
  /** Normalized Y center (`0 = top`, `1 = bottom`) on `headTextureUrl`. */
  readonly normCenterY: number;
  /** Decal width as a fraction of rendered head width (`0..1`). */
  readonly widthFracOfHead: number;
  /** Native pixel aspect ratio (`width / height`) of each mouth decal. */
  readonly decalAspect: number;
  /** Z lift in world units in front of the head cutout plane. */
  readonly zOffset: number;
}

export interface PerformerIsolatedMouthContract {
  readonly characterId: string;
  readonly family: BibleMouthFamily;
  readonly headTextureUrl: string;
  readonly anicraftPilotUrl?: string;
  readonly decals: Readonly<Record<IsolatedMouthKey, string>>;
  readonly placement: IsolatedMouthPlacement;
  /** Natural eye centers on `headTextureUrl` (normalized `0..1` from top-left) for eyelid blink shutters. */
  readonly eyes?: {
    readonly leftNormX: number;
    readonly rightNormX: number;
    readonly normY: number;
  };
}

/**
 * Tabby Pilot Contract (`S-4`):
 * 7 nose-aligned 144x64 needle-felted mouth-only decals extracted natively via `photocraft-cli`
 * (`image.crop` + feathered elliptical `select.rect` + `layer.layerMask.revealSelection` + `apply`),
 * measured to sub-pixel nose alignment against `public/cast/tabby/rig/head.webp` (`329x311`, nose at `(177.4, 230.3)`).
 */
export const TABBY_ISOLATED_MOUTH_CONTRACT: PerformerIsolatedMouthContract = {
  characterId: "tabby",
  family: "felt-decals",
  headTextureUrl: "/cast/tabby/rig/head.webp",
  anicraftPilotUrl: "/cast/tabby/tabby-ribbon-pilot.anicraft",
  decals: {
    rest: "/cast/tabby/mouths/rest.webp",
    closed: "/cast/tabby/mouths/closed.webp",
    fv: "/cast/tabby/mouths/fv.webp",
    ee: "/cast/tabby/mouths/ee.webp",
    ah: "/cast/tabby/mouths/ah.webp",
    oh: "/cast/tabby/mouths/oh.webp",
    oo: "/cast/tabby/mouths/oo.webp",
  },
  placement: {
    normCenterX: 0.5334,
    normCenterY: 0.8209,
    widthFracOfHead: 0.5585,
    decalAspect: 144 / 64,
    zOffset: 0.011,
  },
  eyes: {
    leftNormX: 0.401,
    rightNormX: 0.693,
    normY: 0.629,
  },
};

export const PERFORMER_MOUTH_CONTRACTS: Readonly<Record<string, PerformerIsolatedMouthContract>> = {
  tabby: TABBY_ISOLATED_MOUTH_CONTRACT,
};

const VISEME_TO_MOUTH_KEY: Readonly<Record<VisemeCode, IsolatedMouthKey>> = {
  0: "rest",
  1: "closed",
  2: "fv",
  3: "ee",
  4: "ah",
  5: "oh",
  6: "oo",
  7: "rest", // Blink drives ONLY the eyelid shutters, never overrides the mouth!
};

export function resolveIsolatedMouthKey(viseme: VisemeCode, speaking: boolean): IsolatedMouthKey {
  if (!speaking) return "rest";
  return VISEME_TO_MOUTH_KEY[viseme] ?? "rest";
}

export interface IsolatedMouthModulation {
  readonly activeKey: IsolatedMouthKey;
  /** Subtle horizontal felt-muzzle stretch (`~0.92 .. 1.09`) driven by CHIMERA `lipWidth`, `mouthRound`, and `mouthPressure` cheek puff. */
  readonly scaleX: number;
  /** Subtle vertical jaw-drop stretch (`~0.94 .. 1.12`) driven by CHIMERA `mouthOpen` / `mouthJaw` while anchored at the nose! */
  readonly scaleY: number;
  /** Downward vertical shift (`<= 0`) in fraction of decal height so vertical stretch drops the chin while keeping the pink nose pinned! */
  readonly shiftYFrac: number;
  /** Expressive CRT eye glow multiplier from CHIMERA `browLift` (`log2(f0)`). */
  readonly eyeGlowScale: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Compute gentle continuous micro-modulation on top of the active Craft mouth decal from real
 * CHIMERA articulator channels (`mouthOpen`, `mouthWidth`, `mouthRound`, `mouthPressure`, `browLift`).
 * Keeps the pink nose landmark locked while letting sustained vowels and plosive buildups breathe organically.
 */
export function computeIsolatedMouthModulation(facial: TabbyFacialState): IsolatedMouthModulation {
  const activeKey = resolveIsolatedMouthKey(facial.viseme, facial.speaking);
  if (!facial.speaking || activeKey === "rest") {
    return {
      activeKey: "rest",
      scaleX: 1,
      scaleY: 1,
      shiftYFrac: 0,
      eyeGlowScale: 1,
    };
  }

  // Bilabial pressure (`mouthPressure` in cmH2O before /p/, /b/) creates subtle felt cheek puff!
  const cheekPuff = activeKey === "closed" ? clamp(facial.mouthPressure / 10, 0, 0.085) : 0;

  // Gentle width shaping: wide /ee/ stretches slightly outward; puckered /oo/ narrows slightly inward
  const widthBias = (clamp(facial.mouthWidth, 0, 1) - 0.5) * 0.09;
  const roundPinch = clamp(facial.mouthRound, 0, 1) * 0.055;
  const scaleX = clamp(1 + widthBias - roundPinch + cheekPuff, 0.92, 1.09);

  // Subtle vertical aperture elasticity anchored at the upper nose (y ≈ 0.194 from top of decal)
  const openDrive =
    activeKey === "closed"
      ? -0.025
      : activeKey === "fv"
        ? -0.01
        : (clamp(facial.mouthOpen, 0, 1) - 0.45) * 0.12 + clamp(facial.mouthJaw, 0, 1) * 0.04;
  const scaleY = clamp(1 + openDrive, 0.95, 1.12);
  // Shift downward by ~30% of delta height so the upper pink nose stays anchored to `rig/head.webp`!
  const shiftYFrac = -(scaleY - 1) * 0.31;

  // Subtle LED eye luminosity lift on high sung notes (`browLift` from `log2(f0)`)
  const eyeGlowScale = clamp(1 + facial.browLift * 0.14, 0.88, 1.18);

  return {
    activeKey,
    scaleX,
    scaleY,
    shiftYFrac,
    eyeGlowScale,
  };
}
