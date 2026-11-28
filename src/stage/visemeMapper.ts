/**
 * Deterministic 8-Viseme Lip-Sync & Natural Eye-Acting Mapper (`S-61`):
 *  - Maps CHIMERA `VISEME` codes (`rest=0, closed=1, fv=2, ee=3, ah=4, oh=5, oo=6, blink=7`)
 *    to the EXACT verified cell order on `public/cast/tabby/visemes-4x2.webp`!
 *  - Uses real CHIMERA articulator telemetry (`vocalTiming.visemes`) whenever available,
 *    and falls back seamlessly to deterministic lyric-phoneme mapping in Remotion Studio,
 *    headless 1080p MP4 renders, and Pure-MIDI scrubbing!
 *  - Schedules organic phrase-boundary blinks (never robotic periodic metronome blinks).
 */
import type { VideoBubbleClip } from "../choir/videoProject.ts";
import { visemeAt, vocalArticAt, vocalLevelAt, type VocalTiming } from "../choir/vocalTiming.ts";

/** Canonical CHIMERA viseme code constants (mirrors `src/choir/pose.ts` without importing engine). */
export const VISEME_CODE = {
  rest: 0,
  closed: 1,
  fv: 2,
  ee: 3,
  ah: 4,
  oh: 5,
  oo: 6,
  blink: 7,
} as const;

export type VisemeCode = (typeof VISEME_CODE)[keyof typeof VISEME_CODE];

/**
 * Verified cell index (`0..7`, row-major 4x2) on `public/cast/tabby/visemes-4x2.webp`:
 *  Row 0: [0=rest, 1=blink, 2=ee(crescent smile), 3=oh(round open)]
 *  Row 1: [4=closed(m/b/p), 5=fv(cheeky tucked), 6=oo(surprised pucker), 7=ah(wide excited)]
 */
export const TABBY_VISEME_CELL: Readonly<Record<VisemeCode, number>> = {
  0: 0, // rest
  1: 4, // closed (m/b/p)
  2: 5, // fv (f/v)
  3: 2, // ee (happy crescent eyes, wide smile)
  4: 7, // ah (wide open excited)
  5: 3, // oh (round open)
  6: 6, // oo (puckered surprised)
  7: 1, // blink (flat horizontal LED eyes)
};

/** Exact measured UV sub-crop of Tabby's head + ears + whiskers inside each 512x512 cell of `visemes-4x2.webp`. */
export function tabbyVisemeHeadUvRect(viseme: VisemeCode): readonly [number, number, number, number] {
  const cell = TABBY_VISEME_CELL[viseme] ?? 0;
  const col = cell % 4;
  const row = Math.floor(cell / 4);

  const cellU0 = col / 4;
  const cellV0 = 1 - (row + 1) / 2;
  const cellUSpan = 1 / 4;
  const cellVSpan = 1 / 2;

  // Measured non-transparent head+ears+whiskers crop inside 512x512 cell:
  // x in [104..400] (296px), y_top in [58..320] (262px -> stops cleanly at chin above collar)
  const localU0 = 104 / 512;
  const localUSpan = 296 / 512;
  const localV0 = 1 - 320 / 512;
  const localVSpan = 262 / 512;

  return [
    cellU0 + localU0 * cellUSpan,
    cellV0 + localV0 * cellVSpan,
    localUSpan * cellUSpan,
    localVSpan * cellVSpan,
  ];
}

