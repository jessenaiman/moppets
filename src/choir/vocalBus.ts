/** Clean stereo vocal bus shared by the AudioWorklet mixer and offline WAV export.
 * Routes CHIMERA's physically modelled voices directly with gentle stereo spread,
 * a subsonic DC guard, and a transparent linked stereo peak limiter (no treble-killing EQ
 * or zero-makeup compression). */

class HighPass {
  private x1 = 0;
  private y1 = 0;
  private readonly a: number;

  constructor(rate: number, hz = 45) {
    const dt = 1 / rate;
    const rc = 1 / (2 * Math.PI * hz);
    this.a = rc / (rc + dt);
  }

  tick(x: number): number {
    const y = this.a * (this.y1 + x - this.x1);
    this.x1 = x;
    this.y1 = y;
    return y;
  }
}

export function vocalPans(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const pan = count < 2 ? 0 : 0.28 * ((2 * i) / (count - 1) - 1);
    return { left: Math.sqrt(1 - pan), right: Math.sqrt(1 + pan) };
  });
}

export class VocalBus {
  private readonly hpL: HighPass;
  private readonly hpR: HighPass;
  private readonly limiterRelease: number;
  private gain = 1;
  peak = 0;
  limited = 0;

  constructor(rate: number) {
    this.hpL = new HighPass(rate, 45);
    this.hpR = new HighPass(rate, 45);
    this.limiterRelease = 1 - Math.exp(-1 / (rate * 0.05));
  }

  process(left: Float32Array, right: Float32Array, backing: Float32Array, n: number) {
    const ceiling = 0.94;
    for (let i = 0; i < n; i++) {
      const l = this.hpL.tick(left[i]) + backing[i];
      const r = this.hpR.tick(right[i]) + backing[i];
      const amplitude = Math.max(Math.abs(l), Math.abs(r));
      const target = amplitude > ceiling ? ceiling / amplitude : 1;
      this.gain = target < this.gain
        ? target
        : Math.min(1, this.gain + (1 - this.gain) * this.limiterRelease);
      if (this.gain < 0.9999) this.limited++;
      left[i] = l * this.gain;
      right[i] = r * this.gain;
      this.peak = Math.max(this.peak, amplitude * this.gain);
    }
  }
}
