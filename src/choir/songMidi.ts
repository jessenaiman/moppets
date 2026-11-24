// The DAW files live next to their lyric sheets. Only the requested score is decoded.
import { parseMidi, scoreFromMidi } from "./midi.ts";
import type { Piece } from "./music.ts";

declare const require: {
  context(dir: string, recursive: boolean, match: RegExp): { keys(): string[]; (path: string): string };
};

function bundledScores(): Record<string, string> {
  if ((import.meta as ImportMeta & { webpack?: number }).webpack) {
    const files = require.context("../../songs", false, /\.mid$/);
    return Object.fromEntries(files.keys().map((key) => [key.slice(2, -4), files(key)]));
  }
  if (typeof Bun !== "undefined") return {};
  const files = import.meta.glob<string>("../../songs/*.mid", { eager: true, import: "default", query: "?url&inline" });
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [path.split("/").pop()!.slice(0, -4), data]));
}

const sources = bundledScores();
const parsed = new Map<string, ReturnType<typeof parseMidi>>();

function readSongScore(id: string) {
  let score = parsed.get(id);
  if (!score) {
    let bytes: Uint8Array;
    if (sources[id]) {
      const uri = sources[id];
      bytes = Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), (char) => char.charCodeAt(0));
    } else if (typeof Bun !== "undefined" && /^[a-z0-9-]+$/.test(id)) {
      // The local audio renderer runs the same songbook directly in Bun.
      const fs: typeof import("node:fs") = import.meta.require("node:fs");
      const file = import.meta.dir + "/../../songs/" + id + ".mid";
      if (!fs.existsSync(file)) return;
      bytes = fs.readFileSync(file);
    } else {
      return;
    }
    score = parseMidi(bytes);
    parsed.set(id, score);
  }
  return score;
}

export function withSongMidi(id: string, sheet: Piece, originalSheet?: Piece): Piece {
  const midiFile = `songs/${id}.mid`;
  try {
    const score = readSongScore(id);
    if (!score) return sheet;
    const { piece, kept } = scoreFromMidi(sheet, score);
    // A local lead-sheet draft can deliberately change a pitch, rhythm or tempo.
    // Keep other DAW edits when the writer only changes a word or a different note.
    if (originalSheet) {
      if (sheet.bpm !== originalSheet.bpm) piece.bpm = sheet.bpm;
      piece.tracks = piece.tracks.map((track, i) => {
        const draft = sheet.tracks[i],
          original = originalSheet.tracks.find((t) => t.id === track.id);
        if (!original || original.events.length !== draft.events.length) return draft;
        return {
          ...track,
          events: track.events.map((n, j) => {
            const a = original.events[j],
              b = draft.events[j];
            return {
              ...n,
              midi: a.midi === b.midi ? n.midi : b.midi,
              beat: a.beat === b.beat ? n.beat : b.beat,
              beats: a.beats === b.beats ? n.beats : b.beats,
            };
          }),
        };
      });
    }
    const midiNotice = kept.length
      ? `Using lyric-sheet notes for ${kept.join(", ")}. Match the MIDI note count to the words.`
      : undefined;
    return { ...piece, midiFile, midiNotice };
  } catch (error) {
    return {
      ...sheet,
      midiFile,
      midiNotice: `Using the lyric sheet. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
