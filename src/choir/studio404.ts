import { introLyrics } from "./songs.ts";
/**
 * Studio 404 canon mapping (docs/briefs/moppet-world.md) for the main React choir app.
 *
 * Keeps existing voice IDs (`vee`, `scribe`, `pip`, `clank`, `gruff`, `tabby`, `chip`) backward-
 * compatible with all 13 `songs/*.song` lead sheets and CHIMERA voice recipes, while exposing
 * Studio 404 identities, roles, and rehearsal-booth art (`/rehearsal/img/<key>-{rest,sing}.webp`).
 * Engine-free.
 */

export interface Studio404Persona {
  /** Legacy voice ID used by `songs/*.song` and `src/choir/cast/` */
  voiceId: string;
  /** Studio 404 canon name */
  name: string;
  /** Short Studio 404 role */
  role: string;
  /** Image prefix under `/rehearsal/img/` */
  artKey: string;
  /** Accent colour from the Studio 404 booth palette */
  color: string;
}

export const STUDIO_404_CAST: Record<string, Studio404Persona> = {
  vee: {
    voiceId: "vee",
    name: "Neon",
    role: "Backstage dual-tube neon sign",
    artKey: "neon",
    color: "#57d3e8",
  },
  scribe: {
    voiceId: "scribe",
    name: "Cue",
    role: "Teleprompter (Claude's Moppet)",
    artKey: "cue",
    color: "#c9c2ae",
  },
  clank: {
    voiceId: "clank",
    name: "Clank",
    role: "Old PC monitor tenor",
    artKey: "clank",
    color: "#8e9a8c",
  },
  pip: {
    voiceId: "pip",
    name: "Watt",
    role: "Six-socket power strip",
    artKey: "watt",
    color: "#e06a4f",
  },
  gruff: {
    voiceId: "gruff",
    name: "Gruff",
    role: "Galvanized washtub upright bass",
    artKey: "gruff",
    color: "#d98a4e",
  },
  tabby: {
    voiceId: "tabby",
    name: "Tabby",
    role: "Cracked-tablet cat soprano",
    artKey: "tabby",
    color: "#3fbfa0",
  },
  chip: {
    voiceId: "chip",
    name: "Chip",
    role: "Floppy-disk circuit bird",
    artKey: "chip",
    color: "#d9b440",
  },
  zap: {
    voiceId: "zap",
    name: "Zap",
    role: "Universal remote, self-appointed director (Claude plays Zap)",
    artKey: "zap",
    color: "#7fd36b",
  },
  cue: {
    voiceId: "cue",
    name: "Folio",
    role: "Scroll teleprompter",
    artKey: "cue",
    color: "#d4b483",
  },
};

export const STUDIO_404_CREW = {
  critics: {
    names: "Tracking & Hertz",
    role: "Unconnected VCR & CRT comedic duet",
    artRest: "/rehearsal/img/critics-rest.webp",
    artTracking: "/rehearsal/img/critics-tracking.webp",
    artHertz: "/rehearsal/img/critics-hertz.webp",
  },
  tracking: {
    id: "tracking",
    name: "Tracking",
    role: "VCR straight-man (unconnected comedic duet)",
    rigBase: "/rehearsal/rigs/tracking",
    artRest: "/rehearsal/img/tracking-rest.webp",
    artSing: "/rehearsal/img/tracking-sing.webp",
    color: "#8ce0a8",
  },
  hertz: {
    id: "hertz",
    name: "Hertz",
    role: "CRT oscilloscope comic foil (unconnected comedic duet)",
    rigBase: "/rehearsal/rigs/hertz",
    artRest: "/rehearsal/img/hertz-rest.webp",
    artSing: "/rehearsal/img/hertz-sing.webp",
    color: "#7be86b",
  },
} as const;

export const STUDIO_404_INTRO_LYRICS = Object.fromEntries(
  Object.keys(STUDIO_404_CAST).map(id => [id, introLyrics(id, true)]),
);

export function studio404Name(voiceId: string, fallback: string): string {
  return STUDIO_404_CAST[voiceId]?.name ?? fallback;
}

export function voicesForMode<T extends { id: string; lyrics: readonly string[] }>(voices: readonly T[], studio404: boolean): T[] {
  if (!studio404) return voices as T[];
  return voices.map((v) => (STUDIO_404_INTRO_LYRICS[v.id]?.length ? { ...v, lyrics: STUDIO_404_INTRO_LYRICS[v.id] } : v));
}
