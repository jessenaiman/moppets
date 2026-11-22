/**
 * What a puppet's face does at one telemetry record. Everything here reads the engine's own
 * articulators (jaw height, lip aperture and protrusion) and output level, so a closed [m] closes
 * the mouth even while voiced, and silence rests it. No timers.
 */
import { TELE_HEADER, TELE } from "./singerCore.ts";

const JAW = TELE_HEADER + 0, LIP_AP = TELE_HEADER + 7, LIP_PROT = TELE_HEADER + 8, LABIO = TELE_HEADER + 10;
export interface Pose {
  /** mouth opening 0..1, from the lips and jaw */
  open: number;
  /** jaw drop 0..1 */
  jaw: number;
  /** lip rounding 0..1 */
  round: number;
  /** output level 0..1 (shapes intensity, not timing) */
  level: number;
  /** is this singer making sound */
  singing: boolean;
  /** which mouth shape the articulators are making (see VISEME) */
  viseme: number;
  /** lung pressure 0..1 (of 12 in the voice's own units; the cast sings at 9 to 10) */
  pressure: number;
  /** pitch in Hz (0: unvoiced) */
  f0: number;
  /** voicing 0..1: how much the folds are vibrating */
  voicing: number;
}

/** Cells of the viseme head sheet, in order. */
export const VISEME = { rest: 0, closed: 1, fv: 2, ee: 3, ah: 4, oh: 5, oo: 6, blink: 7 } as const;

/** The mouth shape this moment's lip, jaw and rounding telemetry describes. */
export function visemeFrom(lipAp: number, labio: number, round: number, jaw: number, singing: boolean): number {
  if (!singing) return VISEME.rest;
  if (lipAp <= 0.05) return VISEME.closed;
  if (labio > 0.45) return VISEME.fv;
  if (round > 0.55) return lipAp > 1 ? VISEME.oh : VISEME.oo;
  if (round > 0.3) return VISEME.oh;
  return jaw > 1.2 ? VISEME.ah : VISEME.ee;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const SILENT_POSE: Pose = { open: 0, jaw: 0, round: 0, level: 0, singing: false, viseme: 0, pressure: 0, f0: 0, voicing: 0 };

/** Quiet floor below which a singer counts as resting (the telemetry's RMS of the stem). */
const SINGING_RMS = 0.012;
/** Mouth-open threshold shared by the stage sprite swap and telemetry tests. */
export const MOUTH_OPEN_THRESHOLD = 0.2;

export function poseFromRecord(rec: Float32Array, at = 0): Pose {
  const jaw = rec[at + JAW], lipAp = rec[at + LIP_AP], lipProt = rec[at + LIP_PROT], rms = rec[at + TELE.outRms];
  const singing = rms > SINGING_RMS;
  const level = clamp(rms * 5);
  // Lip aperture is the visible opening; the output level scales it, so held notes still breathe.
  // A closure (lip aperture at or below zero) always shuts the mouth, even while voiced. There is no
  // floor: one (0.12 + 0.18 × level) sat above the stage's open threshold for loud voices, holding
  // Scribe's and Tabby's mouths open through every consonant.
  // A rounded vowel ("oo", lip protrusion ~1.1 to 1.3) has a small opening, about as wide as a
  // consonant's (~0.3) but still a sung mouth: rounding, not width, tells them apart.
  const rounded = lipProt > 0.9 && lipAp > 0.1;
  const lip = lipAp <= 0.02 ? 0 : Math.max(clamp(lipAp / 2.2) * (0.55 + 0.45 * level), rounded ? 0.25 : 0);
  const open = singing ? lip : 0;
  const round = clamp(lipProt);
  const voicing = clamp(rec[at + TELE.voicing]);
  return { open, jaw: singing ? clamp(jaw / 1.9) : 0, round, level, singing, viseme: visemeFrom(lipAp, rec[at + LABIO], round, jaw, singing), pressure: clamp(rec[at + TELE.pLung] / 12), f0: voicing > 0.1 ? rec[at + TELE.f0] : 0, voicing };
}
