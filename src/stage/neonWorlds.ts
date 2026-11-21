/**
 * Pure, engine-free state & choreography helpers for Neon's Beyond-the-Studio
 * Multi-Lens Performance Worlds (`Take Two`).
 *
 * Keeps zero imports from `@chimera/wasm/engine.ts` so it is safe across live
 * stage, Remotion `<Player>`, headless MP4 export, and Bun unit tests.
 */
import type { Piece } from "../choir/music.ts";
import { speechDetailForTrack, type KaraokeWordSpan } from "../choir/bubbles.ts";
import { neonScore, neonTake } from "./NeonSolo.tsx";

export type NeonWorldLens = "diorama" | "signal" | "zine" | "vinyl" | "archive";

export interface NeonLensOption {
  readonly id: NeonWorldLens;
  readonly label: string;
  readonly shortLabel: string;
  readonly tagline: string;
}

export const NEON_WORLD_LENSES: readonly NeonLensOption[] = [
  {
    id: "diorama",
    label: "1. Folded Diorama",
    shortLabel: "Diorama 3D",
    tagline: "Three.js 3D pop-up cardstock storybook with real tabletop shadows",
  },
  {
    id: "signal",
    label: "2. Optical Signal",
    shortLabel: "Signal",
    tagline: "Cyan & rose vocal harmonics in infinite optical space",
  },
  {
    id: "zine",
    label: "3. Kinetic Zine",
    shortLabel: "Zine",
    tagline: "Editorial print spread where typography becomes the stage",
  },
  {
    id: "vinyl",
    label: "4. Vinyl Turntable",
    shortLabel: "Vinyl LP",
    tagline: "Spinning record platter & sleeve where Neon rides the groove",
  },
  {
    id: "archive",
    label: "5. Archive 404",
    shortLabel: "Archive 404",
    tagline: "Original Studio 404 glass repair bay (legacy lens)",
  },
] as const;

export interface NeonPlateInfo {
  readonly index: number;
  readonly numberLabel: string;
  readonly sectionName: string;
  readonly chapterEyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly promptHint: string;
  readonly stampLeft: string;
  readonly stampRight: string;
  readonly startBeat: number;
  readonly endBeat: number;
}

export const NEON_PLATES: readonly NeonPlateInfo[] = [
  {
    index: 0,
    numberLabel: "01 / 04",
    sectionName: "after hours",
    chapterEyebrow: "PLATE 01 / 04 · AFTER HOURS",
    title: "Left Tube, Right Tube",
    subtitle: "Glass Observatory",
    promptHint: "Drag the paper table to tilt, or tap the hanging rose bell.",
    stampLeft: "GLASS OBSERVATORY",
    stampRight: "PLATE 01",
    startBeat: 0,
    endBeat: 16,
  },
  {
    index: 1,
    numberLabel: "02 / 04",
    sectionName: "twin take",
    chapterEyebrow: "PLATE 02 / 04 · TWIN TAKE",
    title: "Two Lights, One Song",
    subtitle: "The Lantern Arch",
    promptHint: "Cyan and rose filaments braid across the folded spine.",
    stampLeft: "LANTERN ARCH",
    stampRight: "PLATE 02",
    startBeat: 16,
    endBeat: 32,
  },
  {
    index: 2,
    numberLabel: "03 / 04",
    sectionName: "the dark",
    chapterEyebrow: "PLATE 03 / 04 · THE DARK",
    title: "Still Here in the Dark",
    subtitle: "Midnight Filament",
    promptHint: "The lamps dim down—an answering rose ring finds the saved place.",
    stampLeft: "MIDNIGHT FOLD",
    stampRight: "PLATE 03",
    startBeat: 32,
    endBeat: 48,
  },
  {
    index: 3,
    numberLabel: "04 / 04",
    sectionName: "reprise",
    chapterEyebrow: "PLATE 04 / 04 · REPRISE",
    title: "All Night Long",
    subtitle: "Shared Horizon",
    promptHint: "Both rings burn steady across the open songbook.",
    stampLeft: "SHARED HORIZON",
    stampRight: "PLATE 04",
    startBeat: 48,
    endBeat: 64,
  },
] as const;

