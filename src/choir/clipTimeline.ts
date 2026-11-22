/**
 * Pure, engine-free timeline compiler mapping a `Piece` (including MIDI-shifted notes and edited
 * lyrics) onto individual reusable character alpha video loops (`idle`, `sing`, `belt`, `chuckle`).
 */
import type { Piece } from "./music.ts";
import { gestureSeconds } from "./gestures.ts";
import { isPadOnlyText } from "./bubbles.ts";
import { STUDIO_404_CAST } from "./studio404.ts";
import { beatSeconds, LEAD_IN } from "./timeline.ts";

export type CharacterClipKind = "idle" | "sing" | "belt" | "chuckle";

export interface CharacterClipManifest {
  artKey: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  clips: Record<CharacterClipKind, string>;
}

export interface ClipSegment {
  kind: CharacterClipKind;
  startFrame: number;
  durationInFrames: number;
  playbackRate: number;
}

/** Cast members whose individual EffectCraft VP9 alpha clips exist under `public/clips/<artKey>/`. */
export const AVAILABLE_CLIP_MANIFESTS: Readonly<Record<string, CharacterClipManifest>> = {
  neon: {
    artKey: "neon",
    name: "Neon",
    width: 384,
    height: 512,
    fps: 24,
    durationSec: 2.0,
    clips: {
      idle: "/clips/neon/idle.webm",
      sing: "/clips/neon/sing.webm",
      belt: "/clips/neon/belt.webm",
      chuckle: "/clips/neon/chuckle.webm",
    },
  },
  cue: {
    artKey: "cue",
    name: "Cue",
    width: 384,
    height: 512,
    fps: 24,
    durationSec: 2.0,
    clips: {
      idle: "/clips/cue/idle.webm",
      sing: "/clips/cue/sing.webm",
      belt: "/clips/cue/belt.webm",
      chuckle: "/clips/cue/chuckle.webm",
    },
  },
  watt: {
    artKey: "watt",
    name: "Watt",
    width: 384,
    height: 512,
    fps: 24,
    durationSec: 2.0,
    clips: {
      idle: "/clips/watt/idle.webm",
      sing: "/clips/watt/sing.webm",
      belt: "/clips/watt/belt.webm",
      chuckle: "/clips/watt/chuckle.webm",
    },
  },
  gruff: {
    artKey: "gruff",
    name: "Gruff",
    width: 384,
    height: 512,
    fps: 24,
    durationSec: 2.0,
    clips: {
      idle: "/clips/gruff/idle.webm",
      sing: "/clips/gruff/sing.webm",
      belt: "/clips/gruff/belt.webm",
      chuckle: "/clips/gruff/chuckle.webm",
    },
  },
  clank: {
    artKey: "clank",
    name: "Clank",
    width: 384,
    height: 512,
    fps: 24,
    durationSec: 2.0,
    clips: {
      idle: "/clips/clank/idle.webm",
      sing: "/clips/clank/sing.webm",
      belt: "/clips/clank/belt.webm",
      chuckle: "/clips/clank/chuckle.webm",
    },
  },
  tabby: {
    artKey: "tabby",
    name: "Tabby",
    width: 384,
    height: 512,
    fps: 24,
    durationSec: 2.0,
    clips: {
      idle: "/clips/tabby/idle.webm",
      sing: "/clips/tabby/sing.webm",
      belt: "/clips/tabby/belt.webm",
      chuckle: "/clips/tabby/chuckle.webm",
    },
  },
  chip: {
    artKey: "chip",
    name: "Chip",
    width: 384,
    height: 512,
    fps: 24,
    durationSec: 2.0,
    clips: {
      idle: "/clips/chip/idle.webm",
      sing: "/clips/chip/sing.webm",
      belt: "/clips/chip/belt.webm",
      chuckle: "/clips/chip/chuckle.webm",
    },
  },
};

export function manifestForCharacter(voiceId: string, studio404 = true): CharacterClipManifest | null {
  if (!studio404) return null;
  const artKey = STUDIO_404_CAST[voiceId]?.artKey ?? voiceId;
  return AVAILABLE_CLIP_MANIFESTS[artKey] ?? null;
}

/**
 * Compile `voiceId`'s track in `piece` into contiguous Remotion `<Sequence>` clip segments.
 * Responds deterministically to live MIDI note edits, tempo changes, and lyric edits.
 */
export function buildCharacterClipSegments(
  piece: Piece,
  voiceId: string,
  fps: number,
  stageDurationSec: number,
): ClipSegment[] {
  const safeFps = Math.max(1, fps);
  const totalFrames = Math.max(1, Math.round(Math.max(0.1, stageDurationSec) * safeFps));
  const bs = beatSeconds(piece);
  const playbackRate = Number(Math.max(0.5, Math.min(1.8, (piece.bpm || 112) / 112)).toFixed(3));
  const track = piece.tracks.find((t) => t.id === voiceId);

  if (!track || !track.events.length) {
    return [{ kind: "idle", startFrame: 0, durationInFrames: totalFrames, playbackRate }];
  }

  const vocalEvents = track.events.filter((e) => !(e.line === undefined && isPadOnlyText(e.text)));
  const midis = vocalEvents.map((e) => e.midi);
  const minMidi = midis.length ? Math.min(...midis) : 60;
  const maxMidi = midis.length ? Math.max(...midis) : 72;
  const beltThreshold = maxMidi > minMidi + 2 ? minMidi + (maxMidi - minMidi) * 0.72 : 999;

  const reactCues = (piece.cues ?? []).filter(
    (c) => c.who === voiceId && (c.gesture === "laugh" || c.gesture === "cheer" || c.gesture === "nod" || c.gesture === "tilt"),
  );

  // Classify every frame cleanly and coalesce runs into Sequence spans
  const frameKinds: CharacterClipKind[] = new Array(totalFrames).fill("idle");
  for (const ev of vocalEvents) {
    const t0 = LEAD_IN + ev.beat * bs;
    const t1 = LEAD_IN + (ev.beat + ev.beats) * bs;
    const f0 = Math.max(0, Math.floor(t0 * safeFps));
    const f1 = Math.min(totalFrames, Math.ceil(t1 * safeFps));
    const isBelt = ev.midi >= beltThreshold || ev.beats >= 2.0;
    const kind: CharacterClipKind = isBelt ? "belt" : "sing";
    for (let f = f0; f < f1; f++) frameKinds[f] = kind;
  }

  for (const rc of reactCues) {
    const t0 = LEAD_IN + rc.beat * bs;
    const t1 = t0 + Math.max(0.6, gestureSeconds(rc.gesture) || 1.5 * bs);
    const f0 = Math.max(0, Math.floor(t0 * safeFps));
    const f1 = Math.min(totalFrames, Math.ceil(t1 * safeFps));
    for (let f = f0; f < f1; f++) {
      if (frameKinds[f] === "idle") frameKinds[f] = "chuckle";
    }
  }

  const segments: ClipSegment[] = [];
  let start = 0;
  let cur = frameKinds[0];
  for (let f = 1; f < totalFrames; f++) {
    if (frameKinds[f] !== cur) {
      segments.push({ kind: cur, startFrame: start, durationInFrames: f - start, playbackRate });
      start = f;
      cur = frameKinds[f];
    }
  }
  segments.push({ kind: cur, startFrame: start, durationInFrames: totalFrames - start, playbackRate });
  return segments;
}
