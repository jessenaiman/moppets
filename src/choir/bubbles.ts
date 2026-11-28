/**
 * Pure stage speech-bubble resolution, note-locked word-level karaoke timing, and non-overlapping
 * harmony lane layout for singing Moppets, skits, and live MIDI play.
 * Preserves rising musical notes without bubble clutter on humming / Music school pieces.
 * Pure and engine-free.
 */
import type { Piece, ScoreEvent, Track } from "./music.ts";
import { shownWords } from "./captions.ts";

/** Returns true for non-lexical humming or backing-pad syllables ("oo", "doo", "bom", "da", "mm"). */
export function isPadOnlyText(text: string): boolean {
  const clean = text.trim();
  if (!clean) return true;
  return /^(oo+h?|bom|da+|mm+|doo+)[!?.…]*$/i.test(clean);
}

export interface LinePass {
  line: number;
  start: number;
  end: number;
  events: ScoreEvent[];
}

export interface KaraokeWordSpan {
  text: string;
  startBeat: number;
  endBeat: number;
}

export interface TrackSpeechDetail {
  text: string;
  startBeat: number;
  endBeat: number;
  words: KaraokeWordSpan[];
}

/** Estimate spoken English syllable count purely without G2P/engine dependencies. */
function estimateSyllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return 1;
  if (letters.length <= 3) return 1;
  const trimmed = letters.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const matches = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, matches ? matches.length : 1);
}

/** Map raw `.song` words (including `_` melisma holds) onto the note events of a sung phrase pass. */
export function mapWordsToEvents(
  rawPhrase: string,
  events: readonly ScoreEvent[],
  fallbackStart: number,
  fallbackEnd: number,
): KaraokeWordSpan[] {
  const rawTokens = rawPhrase.trim().split(/\s+/).filter(Boolean);
  if (!rawTokens.length) return [];

  const parsed: { text: string; units: number }[] = [];
  for (const tok of rawTokens) {
    const holds = (tok.match(/_/g) ?? []).length;
    const clean = shownWords(tok).trim();
    if (!clean) {
      if (parsed.length > 0) parsed[parsed.length - 1].units += Math.max(1, holds);
      continue;
    }
    parsed.push({ text: clean, units: estimateSyllables(clean) + holds });
  }
  if (!parsed.length) return [];

  const totalUnits = Math.max(1, parsed.reduce((s, w) => s + w.units, 0));
  const sorted = [...events].sort((a, b) => a.beat - b.beat);

  if (sorted.length === 0) {
    const dur = Math.max(0.4, fallbackEnd - fallbackStart);
    let acc = 0;
    return parsed.map((w) => {
      const s = fallbackStart + (acc / totalUnits) * dur;
      acc += w.units;
      const e = fallbackStart + (acc / totalUnits) * dur;
      return { text: w.text, startBeat: s, endBeat: Math.max(s + 0.08, e) };
    });
  }

  const n = sorted.length;
  let acc = 0;
  return parsed.map((w) => {
    const u0 = acc / totalUnits;
    acc += w.units;
    const u1 = acc / totalUnits;

    const fIdx0 = u0 * n;
    const fIdx1 = Math.max(fIdx0 + 0.001, u1 * n);
    const i0 = Math.min(n - 1, Math.floor(fIdx0));
    const frac0 = fIdx0 - i0;
    const ev0 = sorted[i0];
    const startBeat = ev0.beat + ev0.beats * frac0;

    const i1 = Math.min(n - 1, Math.max(i0, Math.ceil(fIdx1) - 1));
    const ev1 = sorted[i1];
    const localEndFrac = Math.min(1, Math.max(0.15, fIdx1 - i1));
    const endBeat = u1 >= 0.999 ? ev1.beat + ev1.beats : ev1.beat + ev1.beats * localEndFrac;

    return {
      text: w.text,
      startBeat,
      endBeat: Math.max(startBeat + 0.08, endBeat),
    };
  });
}

/** Map spoken skit words proportionally by character weight & punctuation pauses. */
export function mapSkitWords(text: string, startBeat: number, endBeat: number): KaraokeWordSpan[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weights = tokens.map((t) => {
    const pause = /[.!?…]$/.test(t) ? 2.6 : /[,;:—–-]$/.test(t) ? 1.6 : 0;
    return Math.max(2, t.length) + pause;
  });
  const total = Math.max(1, weights.reduce((a, b) => a + b, 0));
  const span = Math.max(0.4, endBeat - startBeat);
  let acc = 0;
  return tokens.map((t, i) => {
    const s = startBeat + (acc / total) * span;
    acc += weights[i];
    const e = startBeat + (acc / total) * span;
    return { text: t, startBeat: s, endBeat: Math.max(s + 0.06, e - 0.03) };
  });
}