/**
 * S-27 Hybrid FMV-Cel Manifest contract: allows Flow-generated keyed FMV cel
 * atlases to plug directly into Neon's worlds with zero layout or code churn.
 */
export interface NeonFmvClipSpec {
  readonly atlasUrl: string;
  readonly cols: number;
  readonly rows: number;
  readonly frames: number;
  readonly fps: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface NeonFmvRigManifest {
  readonly character: string;
  readonly version: number;
  readonly actions: Partial<Record<NeonFmvActionKey, NeonFmvClipSpec>>;
}

export type NeonFmvActionKey =
  | "idle"
  | "roll"
  | "sing-left"
  | "sing-right"
  | "dark-listen"
  | "offer"
  | "reprise";

export interface ResolvedNeonCel {
  readonly atlasUrl: string;
  readonly cols: number;
  readonly rows: number;
  readonly frame: number;
  readonly action: NeonFmvActionKey;
  readonly source: "fmv-manifest" | "solo-atlas";
}

export interface NeonWorldState {
  readonly plateIndex: number;
  readonly plate: NeonPlateInfo;
  readonly scorePlateIndex: number;
  readonly plateTurn: number;
  readonly take: ReturnType<typeof neonTake>;
  readonly cyan: number;
  readonly rose: number;
  readonly darkness: number;
  readonly sharedLight: number;
  readonly vocalLevel: number;
  readonly singing: boolean;
  readonly mouthOpen: boolean;
  readonly lineText: string;
  readonly words: readonly KaraokeWordSpan[];
  readonly lineProgress: number;
  readonly neonPathPct: number;
  readonly autoTiltX: number;
  readonly autoTiltY: number;
  readonly cel: ResolvedNeonCel;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function resolveSectionBounds(piece: Piece): readonly NeonPlateInfo[] {
  const sections = piece.sections ?? [];
  if (sections.length === 0) return NEON_PLATES;
  const after = sections.find((s) => s.name === "after hours")?.beat ?? 0;
  const twinFirst = sections.find((s) => s.name === "twin take")?.beat ?? 16;
  const dark = sections.find((s) => s.name === "the dark")?.beat ?? 32;
  const twinLast = sections.filter((s) => s.name === "twin take").at(-1)?.beat;
  const reprise = twinLast !== undefined && twinLast > dark ? twinLast : dark + 16;
  const total = Math.max(piece.beats || 64, reprise + 16);
  return [
    { ...NEON_PLATES[0], startBeat: after, endBeat: twinFirst },
    { ...NEON_PLATES[1], startBeat: twinFirst, endBeat: dark },
    { ...NEON_PLATES[2], startBeat: dark, endBeat: reprise },
    { ...NEON_PLATES[3], startBeat: reprise, endBeat: total },
  ];
}

export function resolveNeonFmvFrame(
  take: ReturnType<typeof neonTake>,
  plateIndex: number,
  beat: number,
  mouthOpen: boolean,
  manifest?: NeonFmvRigManifest | null,
): ResolvedNeonCel {
  const action: NeonFmvActionKey = take.rolling
    ? "roll"
    : take.dark
      ? "dark-listen"
      : plateIndex === 3
        ? "reprise"
        : plateIndex === 1
          ? "offer"
          : take.cyan >= take.rose
            ? "sing-left"
            : "sing-right";

  const clip = manifest?.actions[action] ?? manifest?.actions.idle;
  if (clip && clip.frames > 0) {
    const frame = take.rolling
      ? Math.min(clip.frames - 1, Math.round((take.frame / 47) * (clip.frames - 1)))
      : Math.floor(Math.max(0, beat * 2)) % clip.frames;
    return {
      atlasUrl: clip.atlasUrl,
      cols: clip.cols,
      rows: clip.rows,
      frame,
      action,
      source: "fmv-manifest",
    };
  }

  const pinAction = take.rolling
    ? "snag"
    : take.dark
      ? "listen"
      : plateIndex === 3
        ? "acknowledge"
        : plateIndex === 1
          ? "answer"
          : take.cyan >= take.rose
            ? "answer"
            : "acknowledge";

  const pinFrame = take.rolling
    ? Math.min(47, Math.max(0, take.frame))
    : Math.min(47, Math.round((take.frame / 95) * 47));

  return {
    atlasUrl: `/rehearsal/pins/neon/${pinAction}.webp`,
    cols: 8,
    rows: 6,
    frame: pinFrame,
    action,
    source: "solo-atlas",
  };
}

export function computeNeonWorldState(params: {
  piece: Piece;
  beat: number;
  timeSec: number;
  performing: boolean;
  still: boolean;
  singing: boolean;
  level: number;
  mouthOpen: boolean;
  plateOverride?: number | null;
  fmvManifest?: NeonFmvRigManifest | null;
}): NeonWorldState {
  const {
    piece,
    beat,
    timeSec,
    performing,
    still,
    singing,
    level,
    mouthOpen,
    plateOverride = null,
    fmvManifest = null,
  } = params;

  const plates = resolveSectionBounds(piece);
  const effectiveBeat = performing ? Math.max(0, beat) : 0;
  let scorePlateIndex = 0;
  for (let i = plates.length - 1; i >= 0; i--) {
    if (effectiveBeat >= plates[i].startBeat - 0.001) {
      scorePlateIndex = i;
      break;
    }
  }

  const plateIndex =
    plateOverride !== null && plateOverride >= 0 && plateOverride < plates.length
      ? plateOverride
      : scorePlateIndex;
  const plate = plates[plateIndex];

  // Smooth plate-turn reveal (0 -> 1 over the first 1.6 beats of each chapter)
  const intoPlate = Math.max(0, effectiveBeat - plate.startBeat);
  const plateTurn = still || !performing ? 1 : clamp01(intoPlate / 1.6);

  const score = neonScore(piece);
  const take = neonTake(score, effectiveBeat, performing, still);

  const track = piece.tracks.find((t) => t.id === "vee");
  const detail = performing ? speechDetailForTrack(piece, track, effectiveBeat) : null;
  const words = detail?.words ?? [];
  const lineText = detail?.text ?? (plateIndex === 2 ? "The sign goes dark — still here" : "My left tube hums · My right comes late");
  const lineProgress = detail
    ? clamp01((effectiveBeat - detail.startBeat) / Math.max(0.25, detail.endBeat - detail.startBeat))
    : 0;

  const lower = lineText.toLowerCase();
  const leftBias = lower.includes("left") ? 1.25 : lower.includes("right") ? 0.55 : 1;
  const rightBias = lower.includes("right") ? 1.25 : lower.includes("left") ? 0.55 : 1;
  const darkActive = plateIndex === 2 || take.dark;
  const darkness = darkActive ? (plateIndex === 2 && !take.dark ? 0.85 : 0.92) : 0;
  const sharedLight = plateIndex === 3 ? 1 : take.sharedLight ? 1 : take.partnerLight;

  const vocalEnergy = singing ? Math.max(0.28, level) : 0.14;
  const cyan = clamp01((take.cyan * 0.65 + vocalEnergy * 0.55) * leftBias * (1 - darkness * 0.58) + sharedLight * 0.25);
  const rose = clamp01((take.rose * 0.65 + vocalEnergy * 0.55) * rightBias * (1 - darkness * 0.42) + sharedLight * 0.35);

  // Map Neon's rolling travel cleanly onto the folded diorama path (26%..56%)
  const travelNorm = clamp01((take.x - 28) / 15);
  const neonPathPct = 28 + travelNorm * 24;

  // Motion-doctrine deterministic progression (zero idle sine wobble)
  const actSpan = Math.max(4, plate.endBeat - plate.startBeat);
  const actNorm = clamp01((effectiveBeat - plate.startBeat) / actSpan);
  const autoTiltX = 14 - actNorm * 2;
  const autoTiltY = -4 + actNorm * 8;

  const cel = resolveNeonFmvFrame(take, plateIndex, effectiveBeat, mouthOpen, fmvManifest);

  return {
    plateIndex,
    plate,
    scorePlateIndex,
    plateTurn,
    take,
    cyan,
    rose,
    darkness,
    sharedLight,
    vocalLevel: vocalEnergy,
    singing,
    mouthOpen,
    lineText,
    words,
    lineProgress,
    neonPathPct,
    autoTiltX,
    autoTiltY,
    cel,
  };
}
