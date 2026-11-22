import { choirIds } from "./voices.ts";
/**
 * Pure Remotion video workbench project model — unified with ShotcraftStage so @remotion/player
 * and on-demand export render the live theatrical React stage directly without a stage.mp4 capture hack.
 * Pure and engine-free.
 */
import { makeRound, type Piece } from "./music.ts";
import { shownWords } from "./captions.ts";
import {
  collectLinePasses,
  isPadOnlyText,
  layoutStageCapsules,
  mapSkitWords,
  mapWordsToEvents,
  type StageCapsuleInput,
} from "./bubbles.ts";
import { beatSeconds, LEAD_IN, pieceSeconds } from "./timeline.ts";
import { STUDIO_404_CAST, studio404Name } from "./studio404.ts";
import type { MoppetVoice } from "./voices.ts";
import type { VocalTiming } from "./vocalTiming.ts";
import type { WorldLens } from "../stage/worlds.ts";

export type AspectMode = "16:9" | "9:16";
export type BubbleTail = "down" | "left" | "right" | "none";

export type VideoBubbleWord = {
  text: string;
  startSec: number;
  endSec: number;
};

export type VideoBubbleClip = {
  id: string;
  speakerId: string;
  speaker: string;
  text: string;
  startSec: number;
  durationSec: number;
  /** normalized horizontal position (0..1) */
  x: number;
  /** normalized vertical position (0..1) */
  y: number;
  bg: string;
  fg: string;
  color: string;
  tail: BubbleTail;
  words?: VideoBubbleWord[];
};

export type TitleCardConfig = {
  enabled: boolean;
  durationSec: number;
  heading: string;
  subheading: string;
  accent: string;
  bg: string;
};

export type MoppetVideoProps = {
  title: string;
  slug: string;
  kind: Piece["kind"];
  aspect: AspectMode;
  fps: number;
  studio404: boolean;
  stageDurationSec: number;
  audioUrl: string | null;
  audioVolume: number;
  /** Preview is waiting for its score revision to finish rendering. */
  waitingForScore?: boolean;
  vocalTiming?: VocalTiming;
  cameraAutoFollow: boolean;
  intro: TitleCardConfig;
  outro: TitleCardConfig;
  bubbles: VideoBubbleClip[];
  bpm: number;
  piece?: Piece;
  /** Selected polymorphic stage world lens (preserved cleanly into Remotion MP4 export). */
  worldLens?: WorldLens;
};

export function lessonSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "moppet-song";
}

