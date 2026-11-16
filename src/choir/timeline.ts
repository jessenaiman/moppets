/** The shared timeline's constants (engine-free, so workers and worklets can import them). */
import type { Piece } from "./music.ts";

/** Silence on the timeline before beat 0, so the first onset's consonant has room. */
export const LEAD_IN = 0.4;
/** Tail after the last beat for the final release to ring out. */
export const TAIL = 0.6;

export const beatSeconds = (piece: Piece) => 60 / piece.bpm;
export const pieceSeconds = (piece: Piece) => LEAD_IN + piece.beats * beatSeconds(piece) + TAIL;
