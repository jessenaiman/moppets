import { isPadOnlyText } from "../choir/bubbles.ts";
import { shownWords } from "../choir/captions.ts";
import { canonicalCastId } from "../choir/castManifest.ts";
import type { CinemaShotPreset, Piece } from "../choir/music.ts";

export const MIN_SHOT_BEATS = 8;
export const FINALE_MIN_SHOT_BEATS = 6;

export interface VocalSpan {
  readonly singerId: string;
  readonly startBeat: number;
  readonly endBeat: number;
}

export interface ShotBlock {
  readonly startBeat: number;
  readonly endBeat: number;
  readonly preset: CinemaShotPreset;
  readonly focusActorIds: readonly string[];
  readonly isFinale?: boolean;
}

export interface CompleteSongCameraPlan {
  readonly blocks: readonly ShotBlock[];
  readonly vocalSpans: readonly VocalSpan[];
  readonly stageIds: readonly string[];
  readonly voiceIds: readonly string[];
}

export interface CinemaCameraState {
  shotType: CinemaShotPreset;
  focusActorIds: readonly string[];
  /** Orthographic stage scale multiplier (1.0 = full establishing frame). */
  zoom: number;
  /** Normalized focal point X across stage (0.15..0.85, 0.5 = center). */
  focusXNorm: number;
  /** Normalized focal point Y adjustment (-0.08..+0.08). */
  focusYNorm: number;
  /** Spotlight floor beam X normalized (-0.42..+0.42). */
  spotXNorm: number;
  /** Depth-of-field backdrop blur / haze weight (0..1). */
  depthHaze: number;
  /** Dramatic edge vignette strength (0..1). */
  vignette: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);
const smoothstep = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

function resolveActorIndex(
  actorId: string,
  stageIds: readonly string[],
  voiceIds?: readonly string[],
): number {
  let idx = stageIds.indexOf(actorId);
  if (idx >= 0) return idx;
  if (voiceIds) {
    idx = voiceIds.indexOf(actorId);
    if (idx >= 0) return idx;
  }
  const canon = canonicalCastId(actorId);
  idx = stageIds.indexOf(canon);
  if (idx >= 0) return idx;
  if (voiceIds) {
    for (let i = 0; i < voiceIds.length; i++) {
      if (canonicalCastId(voiceIds[i]) === canon) return i;
    }
  }
  return -1;
}

function resolveTrackActorId(
  trackId: string,
  stageIds: readonly string[],
  voiceIds?: readonly string[],
): string {
  if (stageIds.includes(trackId)) return trackId;
  if (voiceIds) {
    const idx = voiceIds.indexOf(trackId);
    if (idx >= 0 && stageIds[idx]) return stageIds[idx];
  }
  const canon = canonicalCastId(trackId);
  if (stageIds.includes(canon)) return canon;
  return trackId;
}

/**
 * Scan `piece.tracks` for sung lyric events ONLY (strictly ignoring non-lyric pads such as `"oo"` / `"bom"`
 * where `e.line === undefined` or `!rawLine` or `isPadOnlyText(shownWords(rawLine))`), merging adjacent
 * notes per singer within `<= 1.5` beats into `VocalSpan` intervals.
 */
export function extractSungVocalSpans(
  piece: Piece,
  stageIds: readonly string[],
  voiceIds?: readonly string[],
): VocalSpan[] {
  if (piece.kind === "school") return [];

  const spans: VocalSpan[] = [];
  const MERGE_GAP_BEATS = 1.5;

  for (const track of piece.tracks) {
    if (!track.id || track.id === "band") continue;
    const singerId = resolveTrackActorId(track.id, stageIds, voiceIds);
    const words = track.phrases ?? track.lines;

    const validEvents: { start: number; end: number }[] = [];
    for (const e of track.events) {
      if (piece.kind === "skit") {
        const clean = shownWords(e.text ?? "");
        if (!clean || isPadOnlyText(clean)) continue;
      } else {
        if (e.line === undefined) continue;
        const rawLine = words?.[e.line];
        if (!rawLine) continue;
        const clean = shownWords(rawLine);
        if (!clean || isPadOnlyText(clean)) continue;
      }
      const start = Math.max(0, e.beat);
      const end = Math.max(start + 0.25, start + Math.max(0.1, e.beats));
      validEvents.push({ start, end });
    }

    if (validEvents.length === 0) continue;
    validEvents.sort((a, b) => a.start - b.start);

    let curStart = validEvents[0].start;
    let curEnd = validEvents[0].end;
    for (let i = 1; i < validEvents.length; i++) {
      const ev = validEvents[i];
      if (ev.start - curEnd <= MERGE_GAP_BEATS) {
        curEnd = Math.max(curEnd, ev.end);
      } else {
        spans.push({ singerId, startBeat: curStart, endBeat: curEnd });
        curStart = ev.start;
        curEnd = ev.end;
      }
    }
    spans.push({ singerId, startBeat: curStart, endBeat: curEnd });
  }

  spans.sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat);
  return spans;
}

