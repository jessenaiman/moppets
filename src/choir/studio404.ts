/**
 * Canonical Studio 404 persona lookup derived directly from the single Character Bible manifest
 * (`CAST_MANIFEST.characters` in `castManifest.ts`) so names, roles, and colors can never drift.
 */
import { CAST_MANIFEST, canonicalCastId } from "./castManifest.ts";

export interface Studio404Persona {
  voiceId: string;
  name: string;
  role: string;
  artKey: string;
  color: string;
}

export const STUDIO_404_CAST: Record<string, Studio404Persona> = Object.fromEntries(
  Object.values(CAST_MANIFEST.characters).map((ch) => [
    ch.id,
    {
      voiceId: ch.id,
      name: ch.displayName,
      role: ch.role,
      artKey: ch.id,
      color: ch.color,
    },
  ]),
);

export function studio404Name(voiceId: string, fallback: string): string {
  const ch = CAST_MANIFEST.characters[canonicalCastId(voiceId)];
  return ch?.displayName ?? fallback;
}

export function voicesForMode<T extends { id: string; lyrics: readonly string[] }>(
  voices: readonly T[],
  _studio404 = true,
): T[] {
  return voices as T[];
}
