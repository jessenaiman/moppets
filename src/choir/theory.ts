/**
 * Musical ideas to pick from: church modes, cadence-bearing progressions, grooves, sound palettes.
 * Everything a new invention is made of is one of these named concepts, chosen by the user, and
 * the seed only decides small choices inside them.
 */
import type { ScaleMode } from "./music.ts";

export interface ModeInfo {
  id: ScaleMode;
  label: string;
  /** the chord (scale degree) that leads home in this mode */
  approach: number;
}
export const MODES: ModeInfo[] = [
  { id: "major", label: "Major (Ionian)", approach: 4 },
  { id: "minor", label: "Harmonic minor", approach: 4 },
  { id: "aeolian", label: "Natural minor (Aeolian)", approach: 6 },
  { id: "dorian", label: "Dorian", approach: 3 },
  { id: "mixolydian", label: "Mixolydian", approach: 6 },
  { id: "lydian", label: "Lydian", approach: 1 },
  { id: "phrygian", label: "Phrygian", approach: 1 },
];

/** Bars 1–6 of an eight-bar idea, in scale degrees; bars 7–8 are always the mode's approach, then home. */
export interface Progression {
  id: string;
  label: string;
  degrees: number[];
}
export const PROGRESSIONS: Progression[] = [
  { id: "doowop", label: "Doo-wop · I–vi–IV–V", degrees: [0, 5, 3, 4, 0, 5] },
  { id: "pop", label: "Four chords · I–V–vi–IV", degrees: [0, 4, 5, 3, 0, 4] },
  { id: "circle", label: "Circle of fifths · vi–ii–V–I", degrees: [5, 1, 4, 0, 3, 1] },
  { id: "andalusian", label: "Andalusian descent · i–VII–VI–V", degrees: [0, 6, 5, 4, 0, 6] },
  { id: "plagal", label: "Gospel plagal · I–IV–I–IV", degrees: [0, 3, 0, 3, 5, 3] },
  { id: "vamp", label: "Modal vamp · I–♭VII–I–IV", degrees: [0, 6, 0, 3, 0, 6] },
];

export interface Groove {
  id: string;
  label: string;
  bpm: number;
  /** one-bar rhythm cells for the lead (sum to 4) */
  cells: number[][];
  /** note length of the harmony parts */
  pad: number;
  /** bass in this style: a figure in beats */
  bass: number[];
  /** scat syllables that fit the feel */
  scat: string[];
  /** beatbox pattern (CHIMERA's preset notation) and its swing, 16 steps to the bar */
  beat: { text: string; swing: number };
}
const SWING = 2 / 3;
export const GROOVES: Groove[] = [
  { id: "swing", label: "Swing shuffle", bpm: 96, cells: [[SWING, 1 - SWING, 1, SWING, 1 - SWING, 1], [1, SWING, 1 - SWING, 2], [SWING, 1 - SWING, SWING, 1 - SWING, 2]], pad: 2, bass: [1, 1, 1, 1], scat: ["doo", "bah", "dah", "skoo"], beat: { text: "B . t . | Pf . t K | B . t . | Pf . t K", swing: 0.45 } },
  { id: "bossa", label: "Bossa stroll", bpm: 118, cells: [[1.5, 1.5, 1], [0.75, 0.75, 0.5, 1, 1], [1.5, 1, 1.5]], pad: 4, bass: [1.5, 0.5, 1.5, 0.5], scat: ["bah", "da", "shoo", "lay"], beat: { text: "B . t K | . t B . | t B . K | . B t .", swing: 0.05 } },
  { id: "boombap", label: "Boom-bap head-nod", bpm: 88, cells: [[1, 0.5, 0.5, 2], [0.5, 1, 0.5, 1, 1], [1.5, 0.5, 2]], pad: 2, bass: [2.5, 1.5], scat: ["yo", "uh", "nah", "ay"], beat: { text: "B . t . | Pf . t . | B B t . | Pf . t t", swing: 0.18 } },
  { id: "funk", label: "Sticky funk", bpm: 106, cells: [[0.5, 0.5, 0.75, 0.25, 1, 1], [0.75, 0.25, 0.5, 0.5, 2], [1, 0.5, 0.5, 1, 1]], pad: 1, bass: [0.75, 0.75, 0.5, 2], scat: ["wop", "get", "bam", "hey"], beat: { text: "B . t K | Pf t . t | B B t K | Pf . B t", swing: 0.1 } },
  { id: "doowop", label: "Slow doo-wop", bpm: 72, cells: [[2, 2], [1, 1, 2], [2, 1, 1]], pad: 4, bass: [1, 1, 1, 1], scat: ["shoo", "bop", "sha", "la"], beat: { text: "B . . . | Pf . t . | B . . . | Pf . t .", swing: 0.3 } },
  { id: "march", label: "Sock-puppet march", bpm: 124, cells: [[1, 1, 1, 1], [0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 2]], pad: 2, bass: [1, 1, 1, 1], scat: ["rum", "tum", "ta", "dum"], beat: { text: "B . t . | B . t . | B . tss . | B . t .", swing: 0 } },
];

/** A grouping of CHIMERA's sound sources to arrange the piece for. */
export interface Palette {
  id: string;
  label: string;
  /** add the beatbox stem */
  beatbox: boolean;
  /** creature cameos: which of CHIMERA's animals answer the singers at phrase ends */
  creatures: string[];
}
export const PALETTES: Palette[] = [
  { id: "choir", label: "Six-part choir", beatbox: false, creatures: [] },
  { id: "beatband", label: "Beatbox band", beatbox: true, creatures: [] },
  { id: "menagerie", label: "Menagerie", beatbox: false, creatures: ["songbird", "seal", "alligator"] },
  { id: "circus", label: "Full circus", beatbox: true, creatures: ["songbird", "elephant"] },
];
export const findGroove = (id: string): Groove => GROOVES.find((g) => g.id === id) ?? GROOVES[0];
export const findMode = (id: string): ModeInfo => MODES.find((m) => m.id === id) ?? MODES[0];
export const findProgression = (id: string): Progression => PROGRESSIONS.find((p) => p.id === id) ?? PROGRESSIONS[0];
export const findPalette = (id: string): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

/** Calls each animal can answer with (CHIMERA's bestiary catalogue names). */
export const CREATURE_CALLS: Record<string, string[]> = { songbird: ["chirps", "trill", "buzz"], seal: ["trill", "zap"], alligator: ["bellow", "growl"], elephant: ["rumble"] };
