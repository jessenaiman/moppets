/**
 * Pure, engine-free stage cast & timed caption/speech-bubble layout for the unified live stage.
 * Zero external video-framework concepts.
 */
import { shownWords } from "./captions.ts";
import {
  collectLinePasses,
  isPadOnlyText,
  layoutStageCapsules,
  mapSkitWords,
  mapWordsToEvents,
  type StageCapsuleInput,
} from "./bubbles.ts";
import type { Piece } from "./music.ts";
import { resolvePerformerIdentity } from "./performer.ts";
import { STUDIO_404_CAST, studio404Name } from "./studio404.ts";
import { beatSeconds, LEAD_IN } from "./timeline.ts";
import { choirIds, type MoppetVoice } from "./voices.ts";

export type BubbleTail = "down" | "left" | "right" | "none";

export interface StageBubbleWord {
  readonly text: string;
  readonly startSec: number;
  readonly endSec: number;
}

export interface StageBubbleClip {
  readonly id: string;
  readonly speakerId: string;
  readonly speaker: string;
  readonly text: string;
  readonly startSec: number;
  readonly durationSec: number;
  /** Normalized horizontal position (0..1). */
  readonly x: number;
  /** Normalized vertical position (0..1). */
  readonly y: number;
  readonly bg: string;
  readonly fg: string;
  readonly color: string;
  readonly tail: BubbleTail;
  readonly words?: readonly StageBubbleWord[];
}

/** Backwards-compatible type aliases for caption & viseme consumers. */
export type VideoBubbleWord = StageBubbleWord;
export type VideoBubbleClip = StageBubbleClip;

export function lessonSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "moppet-song";
}

/** Visible stage cast for `piece`, filtered by `piece.stage` / track participation and resolved via Bible casting. */
export function stageVoicesForPiece(
  piece: Piece,
  voices: readonly MoppetVoice[],
  studio404 = true,
): { id: string; name: string; color: string }[] {
  const stageIds = piece.stage?.filter((id) => id !== "band");
  const visible = stageIds?.length
    ? stageIds.flatMap((id) => {
        const v = voices.find((x) => x.id === id);
        return v ? [v] : [];
      })
    : voices.filter((v) => choirIds.includes(v.id) || piece.tracks.some((t) => t.id === v.id));
  const slotList = visible.length ? visible : voices;
  return slotList.map((v) => {
    const { id, name, color } = resolvePerformerIdentity(v, studio404, piece.title);
    return { id, name, color };
  });
}

interface RawClip {
  speakerId: string;
  speaker: string;
  x: number;
  color: string;
  text: string;
  startSec: number;
  endSec: number;
  startBeat: number;
  endBeat: number;
  words: StageBubbleWord[];
}

