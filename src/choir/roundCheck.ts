/** The round's words check (needs the engine's syllable splitter, so it lives apart from music.ts, which stays engine-free). */
import { lyricsToSyllables } from "../wasm/engine.ts";
import { roundWords, type RoundLyrics } from "./music.ts";

/** What stops a set of words being sung on the round's tune: one note per syllable, eight to a line. Load the dictionary first. */
export function roundProblems(w: Partial<RoundLyrics>): string[] {
  if (!Array.isArray(w.lines) || w.lines.length !== 4 || typeof w.last !== "string" || typeof w.title !== "string") return ["it needs a title, four lines and a last word"];
  const out: string[] = [];
  w.lines.forEach((l, i) => {
    const words = roundWords(String(l));
    if (words.length !== 8) out.push(`line ${i + 1} has ${words.length} words, not 8`);
  });
  const multi = [...w.lines.flatMap((l) => roundWords(String(l))), ...roundWords(w.last)].filter((x) => lyricsToSyllables(x).length !== 1);
  if (multi.length) out.push(`these are not one syllable: ${[...new Set(multi)].join(", ")}`);
  if (roundWords(w.last).length !== 1) out.push("the last word must be one word");
  return out;
}

