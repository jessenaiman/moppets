export interface VocalTiming {
  framesPerSecond: number;
  /** Vocal RMS from each decoded CHIMERA stem, with the same sample zero as the mix. */
  envelopes: Record<string, readonly number[]>;
  /** Real CHIMERA articulator viseme code (`0..7`, see `VISEME`) per hop when available. */
  visemes?: Record<string, readonly number[]>;
  /** Voicing energy (`0..1`) per hop when available. */
  voicing?: Record<string, readonly number[]>;
  /** Real CHIMERA lip aperture (`0..1`, shuts strictly to `0` on `[m/b/p]`) per hop. */
  open?: Record<string, readonly number[]>;
  /** Real CHIMERA jaw drop (`0..1`) per hop. */
  jaw?: Record<string, readonly number[]>;
  /** Real CHIMERA lip rounding/protrusion (`0..1`) per hop. */
  round?: Record<string, readonly number[]>;
  /** Real CHIMERA horizontal lip width/spread (`0..1`, separates `/i/` vs `/u/`) per hop. */
  lipWidth?: Record<string, readonly number[]>;
  /** Real CHIMERA labiodental contact (`0..1`, `/f v/`) per hop. */
  labiodental?: Record<string, readonly number[]>;
  /** Real CHIMERA intra-oral mouth pressure (`cmH2O`, cheek puff behind closed `/p b/`) per hop. */
  mouthPressure?: Record<string, readonly number[]>;
  /** Real CHIMERA pitch `f0` in Hz (`0` when unvoiced) per hop. */
  f0?: Record<string, readonly number[]>;
}

export interface VocalArticSample {
  readonly open: number;
  readonly jaw: number;
  readonly round: number;
  readonly lipWidth: number;
  readonly labiodental: number;
  readonly mouthPressure: number;
  readonly f0: number;
  readonly voicing: number;
}

let liveVocalTiming: VocalTiming | undefined;

export function setLiveVocalTiming(timing: VocalTiming | undefined): void {
  liveVocalTiming = timing;
}

export function getLiveVocalTiming(): VocalTiming | undefined {
  return liveVocalTiming;
}

export function vocalLevelAt(timing: VocalTiming | undefined, singerId: string, seconds: number): number | undefined {
  const envelope = timing?.envelopes[singerId];
  if (!timing || !envelope) return;
  const rms = envelope[Math.floor(seconds * timing.framesPerSecond)] ?? 0;
  return rms < 0.008 ? 0 : Math.min(1, rms * 5);
}

/** True if the singer has audible vocal RMS anywhere within ±windowSec (prevents idle<->sing body flashing on consonants). */
export function vocalPhraseActiveAt(
  timing: VocalTiming | undefined,
  singerId: string,
  seconds: number,
  windowSec = 0.28,
): boolean | undefined {
  const envelope = timing?.envelopes[singerId];
  if (!timing || !envelope) return;
  const center = Math.floor(seconds * timing.framesPerSecond);
  const span = Math.max(1, Math.round(windowSec * timing.framesPerSecond));
  const lo = Math.max(0, center - span);
  const hi = Math.min(envelope.length - 1, center + span);
  for (let i = lo; i <= hi; i++) {
    if ((envelope[i] ?? 0) >= 0.012) return true;
  }
  return false;
}

export function visemeAt(timing: VocalTiming | undefined, singerId: string, seconds: number): number | undefined {
  const track = timing?.visemes?.[singerId];
  if (!timing || !track) return;
  const idx = Math.floor(seconds * timing.framesPerSecond);
  return idx >= 0 && idx < track.length ? track[idx] : undefined;
}

/**
 * Deterministically sample continuous CHIMERA mouth/face articulators at `seconds`.
 * Averages over ±18ms to remove single-hop jitter while preserving strict bilabial closures
 * (`open === 0` at center hop stays closed so `/m b p/` never blurs open across neighboring vowels).
 */
export function vocalArticAt(
  timing: VocalTiming | undefined,
  singerId: string,
  seconds: number,
): VocalArticSample | undefined {
  const openTrack = timing?.open?.[singerId];
  const jawTrack = timing?.jaw?.[singerId];
  const roundTrack = timing?.round?.[singerId];
  if (!timing || !openTrack || !jawTrack || !roundTrack) return;

  const widthTrack = timing.lipWidth?.[singerId];
  const labioTrack = timing.labiodental?.[singerId];
  const pressureTrack = timing.mouthPressure?.[singerId];
  const f0Track = timing.f0?.[singerId];
  const voicingTrack = timing.voicing?.[singerId];

  const center = Math.floor(seconds * timing.framesPerSecond);
  const half = Math.max(1, Math.round(0.018 * timing.framesPerSecond));
  const lo = Math.max(0, center - half);
  const hi = Math.min(openTrack.length - 1, center + half);
  if (hi < lo) {
    return { open: 0, jaw: 0, round: 0, lipWidth: 0.5, labiodental: 0, mouthPressure: 0, f0: 0, voicing: 0 };
  }

  let oSum = 0;
  let jSum = 0;
  let rSum = 0;
  let wSum = 0;
  let lSum = 0;
  let pSum = 0;
  let fSum = 0;
  let fCount = 0;
  let vSum = 0;
  let n = 0;

  for (let i = lo; i <= hi; i++) {
    oSum += openTrack[i] ?? 0;
    jSum += jawTrack[i] ?? 0;
    rSum += roundTrack[i] ?? 0;
    wSum += widthTrack ? (widthTrack[i] ?? 0.5) : 0.5;
    lSum += labioTrack ? (labioTrack[i] ?? 0) : 0;
    pSum += pressureTrack ? (pressureTrack[i] ?? 0) : 0;
    vSum += voicingTrack ? (voicingTrack[i] ?? 0) : 0;
    const fi = f0Track ? (f0Track[i] ?? 0) : 0;
    if (fi > 20) {
      fSum += fi;
      fCount++;
    }
    n++;
  }

  // Keep bilabial closures crisp (do not smear adjacent open vowels over a closed /m b p/ hop)
  const centerOpen = center >= 0 && center < openTrack.length ? (openTrack[center] ?? 0) : 0;
  const open = centerOpen <= 0.01 ? 0 : oSum / n;

  return {
    open,
    jaw: jSum / n,
    round: rSum / n,
    lipWidth: wSum / n,
    labiodental: lSum / n,
    mouthPressure: pSum / n,
    f0: fCount > 0 ? fSum / fCount : 0,
    voicing: vSum / n,
  };
}