interface SectionInterval {
  readonly name: string;
  readonly startBeat: number;
  readonly endBeat: number;
  readonly isFinale: boolean;
}

function buildSectionIntervals(piece: Piece, totalBeats: number): SectionInterval[] {
  const rawSections: { name: string; beat: number }[] = [];

  if (piece.sections?.length) {
    for (const s of piece.sections) {
      rawSections.push({ name: s.name, beat: clamp(s.beat, 0, totalBeats) });
    }
  } else if (piece.kind === "skit" && piece.scenes?.length) {
    for (let i = 0; i < piece.scenes.length; i++) {
      rawSections.push({ name: `scene ${i + 1}`, beat: clamp(piece.scenes[i].beat, 0, totalBeats) });
    }
  }

  rawSections.sort((a, b) => a.beat - b.beat);
  const out: SectionInterval[] = [];

  if (rawSections.length === 0) {
    out.push({ name: piece.title, startBeat: 0, endBeat: totalBeats, isFinale: false });
    return out;
  }

  if (rawSections[0].beat > 0.05) {
    out.push({ name: "Intro", startBeat: 0, endBeat: rawSections[0].beat, isFinale: false });
  }

  for (let i = 0; i < rawSections.length; i++) {
    const start = rawSections[i].beat;
    const end = i + 1 < rawSections.length ? rawSections[i + 1].beat : totalBeats;
    if (end - start <= 0.05) continue;
    const name = rawSections[i].name;
    const isFinale = i === rawSections.length - 1 && /finale|outro|curtain/i.test(name);
    out.push({ name, startBeat: start, endBeat: end, isFinale });
  }

  return out.length ? out : [{ name: piece.title, startBeat: 0, endBeat: totalBeats, isFinale: false }];
}

function isEnsembleWideSection(name: string): boolean {
  return /chorus|choir|curtain|finale|outro/i.test(name);
}

interface ActivitySlice {
  startBeat: number;
  endBeat: number;
  activeIds: string[];
}

function sliceSectionVocalActivity(
  spans: readonly VocalSpan[],
  secStart: number,
  secEnd: number,
): ActivitySlice[] {
  const clipped = spans
    .map((s) => ({
      singerId: s.singerId,
      start: Math.max(secStart, s.startBeat),
      end: Math.min(secEnd, s.endBeat),
    }))
    .filter((s) => s.end - s.start >= 0.2);

  if (clipped.length === 0) {
    return [{ startBeat: secStart, endBeat: secEnd, activeIds: [] }];
  }

  const rawPts = [secStart, secEnd];
  for (const c of clipped) {
    rawPts.push(c.start, c.end);
  }
  rawPts.sort((a, b) => a - b);

  const pts: number[] = [rawPts[0]];
  for (let i = 1; i < rawPts.length; i++) {
    if (rawPts[i] - pts[pts.length - 1] > 0.05) {
      pts.push(rawPts[i]);
    }
  }
  if (pts[pts.length - 1] < secEnd - 0.01) pts[pts.length - 1] = secEnd;

  const slices: ActivitySlice[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b - a < 0.05) continue;
    const mid = (a + b) * 0.5;
    const ids: string[] = [];
    for (const c of clipped) {
      if (mid >= c.start && mid <= c.end && !ids.includes(c.singerId)) {
        ids.push(c.singerId);
      }
    }
    const prev = slices[slices.length - 1];
    if (
      prev &&
      prev.activeIds.length === ids.length &&
      prev.activeIds.every((id, k) => id === ids[k])
    ) {
      prev.endBeat = b;
    } else {
      slices.push({ startBeat: a, endBeat: b, activeIds: ids });
    }
  }

  // Bridge short breath pauses (< 3.5 beats) between phrases so the camera never flashes to "wide"
  const bridged: ActivitySlice[] = [];
  for (let i = 0; i < slices.length; i++) {
    const sl = slices[i];
    const dur = sl.endBeat - sl.startBeat;
    if (sl.activeIds.length === 0 && dur < 3.5) {
      if (bridged.length > 0) {
        bridged[bridged.length - 1].endBeat = sl.endBeat;
      } else if (i + 1 < slices.length) {
        slices[i + 1].startBeat = sl.startBeat;
      } else {
        bridged.push({ ...sl });
      }
    } else {
      bridged.push({ ...sl });
    }
  }

  // Coalesce adjacent identical active sets after bridging
  const out: ActivitySlice[] = [];
  for (const sl of bridged) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.activeIds.length === sl.activeIds.length &&
      prev.activeIds.every((id, k) => id === sl.activeIds[k])
    ) {
      prev.endBeat = sl.endBeat;
    } else {
      out.push(sl);
    }
  }
  return out;
}

