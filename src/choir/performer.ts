/**
 * Unified, engine-free OO Performer model (`S-29` / `S-46`).
 *
 * Resolves Character identity, CHIMERA voice/physics presets, accent palette, and
 * polymorphic avatar frames directly from `public/cast/manifest.json` (`castManifest.ts`)
 * and declarative per-song casting (`songCasting.ts`) with ZERO hardcoded per-character branches.
 */
import type { MoppetArtic, MoppetSource, MoppetVoice } from "./voices.ts";
import { STUDIO_404_CAST } from "./studio404.ts";
import {
  collectCastAssetUrls,
  getCastCharacter,
  resolveManifestCel,
  type ActiveTakeState,
} from "./castManifest.ts";
import { getSongCastSpec, resolveSongCastId } from "./songCasting.ts";

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
  readonly anchorY?: number;
}

export interface PerformerIdentity {
  readonly id: string;
  readonly artKey: string;
  readonly name: string;
  readonly role: string;
  readonly color: string;
  readonly accentB: string;
  readonly scaleFactor?: number;
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

/**
 * Canonical Bible identity lookup driven purely by `songCasting.ts` + `castManifest.ts`.
 * Zero per-song or per-character `if` branches.
 */
export function resolvePerformerIdentity(
  voice: { id: string; name: string; role?: string; color: string },
  studio404: boolean,
  songTitle?: string,
): PerformerIdentity {
  const artKey = resolveSongCastId(voice.id, studio404, songTitle);
  const manifestChar = studio404 ? getCastCharacter(artKey) : undefined;
  const s404 = studio404 ? STUDIO_404_CAST[voice.id] : undefined;
  const displayOverride = studio404 ? getSongCastSpec(songTitle)?.voiceDisplayOverrides?.[voice.id] : undefined;

  return {
    id: voice.id,
    artKey: manifestChar?.id ?? artKey,
    name: displayOverride?.name ?? manifestChar?.displayName ?? s404?.name ?? voice.name,
    role: displayOverride?.role ?? manifestChar?.role ?? s404?.role ?? voice.role ?? "CHIMERA performer",
    color: manifestChar?.color ?? s404?.color ?? voice.color,
    accentB: manifestChar?.accentB ?? "#e3bd7f",
    scaleFactor: manifestChar?.scaleFactor ?? 1,
  };
}

/** Select an authored FMV clip when an external manifest is supplied. */
export function fmvCel(
  manifest: CharacterFmvManifest | null | undefined,
  pose: PerformerPoseInput,
  timeSec: number,
  plateIndex: number,
  mouthOpen: boolean,
  still: boolean,
): PerformerAvatarCel | null {
  if (!manifest) return null;
  const actionKey = pose.singing
    ? plateIndex >= 3
      ? "reprise"
      : mouthOpen
        ? "sing-left"
        : "sing-right"
    : "idle";

  const actions = manifest.actions;
  const fallback = pose.singing ? "sing" : "idle";
  const action = actions[actionKey] ? actionKey : fallback;
  const clip = actions[action];
  if (!clip) return null;
  return {
    atlasUrl: clip.atlasUrl,
    cols: clip.cols,
    rows: clip.rows,
    frame: still ? 0 : Math.floor(Math.max(0, timeSec) * clip.fps) % clip.frames,
    action,
    source: "fmv-manifest",
    anchorY: clip.anchorY,
  };
}

/**
 * Polymorphic manifest-driven avatar frame resolution for ANY performer:
 *   1. External FMV manifest (if explicitly provided)
 *   2. Compiled Character Bible manifest (`public/cast/manifest.json`: baked transparent WebP cel atlases,
 *      48-frame pin/rig atlases, directed EffectCraft takes)
 *   3. Workshop sprite-pair fallback (only for non-Studio-404 legacy workshop mode)
 */
export function resolvePerformerCel(
  artKey: string,
  pose: PerformerPoseInput,
  beat: number,
  timeSec: number,
  plateIndex: number,
  mouthOpen: boolean,
  manifest?: CharacterFmvManifest | null,
  still = false,
  activeTake?: ActiveTakeState | null,
): PerformerAvatarCel {
  const fmv = fmvCel(manifest, pose, timeSec, plateIndex, mouthOpen, still);
  if (fmv) return fmv;

  const compiled = resolveManifestCel(artKey, pose, beat, timeSec, plateIndex, mouthOpen, still, activeTake);
  if (compiled) return compiled;

  const stateName = mouthOpen || (pose.singing && pose.level > 0.14) ? "sing" : "rest";
  return {
    atlasUrl: `/rehearsal/img/${artKey}-${stateName}.webp`,
    cols: 1,
    rows: 1,
    frame: 0,
    action: stateName,
    source: "sprite-pair",
    anchorY: 0.95,
  };
}

/** Collect every texture URL (multiplane rig WebPs + all baked/pin atlases) for delayRender() preloading. */
export function performerAtlasUrls(artKey: string, _hasCurtainCall = false): string[] {
  const compiled = collectCastAssetUrls(artKey);
  if (compiled.length > 0) return compiled;
  return [`/rehearsal/img/${artKey}-rest.webp`, `/rehearsal/img/${artKey}-sing.webp`];
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
    artic: { larynx: 0.08, velum: 0.04, root: 0.08, epilarynx: 0.22, ventricular: 0 },
    source: { tension: 0.54, brightness: 0.34, roughness: 0.04, breathiness: 0.1, pressure: 7.4, glide: 0.055, vibratoRate: 6.0 },
    vibrato: 12,
  },
  {
    id: "tuvan",
    label: "Tuvan Throat (Sygyt)",
    tagline: "Strong false-fold & epilarynx ring for overtone singing",
    size: 1.08,
    body: { female: 0, child: 0 },
    artic: { larynx: -0.75, velum: 0.04, root: -0.3, epilarynx: 0.65, ventricular: 0.55 },
    source: { tension: 0.66, brightness: 0.48, roughness: 0.32, breathiness: 0.06, pressure: 8.2, glide: 0.05, vibratoRate: 5.4 },
    vibrato: 6,
  },
  {
    id: "songbird",
    label: "Bestiary · Songbird",
    tagline: "Small bright airway with rapid trill (above phonation cliff)",
    size: 1.0,
    body: { female: 0.45, child: 0.85 },
    artic: { larynx: 0.85, velum: 0.02, root: 0.25, epilarynx: 0.35, ventricular: 0 },
    source: { tension: 0.6, brightness: 0.46, roughness: 0.03, breathiness: 0.12, pressure: 7.4, glide: 0.045, vibratoRate: 7.2 },
    vibrato: 24,
  },
  {
    id: "seal",
    label: "Bestiary · Seal Bark",
    tagline: "Open nasal resonance + gravelly folds",
    size: 1.15,
    body: { female: 0.15, child: 0.1 },
    artic: { larynx: -0.5, velum: 0.28, root: -0.35, epilarynx: 0.35, ventricular: 0.35 },
    source: { tension: 0.48, brightness: 0.26, roughness: 0.42, breathiness: 0.18, pressure: 8.0, glide: 0.055, vibratoRate: 5.5 },
    vibrato: 8,
  },
  {
    id: "alligator",
    label: "Bestiary · Alligator Bellow",
    tagline: "Giant low-larynx sub-bass rumble",
    size: 1.48,
    body: { female: 0, child: 0 },
    artic: { larynx: -1.1, velum: 0.08, root: -0.45, epilarynx: 0.22, ventricular: 0.52 },
    source: { tension: 0.36, brightness: 0.16, roughness: 0.46, breathiness: 0.2, pressure: 8.4, glide: 0.06, vibratoRate: 4.8 },
    vibrato: 6,
  },
  {
    id: "elephant",
    label: "Bestiary · Elephant Trumpet",
    tagline: "Giant resonant brassy horn",
    size: 1.44,
    body: { female: 0.1, child: 0 },
    artic: { larynx: -0.3, velum: 0.3, root: 0.15, epilarynx: 0.55, ventricular: 0.22 },
    source: { tension: 0.64, brightness: 0.44, roughness: 0.2, breathiness: 0.1, pressure: 8.4, glide: 0.06, vibratoRate: 5.6 },
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
