import React from "react";
import type { Piece } from "../choir/music.ts";

export const neonAtlas = (rolling: boolean, open: boolean) =>
  `/rehearsal/rigs/neon/solo/${rolling ? "roll" : "sing"}-${open ? "open" : "closed"}.webp`;

export function neonScore(piece: Piece) {
  const track = piece.tracks.find((t) => t.id === "vee");
  const sections = piece.sections ?? [];
  const lines = new Map<number, { start: number; end: number }>();
  for (const n of track?.events ?? []) {
    if (n.line === undefined) continue;
    const line = lines.get(n.line);
    if (line) line.end = n.beat + n.beats;
    else lines.set(n.line, { start: n.beat, end: n.beat + n.beats });
  }
  const gestures = [...lines.values()].map((line) => {
    const s = sections.filter((s) => s.beat <= line.start).at(-1);
    const index = [...lines.values()].filter(
      (l) => l.start >= (s?.beat ?? 0) && l.start < line.start,
    ).length;
    const peak =
      s?.name === "Finale"
        ? 76
        : s?.name === "the dark"
          ? 95
          : s?.name === "twin take" && index >= 2
            ? 76
            : index % 2
              ? 46
              : 15;
    return { ...line, peak };
  });
  const dark = sections.find((s) => s.name === "the dark")?.beat;
  return {
    gestures,
    dark,
    reprise: sections.filter(s => s.name === "twin take").at(-1)?.beat,
    secondRoll: dark === undefined ? undefined : dark + 8,
  };
}

function interpolate(
  points: readonly (readonly [number, number])[],
  t: number,
) {
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i],
      [prev, v] = points[i - 1];
    if (t <= x) return v + (y - v) * Math.max(0, (t - prev) / (x - prev));
  }
  return points[points.length - 1][1];
}
// At the bind the kingpin and floor position stop together. The extra native
// frames carry only the ballast, sleeves and boot past the stopped axle.
const rollTravel = [
  [0, 0],
  [0.18, 0.24],
  [0.32, 0.54],
  [0.405, 0.65],
  [0.665, 0.65],
  [0.72, 0.66],
  [0.88, 0.9],
  [1, 1],
] as const;
export function neonTake(
  score: ReturnType<typeof neonScore>,
  beat: number,
  playing: boolean,
  still: boolean,
) {
  const dark =
    score.dark !== undefined && beat >= score.dark && beat < score.dark + 16;
  const second = score.secondRoll !== undefined && beat >= score.secondRoll;
  const t = Math.max(
    0,
    Math.min(1, (beat - (second ? score.secondRoll! : 0)) / 4),
  );
  const rolling = playing && !still && t < 1;
  const x = !playing
    ? 28
    : still
      ? 43
      : second
        ? 38 + 5 * interpolate(rollTravel, t)
        : 28 + 10 * interpolate(rollTravel, t);
  const g = score.gestures.filter((g) => g.start <= beat).at(-1);
  let frame = 0,
    cyan = 0.32,
    rose = 0.32;
  if (rolling) {
    frame = Math.round(47 * t);
    cyan = t < 0.36 ? 0.9 : 0.45;
    rose = t < 0.36 ? 0.25 : 0.55;
  } else if (playing && g) {
    const elapsed = beat - g.start;
    const strength = Math.max(
      0,
      Math.min(1, elapsed / 0.65, (g.end + 0.6 - beat) / 0.7),
    );
    const from =
      g.peak === 15 ? 0 : g.peak === 46 ? 30 : g.peak === 76 ? 60 : 85;
    frame = Math.round(from + (g.peak - from) * strength);
    cyan = g.peak === 95 ? 0.09 : g.peak === 46 ? 0.18 : 0.35 + 0.65 * strength;
    rose = g.peak === 95 ? 0.09 : g.peak === 15 ? 0.18 : 0.35 + 0.65 * strength;
  }
  // On the second catch, leave the singer's face for the cause of the silence.
  const detail = rolling && second ? interpolate([[0,0],[.14,0],[.34,1],[.67,1],[.91,0],[1,0]],t) : 0;
  // The answering light finds the empty floor mark during “Sing with me”.
  const invitation = playing && score.dark !== undefined && beat >= score.dark + 12;
  const partnerLight = invitation ? interpolate([[0, 0], [2, 1]], beat - score.dark! - 12) : 0;
  const sharedLight = score.reprise !== undefined && beat >= score.reprise && invitation;
  return { detail, partnerLight, sharedLight, rolling, frame: still ? 0 : frame, x, cyan, rose, dark };
}

export function NeonSolo({
  take,
  open,
  resolveAsset,
}: {
  take: ReturnType<typeof neonTake>;
  open: boolean;
  resolveAsset: (path: string) => string;
}) {
  const cols = take.rolling ? 8 : 12,
    rows = take.rolling ? 6 : 8;
  return (
    <span
      className="neon-performer"
      aria-hidden="true"
      data-take={take.rolling ? "roll" : "sing"}
      data-cel={take.frame}
      style={{
        backgroundImage: `url("${resolveAsset(neonAtlas(take.rolling, open))}")`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${((take.frame % cols) * 100) / (cols - 1)}% ${(Math.floor(take.frame / cols) * 100) / (rows - 1)}%`,
      }}
    />
  );
}
export function RepairBayLights({
  take,
}: {
  take: ReturnType<typeof neonTake>;
}) {
  return (
    <div
      className="neon-bay-lights"
      style={{ backgroundColor: `rgba(12,13,22,${take.dark ? 0.67 : 0.09})` }}
    >
      <i className="neon-partner-spot" data-shared={take.sharedLight} style={{ opacity: take.partnerLight }} />
      <i className="neon-cyan-spill" style={{ opacity: take.cyan }} />
      <i className="neon-rose-spill" style={{ opacity: take.rose }} />
    </div>
  );
}