function normalizeSoloPreset(preset: CinemaShotPreset): CinemaShotPreset {
  if (preset === "two-shot") return "closeup";
  if (preset === "reaction") return "closeup";
  return preset;
}

function planIsolatedSoloSubBlocks(
  singerId: string,
  startBeat: number,
  endBeat: number,
  sectionName: string,
  cues: readonly NonNullable<Piece["cameraCues"]>[number][],
): ShotBlock[] {
  const defaultPreset: CinemaShotPreset = /bridge|solo|break/i.test(sectionName) ? "low-angle" : "closeup";
  const inRange = cues
    .filter((c) => c.beat >= startBeat - 0.1 && c.beat < endBeat - MIN_SHOT_BEATS + 0.1)
    .sort((a, b) => a.beat - b.beat);

  if (inRange.length === 0 || endBeat - startBeat < MIN_SHOT_BEATS * 2) {
    const firstCue = inRange.find((c) => c.beat <= startBeat + 1.5);
    const preset = firstCue ? normalizeSoloPreset(firstCue.preset) : defaultPreset;
    return [
      {
        startBeat,
        endBeat,
        preset,
        focusActorIds: preset === "wide" ? [] : [singerId],
      },
    ];
  }

  const initialCue = inRange.find((c) => c.beat <= startBeat + 0.5);
  let curPreset = initialCue ? normalizeSoloPreset(initialCue.preset) : defaultPreset;
  let curStart = startBeat;
  const blocks: ShotBlock[] = [];

  for (const cue of inRange) {
    if (cue.beat <= startBeat + 0.5) continue;
    const nextPreset = normalizeSoloPreset(cue.preset);
    if (nextPreset === curPreset) continue;
    if (cue.beat - curStart < MIN_SHOT_BEATS) continue;
    if (endBeat - cue.beat < MIN_SHOT_BEATS) continue;
    blocks.push({
      startBeat: curStart,
      endBeat: cue.beat,
      preset: curPreset,
      focusActorIds: curPreset === "wide" ? [] : [singerId],
    });
    curStart = cue.beat;
    curPreset = nextPreset;
  }

  blocks.push({
    startBeat: curStart,
    endBeat,
    preset: curPreset,
    focusActorIds: curPreset === "wide" ? [] : [singerId],
  });
  return blocks;
}

function sameBlockFraming(a: ShotBlock, b: ShotBlock): boolean {
  if (a.preset !== b.preset) return false;
  if (a.preset === "wide" && b.preset === "wide") return true;
  if (a.focusActorIds.length !== b.focusActorIds.length) return false;
  const sa = [...a.focusActorIds].sort();
  const sb = [...b.focusActorIds].sort();
  return sa.every((id, i) => id === sb[i]);
}

