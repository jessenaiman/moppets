/**
 * Five transformative 3D Stage Worlds for Studio 404 (`S-54` / `S-61`):
 *  - `theater`: Studio 404 Broadcast Soundstage (bare concrete/hardwood, oak riser, CRT racks, 3D Fresnel shafts)
 *  - `caravan`: Meadow Caravan 3D (corrugated kraft wagon, rocking cardstock horse, sunset dome, scrolling hills)
 *  - `storybook`: Pop-Up Storybook 3D (curved open hardcover, vertex-curled page turns, folded cardstock gatehouse)
 *  - `cosmic`: Cosmic Observatory / Starlight Drift (spherical nebula dome, stepped obsidian terrace, astrolabe)
 *  - `playroom`: Toybox Soundstage / Kinetic Arcade (3D corner pegboard room, sunlit window beams, birch riser)
 *
 * Pure and engine-free so UI, Three.js stage, and Web Audio acoustics share one source of truth.
 */

export type StageWorldId = "theater" | "caravan" | "storybook" | "cosmic" | "playroom";

export interface StageLightingProfile {
  readonly keyColor: readonly [number, number, number];
  readonly keyStrength: number;
  readonly shadowTint: readonly [number, number, number];
  readonly shadowStrength: number;
  readonly rimLeftColor: readonly [number, number, number];
  readonly rimRightColor: readonly [number, number, number];
  readonly rimStrength: number;
  readonly ambientBounce: readonly [number, number, number];
  readonly crtGlowBoost: number;
  readonly spotColorHex: string;
  readonly accentColorHex: string;
  readonly backgroundHex: string;
}

export interface StagePhysicsProfile {
  /** World gravity (stage world units/sec^2; negative = down). */
  readonly gravity: number;
  /** Default jump launch impulse (units/sec). */
  readonly jumpVelocity: number;
  /** Prop bounce restitution (0..1). */
  readonly bounceRestitution: number;
  /** Horizontal prop damping per second. */
  readonly propDrag: number;
  /** Prop ambient float lift (cosmic zero-G drift). */
  readonly propFloatStrength: number;
}

export interface StageAcousticProfile {
  readonly label: string;
  readonly rt60Sec: number;
  readonly wetMix: number;
  readonly preDelayMs: number;
  readonly dampHz: number;
  readonly warmthDb: number;
  readonly airDb: number;
  readonly slapbackMs: number;
  readonly slapbackGain: number;
  readonly stereoSpread: number;
}

export interface StageWorldSpec {
  readonly id: StageWorldId;
  readonly label: string;
  readonly shortLabel: string;
  readonly tagline: string;
  readonly acousticBadge: string;
  readonly lighting: StageLightingProfile;
  readonly physics: StagePhysicsProfile;
  readonly acoustics: StageAcousticProfile;
}

