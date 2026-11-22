export interface VocalTiming {
  framesPerSecond: number;
  /** Vocal RMS from each decoded CHIMERA stem, with the same sample zero as the mix. */
  envelopes: Record<string, readonly number[]>;
}

export function vocalLevelAt(timing: VocalTiming | undefined, singerId: string, seconds: number): number | undefined {
  const envelope = timing?.envelopes[singerId];
  if (!timing || !envelope) return;
  const rms = envelope[Math.floor(seconds * timing.framesPerSecond)] ?? 0;
  return rms < 0.008 ? 0 : Math.min(1, rms * 5);
}