export function collectLinePasses(track: Track): LinePass[] {
  const passes: LinePass[] = [];
  const lined = track.events.filter((e) => e.line !== undefined).sort((a, b) => a.beat - b.beat);
  for (const e of lined) {
    const prev = passes.length > 0 && passes[passes.length - 1].line === e.line ? passes[passes.length - 1] : undefined;
    const eEnd = e.beat + e.beats;
    if (prev && e.beat - prev.end < 4) {
      prev.end = Math.max(prev.end, eEnd);
      prev.events.push(e);
    } else {
      passes.push({ line: e.line!, start: e.beat, end: eEnd, events: [e] });
    }
  }
  return passes;
}

/** Detailed word-timed lyric pass for `track` at `beat`, or null when humming / resting / silent. */
export function speechDetailForTrack(piece: Piece, track: Track | undefined, beat: number): TrackSpeechDetail | null {
  if (!track || piece.kind === "school") return null;
  if (piece.kind === "skit") {
    const ev = track.events.find((e) => beat >= e.beat - 0.15 && beat < e.beat + e.beats + 0.3);
    const clean = ev?.text.trim() ?? "";
    if (!ev || !clean) return null;
    const startBeat = ev.beat;
    const endBeat = ev.beat + ev.beats;
    return {
      text: clean,
      startBeat,
      endBeat,
      words: mapSkitWords(clean, startBeat, endBeat),
    };
  }
  const words = track.phrases ?? track.lines;
  if (!words) return null;

  const passes = collectLinePasses(track);
  // Hold a completed line slightly longer across silent dramatic rests (e.g. power-cut freeze) unless a next line begins
  const matches = passes.filter((p, idx) => {
    const nextStart = idx + 1 < passes.length ? passes[idx + 1].start : Infinity;
    const holdBeats = Math.min(1.4, Math.max(0.38, nextStart - p.end - 0.15));
    return beat >= p.start - 0.12 && beat < p.end + holdBeats;
  });
  if (!matches.length) return null;

  const started = matches.filter((p) => beat >= p.start);
  const pool = started.length ? started : matches;
  let chosen = pool[0];
  for (const p of pool) {
    if (p.start > chosen.start) chosen = p;
  }

  const raw = words[chosen.line];
  if (!raw) return null;
  const clean = shownWords(raw);
  if (!clean || isPadOnlyText(clean)) return null;
  return {
    text: clean,
    startBeat: chosen.start,
    endBeat: chosen.end,
    words: mapWordsToEvents(raw, chosen.events, chosen.start, chosen.end),
  };
}

/** Active speech-bubble lyric for one track at `beat`, or null when humming / resting / silent. */
export function bubbleForTrack(piece: Piece, track: Track | undefined, beat: number): string | null {
  return speechDetailForTrack(piece, track, beat)?.text ?? null;
}

/** Per-actor talk lines at `beat` while performing; undefined on humming pieces (`01 · Music school`). */
export function stageTalkAt(piece: Piece, ids: readonly string[], beat: number, performing: boolean): (string | null)[] | undefined {
  if (!performing || piece.kind === "school") return undefined;
  return ids.map((id) => bubbleForTrack(piece, piece.tracks.find((t) => t.id === id), beat));
}

export interface StageBubble {
  text: string;
  anchorX: number;
  topY: number;
  count: number;
}

/** Merge identical simultaneous chorus/duet bubbles over the singing group while keeping distinct lines separate. */
export function groupStageBubbles(marks: readonly { x: number; feet: number; h: number; bubble: string | null }[]): StageBubble[] {
  const order: string[] = [];
  const groups = new Map<string, { sumX: number; minTop: number; count: number }>();
  for (const m of marks) {
    const text = m.bubble?.trim() ?? "";
    if (!text) continue;
    const top = m.feet - m.h * 0.92;
    const existing = groups.get(text);
    if (existing) {
      existing.sumX += m.x;
      existing.minTop = Math.min(existing.minTop, top);
      existing.count += 1;
    } else {
      order.push(text);
      groups.set(text, { sumX: m.x, minTop: top, count: 1 });
    }
  }
  return order.map((text) => {
    const g = groups.get(text)!;
    return {
      text,
      anchorX: g.sumX / g.count,
      topY: g.minTop,
      count: g.count,
    };
  });
}

export interface StageCapsuleInput {
  id: string;
  name: string;
  color: string;
  /** Normalized 0..1 horizontal actor position on stage */
  x: number;
  level: number;
  singing: boolean;
  bubbleText: string | null;
  detail: TrackSpeechDetail | null;
}

export interface PlacedSpeechCapsule {
  key: string;
  speaker: string;
  speakerIds: readonly string[];
  speakerNames: readonly string[];
  speakerColors: readonly string[];
  isGroup: boolean;
  roleLabel: string;
  accent: string;
  text: string;
  words: KaraokeWordSpan[];
  startBeat: number;
  endBeat: number;
  /** Normalized 0..1 capsule center X */
  centerX: number;
  /** Normalized 0..1 actor anchor X for pointer tail */
  anchorX: number;
  /** Normalized 0..1 top Y in stage headroom (strictly above puppet heads) */
  topY: number;
  /** Normalized 0..1 max capsule width */
  maxWidthPct: number;
  level: number;
  singing: boolean;
  count: number;
}