export function compositionDimensions(aspect: AspectMode): { width: number; height: number } {
  return aspect === "9:16" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

export function videoFrameLayout(
  props: Pick<MoppetVideoProps, "fps" | "intro" | "outro" | "stageDurationSec">,
) {
  const fps = Math.max(1, props.fps || 30);
  const introFrames = props.intro.enabled ? Math.round(Math.max(0.4, props.intro.durationSec) * fps) : 0;
  const stageFrames = Math.ceil(Math.max(1, props.stageDurationSec) * fps);
  const outroFrames = props.outro.enabled ? Math.round(Math.max(0.4, props.outro.durationSec) * fps) : 0;
  return { fps, introFrames, stageFrames, outroFrames };
}

export function totalDurationFrames(props: Parameters<typeof videoFrameLayout>[0]): number {
  const { introFrames, stageFrames, outroFrames } = videoFrameLayout(props);
  return introFrames + stageFrames + outroFrames;
}

/** Visible stage cast for `piece`, filtered by `piece.stage` / Chip participation and styled for the mode. */
export function stageVoicesForPiece(
  piece: Piece,
  voices: readonly MoppetVoice[],
  studio404 = true,
): { id: string; name: string; color: string }[] {
  const stageIds = piece.stage?.filter((id) => id !== "band");
  const visible = stageIds?.length
    ? voices.filter((v) => stageIds.includes(v.id))
    : voices.filter((v) => choirIds.includes(v.id) || piece.tracks.some((t) => t.id === v.id));
  const slotList = visible.length ? visible : voices;
  return slotList.map((v) => ({
    id: v.id,
    name: piece.title === "Borrowed Light" && v.id === "vee" ? "Moonbeam" : studio404 ? studio404Name(v.id, v.name) : v.name,
    color: studio404 ? (STUDIO_404_CAST[v.id]?.color ?? v.color) : v.color,
  }));
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
  words: VideoBubbleWord[];
}

export function buildVideoProject(
  piece: Piece,
  voices: readonly MoppetVoice[],
  studio404 = true,
  opts?: { aspect?: AspectMode; audioUrl?: string | null },
): MoppetVideoProps {
  const fps = 30;
  const bs = beatSeconds(piece);
  const stageDurationSec = pieceSeconds(piece);
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

  // Build speech bubble clips using bubbles.ts pass & karaoke word-span helpers
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
    // These Studio 404 verse roles use existing CHIMERA voices.
    const foundVerseRoles: Record<string, string> = { pip: "Spool", vee: "Clacker" };
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
        const section = sections.find(section => section.beat <= p.start);
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
  const groups: { entries: RawClip[]; text: string; startSec: number; endSec: number; startBeat: number; words: VideoBubbleWord[] }[] = [];
  for (const r of raw) {
    const twin = groups.find((g) => g.text === r.text && Math.abs(g.startSec - r.startSec) < 0.3);
    if (twin) {
      twin.endSec = Math.max(twin.endSec, r.endSec);
      if (!twin.entries.some((e) => e.speakerId === r.speakerId)) twin.entries.push(r);
    } else {
      groups.push({ entries: [r], text: r.text, startSec: r.startSec, endSec: r.endSec, startBeat: r.startBeat, words: r.words });
    }
  }

  // Place overlapping bubbles into non-colliding lanes via bubbles.ts `layoutStageCapsules`
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

  const bubbles: VideoBubbleClip[] = groups.map((g, idx) => {
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
      bg: "rgba(20, 12, 15, 0.88)",
      fg: "#f8efe2",
      color: lead.color,
      tail: "down",
      words: g.words,
    };
  });

  return {
    title: piece.title,
    slug: lessonSlug(piece.title),
    kind: piece.kind,
    aspect: opts?.aspect ?? "16:9",
    fps,
    studio404,
    stageDurationSec,
    audioUrl: opts?.audioUrl ?? null,
    audioVolume: 1,
    cameraAutoFollow: true,
    intro: {
      enabled: true,
      durationSec: 2.5,
      heading: piece.title,
      subheading: studio404 ? "STUDIO 404 · THE MOPPETS" : "THE MOPPET CHOIR",
      accent: "#57d3e8",
      bg: "#160a0d",
    },
    outro: {
      enabled: true,
      durationSec: 2.5,
      heading: "Studio 404",
      subheading: "Found objects with real voices · CHIMERA",
      accent: "#e3bd7f",
      bg: "#160a0d",
    },
    bubbles,
    bpm: piece.bpm,
    piece,
  };
}

export const DEFAULT_VIDEO_PROPS: MoppetVideoProps = {
  title: "Studio 404 Session",
  slug: "studio-404-session",
  kind: "motesong",
  aspect: "16:9",
  fps: 30,
  studio404: true,
  stageDurationSec: 8,
  audioUrl: null,
  audioVolume: 1,
  cameraAutoFollow: true,
  intro: {
    enabled: true,
    durationSec: 2.5,
    heading: "Studio 404 Session",
    subheading: "STUDIO 404 · THE MOPPETS",
    accent: "#57d3e8",
    bg: "#160a0d",
  },
  outro: {
    enabled: true,
    durationSec: 2.5,
    heading: "Studio 404",
    subheading: "Found objects with real voices · CHIMERA",
    accent: "#e3bd7f",
    bg: "#160a0d",
  },
  bubbles: [],
  bpm: 112,
  piece: makeRound(),
};
