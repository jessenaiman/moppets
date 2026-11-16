/**
 * Stage choreography: where each Moppet stands, which way it faces, when it hops and what it says.
 *
 * Targets come from the score while a piece plays (a singer walks downstage a beat or two before
 * its entrance and the rest gather upstage to watch it), and from a seeded wander at rest (the
 * puppets roam, and every few seconds two of them meet and chat). A critically damped spring moves
 * each puppet to its target, so every move eases in and out without keyframes; turning to face
 * someone passes through a squash, like a flipped cutout. Pure and engine-free.
 */

export interface Actor {
  /** stage position, 0 = left edge, 1 = right edge */
  x: number;
  /** 0 = downstage (front), 1 = upstage (back) */
  depth: number;
  /** horizontal facing, -1..1; passes through 0 while turning */
  face: number;
  /** jump height, 0..1 */
  hop: number;
  /** lean, degrees (positive leans right) */
  lean: number;
  walking: boolean;
  bubble: string | null;
}

export interface Cue {
  playing: boolean;
  /** score beat while playing */
  beat: number;
  /** wall clock, seconds */
  now: number;
  /** per actor: has a note within the lookahead window */
  featured: boolean[];
  /** per actor: sounding right now */
  singing: boolean[];
  /** the actor last clicked, and when */
  poke: { index: number; at: number } | null;
  /** prefers-reduced-motion: stand in a line and never wander */
  still: boolean;
}

/** Beats ahead a singer starts walking forward, and beats it stays after its last note. */
export const LOOKAHEAD = 2, LINGER = 1;

/** A few things each Moppet says when two of them meet at rest. */
export const CHATTER: Record<string, string[]> = {
  vee: ["*click* rewind?", "nice teeth", "B-side!"],
  scribe: ["tak-tak-ding", "noted.", "spell it?"],
  clank: ["BEEP?", "hello, unit", "low C. LOW."],
  pip: ["ribbit ♪", "hop on it", "sparkly!"],
  gruff: ["grrr~", "warm up?", "ahoy"],
  tabby: ["purr…", "la la la", "stitch it"],
  chip: ["01?", "read me", "hum hum"],
};
const HELLO = ["hi!", "me!", "♪!", "yes?"];