/** Deterministic phoneme timeline for an English sung word -> ordered list of VisemeCodes. */
function wordToVisemeSequence(rawWord: string): VisemeCode[] {
  const w = rawWord.toLowerCase().replace(/[^a-z']/g, "");
  if (!w) return [VISEME_CODE.rest];

  // Explicit high-accuracy overrides for Ribbon and Felt & Studio 404 lyrics
  const LEXICON: Record<string, VisemeCode[]> = {
    tap: [VISEME_CODE.ah, VISEME_CODE.closed],
    is: [VISEME_CODE.ee, VISEME_CODE.ee],
    that: [VISEME_CODE.ah, VISEME_CODE.closed],
    me: [VISEME_CODE.closed, VISEME_CODE.ee, VISEME_CODE.ee],
    one: [VISEME_CODE.oo, VISEME_CODE.ah],
    small: [VISEME_CODE.closed, VISEME_CODE.oh, VISEME_CODE.oh],
    voice: [VISEME_CODE.fv, VISEME_CODE.oh, VISEME_CODE.ee],
    in: [VISEME_CODE.ee],
    a: [VISEME_CODE.ah],
    cracked: [VISEME_CODE.ah, VISEME_CODE.closed],
    glass: [VISEME_CODE.ah, VISEME_CODE.ah],
    sea: [VISEME_CODE.ee, VISEME_CODE.ee],
    mew: [VISEME_CODE.closed, VISEME_CODE.oo, VISEME_CODE.oo],
    can: [VISEME_CODE.ah, VISEME_CODE.closed],
    you: [VISEME_CODE.oo, VISEME_CODE.oo],
    hear: [VISEME_CODE.ee, VISEME_CODE.ah],
    here: [VISEME_CODE.ee, VISEME_CODE.ee],
    the: [VISEME_CODE.ah],
    seam: [VISEME_CODE.ee, VISEME_CODE.closed],
    echoes: [VISEME_CODE.ee, VISEME_CODE.oh],
    bounce: [VISEME_CODE.closed, VISEME_CODE.ah, VISEME_CODE.oo],
    off: [VISEME_CODE.oh, VISEME_CODE.fv],
    screen: [VISEME_CODE.ee, VISEME_CODE.ee],
    ribbon: [VISEME_CODE.ee, VISEME_CODE.closed, VISEME_CODE.ah],
    bright: [VISEME_CODE.closed, VISEME_CODE.ah, VISEME_CODE.ee],
    warm: [VISEME_CODE.oo, VISEME_CODE.oh, VISEME_CODE.closed],
    felt: [VISEME_CODE.fv, VISEME_CODE.ee],
    left: [VISEME_CODE.ee, VISEME_CODE.fv],
    paw: [VISEME_CODE.closed, VISEME_CODE.oh, VISEME_CODE.oh],
    right: [VISEME_CODE.ah, VISEME_CODE.ee],
    watch: [VISEME_CODE.oo, VISEME_CODE.ah],
    leap: [VISEME_CODE.ee, VISEME_CODE.closed],
    and: [VISEME_CODE.ah],
    spin: [VISEME_CODE.closed, VISEME_CODE.ee],
    around: [VISEME_CODE.ah, VISEME_CODE.oo],
    sweep: [VISEME_CODE.oo, VISEME_CODE.ee, VISEME_CODE.closed],
    spotlight: [VISEME_CODE.closed, VISEME_CODE.oh, VISEME_CODE.ah, VISEME_CODE.ee],
    downstage: [VISEME_CODE.ah, VISEME_CODE.oo, VISEME_CODE.ee],
    wide: [VISEME_CODE.oo, VISEME_CODE.ah, VISEME_CODE.ee],
    center: [VISEME_CODE.ee, VISEME_CODE.ah],
    stage: [VISEME_CODE.ee, VISEME_CODE.ah],
    no: [VISEME_CODE.oh, VISEME_CODE.oh],
    place: [VISEME_CODE.closed, VISEME_CODE.ee],
    to: [VISEME_CODE.oo],
    hide: [VISEME_CODE.ah, VISEME_CODE.ee],
    now: [VISEME_CODE.ah, VISEME_CODE.oo],
    i: [VISEME_CODE.ah, VISEME_CODE.ee],
    my: [VISEME_CODE.closed, VISEME_CODE.ah, VISEME_CODE.ee],
    own: [VISEME_CODE.oh, VISEME_CODE.oo],
    rings: [VISEME_CODE.ee],
    clear: [VISEME_CODE.ee, VISEME_CODE.ah],
    take: [VISEME_CODE.ee, VISEME_CODE.ah],
    bow: [VISEME_CODE.closed, VISEME_CODE.ah, VISEME_CODE.oo],
  };
  if (LEXICON[w]) return LEXICON[w];

  const seq: VisemeCode[] = [];
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    const two = w.slice(i, i + 2);
    if (two === "oo" || two === "ew" || two === "ou" || two === "ow") {
      seq.push(VISEME_CODE.oo);
      i++;
    } else if (two === "ee" || two === "ea" || two === "ie") {
      seq.push(VISEME_CODE.ee);
      i++;
    } else if (two === "oh" || two === "oa" || two === "aw" || two === "au") {
      seq.push(VISEME_CODE.oh);
      i++;
    } else if (ch === "m" || ch === "b" || ch === "p") {
      seq.push(VISEME_CODE.closed);
    } else if (ch === "f" || ch === "v") {
      seq.push(VISEME_CODE.fv);
    } else if (ch === "u" || ch === "w") {
      seq.push(VISEME_CODE.oo);
    } else if (ch === "o") {
      seq.push(VISEME_CODE.oh);
    } else if (ch === "e" || ch === "i" || ch === "y") {
      seq.push(VISEME_CODE.ee);
    } else if (ch === "a") {
      seq.push(VISEME_CODE.ah);
    }
  }
  return seq.length > 0 ? seq : [VISEME_CODE.ah];
}

/** Natural non-metronomic smooth eyelid blink amount (`0..1`) on 3.4s slots (140ms soft trapezoid). */
export function naturalBlinkAmountAt(timeSec: number, singing: boolean): number {
  const slot = Math.floor(timeSec / 3.4);
  const hash = Math.sin(slot * 12.9898 + 78.233) * 43758.5453;
  const frac = hash - Math.floor(hash);
  const blinkStart = slot * 3.4 + 0.65 + frac * 2.15;
  const duration = singing ? 0.12 : 0.145;
  const local = timeSec - blinkStart;
  if (local <= 0 || local >= duration) return 0;
  const u = local / duration;
  // Fast natural lid drop (0..0.35), brief hold (0.35..0.55), smooth lid reopen (0.55..1)
  if (u < 0.35) return u / 0.35;
  if (u < 0.55) return 1;
  return Math.max(0, 1 - (u - 0.55) / 0.45);
}

/** Natural non-metronomic blink intervals (deterministic hash on 2.8s..4.6s slots, 140ms blink duration). */
export function isNaturalBlinkAt(timeSec: number, singing: boolean): boolean {
  return naturalBlinkAmountAt(timeSec, singing) > 0.35;
}

/** Map a discrete viseme code to continuous physical mouth articulators (`open`, `jaw`, `round`, `width`, `labio`) for fallback mode. */
function visemeToArtic(code: VisemeCode): { open: number; jaw: number; round: number; width: number; labio: number } {
  switch (code) {
    case VISEME_CODE.closed:
      return { open: 0.0, jaw: 0.05, round: 0.0, width: 0.45, labio: 0 };
    case VISEME_CODE.fv:
      return { open: 0.22, jaw: 0.18, round: 0.08, width: 0.56, labio: 0.85 };
    case VISEME_CODE.ee:
      return { open: 0.46, jaw: 0.32, round: 0.05, width: 0.88, labio: 0 };
    case VISEME_CODE.ah:
      return { open: 0.88, jaw: 0.86, round: 0.16, width: 0.56, labio: 0 };
    case VISEME_CODE.oh:
      return { open: 0.66, jaw: 0.62, round: 0.68, width: 0.34, labio: 0 };
    case VISEME_CODE.oo:
      return { open: 0.42, jaw: 0.35, round: 0.94, width: 0.18, labio: 0 };
    case VISEME_CODE.rest:
    case VISEME_CODE.blink:
    default:
      return { open: 0.0, jaw: 0.0, round: 0.0, width: 0.5, labio: 0 };
  }
}

export interface TabbyFacialState {
  readonly viseme: VisemeCode;
  readonly cellIndex: number;
  readonly speaking: boolean;
  readonly voiceEnergy: number;
  readonly blink: boolean;
  /** Smooth eyelid closure `0..1` (drives eyelids ONLY — never swaps the whole head). */
  readonly blinkAmount: number;
  /** Continuous CHIMERA lip aperture `0..1` (`0` on `[m/b/p]` & silence). */
  readonly mouthOpen: number;
  /** Continuous CHIMERA jaw drop `0..1`. */
  readonly mouthJaw: number;
  /** Continuous CHIMERA lip rounding `0..1` (`oh`/`oo` pucker). */
  readonly mouthRound: number;
  /** Continuous CHIMERA horizontal lip width/spread `0..1` (`/i/` vs `/u/`). */
  readonly mouthWidth: number;
  /** Continuous CHIMERA labiodental contact `0..1` (`/f v/`). */
  readonly labiodental: number;
  /** Continuous CHIMERA intra-oral cheek pressure in cmH₂O (`/p b/`). */
  readonly mouthPressure: number;
  /** CHIMERA pitch `f0` in Hz (`0` when unvoiced). */
  readonly f0: number;
  /** CHIMERA vocal-fold voicing `0..1`. */
  readonly voicing: number;
  /** Pitch-following brow lift `-0.7..+1.0` matching CHIMERA `expression.ts` (`log2(f0)`). */
  readonly browLift: number;
}

/**
 * Resolve Tabby's mouth articulators & natural eyelid blink at `timeSec`.
 * Reads CHIMERA's own physical articulators (`open`, `jaw`, `round` from `poseFromRecord`) so
 * ONLY the mouth moves in sync with speech/song — NEVER flashing eyes, ears, or body models.
 */
export function resolveTabbyFacialState(
  timeSec: number,
  singerId: string,
  bubbles: readonly VideoBubbleClip[],
  vocalTiming: VocalTiming | undefined,
  noteActive: boolean,
): TabbyFacialState {
  const audioLevel = vocalLevelAt(vocalTiming, singerId, timeSec);
  const teleViseme = visemeAt(vocalTiming, singerId, timeSec);
  const teleArtic = vocalArticAt(vocalTiming, singerId, timeSec);

  // Locate active lyric word from bubbles
  let activeWord: { text: string; progress: number } | null = null;
  for (const b of bubbles) {
    if (b.speakerId !== singerId) continue;
    if (timeSec < b.startSec - 0.04 || timeSec > b.startSec + b.durationSec + 0.04) continue;
    if (b.words && b.words.length > 0) {
      for (const w of b.words) {
        if (timeSec >= w.startSec && timeSec < w.endSec) {
          const span = Math.max(0.04, w.endSec - w.startSec);
          activeWord = { text: w.text, progress: (timeSec - w.startSec) / span };
          break;
        }
      }
      if (!activeWord) {
        const lastWord = b.words[b.words.length - 1];
        if (timeSec < lastWord.endSec) {
          activeWord = { text: "", progress: 0 };
        }
      }
    } else if (noteActive) {
      activeWord = { text: b.text, progress: (timeSec - b.startSec) / Math.max(0.1, b.durationSec) };
    }
    break;
  }

  const speaking =
    audioLevel !== undefined ? audioLevel > 0.05 : Boolean(noteActive || (activeWord && activeWord.text.length > 0));
  const voiceEnergy =
    audioLevel !== undefined
      ? audioLevel
      : speaking
        ? 0.5 + 0.25 * Math.sin(timeSec * 8.0) * Math.sin(timeSec * 8.0)
        : 0;

  // Natural blinks drive ONLY the eyelid shutters, independent of mouth articulation
  const blinkAmount = voiceEnergy < 0.78 ? naturalBlinkAmountAt(timeSec, speaking) : 0;
  const blink = blinkAmount > 0.35;

  if (!speaking) {
    return {
      viseme: VISEME_CODE.rest,
      cellIndex: TABBY_VISEME_CELL[VISEME_CODE.rest],
      speaking: false,
      voiceEnergy: 0,
      blink,
      blinkAmount,
      mouthOpen: 0,
      mouthJaw: 0,
      mouthRound: 0,
      mouthWidth: 0.5,
      labiodental: 0,
      mouthPressure: 0,
      f0: 0,
      voicing: 0,
      browLift: 0,
    };
  }

  // 1. Primary path: real CHIMERA vocal-tract articulators recorded directly from `poseFromRecord`!
  if (teleArtic !== undefined) {
    const code = (teleViseme !== undefined && teleViseme >= 0 && teleViseme <= 6 ? teleViseme : VISEME_CODE.ah) as VisemeCode;
    const voiced = teleArtic.voicing > 0.45 && teleArtic.f0 > 30;
    const browLift = voiced ? Math.max(-0.7, Math.min(1, (12 * (Math.log2(teleArtic.f0) - Math.log2(392))) / 6)) : 0;
    return {
      viseme: code,
      cellIndex: TABBY_VISEME_CELL[code],
      speaking: true,
      voiceEnergy,
      blink,
      blinkAmount,
      mouthOpen: teleArtic.open,
      mouthJaw: teleArtic.jaw,
      mouthRound: teleArtic.round,
      mouthWidth: teleArtic.lipWidth,
      labiodental: teleArtic.labiodental,
      mouthPressure: teleArtic.mouthPressure,
      f0: teleArtic.f0,
      voicing: teleArtic.voicing,
      browLift,
    };
  }

  // 2. Smooth deterministic lyric-phoneme articulation for Remotion Studio / Pure-MIDI scrubbing
  if (activeWord && activeWord.text.length > 0) {
    const seq = wordToVisemeSequence(activeWord.text);
    const pos = Math.max(0, Math.min(0.9999, activeWord.progress)) * seq.length;
    const i0 = Math.min(seq.length - 1, Math.floor(pos));
    const i1 = Math.min(seq.length - 1, i0 + 1);
    const frac = pos - i0;
    const smoothFrac = frac * frac * (3 - 2 * frac);
    const a0 = visemeToArtic(seq[i0]);
    const a1 = visemeToArtic(seq[i1]);
    // Gentle onset/release word envelope so mouth glides cleanly open & shut
    const env =
      Math.min(1, activeWord.progress / 0.14) *
      Math.min(1, (1 - activeWord.progress) / 0.16);
    const code = seq[i0];
    return {
      viseme: code,
      cellIndex: TABBY_VISEME_CELL[code],
      speaking: true,
      voiceEnergy,
      blink,
      blinkAmount,
      mouthOpen: code === VISEME_CODE.closed ? 0 : (a0.open + (a1.open - a0.open) * smoothFrac) * env,
      mouthJaw: (a0.jaw + (a1.jaw - a0.jaw) * smoothFrac) * env,
      mouthRound: a0.round + (a1.round - a0.round) * smoothFrac,
      mouthWidth: a0.width + (a1.width - a0.width) * smoothFrac,
      labiodental: a0.labio + (a1.labio - a0.labio) * smoothFrac,
      mouthPressure: code === VISEME_CODE.closed ? 2.4 : 0,
      f0: 392,
      voicing: code === VISEME_CODE.fv ? 0.2 : 0.85,
      browLift: 0.18,
    };
  }

  // 3. Fallback sustained singing vowel shape
  const fallback: VisemeCode = voiceEnergy > 0.55 ? VISEME_CODE.ah : VISEME_CODE.oh;
  const fa = visemeToArtic(fallback);
  return {
    viseme: fallback,
    cellIndex: TABBY_VISEME_CELL[fallback],
    speaking: true,
    voiceEnergy,
    blink,
    blinkAmount,
    mouthOpen: fa.open * Math.max(0.35, voiceEnergy),
    mouthJaw: fa.jaw * Math.max(0.35, voiceEnergy),
    mouthRound: fa.round,
    mouthWidth: fa.width,
    labiodental: fa.labio,
    mouthPressure: 0,
    f0: 392,
    voicing: 0.8,
    browLift: 0.15,
  };
}
