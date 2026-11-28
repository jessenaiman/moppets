/**
 * Pure Piece -> ABC notation converter (`abcjs@6.7.3`) with voice grouping & color metadata.
 * Preserves per-character color coding (`ChoirScore` palettes + `resolvePerformerIdentity`)
 * and choral voice grouping (`ROUND_GROUPS` / `Lead` / `Treble` / `Bass`).
 * Visual engraving only (never imports or calls `abcjs.synth`).
 */
import { measures } from "../../choir/meter.ts";
import { ROUND_GROUPS, type KeyName, type Piece, type ScaleMode, type ScoreEvent, type Track } from "../../choir/music.ts";
import { resolvePerformerIdentity } from "../../choir/performer.ts";
import { sungSyllables } from "../../choir/plan.ts";
import { clefForVoice, keySigAccidentals, midiToVexNote, vexKeySignature } from "../../choir/staffMath.ts";
import type { MoppetVoice } from "../../choir/voices.ts";
import { darkPalette, palette } from "../ChoirScore.tsx";

export interface AbcVoiceSpec {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly clef: "treble" | "bass";
  readonly paperColor: string;
  readonly darkColor: string;
  readonly charColor: string;
}

export interface AbcNoteSpan {
  readonly beat: number;
  readonly endBeat: number;
  readonly midi: number;
  readonly text: string;
  readonly voiceId: string;
}

export interface AbcConversionResult {
  readonly abc: string;
  readonly voiceSpecs: readonly AbcVoiceSpec[];
  readonly noteSpansByVoice: readonly (readonly AbcNoteSpan[])[];
  readonly totalBars: number;
}

const KEY_TO_ABC: Record<KeyName, string> = {
  C: "C",
  "D♭": "Db",
  D: "D",
  "E♭": "Eb",
  E: "E",
  F: "F",
  "F♯": "F#",
  G: "G",
  "A♭": "Ab",
  A: "A",
  "B♭": "Bb",
  B: "B",
};

const MODE_TO_ABC: Record<ScaleMode, string> = {
  major: "",
  minor: "m",
  aeolian: "m",
  dorian: " dor",
  mixolydian: " mix",
  lydian: " lyd",
  phrygian: " phr",
};

const STD_UNITS = [16, 12, 8, 6, 4, 3, 2, 1] as const;

function splitUnits(units: number): number[] {
  let rem = Math.max(1, Math.round(units));
  const parts: number[] = [];
  while (rem > 0) {
    const chunk = STD_UNITS.find((u) => u <= rem) ?? 1;
    parts.push(chunk);
    rem -= chunk;
  }
  return parts;
}

function escapeLyricToken(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, "~")
    .replace(/-/g, "\\-")
    .replace(/_/g, "\\_")
    .replace(/\|/g, "");
}

function resolveLyricTokens(track: Track): string[] {
  const byLine = new Map<number, ReturnType<typeof sungSyllables>>();
  const seen = new Map<number, number>();
  return track.events.map((ev) => {
    const isPad = ev.line === undefined && !ev.src && Boolean(track.phrases?.length || track.lines?.length);
    if (isPad) return "*";

    if (ev.line !== undefined && track.lines && !track.phrases) {
      const words = track.lines[ev.line]?.trim().split(/\s+/).filter(Boolean) ?? [];
      const k = seen.get(ev.line) ?? 0;
      seen.set(ev.line, k + 1);
      const w = words[k];
      return w ? escapeLyricToken(w) : "*";
    }

    if (ev.line !== undefined && track.phrases) {
      if (!byLine.has(ev.line)) {
        try {
          byLine.set(ev.line, sungSyllables(track.phrases[ev.line] ?? ""));
        } catch {
          byLine.set(ev.line, []);
        }
      }
      const syls = byLine.get(ev.line)!;
      const k = seen.get(ev.line) ?? 0;
      seen.set(ev.line, k + 1);
      if (!syls.length) return "*";
      const s = syls[k % syls.length];
      if (!s) return "*";
      if (s.melisma || s.text === "~" || s.text === "–") return "_";
      const clean = escapeLyricToken(s.text);
      if (!clean) return "*";
      return s.wordEnd ? clean : `${clean}-`;
    }

    const txt = ev.text.trim();
    if (!txt || txt === "oo" || txt === "bom") return txt || "*";
    if (txt === "~" || txt === "–") return "_";
    return escapeLyricToken(txt);
  });
}

function abcPitch(midi: number, key: KeyName, mode: ScaleMode, activeAcc: Record<string, number>): string {
  const vex = midiToVexNote(midi, key, mode, activeAcc);
  const [letterRaw, octStr] = vex.key.split("/");
  const oct = Number(octStr);
  const prefix = vex.accidental === "#" ? "^" : vex.accidental === "b" ? "_" : vex.accidental === "n" ? "=" : "";
  const base =
    oct <= 4
      ? letterRaw.toUpperCase() + ",".repeat(Math.max(0, 4 - oct))
      : letterRaw.toLowerCase() + "'".repeat(Math.max(0, oct - 5));
  return `${prefix}${base}`;
}