const hash = (a: number, b: number) => {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const spread = (n: number, from: number, to: number) => Array.from({ length: n }, (_, i) => (n === 1 ? (from + to) / 2 : from + ((to - from) * i) / (n - 1)));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const LEFT = 0.09, RIGHT = 0.91;

interface Target {
  x: number;
  depth: number;
  /** NaN: face the way it walks */
  face: number;
  hop: number;
  lean: number;
  bubble: string | null;
  /** the face is set directly (a spin), not eased */
  snap?: boolean;
}

/** One ripple of hops along the line on every bar's downbeat. */
const wave = (beat: number, i: number) => {
  const phase = (((beat - i * 0.18) % 4) + 4) % 4;
  return phase < 0.5 ? Math.sin((Math.PI * phase) / 0.5) : 0;
};

function onStage(c: Cue, ids: readonly string[], current: readonly Actor[]): Target[] {
  const n = ids.length;
  const home = spread(n, LEFT, RIGHT);
  if (c.still) return home.map((x) => ({ x, depth: 0, face: 1, hop: 0, lean: 0, bubble: null }));
  const featured = ids.map((_, i) => i).filter((i) => c.featured[i]);
  const k = featured.length;
  if (k === 0 || k >= n - 1) {
    // a breath: a loose huddle facing the middle; the whole choir: one line, a wave of hops each bar
    const all = k > 0;
    return home.map((x, i) => ({ x, depth: all ? 0 : 0.3, face: all ? 1 : x < 0.5 ? 1 : -1, hop: all ? wave(c.beat, i) * 0.6 : 0, lean: 0, bubble: null }));
  }
  // the featured singers downstage centre, the rest upstage watching them
  const gap = Math.min(0.2, 0.7 / k);
  const front = spread(k, 0.5 - (gap * (k - 1)) / 2, 0.5 + (gap * (k - 1)) / 2);
  const back = spread(n - k, LEFT, RIGHT);
  const centre = front.reduce((a, b) => a + b, 0) / k;
  let f = 0, b = 0;
  return ids.map((_, i) => {
    if (c.featured[i]) {
      const x = front[f++];
      const face = k === 2 ? (f === 1 ? 1 : -1) : k === 1 ? 1 : x <= centre ? 1 : -1;
      return { x, depth: 0, face, hop: 0, lean: c.singing[i] ? face * 3 : 0, bubble: null };
    }
    const x = back[b++];
    // each watcher looks at the nearest singer, as it actually stands now
    const near = featured.reduce((best, j) => (Math.abs(current[j].x - x) < Math.abs(current[best].x - x) ? j : best), featured[0]);
    return { x, depth: 0.85, face: current[near].x >= x ? 1 : -1, hop: 0, lean: 0, bubble: null };
  });
}

/** At rest: everyone wanders, and every nine seconds two of them meet in the middle for a chat. */
function atRest(c: Cue, ids: readonly string[]): Target[] {
  const n = ids.length;
  if (c.still) return spread(n, LEFT, RIGHT).map((x) => ({ x, depth: 0, face: 1, hop: 0, lean: 0, bubble: null }));
  const out: Target[] = ids.map((_, i) => {
    const epoch = Math.floor((c.now + i * 2.3) / 6);
    return { x: LEFT + (RIGHT - LEFT) * hash(i, epoch), depth: 0.75 * hash(i + 50, epoch), face: NaN, hop: 0, lean: 0, bubble: null };
  });
  if (n < 2) return out;
  const m = Math.floor(c.now / 9), t = c.now - m * 9;
  if (t > 0.5 && t < 7.5) {
    const a = Math.floor(hash(99, m) * n), b = (a + 1 + Math.floor(hash(98, m) * (n - 1))) % n;
    const mx = 0.3 + 0.4 * hash(97, m);
    out[a] = { x: mx - 0.08, depth: 0.15, face: 1, hop: 0, lean: 0, bubble: null };
    out[b] = { x: mx + 0.08, depth: 0.15, face: -1, hop: 0, lean: 0, bubble: null };
    const say = (who: number, from: number) => {
      const s = t - from;
      if (s < 0 || s > 1.7) return;
      const lines = CHATTER[ids[who]] ?? HELLO;
      out[who].bubble = lines[Math.floor(hash(who + 7, m) * lines.length)];
      out[who].hop = s < 0.3 ? Math.sin((Math.PI * s) / 0.3) * 0.35 : 0;
      out[who].lean = out[who].face * 4;
    };
    say(a, 2.4);
    say(b, 4.4);
  }
  return out;
}

/** Eases each Moppet towards where the score (or its own wandering) wants it. */
export class Choreographer {
  readonly actors: Actor[];
  private vx: number[];
  private vd: number[];
  constructor(private ids: readonly string[]) {
    const home = spread(ids.length, LEFT, RIGHT);
    this.actors = home.map((x) => ({ x, depth: 0, face: 1, hop: 0, lean: 0, walking: false, bubble: null }));
    this.vx = home.map(() => 0);
    this.vd = home.map(() => 0);
  }

  step(c: Cue, dt: number): Actor[] {
    dt = clamp(dt, 0, 0.05);
    const targets = c.playing ? onStage(c, this.ids, this.actors) : atRest(c, this.ids);
    // a click: two hops and a spin, then a hello; everyone else turns to look
    const poke = c.poke && !c.still && c.now - c.poke.at < 1.8 ? c.poke : null;
    if (poke) {
      const t = c.now - poke.at, p = poke.index, me = targets[p];
      me.hop = t < 0.8 ? Math.abs(Math.sin((Math.PI * t) / 0.4)) : 0;
      if (t < 0.8) Object.assign(me, { face: Math.cos((2 * Math.PI * t) / 0.8), snap: true });
      me.bubble = t > 0.3 ? HELLO[poke.index % HELLO.length] : null;
      targets.forEach((o, i) => {
        if (i !== p && !(c.playing && c.featured[i])) o.face = this.actors[p].x >= this.actors[i].x ? 1 : -1;
      });
    }
    const w = 3.2, wd = 3, maxV = 0.45;
    return this.actors.map((a, i) => {
      const t = targets[i];
      // critically damped spring: slow in, slow out, no overshoot
      this.vx[i] = clamp(this.vx[i] + (w * w * (t.x - a.x) - 2 * w * this.vx[i]) * dt, -maxV, maxV);
      this.vd[i] += (wd * wd * (t.depth - a.depth) - 2 * wd * this.vd[i]) * dt;
      a.x = clamp(a.x + this.vx[i] * dt, LEFT, RIGHT);
      a.depth = clamp(a.depth + this.vd[i] * dt, 0, 1);
      a.walking = Math.abs(this.vx[i]) > 0.03 || Math.abs(this.vd[i]) > 0.06;
      const want = Number.isNaN(t.face) ? (Math.abs(this.vx[i]) > 0.02 ? Math.sign(this.vx[i]) : Math.sign(a.face) || 1) : t.face;
      a.face = t.snap ? want : a.face + clamp(want - a.face, -7 * dt, 7 * dt);
      a.hop = t.hop;
      a.lean += (t.lean - a.lean) * Math.min(1, 8 * dt);
      a.bubble = t.bubble;
      return a;
    });
  }
}

/** Per track, whether it has a note within [beat - LINGER, beat + LOOKAHEAD). */
export function featuredAt(tracks: readonly { id: string; events: readonly { beat: number; beats: number }[] }[], ids: readonly string[], beat: number): boolean[] {
  return ids.map((id) => {
    const t = tracks.find((x) => x.id === id);
    return !!t && t.events.some((e) => e.beat < beat + LOOKAHEAD && e.beat + e.beats > beat - LINGER);
  });
}