/**
 * Deduplicate chorus/duet capsules and place simultaneous polyphonic lines into clean,
 * non-overlapping horizontal/headroom lanes so speech bubbles never collide or cover faces.
 */
export function layoutStageCapsules(inputs: readonly StageCapsuleInput[], currentBeat: number): PlacedSpeechCapsule[] {
  const order: string[] = [];
  const byText = new Map<
    string,
    {
      ids: string[];
      names: string[];
      colors: string[];
      accent: string;
      sumX: number;
      maxLevel: number;
      anySinging: boolean;
      count: number;
      detail: TrackSpeechDetail | null;
    }
  >();

  for (const inp of inputs) {
    const text = (inp.detail?.text ?? inp.bubbleText ?? "").trim();
    if (!text) continue;
    const prev = byText.get(text);
    if (prev) {
      if (!prev.ids.includes(inp.id)) {
        prev.ids.push(inp.id);
        prev.names.push(inp.name);
        prev.colors.push(inp.color);
      } else if (!prev.names.includes(inp.name)) {
        prev.names.push(inp.name);
      }
      prev.sumX += inp.x;
      prev.maxLevel = Math.max(prev.maxLevel, inp.level);
      prev.anySinging = prev.anySinging || inp.singing;
      prev.count += 1;
      if (!prev.detail && inp.detail) prev.detail = inp.detail;
    } else {
      order.push(text);
      byText.set(text, {
        ids: [inp.id],
        names: [inp.name],
        colors: [inp.color],
        accent: inp.color,
        sumX: inp.x,
        maxLevel: inp.level,
        anySinging: inp.singing,
        count: 1,
        detail: inp.detail,
      });
    }
  }

  if (order.length === 0) return [];

  const rawCapsules = order.map((text, idx) => {
    const g = byText.get(text)!;
    const anchorX = g.sumX / Math.max(1, g.count);
    const speaker =
      g.names.length >= 4
        ? `ALL TOGETHER · ${g.names.length} VOICES`
        : g.names.length === 3
          ? `${g.names[0]}, ${g.names[1]} & ${g.names[2]}`
          : g.names.join(" & ");
    const roleLabel = g.names.length >= 3 ? `${g.names.length} VOICES` : g.names.length === 2 ? "DUET" : "SOLO";
    const startBeat = g.detail?.startBeat ?? currentBeat - 0.2;
    const endBeat = g.detail?.endBeat ?? currentBeat + 1.4;
    const words =
      g.detail?.words ??
      mapSkitWords(text, startBeat, endBeat);

    return {
      key: `${speaker}-${text}-${idx}`,
      speaker,
      speakerIds: g.ids,
      speakerNames: g.names,
      speakerColors: g.colors,
      isGroup: g.ids.length >= 2,
      roleLabel,
      accent: g.accent,
      text,
      words,
      startBeat,
      endBeat,
      anchorX,
      level: g.maxLevel,
      singing: g.anySinging,
      count: g.count,
    };
  });

  // Sort left-to-right by stage anchor so polyphonic lanes match physical actor positions
  rawCapsules.sort((a, b) => a.anchorX - b.anchorX);

  // Cap simultaneous display to at most 3 cleanest capsules (if 4 distinct lines overlap, keep top 3 loudest/featured)
  const visible =
    rawCapsules.length <= 3
      ? rawCapsules
      : [...rawCapsules]
          .sort((a, b) => Number(b.singing) - Number(a.singing) || b.count - a.count || b.level - a.level)
          .slice(0, 3)
          .sort((a, b) => a.anchorX - b.anchorX);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Each bubble sits just above its own speaker (heads stand at about 58% of the stage height), so
  // the tail points straight down at whoever is singing. Overlapping bubbles stagger upward in
  // height instead of jumping to the stage corners, which hid who was singing.
  const LOW = 0.3;     // a lone bubble's top: its tail ends just above the heads
  const STEP = 0.17;   // one bubble's height, for stacking
  const near = (a: number, b: number, w: number) => Math.abs(a - b) < w;
  if (visible.length === 1) {
    const c = visible[0];
    return [{ ...c, centerX: clamp(c.anchorX, 0.22, 0.78), topY: LOW, maxWidthPct: 46 }];
  }
  const width = visible.length === 2 ? 0.4 : 0.34;
  const placed: PlacedSpeechCapsule[] = [];
  for (const c of visible) {
    const centerX = clamp(c.anchorX, width / 2 + 0.02, 1 - width / 2 - 0.02);
    // Take the lowest row that no overlapping bubble already holds.
    const taken = new Set(placed.filter((p) => near(p.centerX, centerX, width)).map((p) => Math.round((LOW - p.topY) / STEP)));
    let row = 0;
    while (taken.has(row)) row++;
    placed.push({ ...c, centerX, topY: Math.max(0.03, LOW - row * STEP), maxWidthPct: Math.round(width * 100) });
  }
  return placed;
}