function mergeAdjacentIdentical(blocks: ShotBlock[]): ShotBlock[] {
  const out: ShotBlock[] = [];
  for (const b of blocks) {
    if (b.endBeat - b.startBeat <= 0.01) continue;
    const prev = out[out.length - 1];
    if (prev && sameBlockFraming(prev, b)) {
      out[out.length - 1] = {
        startBeat: prev.startBeat,
        endBeat: b.endBeat,
        preset: prev.preset,
        focusActorIds: prev.focusActorIds,
        isFinale: Boolean(b.isFinale),
      };
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

function combineBlocks(a: ShotBlock, b: ShotBlock): ShotBlock {
  const durA = a.endBeat - a.startBeat;
  const durB = b.endBeat - b.startBeat;
  const unionFocus: string[] = [];
  for (const id of [...a.focusActorIds, ...b.focusActorIds]) {
    if (!unionFocus.includes(id)) unionFocus.push(id);
  }

  let preset: CinemaShotPreset;
  let focusActorIds: readonly string[];
  if (a.preset === "wide" || b.preset === "wide" || unionFocus.length >= 3 || unionFocus.length === 0) {
    preset = "wide";
    focusActorIds = [];
  } else if (unionFocus.length === 2) {
    preset = "two-shot";
    focusActorIds = unionFocus;
  } else {
    preset = durA >= durB ? a.preset : b.preset;
    focusActorIds = unionFocus;
  }

  return {
    startBeat: a.startBeat,
    endBeat: b.endBeat,
    preset,
    focusActorIds,
    isFinale: Boolean(b.isFinale),
  };
}

function enforceMinimumShotHold(rawBlocks: ShotBlock[], totalBeats: number): ShotBlock[] {
  let blocks = mergeAdjacentIdentical(rawBlocks);
  if (blocks.length <= 1) {
    if (blocks.length === 1) {
      blocks[0] = { ...blocks[0], startBeat: 0, endBeat: totalBeats };
    }
    return blocks;
  }

  // Iteratively absorb any shot shorter than MIN_SHOT_BEATS (8 beats; 6-beat floor for finale stings)
  let guard = 0;
  while (blocks.length > 1 && guard++ < 256) {
    let worstIdx = -1;
    let worstDur = Infinity;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const floor = b.isFinale ? FINALE_MIN_SHOT_BEATS : MIN_SHOT_BEATS;
      const dur = b.endBeat - b.startBeat;
      if (dur < floor - 0.01 && dur < worstDur) {
        worstDur = dur;
        worstIdx = i;
      }
    }
    if (worstIdx < 0) break;

    const cur = blocks[worstIdx];
    const prev = worstIdx > 0 ? blocks[worstIdx - 1] : null;
    const next = worstIdx + 1 < blocks.length ? blocks[worstIdx + 1] : null;

    let mergeWithPrev = false;
    if (prev && next) {
      const prevShares = prev.focusActorIds.some((id) => cur.focusActorIds.includes(id));
      const nextShares = next.focusActorIds.some((id) => cur.focusActorIds.includes(id));
      if (cur.preset === "wide" && prev.preset === "wide") mergeWithPrev = true;
      else if (cur.preset === "wide" && next.preset === "wide") mergeWithPrev = false;
      else if (prev.preset === "wide" && next.preset !== "wide") mergeWithPrev = true;
      else if (next.preset === "wide" && prev.preset !== "wide") mergeWithPrev = false;
      else if (prevShares && !nextShares) mergeWithPrev = true;
      else if (nextShares && !prevShares) mergeWithPrev = false;
      else mergeWithPrev = prev.endBeat - prev.startBeat <= next.endBeat - next.startBeat;
    } else if (prev) {
      mergeWithPrev = true;
    }

    if (mergeWithPrev && prev) {
      blocks.splice(worstIdx - 1, 2, combineBlocks(prev, cur));
    } else if (next) {
      blocks.splice(worstIdx, 2, combineBlocks(cur, next));
    } else {
      break;
    }
    blocks = mergeAdjacentIdentical(blocks);
  }

  if (blocks.length > 0) {
    blocks[0] = { ...blocks[0], startBeat: 0 };
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], endBeat: totalBeats };
  }
  return blocks;
}

/**
 * Pre-plan the ENTIRE song's camera direction ONCE per piece + stage cast (`S-50`):
 * - Ignores non-lyric `"oo"` / `"bom"` pads completely
 * - Locks 0-singer intros/rests and chorus/choir/curtain-call/finale/3+ overlapping singers to `"wide"`
 * - Consolidates 2 overlapping singers or rapid call-and-response (`<= 4.5` beats) into `"two-shot"`
 * - Grants isolated solo phrases (`±3.5` beats clear) `"closeup"` or accent `"low-angle"`
 * - Enforces `MIN_SHOT_BEATS = 8` (`6` for finale stings) so the camera never cuts hyperactively
 */
