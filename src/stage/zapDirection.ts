import type { Piece } from "../choir/music.ts";
import { WASH_STROKES } from "../choir/zapBand.ts";

type Program =
  | "rain"
  | "sun"
  | "moon"
  | "cake"
  | "sky"
  | "cat"
  | "bars"
  | "tabby"
  | "zap"
  | "black"
  | "sunshower"
  | "spark";
type Press = "single" | "pair" | "mash" | "click" | "last";
interface Motion {
  at: number;
  kind: Press;
}
interface Transmission {
  at: number;
  picture: Program;
}
type Direction = readonly [syllable: number, press: Press, picture: Program];

const verses: Record<string, readonly Direction[]> = {
  "verse 1": [
    [7, "single", "rain"],
    [5, "pair", "sunshower"],
    [6, "mash", "bars"],
    [1, "single", "tabby"],
  ],
  "verse 2": [
    [2, "pair", "bars"],
    [5, "single", "sky"],
    [4, "mash", "zap"],
    [5, "single", "cat"],
  ],
  bridge: [
    [0, "single", "black"],
    [2, "single", "spark"],
    [3, "pair", "spark"],
    [2, "single", "black"],
  ],
};

/** Bind the acting to the same authored syllables and section entrances the singers use. */
export function zapCues(piece: Piece) {
  const motions: Motion[] = [],
    pictures: Transmission[] = [];
  const notes = new Map<number, number[]>();
  const track = piece.tracks.find((t) => t.id === "zap");
  for (const e of track?.events ?? []) {
    if (e.line === undefined) continue;
    const line = notes.get(e.line) ?? [];
    line.push(e.beat);
    notes.set(e.line, line);
  }
  const sections = piece.sections ?? [];
  let choruses = 0,
    wash: number | undefined;
  for (const [i, section] of sections.entries()) {
    const lines = [...notes.values()].filter(
      (n) => n[0] >= section.beat && n[0] < (sections[i + 1]?.beat ?? Infinity),
    );
    if (section.name === "washboard") {
      wash = section.beat;
      const tapes: Program[] = ["rain", "moon", "cake", "cat"];
      WASH_STROKES.forEach((s, j) =>
        pictures.push({ at: section.beat + s.beat + 0.1, picture: tapes[j] }),
      );
      continue;
    }
    if (section.name === "chorus") choruses++;
    lines.forEach((n, j) => {
      const start = n[0];
      const direction = verses[section.name]?.[j];
      if (direction) {
        const [syllable, kind, picture] = direction,
          at = n[Math.min(syllable, n.length - 1)];
        motions.push({ at, kind });
        pictures.push({ at: at + 0.16, picture });
        return;
      }
      if (section.name === "Finale") {
        motions.push({ at: start, kind: "last" });
        pictures.push({ at: start + 0.2, picture: "black" });
        return;
      }
      if (section.name !== "chorus") return;
      if (j === 0 || j === 3)
        motions.push({
          at: start,
          kind:
            j === 0 && choruses === 1
              ? "single"
              : j === 3 && choruses > 1
                ? "mash"
                : "pair",
        });
      if (j === 2 || j === 5)
        pictures.push({
          at: start,
          picture:
            j === 2
              ? choruses === 1
                ? "cake"
                : "moon"
              : choruses === 1
                ? "moon"
                : "cat",
        });
      if (j === 6) n.forEach((at) => motions.push({ at, kind: "click" }));
    });
  }
  return { motions, pictures, wash };
}

// Atlas coordinates in the authored EffectCraft composition. Pose 0 is the clear hover.
const poses: Record<Press, readonly [number, number, number, number]> = {
  single: [0, 8, 10, 15],
  pair: [16, 23, 28, 31],
  mash: [32, 40, 45, 47],
  click: [65, 67, 68, 69],
  last: [75, 80, 84, 89],
};
function between(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
}
export function zapTake(cuts: ReturnType<typeof zapCues>, beat: number) {
  const picture = cuts.pictures.filter((p) => p.at <= beat).at(-1);
  const washBeat = beat - (cuts.wash ?? Infinity);
  const wash = washBeat >= 0 && washBeat < 4;
  const cue = cuts.motions
    .filter((m) => m.at - (m.kind === "click" ? 0.15 : 0.55) <= beat)
    .at(-1);
  const dt = beat - (cue?.at ?? Infinity);
  let frame = 0,
    signal = 0,
    tilt = 0;
  if (wash) {
    const marks = [
      [0, 53],
      [0.88, 58],
      [1, 60],
      [1.82, 65],
      [2, 67],
      [2.22, 68],
      [2.5, 70],
      [2.72, 71],
      [3, 72],
      [4, 72],
    ];
    const i = marks.findIndex(([t]) => t > washBeat);
    frame = between(
      marks[i - 1][1],
      marks[i][1],
      (washBeat - marks[i - 1][0]) / (marks[i][0] - marks[i - 1][0]),
    );
    tilt = washBeat < 3 ? -3 * Math.sin((Math.PI * washBeat) / 3) : 0;
    signal = WASH_STROKES.some(
      (s) => washBeat >= s.beat && washBeat < s.beat + s.beats,
    )
      ? 1
      : 0;
  } else if (cue) {
    const [start, contact, hold, end] = poses[cue.kind];
    const quick = cue.kind === "click",
      lead = quick ? 0.15 : 0.55,
      stay = quick ? 0.16 : cue.kind === "mash" ? 1.6 : 0.85,
      release = quick ? 0.17 : 0.58;
    frame =
      dt < 0
        ? between(start, contact, 1 + dt / lead)
        : dt < stay
          ? between(contact, hold, dt / stay)
          : dt < stay + release
            ? between(hold, end, (dt - stay) / release)
            : 0;
    if (dt >= 0 && dt < stay + release)
      tilt =
        (cue.kind === "mash" ? -4 : -1.8) *
        Math.sin((Math.PI * dt) / (stay + release));
    signal = dt >= 0 && dt < 0.26 ? 1 - dt / 0.26 : 0;
  }
  const age = beat - (picture?.at ?? Infinity);
  return {
    frame,
    picture: picture?.picture,
    signal,
    tilt,
    roll: age >= 0 && age < 0.3 ? age / 0.3 : null,
  };
}
