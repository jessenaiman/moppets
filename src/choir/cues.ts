/**
 * When the Moppets act while they sing: gesture cues for any sung piece, on top of the ones a
 * piece writes itself (a songbook phrase's `do`, a skit line's `do` and `react`).
 *
 *  - an entrance after a rest of REST beats or more (or the first note): a nod a beat before, a count-in
 *  - a sung question (a phrase ending in "?"): the head cocks as it starts
 *  - the final chord: everyone holding it bows, finishing as the note ends
 */
import { beatSeconds } from "./plan.ts";
import { gestureSeconds } from "./gestures.ts";
import type { Piece } from "./music.ts";

const REST = 12;
const memo = new WeakMap<Piece, NonNullable<Piece["cues"]>>();

export function cuesFor(piece: Piece): NonNullable<Piece["cues"]> {
  const known = memo.get(piece);
  if (known) return known;
  const own = piece.cues ?? [];
  if (piece.kind === "skit") return own;
  const cues = [...own];
  const bs = beatSeconds(piece);
  const end = Math.max(...piece.tracks.flatMap((t) => t.events.map((e) => e.beat + e.beats)));
  for (const t of piece.tracks) {
    let last = -Infinity, line: number | undefined;
    for (const e of t.events) {
      if (e.beat - last >= REST && (last === -Infinity || e.beats >= 0.75)) cues.push({ beat: Math.max(0, e.beat - 1), who: t.id, gesture: "nod" });
      const words = e.line === undefined ? undefined : (t.phrases ?? t.lines)?.[e.line];
      if (e.line !== line && words && /\?\s*$/.test(words)) cues.push({ beat: e.beat, who: t.id, gesture: "tilt" });
      line = e.line;
      last = e.beat + e.beats;
    }
    const fin = t.events[t.events.length - 1];
    // on a short last note the bow starts over the last few, so it is done as the music stops
    if (fin && Math.abs(fin.beat + fin.beats - end) < 0.5) cues.push({ beat: Math.max(0, end - (gestureSeconds("bow") + 0.1) / bs), who: t.id, gesture: "bow" });
  }
  cues.sort((a, b) => a.beat - b.beat);
  memo.set(piece, cues);
  return cues;
}