export const STAGE_WORLDS: Readonly<Record<StageWorldId, StageWorldSpec>> = {
  theater: {
    id: "theater",
    label: "Studio 404 Theater",
    shortLabel: "Theater",
    tagline: "Warm tungsten fresnels, velvet drapes, glowing floor beat pads & timber hall acoustics.",
    acousticBadge: "Hall Reverb · 1.15s",
    lighting: {
      keyColor: [1.08, 0.95, 0.80],
      keyStrength: 0.72,
      shadowTint: [0.36, 0.19, 0.24],
      shadowStrength: 0.34,
      rimLeftColor: [1.0, 0.78, 0.44],
      rimRightColor: [1.0, 0.73, 0.38],
      rimStrength: 0.82,
      ambientBounce: [0.22, 0.13, 0.10],
      crtGlowBoost: 1.0,
      spotColorHex: "#ffcf86",
      accentColorHex: "#e3bd7f",
      backgroundHex: "#140a0e",
    },
    physics: {
      gravity: -16.5,
      jumpVelocity: 5.6,
      bounceRestitution: 0.68,
      propDrag: 0.92,
      propFloatStrength: 0.0,
    },
    acoustics: {
      label: "Warm Velvet Theater Hall",
      rt60Sec: 1.15,
      wetMix: 0.24,
      preDelayMs: 18,
      dampHz: 4600,
      warmthDb: 1.4,
      airDb: 0.5,
      slapbackMs: 34,
      slapbackGain: 0.12,
      stereoSpread: 0.78,
    },
  },
  caravan: {
    id: "caravan",
    label: "Meadow Caravan 3D",
    shortLabel: "Caravan",
    tagline: "Corrugated kraft parade wagon, rocking cardstock horse, sunset dome & scrolling hills.",
    acousticBadge: "Open Meadow · 0.65s",
    lighting: {
      keyColor: [1.14, 0.96, 0.72],
      keyStrength: 0.76,
      shadowTint: [0.38, 0.22, 0.28],
      shadowStrength: 0.28,
      rimLeftColor: [1.0, 0.80, 0.42],
      rimRightColor: [0.98, 0.56, 0.42],
      rimStrength: 0.85,
      ambientBounce: [0.24, 0.16, 0.10],
      crtGlowBoost: 0.92,
      spotColorHex: "#ffd98a",
      accentColorHex: "#f4b95a",
      backgroundHex: "#1e1218",
    },
    physics: {
      gravity: -17.2,
      jumpVelocity: 5.8,
      bounceRestitution: 0.72,
      propDrag: 0.93,
      propFloatStrength: 0.0,
    },
    acoustics: {
      label: "Golden-Hour Open Meadow",
      rt60Sec: 0.65,
      wetMix: 0.18,
      preDelayMs: 12,
      dampHz: 5800,
      warmthDb: 1.0,
      airDb: 1.5,
      slapbackMs: 42,
      slapbackGain: 0.14,
      stereoSpread: 0.88,
    },
  },
  storybook: {
    id: "storybook",
    label: "Pop-Up Storybook 3D",
    shortLabel: "Storybook",
    tagline: "Open crimson hardcover, curved rag pages, vertex-curled page turns & folded cardstock gatehouse.",
    acousticBadge: "Study Table · 0.55s",
    lighting: {
      keyColor: [1.08, 1.00, 0.86],
      keyStrength: 0.74,
      shadowTint: [0.30, 0.26, 0.28],
      shadowStrength: 0.24,
      rimLeftColor: [0.96, 0.84, 0.54],
      rimRightColor: [0.44, 0.90, 0.94],
      rimStrength: 0.78,
      ambientBounce: [0.24, 0.20, 0.14],
      crtGlowBoost: 1.08,
      spotColorHex: "#ffe6a6",
      accentColorHex: "#5cebf7",
      backgroundHex: "#201712",
    },
    physics: {
      gravity: -16.8,
      jumpVelocity: 5.5,
      bounceRestitution: 0.65,
      propDrag: 0.94,
      propFloatStrength: 0.0,
    },
    acoustics: {
      label: "Warm Walnut Study Room",
      rt60Sec: 0.55,
      wetMix: 0.16,
      preDelayMs: 10,
      dampHz: 5400,
      warmthDb: 1.2,
      airDb: 1.0,
      slapbackMs: 28,
      slapbackGain: 0.12,
      stereoSpread: 0.72,
    },
  },
  cosmic: {
    id: "cosmic",
    label: "Cosmic Observatory",
    shortLabel: "Cosmic",
    tagline: "Starlight nebula dome, orbiting sound orbs, low-gravity leaps & wide space shimmer.",
    acousticBadge: "Space Reverb · 3.1s",
    lighting: {
      keyColor: [0.84, 0.96, 1.12],
      keyStrength: 0.68,
      shadowTint: [0.16, 0.14, 0.38],
      shadowStrength: 0.44,
      rimLeftColor: [0.38, 0.94, 1.0],
      rimRightColor: [0.84, 0.48, 1.0],
      rimStrength: 1.05,
      ambientBounce: [0.10, 0.18, 0.32],
      crtGlowBoost: 1.38,
      spotColorHex: "#7ee7ff",
      accentColorHex: "#9b7cff",
      backgroundHex: "#060816",
    },
    physics: {
      gravity: -8.6,
      jumpVelocity: 4.9,
      bounceRestitution: 0.88,
      propDrag: 0.985,
      propFloatStrength: 1.0,
    },
    acoustics: {
      label: "Deep Space Shimmer",
      rt60Sec: 3.1,
      wetMix: 0.36,
      preDelayMs: 36,
      dampHz: 7800,
      warmthDb: -0.6,
      airDb: 2.2,
      slapbackMs: 92,
      slapbackGain: 0.16,
      stereoSpread: 1.0,
    },
  },
  playroom: {
    id: "playroom",
    label: "Toybox Soundstage",
    shortLabel: "Playroom",
    tagline: "Sunlit birch workshop, springy xylophone tiles, bouncy felt ball & punchy close room.",
    acousticBadge: "Punchy Room · 0.45s",
    lighting: {
      keyColor: [1.05, 1.02, 0.94],
      keyStrength: 0.78,
      shadowTint: [0.32, 0.28, 0.34],
      shadowStrength: 0.22,
      rimLeftColor: [1.0, 0.86, 0.56],
      rimRightColor: [0.46, 0.92, 0.84],
      rimStrength: 0.68,
      ambientBounce: [0.24, 0.20, 0.15],
      crtGlowBoost: 0.86,
      spotColorHex: "#ffe6a8",
      accentColorHex: "#ff7e67",
      backgroundHex: "#241914",
    },
    physics: {
      gravity: -19.0,
      jumpVelocity: 6.3,
      bounceRestitution: 0.82,
      propDrag: 0.94,
      propFloatStrength: 0.0,
    },
    acoustics: {
      label: "Bright Playful Toybox Room",
      rt60Sec: 0.45,
      wetMix: 0.16,
      preDelayMs: 9,
      dampHz: 6400,
      warmthDb: 0.6,
      airDb: 1.4,
      slapbackMs: 26,
      slapbackGain: 0.18,
      stereoSpread: 0.62,
    },
  },
};

export const STAGE_WORLD_LIST: readonly StageWorldSpec[] = [
  STAGE_WORLDS.theater,
  STAGE_WORLDS.caravan,
  STAGE_WORLDS.storybook,
  STAGE_WORLDS.cosmic,
  STAGE_WORLDS.playroom,
];

export function isStageWorldId(id?: string | null): id is StageWorldId {
  return (
    id === "theater" ||
    id === "caravan" ||
    id === "storybook" ||
    id === "cosmic" ||
    id === "playroom"
  );
}

export function resolveStageWorld(id?: string | null): StageWorldSpec {
  if (isStageWorldId(id)) {
    return STAGE_WORLDS[id];
  }
  return STAGE_WORLDS.theater;
}
