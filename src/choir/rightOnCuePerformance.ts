import type { puppetActions } from "../stage/RehearsalActor.tsx";
import type { Piece } from "./music.ts";
import type { PerformerAvatarCel } from "./performer.ts";

type CueAction = typeof puppetActions.cue[number];
type NeonAction = typeof puppetActions.neon[number];
type Move<Action extends string> = {
  action: Action;
  phase: number;
};
type ActionCue<Action extends string> = readonly [
  beat: number, duration: number, action: Action,
];
type SectionScore = {
  cue: readonly ActionCue<CueAction>[];
  neon: readonly ActionCue<NeonAction>[];
};

// Offsets are relative to the lead sheet's named sections. Each atlas returns to its rest pose.
const sections: Record<string, SectionScore> = {
  Intro: {
    cue: [[1, 2.5, "listen"]],
    neon: [[0.5, 3, "listen"]],
  },
  "the offer": {
    // Cue presents the mark, loses the line, then takes in Neon's offer.
    cue: [[0, 3.75, "offer"], [4.25, 3.5, "listen"], [8, 3.75, "recover"], [12.5, 3.25, "listen"]],
    neon: [[0.5, 3.25, "listen"], [4, 3.75, "answer"], [8.5, 3.25, "listen"], [12, 4, "answer"]],
  },
  "step inside": {
    // Cue lays the loop. Neon checks its edge and steps in on the answer.
    cue: [[0, 4, "cast"], [4, 3.75, "listen"], [8, 4, "offer"], [12.5, 3.25, "listen"]],
    neon: [[0.5, 3, "listen"], [4, 3.5, "step"], [8.5, 3, "acknowledge"], [12, 4, "answer"]],
  },
  "right on cue": {
    // Each takes the other's harmony before they share the mark for the long line.
    cue: [[0, 3.75, "offer"], [4, 3.75, "listen"], [8, 4, "offer"], [12.75, 3.25, "listen"]],
    neon: [[0.5, 3.25, "acknowledge"], [4, 3.75, "answer"], [8, 3.5, "listen"], [12, 4, "answer"]],
  },
  "missed entrance": {
    // The bow starts under Cue's line, holds through the rest, and clears for the excuse.
    cue: [[0.5, 7.5, "bow"], [8, 4, "recover"]],
    neon: [[1, 3.5, "listen"], [5.75, 2.25, "acknowledge"], [8.5, 3.25, "listen"]],
  },
  Finale: {
    // This time Cue waits until the final chord.
    cue: [[0.75, 3.25, "bow"]],
    neon: [[1, 3, "acknowledge"]],
  },
};

const clamp = (phase: number) => Math.max(0, Math.min(1, phase));

function moveAt<Action extends string>(actions: readonly ActionCue<Action>[], beat: number) {
  const cue = actions.find(([start, duration]) => beat >= start && beat < start + duration);
  if (!cue) return { action: "listen", phase: 0 } as const;
  const [start, duration, action] = cue;
  return { action, phase: clamp((beat - start) / duration) };
}

interface DuetTake {
  cue: Move<CueAction>;
  neon: Move<NeonAction>;
  cordFrame: number | null;
  neonTravel: number;
  camera: { zoom: number; focusX: number };
}

export function rightOnCuePerformance(piece: Piece, beat: number): DuetTake | null {
  if (piece.title !== "Right on Cue") return null;
  const section = piece.sections?.filter(({ beat: start }) => start <= beat).at(-1);
  const score = section ? sections[section.name] : undefined;
  const offset = beat - (section?.beat ?? 0);
  const cue = moveAt(score?.cue ?? [], offset);
  const neon = moveAt(score?.neon ?? [], offset);

  if (section?.name === "missed entrance" && cue.action === "bow") {
    // Hold the bow apex across the two-beat silence before Neon's “Too soon.”
    cue.phase = 0.5 * (clamp((offset - 0.5) / 3.5) + clamp((offset - 6) / 2));
  }

  const loopStart = piece.sections?.find(({ name }) => name === "step inside")?.beat;
  const loopEnd = piece.sections?.find(({ name }) => name === "missed entrance")?.beat ?? piece.beats;
  const cordFrame = loopStart !== undefined && beat >= loopStart && beat < loopEnd
    ? Math.round(47 * clamp(Math.min((beat - loopStart) / 4, (loopEnd - beat) / 2)))
    : null;

  const reaction = section?.name === "missed entrance"
    ? Math.min(clamp((offset - 5.75) / 0.5), clamp((9 - offset) / 1.25))
    : 0;
  return {
    cue, neon, cordFrame,
    neonTravel: loopStart === undefined ? 0 : clamp((beat - loopStart - 4) / 3.5),
    camera: { zoom: 1 + 0.16 * reaction, focusX: 0.5 - 0.13 * reaction },
  };
}

export function duetCel(take: DuetTake, actor: keyof typeof puppetActions): PerformerAvatarCel {
  const { action, phase } = take[actor];
  return {
    action, frame: Math.round(47 * phase), cols: 8, rows: 6, source: "pin-atlas",
    atlasUrl: `/rehearsal/pins/${actor}/${action}.webp`,
  };
}
