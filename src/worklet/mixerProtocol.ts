/** Messages to and from the choir's mixer worklet. */
import type { GainSection } from "../choir/mix.ts";

export type MixerIn =
  /** a piece of one voice, placed by its absolute frame on the shared timeline */
  | { type: "chunk"; voice: number; generation: number; frame: number; pcm: Float32Array }
  /** a new session: how many stems, their end frames and mix gains */
  | { type: "setup"; ends: number[]; gains: number[]; ports: MessagePort[]; section?: GainSection }
  | { type: "play"; generation: number; frame: number }
  | { type: "pause" }
  | { type: "clear"; generation: number }
  | { type: "gains"; gains: number[] }
  /** which stem feeds the analysers (the inspected Moppet) */
  | { type: "solo"; voice: number };

export type MixerOut =
  | { type: "pos"; frame: number; contextFrame: number; playing: boolean; underruns: number; underrunFrames: number; load: number; limited: number; peak: number; buffering: boolean; missing: number }
  | { type: "ended"; frame: number; underruns: number; underrunFrames: number };
