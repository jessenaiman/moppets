/**
 * The Moppets' backing band: bass, electric piano and a drum kit, written as MIDI parts (General
 * MIDI programs, so the MIDI export opens in SoundCraft or any DAW as real instruments) and
 * synthesized into one background stem by bandSynth.ts. This file is pure (the mixer worklet
 * imports it through mix.ts): no engine, no audio, no animation.
 *
 * Any sung piece gets a band arranged from its chords (`arrange`); a piece can carry its own parts
 * instead (`piece.band`, e.g. edited in SoundCraft and loaded back). A piece with CHIMERA's beatbox
 * already has a drummer, so its kit sits out. Where the chords stop (a songbook rest), the band does.
 */
import type { Chord, Piece } from "./music.ts";
import { zapBand } from "./zapBand.ts";
import { neonBand } from "./neonBand.ts";
import { moonbeamBand } from "./moonbeamBand.ts";
import { promptBand } from "./promptBand.ts";
import { foundThingsBand } from "./foundThingsBand.ts";

export type BandId = "bass" | "keys" | "drums" | "xylophone";
export interface BandNote {
  beat: number;
  beats: number;
  midi: number;
  /** 1..127 */
  vel: number;
}
export interface BandPart {
  id: BandId;
  /** General MIDI program (0-based); the kit is channel 10 and ignores it */
  program: number;
  channel: number;
  notes: BandNote[];
}
/** GM programs: 33 Electric Bass (finger), 4 Electric Piano 1, 13 Xylophone; drums on channel 10 (index 9). */
export const BAND_SETUP: Record<BandId, { program: number; channel: number; name: string }> = {
  bass: { program: 33, channel: 10, name: "Bass" },
  keys: { program: 4, channel: 11, name: "Electric piano" },
  drums: { program: 0, channel: 9, name: "Drum kit" },
  xylophone: { program: 13, channel: 12, name: "Xylophone" },
};
/** GM drum notes */
export const KICK = 36, SIDE_STICK = 37, SNARE = 38, HAT = 42, BRUSH = 44, OPEN_HAT = 46, CRASH = 49;

let enabled = true;
/** The band switch (the Moppet store sets it). Off: no band in playback, WAVs or MIDI. */
export function setBandEnabled(on: boolean): void {
  enabled = on;
}
export const bandEnabled = () => enabled;

const memo = new WeakMap<Piece, BandPart[]>();
/** The band for a piece: its own parts, or an arrangement of its chords (none for a skit, or when off). */
export function bandFor(piece: Piece): BandPart[] {
  if (!enabled || piece.kind === "skit") return [];
  let parts = memo.get(piece);
  if (parts) return parts;
  if (piece.band) {
    parts = piece.band;
    if (
      piece.title === "Every Button" &&
      piece.stage?.includes("zap") &&
      piece.chords.length &&
      !parts.some((b) => b.id === "xylophone")
    ) {
      const xylo = zapBand(piece).find((b) => b.id === "xylophone");
      if (xylo) parts = [...parts, xylo];
    }
    memo.set(piece, parts);
    return parts;
  }
  memo.set(piece, (parts = arrange(piece)));
  return parts;
}

/** Bars of four, from the chords; a gap in the chords is a rest. */
function chordAt(chords: readonly Chord[], beat: number): Chord | undefined {
  return chords.find((c) => beat >= c.beat - 1e-6 && beat < c.beat + c.beats - 1e-6);
}

/** The pitch class `pc` placed nearest `centre`. */
const near = (pc: number, centre: number) => {
  const base = centre - ((((centre - pc) % 12) + 12) % 12);
  return centre - base > 6 ? base + 12 : base;
};

