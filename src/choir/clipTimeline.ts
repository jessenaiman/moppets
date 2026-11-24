/**
 * Pure, engine-free timeline compiler mapping a `Piece` (including MIDI-shifted notes and edited
 * lyrics) onto individual reusable character alpha video loops (`idle`, `sing`, `belt`, `chuckle`).
 */
import type { Piece } from "./music.ts";
import { gestureSeconds } from "./gestures.ts";
import { beatSeconds, LEAD_IN } from "./timeline.ts";

export type CharacterClipKind = "idle" | "sing" | "belt" | "chuckle";

export interface CharacterClipManifest {
  artKey: string;
  clips: { idle: string; sing: string; [action: string]: string | undefined };
}

export interface ClipSegment {
  kind: CharacterClipKind;
  startFrame: number;
  durationInFrames: number;
  playbackRate: number;
}

export function characterClipUrl({ clips }: CharacterClipManifest, kind: CharacterClipKind): string {
  if (kind === "belt") return clips.belt ?? clips.sing;
  if (kind === "chuckle") return clips.chuckle ?? clips.react ?? clips.idle;
  return clips[kind];
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

  const midis = track.events.map((e) => e.midi);
  const minMidi = midis.length ? Math.min(...midis) : 60;
  const maxMidi = midis.length ? Math.max(...midis) : 72;
  const beltThreshold = maxMidi > minMidi + 2 ? minMidi + (maxMidi - minMidi) * 0.72 : 999;

  const reactCues = (piece.cues ?? []).filter(
    (c) => c.who === voiceId && (c.gesture === "laugh" || c.gesture === "cheer" || c.gesture === "nod" || c.gesture === "tilt"),
  );

  // Classify every frame cleanly and coalesce runs into Sequence spans
  const frameKinds: CharacterClipKind[] = new Array(totalFrames).fill("idle");
  for (const ev of track.events) {
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