export function planCompleteSongCamera(
  piece: Piece,
  stageIds: readonly string[],
  voiceIds?: readonly string[],
): CompleteSongCameraPlan {
  const totalBeats = Math.max(8, piece.beats || 32);
  const vocalSpans = extractSungVocalSpans(piece, stageIds, voiceIds);
  const resolvedVoiceIds = voiceIds ? [...voiceIds] : [...stageIds];

  if (piece.kind === "school" || vocalSpans.length === 0) {
    return {
      blocks: [{ startBeat: 0, endBeat: totalBeats, preset: "wide", focusActorIds: [] }],
      vocalSpans,
      stageIds: [...stageIds],
      voiceIds: resolvedVoiceIds,
    };
  }

  const firstVocalBeat = vocalSpans[0].startBeat;
  const sections = buildSectionIntervals(piece, totalBeats);
  const advisoryCues = [...(piece.cameraCues ?? [])].sort((a, b) => a.beat - b.beat);
  const rawBlocks: ShotBlock[] = [];

  for (const sec of sections) {
    if (isEnsembleWideSection(sec.name)) {
      rawBlocks.push({
        startBeat: sec.startBeat,
        endBeat: sec.endBeat,
        preset: "wide",
        focusActorIds: [],
        isFinale: sec.isFinale,
      });
      continue;
    }

    let workStart = sec.startBeat;
    if (workStart < firstVocalBeat) {
      const preEnd = Math.min(sec.endBeat, firstVocalBeat);
      rawBlocks.push({
        startBeat: workStart,
        endBeat: preEnd,
        preset: "wide",
        focusActorIds: [],
      });
      workStart = preEnd;
    }
    if (workStart >= sec.endBeat - 0.05) continue;

    const slices = sliceSectionVocalActivity(vocalSpans, workStart, sec.endBeat);
    let lastWasPairedTwoShot = false;

    for (let i = 0; i < slices.length; i++) {
      const sl = slices[i];
      const dur = sl.endBeat - sl.startBeat;

      if (sl.activeIds.length === 0 || sl.activeIds.length >= 3) {
        rawBlocks.push({
          startBeat: sl.startBeat,
          endBeat: sl.endBeat,
          preset: "wide",
          focusActorIds: [],
        });
        lastWasPairedTwoShot = false;
        continue;
      }

      if (sl.activeIds.length === 2) {
        rawBlocks.push({
          startBeat: sl.startBeat,
          endBeat: sl.endBeat,
          preset: "two-shot",
          focusActorIds: [sl.activeIds[0], sl.activeIds[1]],
        });
        lastWasPairedTwoShot = true;
        continue;
      }

      // Single active singer inside [sl.startBeat, sl.endBeat]
      const singerId = sl.activeIds[0];
      const next = i + 1 < slices.length ? slices[i + 1] : null;
      const prev = i > 0 ? slices[i - 1] : null;
      const nextDur = next ? next.endBeat - next.startBeat : 0;

      // Rapid call-and-response between two short/medium turns (gap <= 4.5 beats) -> calm two-shot!
      if (
        dur < 11 &&
        next &&
        next.activeIds.length === 1 &&
        next.activeIds[0] !== singerId &&
        nextDur < 11 &&
        next.startBeat - sl.endBeat <= 4.5
      ) {
        rawBlocks.push({
          startBeat: sl.startBeat,
          endBeat: next.endBeat,
          preset: "two-shot",
          focusActorIds: [singerId, next.activeIds[0]],
        });
        lastWasPairedTwoShot = true;
        i++; // consumed next in the consolidated two-shot
        continue;
      }

      // Short handoff right after an isolated long solo -> frame both speakers in two-shot
      if (
        dur < 11 &&
        prev &&
        prev.activeIds.length === 1 &&
        prev.activeIds[0] !== singerId &&
        sl.startBeat - prev.endBeat <= 4.5
      ) {
        const cueAtStart = advisoryCues.find((c) => Math.abs(c.beat - sl.startBeat) <= 0.75);
        if (lastWasPairedTwoShot && cueAtStart && dur >= MIN_SHOT_BEATS && cueAtStart.preset !== "two-shot") {
          const preset = normalizeSoloPreset(cueAtStart.preset);
          rawBlocks.push({
            startBeat: sl.startBeat,
            endBeat: sl.endBeat,
            preset,
            focusActorIds: preset === "wide" ? [] : [singerId],
          });
        } else {
          rawBlocks.push({
            startBeat: sl.startBeat,
            endBeat: sl.endBeat,
            preset: "two-shot",
            focusActorIds: [prev.activeIds[0], singerId],
          });
          lastWasPairedTwoShot = true;
        }
        continue;
      }

      // Long isolated solo (or genuinely isolated short phrase with > 4.5 beat separation)
      const soloBlocks = planIsolatedSoloSubBlocks(singerId, sl.startBeat, sl.endBeat, sec.name, advisoryCues);
      rawBlocks.push(...soloBlocks);
      lastWasPairedTwoShot = false;
    }
  }

  const blocks = enforceMinimumShotHold(rawBlocks, totalBeats);
  return {
    blocks,
    vocalSpans,
    stageIds: [...stageIds],
    voiceIds: resolvedVoiceIds,
  };
}

