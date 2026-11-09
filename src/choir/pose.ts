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
export const SILENT_POSE: Pose = { open: 0, jaw: 0, round: 0, level: 0, singing: false, viseme: 0 };

/** Quiet floor below which a singer counts as resting (the telemetry's RMS of the stem). */
const SINGING_RMS = 0.012;

export function poseFromRecord(rec: Float32Array, at = 0): Pose {
  const jaw = rec[at + JAW], lipAp = rec[at + LIP_AP], lipProt = rec[at + LIP_PROT], rms = rec[at + TELE.outRms];
  const singing = rms > SINGING_RMS;
  const level = clamp(rms * 5);
  // Lip aperture is the visible opening; the output level shapes each vowel, so held notes still
  // breathe. A closure (lip aperture at or below zero) always shuts the mouth, even while voiced.
  const lip = lipAp <= 0.02 ? 0 : Math.max(clamp(lipAp / 2.2) * (0.55 + 0.45 * level), 0.12 + 0.18 * level);
  const open = singing ? lip : 0;
  const round = clamp(lipProt);
  return { open, jaw: singing ? clamp(jaw / 1.9) : 0, round, level, singing, viseme: visemeFrom(lipAp, rec[at + LABIO], round, jaw, singing) };
}
