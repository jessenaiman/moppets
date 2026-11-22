import type { Piece } from "../choir/music";

export interface DioramaAction {
  atlasUrl: string;
  prelit?: boolean;
  frame: number;
  cols: number;
  rows: number;
}

export type DioramaActions = Record<string, DioramaAction>;

const strip = (atlasUrl: string, frame: number, prelit = false): DioramaAction => ({
  atlasUrl: "/rehearsal/performances/" + atlasUrl,
  frame, prelit, cols: 4, rows: 2,
});

export function dioramaActions(piece: Piece, beat: number, seconds: number, moving: boolean): DioramaActions {
  const time = moving ? Math.max(0, seconds) : 0;
  const actions: DioramaActions = { neon: strip("neon/step.webp", Math.floor(time * 8) % 8) };
  if (!moving) return actions;

  const section = piece.sections?.filter(section => section.beat <= beat).at(-1);
  if (piece.title === "Ribbon and Felt" && (beat < 4 || section?.name === "dance break")) {
    actions.tabby = strip("tabby/walk-right.webp", Math.floor(time * 12) % 8);
  }
  const bow = piece.cues?.filter(cue => cue.who === "chip" && cue.gesture === "bow" && cue.beat <= beat).at(-1);
  if (bow && beat < bow.beat + 3) {
    actions.chip = strip("chip/acting.webp", Math.floor((beat - bow.beat) * 8 / 3), true);
  }
  const welcome = piece.cues?.find(cue => cue.who === "pip" && cue.gesture === "gasp");
  if (piece.title === "Every Socket" && welcome) {
    const frame = Math.floor((beat - welcome.beat) * 60 / piece.bpm * 8);
    if (frame >= 0 && frame < 8) actions.watt = strip("watt/socket-gestures.webp", frame, true);
  }
  return actions;
}