function encodeRestSegment(units: number): string {
  return splitUnits(units)
    .map((u) => (u === 1 ? "z" : `z${u}`))
    .join("");
}

function encodeNoteSegment(pitch: string, units: number, tiedToNext: boolean): string {
  const chunks = splitUnits(units);
  return chunks
    .map((u, idx) => {
      const len = u === 1 ? "" : String(u);
      const tie = idx < chunks.length - 1 || tiedToNext ? "-" : "";
      return `${pitch}${len}${tie}`;
    })
    .join("");
}

interface CleanEvent {
  readonly event: ScoreEvent;
  readonly lyric: string;
  readonly startUnit: number;
  readonly endUnit: number;
}

function normalizeTrackEvents(track: Track): CleanEvent[] {
  const lyrics = resolveLyricTokens(track);
  const raw = track.events
    .map((ev, i) => ({
      event: ev,
      lyric: lyrics[i] ?? "*",
      startUnit: Math.max(0, Math.round(ev.beat * 4)),
      endUnit: Math.max(1, Math.round((ev.beat + ev.beats) * 4)),
    }))
    .sort((a, b) => a.startUnit - b.startUnit);

  const out: CleanEvent[] = [];
  for (const item of raw) {
    const prev = out[out.length - 1];
    if (prev && item.startUnit < prev.endUnit) {
      if (item.startUnit === prev.startUnit) {
        if (prev.lyric === "*" && item.lyric !== "*") out[out.length - 1] = item;
        continue;
      }
      out[out.length - 1] = { ...prev, endUnit: item.startUnit };
    }
    if (item.endUnit > item.startUnit) out.push(item);
  }
  return out;
}

