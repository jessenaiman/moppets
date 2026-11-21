/** Stateful stereo vocal strip shared by the AudioWorklet and the offline bounce. */
type Filter = "highpass" | "lowShelf" | "highShelf" | "peak";

class Biquad {
  private z1 = 0;
  private z2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(rate: number, kind: Filter, hz: number, gain = 0, q = Math.SQRT1_2) {
    // RBJ biquads; shelves use slope S=1.
    const w = 2 * Math.PI * hz / rate, c = Math.cos(w), a = 10 ** (gain / 40);
    const alpha = Math.sin(w) / (2 * q), beta = 2 * Math.sqrt(a) * alpha;
    let coefficients: number[];
    switch (kind) {
      case "highpass": coefficients = [(1+c)/2, -(1+c), (1+c)/2, 1+alpha, -2*c, 1-alpha]; break;
      case "peak": coefficients = [1+alpha*a, -2*c, 1-alpha*a, 1+alpha/a, -2*c, 1-alpha/a]; break;
      case "lowShelf": coefficients = [
        a*((a+1)-(a-1)*c+beta), 2*a*((a-1)-(a+1)*c), a*((a+1)-(a-1)*c-beta),
        (a+1)+(a-1)*c+beta, -2*((a-1)+(a+1)*c), (a+1)+(a-1)*c-beta,
      ]; break;
      case "highShelf": coefficients = [
        a*((a+1)+(a-1)*c+beta), -2*a*((a-1)+(a+1)*c), a*((a+1)+(a-1)*c-beta),
        (a+1)-(a-1)*c+beta, 2*((a-1)-(a+1)*c), (a+1)-(a-1)*c-beta,
      ]; break;
    }
    [this.b0,this.b1,this.b2,,this.a1,this.a2] = coefficients.map(value => value / coefficients[3]);
  }

  tick(x: number): number {
    const y = this.b0*x + this.z1;
    this.z1 = this.b1*x - this.a1*y + this.z2;
    this.z2 = this.b2*x - this.a2*y;
    return y;
  }
}

class VocalChannel {
  private readonly filters: Biquad[];
  private readonly delay: Float32Array;
  private pos = 0;
  private low = 0;
  private high = 0;
  private readonly lowCoeff: number;
  private readonly highCoeff: number;

  constructor(rate: number, delaySeconds: number) {
    this.filters = [new Biquad(rate,"highpass",65), new Biquad(rate,"lowShelf",240,3),
      new Biquad(rate,"peak",1300,-2.8,1), new Biquad(rate,"peak",3000,-3,1.1),
      new Biquad(rate,"highShelf",4200,-5)];
    this.delay = new Float32Array(Math.max(1,Math.round(rate*delaySeconds)));
    this.lowCoeff = 1-Math.exp(-2*Math.PI*180/rate);
    this.highCoeff = 1-Math.exp(-2*Math.PI*3200/rate);
  }

  eq(x: number): number {
    for (const filter of this.filters) x = filter.tick(x);
    return x;
  }

  reflection(input: number): number {
    const echo = this.delay[this.pos];
    const send = input + .32 * echo;
    this.low += this.lowCoeff * (send-this.low);
    this.high += this.highCoeff * (send-this.low-this.high);
    this.delay[this.pos] = this.high;
    if (++this.pos === this.delay.length) this.pos = 0;
    return echo;
  }
}

export function vocalPans(count: number) {
  return Array.from({length: count}, (_, i) => {
    const pan = count < 2 ? 0 : .32 * (2*i/(count-1)-1);
    return {left: Math.sqrt(1-pan), right: Math.sqrt(1+pan)};
  });
}

export class VocalBus {
  private readonly left: VocalChannel;
  private readonly right: VocalChannel;
  private readonly attack: number;
  private readonly release: number;
  private readonly limiterRelease: number;
  private envelope = 0;
  private gain = 1;
  peak = 0;
  limited = 0;

  constructor(rate: number) {
    this.left = new VocalChannel(rate, .031);
    this.right = new VocalChannel(rate, .043);
    this.attack = 1-Math.exp(-1/(rate*.022));
    this.release = 1-Math.exp(-1/(rate*.180));
    this.limiterRelease = 1-Math.exp(-1/(rate*.045));
  }

  process(left: Float32Array, right: Float32Array, backing: Float32Array, n: number) {
    const ceiling = 10 ** (-1/20), threshold = .25;
    for (let i=0; i<n; i++) {
      let l=this.left.eq(left[i]), r=this.right.eq(right[i]);
      const level=Math.max(Math.abs(l),Math.abs(r));
      this.envelope += (level-this.envelope)*(level>this.envelope ? this.attack : this.release);
      const compression=this.envelope>threshold ? (threshold/this.envelope)**(1-1/2.5) : 1;
      l *= compression;
      r *= compression;
      const wetL=this.left.reflection(.75*l+.25*r), wetR=this.right.reflection(.75*r+.25*l);
      l = .86*l + .14*wetL + backing[i];
      r = .86*r + .14*wetR + backing[i];
      const amplitude=Math.max(Math.abs(l),Math.abs(r));
      this.gain=Math.min(this.gain+(1-this.gain)*this.limiterRelease, ceiling/Math.max(amplitude,1e-12));
      if (this.gain<.99999) this.limited++;
      left[i]=l*this.gain;
      right[i]=r*this.gain;
      this.peak=Math.max(this.peak,amplitude*this.gain);
    }
  }
}
