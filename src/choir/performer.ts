/**
 * Unified, engine-free OO Performer model (`S-29`).
 *
 * Unifies Character identity, CHIMERA voice/physics presets, accent palette, and
 * polymorphic avatar resolution (Flow FMV cel atlas -> Pin atlas -> WebP sprite pair)
 * into one single data-driven entity so NO stage world ever hardcodes a character.
 */
import type { MoppetArtic, MoppetSource, MoppetVoice } from "./voices.ts";
import { STUDIO_404_CAST } from "./studio404.ts";

export interface FmvClipSpec {
  readonly atlasUrl: string;
  readonly cols: number;
  readonly rows: number;
  readonly frames: number;
  readonly fps: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface CharacterFmvManifest {
  readonly character: string;
  readonly version: number;
  readonly actions: Partial<Record<string, FmvClipSpec>>;
}

export interface PerformerAvatarCel {
  readonly atlasUrl: string;
  readonly cols: number;
  readonly rows: number;
  readonly frame: number;
  readonly action: string;
  readonly source: "fmv-manifest" | "pin-atlas" | "sprite-pair";
}

export interface PerformerIdentity {
  readonly id: string;
  readonly artKey: string;
  readonly name: string;
  readonly role: string;
  readonly color: string;
  readonly accentB: string;
}

export interface PerformerPoseInput {
  readonly singing: boolean;
  readonly level: number;
  readonly open: number;
  readonly viseme: number;
}

export interface PerformerFrame extends PerformerIdentity {
  readonly singing: boolean;
  readonly level: number;
  readonly open: number;
  readonly mouthOpen: boolean;
  readonly viseme: number;
  readonly cel: PerformerAvatarCel;
}

/** Secondary companion accent per artKey for multi-tone lighting, waveforms & editorial spreads. */
const SECONDARY_ACCENTS: Record<string, string> = {
  neon: "#ff5e99",
  cue: "#e3bd7f",
  tabby: "#f2c15a",
  zap: "#57d3e8",
  gruff: "#e07a5f",
  watt: "#f6d55c",
  clank: "#50cfad",
  chip: "#f08c4b",
  tracking: "#57d3e8",
  hertz: "#e3bd7f",
};

/** Known pin-atlas directories available under `public/rehearsal/pins/<artKey>/`. */
const PIN_ATLAS_ACTIONS: Record<string, { rest: string; sing: string; alt: string; bow: string }> = {
  neon: { rest: "listen", sing: "answer", alt: "acknowledge", bow: "step" },
  cue: { rest: "listen", sing: "offer", alt: "cast", bow: "bow" },
};

/** Canonical artKey lookup across both legacy IDs (`vee`, `scribe`, `pip`) and direct names (`neon`, `cue`, `watt`). */
export function resolvePerformerIdentity(
  voice: { id: string; name: string; role?: string; color: string },
  studio404: boolean,
  songTitle?: string,
): PerformerIdentity {
  if (songTitle === "Borrowed Light" && voice.id === "vee") {
    return {
      id: voice.id,
      artKey: "neon",
      name: "Moonbeam",
      role: "Guest phosphor voice",
      color: "#9be7ff",
      accentB: "#ffd38a",
    };
  }
  const s404 = studio404 ? STUDIO_404_CAST[voice.id] : undefined;
  const artKey = s404?.artKey ?? voice.id;
  const color = s404?.color ?? voice.color;
  return {
    id: voice.id,
    artKey,
    name: s404?.name ?? voice.name,
    role: s404?.role ?? voice.role ?? "CHIMERA performer",
    color,
    accentB: SECONDARY_ACCENTS[artKey] ?? "#e3bd7f",
  };
}

/**
 * Polymorphic avatar frame resolution for ANY performer:
 *   1. Sliced Google Flow FMV manifest (`/rehearsal/fmv/<artKey>/manifest.json`) when available
 *   2. 48-frame pin atlas (`/rehearsal/pins/<artKey>/<action>.webp`) when available
 *   3. Clean transparent cutout sprite pair (`/rehearsal/img/<artKey>-{rest,sing}.webp`)
 */
export function resolvePerformerCel(
  artKey: string,
  pose: PerformerPoseInput,
  beat: number,
  plateIndex: number,
  mouthOpen: boolean,
  manifest?: CharacterFmvManifest | null,
): PerformerAvatarCel {
  const actionKey = pose.singing
    ? plateIndex >= 3
      ? "reprise"
      : mouthOpen
        ? "sing-left"
        : "sing-right"
    : "idle";

  // 1. Auto-upgrade to Flow FMV atlas when manifest exists
  const fmvClip =
    manifest?.actions[actionKey] ??
    manifest?.actions.sing ??
    manifest?.actions.bow ??
    manifest?.actions.idle ??
    Object.values(manifest?.actions ?? {}).find(Boolean);
  if (fmvClip && fmvClip.frames > 0) {
    const rate = pose.singing ? 2.4 : 1.2;
    const frame = Math.floor(Math.max(0, beat * rate)) % fmvClip.frames;
    return {
      atlasUrl: fmvClip.atlasUrl,
      cols: fmvClip.cols,
      rows: fmvClip.rows,
      frame,
      action: actionKey,
      source: "fmv-manifest",
    };
  }

  // 2. 48-frame pin atlas (Neon, Cue, or Tabby finale bow)
  const pins = PIN_ATLAS_ACTIONS[artKey];
  if (pins) {
    const pinAction = pose.singing
      ? plateIndex >= 3
        ? pins.bow
        : mouthOpen
          ? pins.sing
          : pins.alt
      : pins.rest;
    const frame = pose.singing ? Math.floor(Math.max(0, beat * 6)) % 48 : Math.floor(Math.max(0, beat * 2)) % 48;
    return {
      atlasUrl: `/rehearsal/pins/${artKey}/${pinAction}.webp`,
      cols: 8,
      rows: 6,
      frame,
      action: pinAction,
      source: "pin-atlas",
    };
  }

  // 3. Universal transparent rest/sing cutout WebP pair (works for Tabby, Zap, Gruff, Watt, Clank, Chip, Tracking, Hertz, etc.)
  const stateName = mouthOpen || (pose.singing && pose.level > 0.14) ? "sing" : "rest";
  return {
    atlasUrl: `/rehearsal/img/${artKey}-${stateName}.webp`,
    cols: 1,
    rows: 1,
    frame: 0,
    action: stateName,
    source: "sprite-pair",
  };
}

/**
 * CHIMERA Physics Voice Presets — extend CHIMERA's real vocal tract parameters
 * across ANY character (Tuvan overtone singing, Bestiary creature silhouettes,
 * barbershop blend, sub-bass bellow) with zero per-character code duplication.
 */
export interface ChimeraPhysicsPreset {
  readonly id: string;
  readonly label: string;
  readonly tagline: string;
  readonly size: number;
  readonly body: { female: number; child: number };
  readonly artic: Partial<MoppetArtic>;
  readonly source: Partial<MoppetSource>;
  readonly vibrato: number;
}

export const CHIMERA_VOICE_PRESETS: readonly ChimeraPhysicsPreset[] = [
  {
    id: "barbershop",
    label: "Barbershop Quartet",
    tagline: "Crisp harmonic blend with clean oral resonance",
    size: 1.0,
    body: { female: 0.25, child: 0.05 },
    artic: { larynx: 0.1, velum: 0.06, root: 0.1, epilarynx: 0.35, ventricular: 0 },
    source: { tension: 0.65, brightness: 0.72, roughness: 0.02, breathiness: 0.06, pressure: 10 },
    vibrato: 10,
  },
  {
    id: "tuvan",
    label: "Tuvan Throat (Sygyt)",
    tagline: "Strong false-fold & epilarynx ring for overtone singing",
    size: 1.08,
    body: { female: 0, child: 0 },
    artic: { larynx: -1.1, velum: 0.04, root: -0.45, epilarynx: 0.92, ventricular: 0.88 },
    source: { tension: 0.86, brightness: 0.9, roughness: 0.42, breathiness: 0.04, pressure: 11 },
    vibrato: 4,
  },
  {
    id: "songbird",
    label: "Bestiary · Songbird",
    tagline: "Tiny bright airway with rapid syrinx trill",
    size: 0.62,
    body: { female: 0.8, child: 0.95 },
    artic: { larynx: 1.5, velum: 0.02, root: 0.45, epilarynx: 0.6, ventricular: 0 },
    source: { tension: 0.82, brightness: 0.95, roughness: 0.02, breathiness: 0.12, pressure: 10, vibratoRate: 9.5 },
    vibrato: 26,
  },
  {
    id: "seal",
    label: "Bestiary · Seal Bark",
    tagline: "Open nasal tube + raspy vocal folds",
    size: 1.15,
    body: { female: 0.15, child: 0.1 },
    artic: { larynx: -0.7, velum: 1.25, root: -0.65, epilarynx: 0.5, ventricular: 0.55 },
    source: { tension: 0.52, brightness: 0.48, roughness: 0.62, breathiness: 0.22, pressure: 11 },
    vibrato: 8,
  },
  {
    id: "alligator",
    label: "Bestiary · Alligator Bellow",
    tagline: "Giant low-larynx sub-bass rumble",
    size: 1.58,
    body: { female: 0, child: 0 },
    artic: { larynx: -1.55, velum: 0.15, root: -0.8, epilarynx: 0.25, ventricular: 0.92 },
    source: { tension: 0.25, brightness: 0.18, roughness: 0.85, breathiness: 0.3, pressure: 12 },
    vibrato: 6,
  },
  {
    id: "elephant",
    label: "Bestiary · Elephant Trumpet",
    tagline: "Giant resonant nasal horn",
    size: 1.54,
    body: { female: 0.1, child: 0 },
    artic: { larynx: -0.4, velum: 1.38, root: 0.2, epilarynx: 0.9, ventricular: 0.35 },
    source: { tension: 0.92, brightness: 0.88, roughness: 0.24, breathiness: 0.08, pressure: 12 },
    vibrato: 12,
  },
] as const;

export function applyPresetToVoice(v: MoppetVoice, preset: ChimeraPhysicsPreset): void {
  v.size = preset.size;
  v.body = { ...v.body, ...preset.body };
  v.artic = { ...v.artic, ...preset.artic };
  v.source = { ...v.source, ...preset.source };
  v.vibrato = preset.vibrato;
}