/** Build deterministic word-timed speech/lyric caption clips for `piece` on the live stage. */
export function buildStageBubbles(
  piece: Piece,
  voices: readonly MoppetVoice[],
  studio404 = true,
): StageBubbleClip[] {
  const bs = beatSeconds(piece);
  const stageVoices = stageVoicesForPiece(piece, voices, studio404);
  const voiceById = new Map(stageVoices.map((v, i) => [v.id, { ...v, index: i }]));
  const xFor = (id: string) => {
    const info = voiceById.get(id);
    if (!info || stageVoices.length <= 1) return 0.5;
    return 0.14 + (0.72 * info.index) / (stageVoices.length - 1);
  };
  const infoFor = (id: string) => {
    const stageV = voiceById.get(id);
    if (stageV) return stageV;
    const v = voices.find((x) => x.id === id);
    return {
      id,
      name: studio404 ? studio404Name(id, v?.name ?? id) : (v?.name ?? id),
      color: studio404 ? (STUDIO_404_CAST[id]?.color ?? v?.color ?? "#57d3e8") : (v?.color ?? "#57d3e8"),
    };
  };

  const raw: RawClip[] = [];
  if (piece.kind === "skit") {
    for (const t of piece.tracks) {
      const info = infoFor(t.id);
      for (const e of t.events) {
        const text = e.text.trim();
        if (!text) continue;
        const startSec = LEAD_IN + e.beat * bs;
        const endSec = startSec + Math.max(0.8, e.beats * bs);
        const endBeat = e.beat + Math.max(0.8 / bs, e.beats);
        const wordBeats = mapSkitWords(text, e.beat, endBeat);
        raw.push({
          speakerId: t.id,
          speaker: info.name,
          x: xFor(t.id),
          color: info.color,
          text,
          startSec,
          endSec,
          startBeat: e.beat,
          endBeat,
          words: wordBeats.map((w) => ({
            text: w.text,
            startSec: Number((LEAD_IN + w.startBeat * bs).toFixed(3)),
            endSec: Number((LEAD_IN + w.endBeat * bs).toFixed(3)),
          })),
        });
      }
    }
  } else if (piece.kind !== "school") {
    const foundVerseRoles: Record<string, string> = { watt: "Spool", neon: "Clacker" };
    const sections = studio404 && piece.title === "Found Things" ? [...(piece.sections ?? [])].reverse() : [];
    for (const t of piece.tracks) {
      const words = t.phrases ?? t.lines;
      if (!words) continue;
      const info = infoFor(t.id);
      for (const p of collectLinePasses(t)) {
        const rawLine = words[p.line] ?? "";
        const clean = shownWords(rawLine);
        if (!clean || isPadOnlyText(clean)) continue;
        const startSec = LEAD_IN + p.start * bs;
        const endSec = startSec + Math.max(0.45, (p.end - p.start) * bs);
        const wordBeats = mapWordsToEvents(rawLine, p.events, p.start, p.end);
        const section = sections.find((sec) => sec.beat <= p.start);
        raw.push({
          speakerId: t.id,
          speaker: section?.name.startsWith("verse ") ? foundVerseRoles[t.id] ?? info.name : info.name,
          x: xFor(t.id),
          color: info.color,
          text: clean,
          startSec,
          endSec,
          startBeat: p.start,
          endBeat: p.end,
          words: wordBeats.map((w) => ({
            text: w.text,
            startSec: Number((LEAD_IN + w.startBeat * bs).toFixed(3)),
            endSec: Number((LEAD_IN + w.endBeat * bs).toFixed(3)),
          })),
        });
      }
    }
  }

  raw.sort((a, b) => a.startSec - b.startSec || a.text.localeCompare(b.text));
  const groups: {
    entries: RawClip[];
    text: string;
    startSec: number;
    endSec: number;
    startBeat: number;
    words: StageBubbleWord[];
  }[] = [];
  for (const r of raw) {
    const twin = groups.find((g) => g.text === r.text && Math.abs(g.startSec - r.startSec) < 0.3);
    if (twin) {
      twin.endSec = Math.max(twin.endSec, r.endSec);
      if (!twin.entries.some((e) => e.speakerId === r.speakerId)) twin.entries.push(r);
    } else {
      groups.push({
        entries: [r],
        text: r.text,
        startSec: r.startSec,
        endSec: r.endSec,
        startBeat: r.startBeat,
        words: r.words,
      });
    }
  }

  const toInputs = (g: (typeof groups)[number], label: string, level: number): StageCapsuleInput[] =>
    g.entries.map((e) => ({
      id: e.speakerId,
      name: e.speaker,
      color: e.color,
      x: e.x,
      level,
      singing: true,
      bubbleText: label,
      detail: null,
    }));

  return groups.map((g, idx) => {
    const overlapping = groups.filter((k) => g.startSec < k.endSec - 0.05 && g.endSec > k.startSec + 0.05);
    const inputs: StageCapsuleInput[] = overlapping.flatMap((k, ki) =>
      toInputs(k, k === g ? g.text : k.text === g.text ? `${k.text}\u200b${ki}` : k.text, k === g ? 1 : 0.5),
    );
    const placed = layoutStageCapsules(inputs, g.startBeat).find((c) => c.text === g.text);
    const lead = g.entries[0];
    return {
      id: `bubble-${idx + 1}`,
      speakerId: lead.speakerId,
      speaker: placed?.speaker ?? g.entries.map((e) => e.speaker).join(" & "),
      text: g.text,
      startSec: Number(g.startSec.toFixed(2)),
      durationSec: Number(Math.max(0.45, g.endSec - g.startSec).toFixed(2)),
      x: Number((placed?.centerX ?? 0.5).toFixed(3)),
      y: Number((placed?.topY ?? 0.085).toFixed(3)),
      bg: piece.kind === "skit" ? "#ffedc6" : "rgba(20, 12, 15, 0.88)",
      fg: piece.kind === "skit" ? "#2a1c1b" : "#f8efe2",
      color: lead.color,
      tail: "down",
      words: g.words,
    };
  });
}
