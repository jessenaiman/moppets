/**
 * Shared Per-Scene Variable Stage Director Store.
 *
 * Bridges the restored Illustrated Storyboard (`SongbookStoryboardView`) and the live 3D Three.js
 * stage (`LiveStage3D` + `StudioWorldRig`) so every scene in a song can direct:
 *  - Its 3D Stage World (`theater` | `cosmic` | `playroom`)
 *  - Its 3D Lighting & Zone Mood (`auto` | `standby-dark` | `warm-spotlight` | `arena-lit` | `phosphor-booth` | `encore-surge`)
 *  - Its Camera Shot preset (`wide` | `two-shot` | `closeup` | `low-angle` | `reaction`)
 *  - Live-captured 3D WebGL storyboard hero & 4-panel strip frames (`data:image/webp` / `png`) for ANY of the 68 songs.
 */
import { create } from "zustand";
import type { CinemaShotPreset, Piece } from "../choir/music.ts";
import type { StageWorldId } from "./stageWorlds.ts";

export type StageLightingMood =
  | "auto"
  | "standby-dark"
  | "warm-spotlight"
  | "arena-lit"
  | "phosphor-booth"
  | "encore-surge";

export interface StageLightingMoodOption {
  readonly id: StageLightingMood;
  readonly label: string;
  readonly shortLabel: string;
  readonly tagline: string;
}

export const STAGE_LIGHTING_MOODS: readonly StageLightingMoodOption[] = [
  { id: "auto", label: "Auto (Follows Score)", shortLabel: "Auto", tagline: "Automatically shifts lighting across verses, choruses, bridges, and finales." },
  { id: "standby-dark", label: "Standby Dark", shortLabel: "Standby", tagline: "Dim studio bay with a single tight warm pin-spot on the active singer." },
  { id: "warm-spotlight", label: "Warm Spotlight", shortLabel: "Spot", tagline: "Intimate warm tungsten spotlight pool with gentle rim accents." },
  { id: "arena-lit", label: "Arena Lit", shortLabel: "Arena", tagline: "Full overhead Fresnel rig, bright CRT racks, golden floor pads, and ensemble riser." },
  { id: "phosphor-booth", label: "Phosphor Booth", shortLabel: "Phosphor", tagline: "Moody cyan CRT glow and intimate close framing for bridges and quiet moments." },
  { id: "encore-surge", label: "Encore Surge", shortLabel: "Encore", tagline: "Luminous tungsten peak with wide volumetric shafts and golden dust motes." },
];

export interface SceneStageOverride {
  readonly worldId?: StageWorldId;
  readonly mood?: StageLightingMood;
  readonly cameraPreset?: CinemaShotPreset;
}

export interface CapturedSceneStrip {
  readonly heroUrl?: string;
  readonly frames: readonly (string | null)[];
  readonly capturedAtMs: number;
}

interface StageDirectorState {
  /** Keyed by `${songId}:${sceneIndex}` */
  overrides: Readonly<Record<string, SceneStageOverride>>;
  /** Live-captured 3D stage frames keyed by `${songId}:${sceneIndex}` */
  captures: Readonly<Record<string, CapturedSceneStrip>>;
  /** When true, LiveStage3D automatically follows per-section variable stage cues during playback */
  variableStageEnabled: boolean;
  /** Optional transient preview lock while scrubbing inside Storyboard */
  previewSceneKey: string | null;

  setSceneOverride: (songId: string, sceneIndex: number, patch: Partial<SceneStageOverride>) => void;
  clearSceneOverride: (songId: string, sceneIndex: number) => void;
  setSceneCapture: (songId: string, sceneIndex: number, capture: CapturedSceneStrip) => void;
  setVariableStageEnabled: (enabled: boolean) => void;
  setPreviewSceneKey: (key: string | null) => void;
}

const keyOf = (songId: string, sceneIndex: number) => `${songId}:${sceneIndex}`;

export const useStageDirector = create<StageDirectorState>((set) => ({
  overrides: {},
  captures: {},
  variableStageEnabled: true,
  previewSceneKey: null,

  setSceneOverride: (songId, sceneIndex, patch) =>
    set((st) => {
      const k = keyOf(songId, sceneIndex);
      const prev = st.overrides[k] ?? {};
      return {
        overrides: {
          ...st.overrides,
          [k]: { ...prev, ...patch },
        },
      };
    }),

  clearSceneOverride: (songId, sceneIndex) =>
    set((st) => {
      const k = keyOf(songId, sceneIndex);
      if (!(k in st.overrides)) return st;
      const next = { ...st.overrides };
      delete next[k];
      return { overrides: next };
    }),

  setSceneCapture: (songId, sceneIndex, capture) =>
    set((st) => ({
      captures: {
        ...st.captures,
        [keyOf(songId, sceneIndex)]: capture,
      },
    })),

  setVariableStageEnabled: (enabled) => set({ variableStageEnabled: enabled }),
  setPreviewSceneKey: (previewSceneKey) => set({ previewSceneKey }),
}));

/** Infer a natural variable-stage lighting mood from any song section name when mood === "auto". */
export function defaultMoodForSection(sectionName: string | undefined, totalActors: number): Exclude<StageLightingMood, "auto"> {
  const n = (sectionName ?? "").toLowerCase();
  if (!n) return totalActors > 2 ? "arena-lit" : "warm-spotlight";
  if (n.includes("intro") || n.includes("standby") || n.includes("blackout") || n.includes("dark")) {
    return "standby-dark";
  }
  if (n.includes("bridge") || n.includes("quiet") || n.includes("breakdown") || n.includes("whisper") || n.includes("solo")) {
    return "phosphor-booth";
  }
  if (n.includes("finale") || n.includes("outro") || n.includes("curtain") || n.includes("encore")) {
    return "encore-surge";
  }
  if (n.includes("chorus") || n.includes("choir") || n.includes("all")) {
    return "arena-lit";
  }
  return totalActors > 2 ? "warm-spotlight" : "warm-spotlight";
}

/** Resolve the active scene index & section name at `beat` for any `Piece`. */
export function resolveActiveSceneForPiece(
  piece: Piece,
  beat: number,
): { sceneIndex: number; sectionName: string } {
  const sections = (piece.sections ?? []).slice().sort((a, b) => a.beat - b.beat);
  if (sections.length === 0) {
    return { sceneIndex: 1, sectionName: piece.title };
  }
  let idx = 0;
  for (let i = 0; i < sections.length; i++) {
    if (beat >= sections[i]!.beat - 0.05) idx = i;
  }
  return { sceneIndex: idx + 1, sectionName: sections[idx]!.name };
}