/** Intimate felt-and-brush accompaniment for Tabby's "Ribbon and Felt" spotlight. */
function ribbonAndFeltBand(piece: Piece): BandPart[] {
  const chords = piece.chords;
  if (!chords.length) return [];
  const bass: BandNote[] = [], keys: BandNote[] = [], drums: BandNote[] = [];
  const sectionAt = (beat: number) => piece.sections?.filter((s) => s.beat <= beat + 1e-6).at(-1)?.name ?? "";
  for (const c of chords) {
    const sec = sectionAt(c.beat), root = near(c.tones[0], 38), fifth = near(c.tones[2], root + 7);
    const voicing = c.tones.map((pc) => near(pc, 62)).sort((a, b) => a - b);
    const intro = sec === "Intro", dance = sec === "dance break", bow = sec === "curtain call", finale = sec === "Finale";
    if (intro || bow || finale) {
      bass.push({ beat: c.beat, beats: Math.max(1.5, c.beats * 0.9), midi: root, vel: finale ? 78 : 70 });
      voicing.forEach((m, i) => keys.push({ beat: c.beat + i * 0.035, beats: Math.max(1.5, c.beats * 0.9), midi: m, vel: (finale ? 54 : 46) + i * 2 }));
      if (intro) drums.push({ beat: c.beat + 2, beats: 0.25, midi: SIDE_STICK, vel: 44 }, { beat: c.beat + 3, beats: 0.25, midi: SIDE_STICK, vel: 40 });
      else if (bow) drums.push({ beat: c.beat + 1, beats: 0.35, midi: BRUSH, vel: 32 });
      continue;
    }
    bass.push({ beat: c.beat, beats: c.beats >= 3 && !dance ? 1.8 : 0.85, midi: root, vel: dance ? 84 : 76 });
    if (c.beats >= 3) bass.push({ beat: c.beat + 2, beats: 0.85, midi: fifth, vel: dance ? 72 : 62 });
    if (!dance) {
      voicing.forEach((m, i) => keys.push({ beat: c.beat + i * 0.03, beats: Math.max(0.8, c.beats * 0.85), midi: m, vel: 48 + i * 2 }));
    }
    for (let b = c.beat; b < c.beat + c.beats - 1e-6; b++) {
      const inBar = ((b % 4) + 4) % 4;
      if (dance && (inBar === 1 || inBar === 3)) for (const m of voicing) keys.push({ beat: b, beats: 0.4, midi: m, vel: 48 });
      if (inBar === 0) drums.push({ beat: b, beats: 0.4, midi: KICK, vel: dance ? 66 : 48 });
      if (inBar === 2) drums.push({ beat: b, beats: 0.3, midi: dance ? KICK : SIDE_STICK, vel: dance ? 60 : 44 });
      if (inBar === 1 || inBar === 3) drums.push({ beat: b, beats: 0.35, midi: dance ? SIDE_STICK : BRUSH, vel: dance ? 52 : 38 });
      if (dance) drums.push({ beat: b + 0.52, beats: 0.25, midi: BRUSH, vel: 32 });
    }
  }
  const part = (id: BandId, notes: BandNote[]): BandPart => ({ id, program: BAND_SETUP[id].program, channel: BAND_SETUP[id].channel, notes });
  return [part("bass", bass), part("keys", keys), ...(drums.length ? [part("drums", drums)] : [])];
}