function presetZoomAndY(
  preset: CinemaShotPreset,
  castCount: number,
): { zoom: number; yNorm: number; haze: number; vignette: number } {
  switch (preset) {
    case "closeup":
      return { zoom: castCount <= 1 ? 1.12 : 1.28, yNorm: castCount <= 1 ? -0.015 : 0.02, haze: 0.42, vignette: 0.48 };
    case "two-shot":
      return { zoom: 1.14, yNorm: 0.01, haze: 0.28, vignette: 0.34 };
    case "reaction":
      return { zoom: castCount <= 1 ? 1.1 : 1.24, yNorm: castCount <= 1 ? -0.01 : 0.015, haze: 0.4, vignette: 0.44 };
    case "low-angle":
      return { zoom: castCount <= 1 ? 1.08 : 1.16, yNorm: -0.025, haze: 0.32, vignette: 0.38 };
    case "wide":
    default:
      return { zoom: 1.0, yNorm: 0, haze: 0.18, vignette: 0.24 };
  }
}

/**
 * Evaluate a pre-planned `CompleteSongCameraPlan` at `beat` with zero per-frame allocations
 * and zero RMS audio-energy hijacking.
 */
export function evaluatePlannedCamera(
  plan: CompleteSongCameraPlan,
  actorXNorms: readonly number[],
  beat: number,
  cameraAutoFollow: boolean,
  reducedMotion: boolean,
): CinemaCameraState {
  if (!cameraAutoFollow || reducedMotion || plan.blocks.length === 0) {
    return {
      shotType: "wide",
      focusActorIds: [],
      zoom: 1,
      focusXNorm: 0.5,
      focusYNorm: 0,
      spotXNorm: 0,
      depthHaze: 0.16,
      vignette: 0.22,
    };
  }

  const blocks = plan.blocks;
  let idx = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (beat >= blocks[i].startBeat) idx = i;
  }

  const cur = blocks[idx];
  const prev = idx > 0 ? blocks[idx - 1] : cur;
  const blend = smoothstep((beat - cur.startBeat) / 1.4);

  const curStyle = presetZoomAndY(cur.preset, plan.stageIds.length);
  const prevStyle = presetZoomAndY(prev.preset, plan.stageIds.length);

  let targetFocusX = 0.5;
  if (cur.preset !== "wide" && cur.focusActorIds.length > 0) {
    let sumX = 0;
    let count = 0;
    for (const actorId of cur.focusActorIds) {
      const actorIdx = resolveActorIndex(actorId, plan.stageIds, plan.voiceIds);
      if (actorIdx >= 0 && actorXNorms[actorIdx] !== undefined) {
        sumX += actorXNorms[actorIdx];
        count++;
      }
    }
    if (count > 0) targetFocusX = sumX / count;
  }

  const zoom = lerp(prevStyle.zoom, curStyle.zoom, blend);
  const maxPanFraction = zoom <= 1.01 ? 0.02 : ((zoom - 1) / (2 * zoom)) * 0.85;
  const clampedFocusX = clamp(targetFocusX, 0.5 - maxPanFraction, 0.5 + maxPanFraction);
  const spotXNorm = clamp((targetFocusX - 0.5) * 0.85, -0.4, 0.4);

  return {
    shotType: cur.preset,
    focusActorIds: cur.focusActorIds,
    zoom,
    focusXNorm: clampedFocusX,
    focusYNorm: lerp(prevStyle.yNorm, curStyle.yNorm, blend),
    spotXNorm,
    depthHaze: lerp(prevStyle.haze, curStyle.haze, blend),
    vignette: lerp(prevStyle.vignette, curStyle.vignette, blend),
  };
}

/**
 * Convenience wrapper over `planCompleteSongCamera` + `evaluatePlannedCamera` for stateless callers.
 */
export function evaluateCinemaDirector(
  piece: Piece,
  stageIds: readonly string[],
  actorXNorms: readonly number[],
  _activeSpeakerIdx: number,
  beat: number,
  cameraAutoFollow: boolean,
  reducedMotion: boolean,
  voiceIds?: readonly string[],
): CinemaCameraState {
  const plan = planCompleteSongCamera(piece, stageIds, voiceIds);
  return evaluatePlannedCamera(plan, actorXNorms, beat, cameraAutoFollow, reducedMotion);
}
