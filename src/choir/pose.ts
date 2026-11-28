/**
 * What a puppet's face does at one telemetry record. Everything here reads CHIMERA's own
 * articulators (jaw height, lip aperture, protrusion, lip width, labiodental contact, and
 * intra-oral mouth pressure behind closed lips), so a closed [m/b/p] shuts the mouth even
 * while voiced, /i/ spreads lipWidth vs /u/ lipProt, /f v/ triggers labiodental, and silence
 * rests it. No timers, no RMS floor holding mouths open across consonants.
 */
import { TELE_HEADER, TELE } from "./singerCore.ts";

const JAW = TELE_HEADER + 0;
const LIP_AP = TELE_HEADER + 7;
const LIP_PROT = TELE_HEADER + 8;
const LIP_WIDTH = TELE_HEADER + 9;
const LABIO = TELE_HEADER + 10;

/** dyn/cm² in one cmH₂O (matches CHIMERA `expression.ts`). */
const CM_H2O = 980.665;

export interface Pose {
  /** mouth opening 0..1, directly from CHIMERA lip aperture & rounding (0 on bilabial closure) */
  open: number;
  /** raw normalized lip aperture 0..1 without rounding boost */
  lipAp: number;
  /** jaw drop 0..1 */
  jaw: number;
  /** lip rounding / protrusion 0..1 */
  round: number;
  /** horizontal lip spread 0..1 (separates /i/ spread vs /u/ rounded) */
  lipWidth: number;
  /** lower-lip to upper-teeth labiodental contact 0..1 (/f v/) */
  labiodental: number;
  /** intra-oral air pressure behind closed lips in cmH₂O (cheek puff on /p b/) */
  mouthPressure: number;
  /** output level 0..1 (acoustic meter only; never holds mouths open) */
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

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** The mouth shape this moment's CHIMERA lip, jaw, spread, rounding, and labiodental telemetry describes. */
export function visemeFrom(
  lipAp: number,
  labio: number,
  round: number,
  jaw: number,
  singing: boolean,
  lipWidth = 0.5,
): number {
  if (!singing) return VISEME.rest;
  // Strict bilabial closure (/m b p/): shuts the mouth cleanly even while voiced!
  if (lipAp <= 0.02) return VISEME.closed;
  if (labio > 0.45) return VISEME.fv;
  if (round > 0.55) return lipAp > 1.0 ? VISEME.oh : VISEME.oo;
  if (round > 0.3) return VISEME.oh;
  // Horizontal spread separates /i e/ cleanly from wide-open /a/
  if (lipWidth > 0.6 && jaw < 1.35) return VISEME.ee;
  return jaw > 1.15 ? VISEME.ah : VISEME.ee;
}

export const SILENT_POSE: Pose = {
  open: 0,
  lipAp: 0,
  jaw: 0,
  round: 0,
  lipWidth: 0.5,
  labiodental: 0,
  mouthPressure: 0,
  level: 0,
  singing: false,
  viseme: 0,
  pressure: 0,
  f0: 0,
  voicing: 0,
};

/** Quiet floor below which a singer counts as resting (the telemetry's RMS of the stem). */
const SINGING_RMS = 0.012;
/** Mouth-open threshold shared by stage sync and telemetry checks. */
export const MOUTH_OPEN_THRESHOLD = 0.2;

export interface RawChimeraArtic {
  readonly jaw: number;
  readonly lipAp: number;
  readonly lipProt: number;
  readonly lipWidth: number;
  readonly labiodental: number;
  readonly mouthPressure: number;
  readonly rms: number;
  readonly voicing: number;
  readonly pLung: number;
  readonly f0: number;
}

/** Convert raw CHIMERA articulator values (offline worker or live worklet) into a normalized `Pose`. */
export function poseFromArtic(raw: RawChimeraArtic): Pose {
  const singing = raw.rms > SINGING_RMS;
  const level = clamp01(raw.rms * 5);
  const round = clamp01(raw.lipProt);
  const lipWidth = clamp01(raw.lipWidth);
  const labiodental = clamp01(raw.labiodental);
  const mouthPressure = Number.isFinite(raw.mouthPressure) ? Math.max(0, raw.mouthPressure) : 0;

  // Pure articulator-driven mouth opening (ZERO RMS scaling or floor!):
  // - Bilabial closure (`lipAp <= 0.02`) ALWAYS shuts the mouth (`0`) even while voiced (`/m b p/`).
  // - Rounded vowels (`/u o/`) maintain a visible rounded opening despite smaller vertical aperture.
  const lipNorm = raw.lipAp <= 0.02 ? 0 : clamp01(raw.lipAp / 2.2);
  const rounded = raw.lipProt > 0.85 && raw.lipAp > 0.08;
  const open = singing ? (raw.lipAp <= 0.02 ? 0 : Math.max(lipNorm, rounded ? 0.28 : 0)) : 0;
  const voicing = clamp01(raw.voicing);

  return {
    open,
    lipAp: singing ? lipNorm : 0,
    jaw: singing ? clamp01(raw.jaw / 1.9) : 0,
    round: singing ? round : 0,
    lipWidth: singing ? lipWidth : 0.5,
    labiodental: singing ? labiodental : 0,
    mouthPressure: singing ? mouthPressure : 0,
    level,
    singing,
    viseme: visemeFrom(raw.lipAp, labiodental, round, raw.jaw, singing, lipWidth),
    pressure: clamp01(raw.pLung / 12),
    f0: voicing > 0.1 && Number.isFinite(raw.f0) ? raw.f0 : 0,
    voicing,
  };
}

export function poseFromRecord(rec: Float32Array, at = 0): Pose {
  const nArtic = Math.round(rec[at + TELE.nArtic] || 0);
  const nPh = Math.round(rec[at + TELE.nPh] || 0);
  const nOr = Math.round(rec[at + TELE.nOr] || 0);

  // Intra-oral air pressure ~1 cm behind the lips (`pressureRms[nPh + nOr - 3] / CM_H2O`)
  let mouthPressure = 0;
  if (nArtic > 0 && nOr >= 3) {
    const pIdx = at + TELE_HEADER + nArtic + 2 * (nPh + nOr) - 3;
    if (pIdx >= at + TELE_HEADER + nArtic + nPh + nOr && pIdx < rec.length) {
      mouthPressure = (rec[pIdx] || 0) / CM_H2O;
    }
  }

  return poseFromArtic({
    jaw: rec[at + JAW] ?? 0,
    lipAp: rec[at + LIP_AP] ?? 0,
    lipProt: rec[at + LIP_PROT] ?? 0,
    lipWidth: rec[at + LIP_WIDTH] ?? 0.5,
    labiodental: rec[at + LABIO] ?? 0,
    mouthPressure,
    rms: rec[at + TELE.outRms] ?? 0,
    voicing: rec[at + TELE.voicing] ?? 0,
    pLung: rec[at + TELE.pLung] ?? 0,
    f0: rec[at + TELE.f0] ?? 0,
  });
}