export function arrange(piece: Piece): BandPart[] {
  if (piece.title === "Borrowed Light" && (piece.stage?.includes("moonbell") || piece.stage?.includes("neon"))) return moonbeamBand(piece);
  if ((piece.title === "Line?" || piece.title === "Right on Cue") && piece.stage?.includes("cue")) return promptBand(piece);
  if (piece.title === "Take Two" && piece.stage?.includes("neon")) return neonBand(piece);
  if (piece.title === "Every Button" && piece.stage?.includes("zap") && piece.chords.length) return zapBand(piece);
  if (piece.title === "Found Things") return foundThingsBand(piece);
  if (piece.title === "Ribbon and Felt" && piece.stage?.includes("tabby")) return ribbonAndFeltBand(piece);
  const chords = piece.chords;
  if (!chords.length) return [];
  const end = Math.max(...chords.map((c) => c.beat + c.beats));
  const ballad = piece.bpm < 92;
  const waltz = piece.meter === "3/4";
  const barBeats = waltz ? 3 : 4;
  // swung songs push the off-beat eighth late, as the beatbox does
  const off = 0.5 + (piece.beat?.swing ?? 0) * 0.17;
  const bass: BandNote[] = [], keys: BandNote[] = [], drums: BandNote[] = [];
  const gruffSolo = piece.stage?.length === 1 && piece.stage[0] === "gruff";
  for (const c of chords) {
    const root = near(c.tones[0], 38), fifth = near(c.tones[2], root + 7);
    if (gruffSolo) {
      // A long downbeat and a short answering fifth leave room for the sung line.
      const finalChord = c.beat + c.beats === end;
      bass.push({ beat: c.beat, beats: finalChord ? c.beats : Math.min(1.6, c.beats), midi: root, vel: 102 });
      if (!finalChord && c.beats >= 3) {
        bass.push({ beat: c.beat + c.beats - 1, beats: 0.67, midi: fifth, vel: 88 });
      }
      continue;
    }
    const voicing = c.tones.map((pc) => near(pc, 62)).sort((a, b) => a - b);
    if (ballad) {
      // long notes: the root under a held chord
      bass.push({ beat: c.beat, beats: c.beats * 0.95, midi: root, vel: 104 });
      for (const m of voicing) keys.push({ beat: c.beat, beats: c.beats * 0.95, midi: m, vel: 76 });
      continue;
    }
    if (waltz) {
      const finalChord = c.beat + c.beats >= end - 1e-6;
      for (let b = c.beat; b < c.beat + c.beats - 1e-6; b++) {
        const inBar = ((b % 3) + 3) % 3;
        const first = Math.abs(b - c.beat) < 1e-6;
        if (finalChord && first) {
          bass.push({ beat: b, beats: Math.max(2, c.beats * 0.9), midi: root, vel: 96 });
          voicing.forEach((m, i) => keys.push({ beat: b + i * 0.04, beats: Math.max(2, c.beats * 0.9), midi: m, vel: 68 }));
          break;
        }
        if (first || inBar === 0) bass.push({ beat: b, beats: 1.4, midi: root, vel: 94 });
        else if (inBar === 2) bass.push({ beat: b, beats: 0.75, midi: fifth, vel: 68 });
        if (inBar === 1 || inBar === 2) {
          for (const m of voicing) keys.push({ beat: b, beats: 0.55, midi: m, vel: inBar === 1 ? 62 : 52 });
        }
      }
      continue;
    }
    for (let b = c.beat; b < c.beat + c.beats - 1e-6; b++) {
      const inBar = ((b % 4) + 4) % 4;
      // bass: root on the chord's first beat and on 1, the fifth on 3, a pickup eighth into a change
      const first = Math.abs(b - c.beat) < 1e-6;
      if (first || inBar === 0) bass.push({ beat: b, beats: 0.9, midi: root, vel: 96 });
      else if (inBar === 2) bass.push({ beat: b, beats: 0.9, midi: fifth, vel: 84 });
      const next = chordAt(chords, b + 1);
      if (inBar === 3 && next && next !== c) bass.push({ beat: b + off, beats: 0.4, midi: near(next.tones[0], root) - 1, vel: 70 }); // a half-step below where it's going
      // keys: short stabs on the back beats, and the off-beat after 4
      if (inBar === 1 || inBar === 3) for (const m of voicing) keys.push({ beat: b, beats: 0.45, midi: m, vel: 62 });
      if (inBar === 3) for (const m of voicing) keys.push({ beat: b + off, beats: 0.3, midi: m, vel: 48 });
    }
  }
  if (gruffSolo) return [{ id: "bass", channel: BAND_SETUP.bass.channel, program: BAND_SETUP.bass.program, notes: bass }];
  if (!piece.beat) {
    // the kit: kick on 1 and 3, snare on 2 and 4, eighth hats; a crash where the band starts
    let started = false;
    for (let b = 0; b < end - 1e-6; b++) {
      if (!chordAt(chords, b)) {
        started = false;
        continue;
      }
      const inBar = ((b % barBeats) + barBeats) % barBeats;
      if (!started) drums.push({ beat: b, beats: 1, midi: CRASH, vel: 70 });
      started = true;
      if (ballad) {
        if (inBar === 0) drums.push({ beat: b, beats: 0.5, midi: KICK, vel: 70 });
        if (inBar === 2) drums.push({ beat: b, beats: 0.5, midi: SNARE, vel: 40 });
        drums.push({ beat: b, beats: 0.5, midi: HAT, vel: 34 });
        continue;
      }
      if (waltz) {
        if (inBar === 0) drums.push({ beat: b, beats: 0.5, midi: KICK, vel: 68 }, { beat: b, beats: 0.4, midi: HAT, vel: 42 });
        else drums.push({ beat: b, beats: 0.4, midi: BRUSH, vel: inBar === 1 ? 44 : 34 }, { beat: b, beats: 0.35, midi: HAT, vel: 30 });
        continue;
      }
      drums.push({ beat: b, beats: 0.5, midi: inBar % 2 ? SNARE : KICK, vel: inBar % 2 ? 78 : 92 });
      drums.push({ beat: b, beats: 0.4, midi: HAT, vel: 52 }, { beat: b + off, beats: 0.4, midi: inBar === 3 ? OPEN_HAT : HAT, vel: 38 });
    }
  }
  const part = (id: BandId, notes: BandNote[]): BandPart => ({ id, program: BAND_SETUP[id].program, channel: BAND_SETUP[id].channel, notes });
  return [part("bass", bass), part("keys", keys), ...(drums.length ? [part("drums", drums)] : [])];
}