function buildVoiceBody(
  piece: Piece,
  track: Track,
  bars: ReturnType<typeof measures>,
  includeChords: boolean,
): { bodyLines: string[]; spans: AbcNoteSpan[] } {
  const events = normalizeTrackEvents(track);
  const sig = vexKeySignature(piece.key, piece.mode);
  const chordByUnit = new Map<number, string>();
  if (includeChords) {
    for (const ch of piece.chords) {
      const u = Math.max(0, Math.round(ch.beat * 4));
      if (!chordByUnit.has(u) && ch.name) chordByUnit.set(u, ch.name.replace(/"/g, ""));
    }
  }

  const spans: AbcNoteSpan[] = [];
  const barMusic: string[] = [];
  const barLyrics: string[] = [];
  let evIdx = 0;

  for (const bar of bars) {
    const barStartU = Math.round(bar.start * 4);
    const barEndU = Math.max(barStartU + 1, Math.round(bar.end * 4));
    const activeAcc = keySigAccidentals(sig);
    const musicTokens: string[] = [];
    const lyricTokens: string[] = [];
    let cursorU = barStartU;

    const emitChordAt = (u: number): string => {
      const name = chordByUnit.get(u);
      if (!name) return "";
      chordByUnit.delete(u);
      return `"${name}"`;
    };

    while (cursorU < barEndU) {
      while (evIdx < events.length && events[evIdx].endUnit <= cursorU) evIdx++;
      const cur = events[evIdx];

      if (!cur || cur.startUnit >= barEndU) {
        let nextChordU = barEndU;
        for (const cu of chordByUnit.keys()) {
          if (cu > cursorU && cu < nextChordU) nextChordU = cu;
        }
        musicTokens.push(`${emitChordAt(cursorU)}${encodeRestSegment(nextChordU - cursorU)}`);
        cursorU = nextChordU;
        continue;
      }

      if (cur.startUnit > cursorU) {
        let restEndU = Math.min(cur.startUnit, barEndU);
        for (const cu of chordByUnit.keys()) {
          if (cu > cursorU && cu < restEndU) restEndU = cu;
        }
        musicTokens.push(`${emitChordAt(cursorU)}${encodeRestSegment(restEndU - cursorU)}`);
        cursorU = restEndU;
        continue;
      }

      const segEndU = Math.min(cur.endUnit, barEndU);
      const segLenU = Math.max(1, segEndU - cursorU);
      const continuedFromPrev = cursorU > cur.startUnit;
      const continuesNext = cur.endUnit > barEndU;
      const pitch = abcPitch(cur.event.midi, piece.key, piece.mode, activeAcc);

      musicTokens.push(`${emitChordAt(cursorU)}${encodeNoteSegment(pitch, segLenU, continuesNext)}`);
      if (!continuedFromPrev) {
        lyricTokens.push(cur.lyric);
        spans.push({
          beat: cur.startUnit / 4,
          endBeat: cur.endUnit / 4,
          midi: cur.event.midi,
          text: cur.lyric === "*" ? "" : cur.lyric.replace(/\\-/g, "-"),
          voiceId: track.id,
        });
      }
      cursorU = segEndU;
      if (cursorU >= cur.endUnit) evIdx++;
    }

    barMusic.push(musicTokens.join(" "));
    barLyrics.push(lyricTokens.join(" "));
  }

  const bodyLines: string[] = [];
  for (let i = 0; i < barMusic.length; i += 4) {
    const chunkMusic = barMusic.slice(i, i + 4).join(" | ");
    const isLast = i + 4 >= barMusic.length;
    bodyLines.push(`${chunkMusic} ${isLast ? "|]" : "|"}`);
    const chunkLyrics = barLyrics.slice(i, i + 4).filter(Boolean).join(" ");
    if (chunkLyrics.trim()) bodyLines.push(`w: ${chunkLyrics}`);
  }
  return { bodyLines, spans };
}

export function buildPieceVoiceSpecs(
  piece: Piece,
  voices: readonly MoppetVoice[],
  studio404: boolean,
): AbcVoiceSpec[] {
  const nonEmpty = piece.tracks.filter((t) => t.events.length > 0);
  return nonEmpty.map((tr, i) => {
    const v = voices.find((x) => x.id === tr.id);
    const ident = v ? resolvePerformerIdentity(v, studio404, piece.title) : null;
    const clef = clefForVoice(tr.events.map((e) => e.midi), v?.register);
    let group = clef === "bass" ? "Bass" : i === 0 ? "Lead" : "Treble";
    if (piece.kind === "round") {
      const gIdx = ROUND_GROUPS.findIndex((g) => g.includes(tr.id));
      if (gIdx >= 0) group = `Group ${gIdx + 1}`;
    }
    return {
      index: i,
      id: tr.id,
      name: ident?.name ?? tr.id,
      group,
      clef,
      paperColor: palette[i % palette.length]!,
      darkColor: darkPalette[i % darkPalette.length]!,
      charColor: ident?.color ?? darkPalette[i % darkPalette.length]!,
    };
  });
}

export function pieceToAbc(
  piece: Piece,
  voices: readonly MoppetVoice[],
  studio404: boolean,
  options: { trackIds?: readonly string[] | "all" } = {},
): AbcConversionResult {
  const bars = measures(piece);
  const meter = piece.meter?.trim() || "4/4";
  const keyStr = `${KEY_TO_ABC[piece.key]}${MODE_TO_ABC[piece.mode]}`;
  const allSpecs = buildPieceVoiceSpecs(piece, voices, studio404);
  const nonEmptyTracks = piece.tracks.filter((t) => t.events.length > 0);

  const selectedSpecs =
    !options.trackIds || options.trackIds === "all"
      ? allSpecs
      : allSpecs.filter((sp) => (options.trackIds as readonly string[]).includes(sp.id));

  const activeSpecs = selectedSpecs.length > 0 ? selectedSpecs : allSpecs.slice(0, 1);

  const lines: string[] = [
    "X:1",
    `M:${meter}`,
    "L:1/16",
    `Q:1/4=${Math.max(30, Math.round(piece.bpm))}`,
    `K:${keyStr}`,
  ];

  const noteSpansByVoice: AbcNoteSpan[][] = [];

  if (activeSpecs.length === 1) {
    const sp = activeSpecs[0];
    const tr = nonEmptyTracks.find((t) => t.id === sp.id)!;
    if (sp.clef === "bass") lines.push("V:1 clef=bass");
    const built = buildVoiceBody(piece, tr, bars, true);
    lines.push(...built.bodyLines);
    noteSpansByVoice.push(built.spans);
  } else if (activeSpecs.length > 1) {
    // Bracket grouped voices (`%%staves [1 2 ...]`) so every character keeps a dedicated staff + lyrics
    lines.push(`%%staves [${activeSpecs.map((_, idx) => idx + 1).join(" ")}]`);
    activeSpecs.forEach((sp, idx) => {
      const vNum = idx + 1;
      const vName = sp.name.replace(/"/g, "");
      lines.push(`V:${vNum} name="${vName}" clef=${sp.clef}`);
    });
    activeSpecs.forEach((sp, idx) => {
      const tr = nonEmptyTracks.find((t) => t.id === sp.id)!;
      lines.push(`[V:${idx + 1}]`);
      const built = buildVoiceBody(piece, tr, bars, idx === 0);
      lines.push(...built.bodyLines);
      noteSpansByVoice.push(built.spans);
    });
  }

  return {
    abc: lines.join("\n"),
    voiceSpecs: activeSpecs,
    noteSpansByVoice,
    totalBars: bars.length,
  };
}
