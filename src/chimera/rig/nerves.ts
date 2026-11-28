/**
 * The nerve x-ray: the body's nervous system drawn as round lines in red, purple and blue, with
 * no skin, and the head's eyes, nose, lips and vocal tract kept (rig.html; docs/rig.md). For
 * videos: it's laid out to read as a nervous system, not to be anatomy to rely on.
 *
 * Built once, on the rig in its neutral pose (body cm: x forward, y up, z out of the right side):
 *  - central: the brain's folds (contours of a smooth noise field over the head's brain outline),
 *    the cerebellum's folia, the brainstem and the spinal cord, the cauda equina;
 *  - spinal nerves at each level: the brachial, lumbar and sacral plexuses and the limbs' named
 *    nerves (placed by casting rays from the bones out to the skin), the intercostals round the
 *    ribs, the back's rami, and twigs out to just under the skin (which is what draws the body's
 *    outline when the skin itself isn't drawn);
 *  - the sympathetic chains, the vagus and its recurrent laryngeal loops (the voice's nerve);
 *  - cranial nerves in the head's frame: optic, olfactory, trigeminal, facial, hypoglossal and
 *    the eyes' muscles.
 * Each control point is bound to the bones near it (the skin's weights where it lies) or to the
 * head, so the system follows any pose; the lines are redrawn from the posed points.
 *
 * Use (after `await initChimera()`, as the head):
 *   const head = wearHead(rig, model);                    // the head, as for a RigView (no RigView needed)
 *   const nerves = new Nerves(rig, head);                 // leaves the rig in its neutral pose
 *   const view = new NerveView(nerves);                   // draws the head as the x-ray has it
 *   scene.add(view.mesh, head.mount);                     // under the same parent
 *   // every frame: rig.pose(p) if it moves; view.update(camera, artic, tele, dt, height) (it updates the head);
 *   //              then view.pose() if the rig moved
 * Render with `renderer.outputColorSpace = THREE.LinearSRGBColorSpace`, as the head.
 */
import * as THREE from "three";
import type { Rig } from "./rig.ts";
import type { RigHead } from "./head.ts";
import { neutral } from "./pose.ts";
import type { VoiceModel } from "../ui/analysis.ts";
import type { HumanArtic } from "../wasm/types.ts";
import type { TelemetryMessage } from "../worklet/protocol.ts";
import { bodyPoint, buildProfile } from "../ui/render/profile.ts";
import { REST_ARTIC } from "../ui/render/anatomy3d.ts";

type V3 = THREE.Vector3;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const RAD = Math.PI / 180;

/** what a fibre is, for colouring */
export const KIND = { cerebrum: 0, cerebellum: 1, central: 2, mixed: 3, motor: 4, sensory: 5, autonomic: 6, tract: 7 } as const;

export interface Fibre {
  /** control points, posed (world cm) */
  p: V3[];
  r0: number;
  r1: number;
  kind: number;
  /** path distance from the brain at its start (cm) */
  d0: number;
  /** sample spacing along it (cm) */
  step: number;
  seed: number;
  /** the part of the body it binds to: torso, or a limb (and the torso within `r` of the limb's root) */
  region: Region;
  /** a twig's: the nerve it leaves, where (`t` of the way from its point `j` to the next: a share
   *  of its length would land elsewhere once it's posed and its pieces stretch unevenly); it moves
   *  as the nerve does there, and its first piece (`first`) starts on the nerve */
  twig?: { of: Fibre; j: number; t: number; first: boolean };
  /** a nerve from the trunk into a limb: up to this point it's bound as the trunk, then its
   *  weights go over evenly to its last point's (bound in its region), so the limb's swing is
   *  shared along it */
  blendFrom?: number;
}
interface Region {
  chain: string;
  root?: V3;
  r?: number;
}

/** a seeded random source */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Table = readonly (readonly [number, number])[];
function interp(tab: Table, x: number): number {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
}
/** as anatomy3d.ts's: the brain's half-width by template height */
const BRAIN_WIDTH: Table = [[12.3, 4.0], [13.0, 5.6], [14.5, 6.4], [16.5, 6.9], [18.5, 6.6], [20.0, 5.4], [21.0, 3.6], [21.45, 0.5]];

const len = (p: V3[]) => {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += p[i].distanceTo(p[i - 1]);
  return L;
};

/** the point and direction at a fraction of a polyline's length, and the piece it's on (`j`: from point j to j + 1) and how far along that (`t`) */
function along(p: V3[], u: number): { at: V3; dir: V3; s: number; j: number; t: number } {
  const L = len(p), s = Math.max(0, Math.min(1, u)) * L;
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const d = p[i].distanceTo(p[i - 1]);
    if (acc + d >= s || i === p.length - 1) {
      const t = Math.min(1, d > 0 ? (s - acc) / d : 0);
      return { at: p[i - 1].clone().lerp(p[i], t), dir: p[i].clone().sub(p[i - 1]).normalize(), s, j: i - 1, t };
    }
    acc += d;
  }
  return { at: p[0].clone(), dir: v(0, -1, 0), s: 0, j: 0, t: 0 };
}

/** the curve drawn through a fibre's points (Catmull-Rom), from its point i towards the next, t of the way */
function curveAt(P: V3[], i: number, t: number): V3 {
  const n = P.length, p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[Math.min(n - 1, i + 1)], p3 = P[Math.min(n - 1, i + 2)];
  const t2 = t * t, t3 = t2 * t, out = v();
  for (const c of ["x", "y", "z"] as const) out[c] = 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
  return out;
}

/** the line a fibre is drawn along (sampled from its curve every `step` or so, as `sampled`), from its point i towards the next, t of the way */
function drawnAt(P: V3[], step: number, i: number, t: number): V3 {
  const m = Math.max(1, Math.ceil(P[i].distanceTo(P[i + 1]) / step)), k = Math.min(m - 1, Math.floor(t * m));
  return curveAt(P, i, k / m).lerp(curveAt(P, i, (k + 1) / m), t * m - k);
}

/** a unit vector perpendicular to `t`, at a random turn about it */
function perp(t: V3, rnd: () => number): V3 {
  const a = Math.abs(t.y) < 0.9 ? v(0, 1, 0) : v(1, 0, 0);
  const n = a.clone().cross(t).normalize(), b = t.clone().cross(n).normalize();
  const th = rnd() * 2 * Math.PI;
  return n.multiplyScalar(Math.cos(th)).add(b.multiplyScalar(Math.sin(th)));
}

export class Nerves {
  readonly fibres: Fibre[] = [];
  private readonly rnd = rand(7);
  private readonly ray = new THREE.Raycaster();
  private readonly mesh: THREE.Mesh;
  private readonly k: number;
  private readonly B: (x: number, y: number) => { x: number; y: number };
  private readonly T: { P(x: number, y: number): { x: number; y: number } };
  private readonly side = [1, -1] as const;
  /** each control point's binding: to the head (its point in the head's cm), to bones (its point
   *  in each bone's rest frame), or, a twig's, to where it leaves its nerve (its offset from there
   *  in each bone's rest frame) */
  private bind: { head?: V3; bones?: { b: number; w: number; r: V3 }[]; off?: { b: number; w: number; r: V3 }[]; offHead?: V3 }[][] = [];
  /** the region fibres being added now bind to */
  private region: Region = { chain: "torso" };
  /** the twig being added now: the point it leaves its nerve at, and that nerve and how far along it */
  private root: V3 | undefined;
  private twigOf: { of: Fibre; j: number; t: number } | undefined;

  private readonly headM: THREE.Matrix4;
  private readonly model: VoiceModel;

  /** the system for this rig and the head it wears (it poses the rig neutral and places the head there to build it) */
  constructor(readonly rig: Rig, readonly head: RigHead) {
    rig.pose(neutral());
    const skinned = new Float32Array(3 * rig.n);
    rig.skin(skinned);
    head.update(new THREE.PerspectiveCamera(), REST_ARTIC, null, 0);
    // the head's place in the rig's frame (the mount's own matrix: whatever its parent, the nerves are drawn in that parent's frame too)
    this.headM = head.mount.matrix.clone();
    this.model = head.model;
    this.k = head.model.tract.scale;
    this.B = bodyPoint(head.model);
    this.T = head.model.tract;
    // the skin, for rays from the bones out to it
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(skinned.slice(), 3));
    const idx: number[] = [];
    for (let f = 0; f < rig.nq; f++) {
      const q = rig.quads.subarray(4 * f, 4 * f + 4);
      idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.mesh.updateMatrixWorld(true);
    this.build();
    this.bindAll(skinned);
    geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  // ------------------------------------------------------------------ tools
  private add(p: V3[], r0: number, r1: number, kind: number, d0 = 0, step = 1.2): Fibre {
    // its own copies: a junction (the armpit, a fork) is many fibres' point, and each is bound and posed as its fibre is
    const twig = this.twigOf && { ...this.twigOf, first: p[0] === this.root };
    const f: Fibre = { p: p.map((q) => q.clone()), r0, r1, kind, d0, step, seed: this.rnd(), region: this.region, twig };
    if (p.length >= 2 && len(p) > 0.2) this.fibres.push(f);
    return f;
  }
  /** distance from `o` along `dir` to the skin (or `far`) */
  private hit(o: V3, dir: V3, far = 60): number {
    this.ray.set(o, dir);
    this.ray.far = far;
    const h = this.ray.intersectObject(this.mesh, false);
    return h.length ? h[0].distance : far;
  }
  private under(o: V3, dir: V3, depth: number, far = 60): V3 {
    const d = dir.clone().normalize();
    return o.clone().addScaledVector(d, Math.max(0.3, this.hit(o, d, far) - depth));
  }
  private J(name: string): V3 {
    return this.rig.P[this.rig.bone(name)].clone();
  }
  /** a bone's tail, posed */
  private tail(name: string): V3 {
    const i = this.rig.bone(name), b = this.rig.bones[i];
    return v(...(b.tail as [number, number, number])).sub(this.rig.H[i]).applyQuaternion(this.rig.S[i]).multiplyScalar(this.rig.sc[i]).add(this.rig.P[i]);
  }
  /** a rest point carried by one bone */
  private onBone(name: string, rest: number[]): V3 {
    const i = this.rig.bone(name);
    return v(...(rest as [number, number, number])).sub(this.rig.H[i]).applyQuaternion(this.rig.S[i]).add(this.rig.P[i]);
  }
  /** a head point: template x, y (as the 2D head's) and z (template cm), to world */
  private hp(X: number, Y: number, Z: number): V3 {
    const b = this.B(X, Y);
    return v(b.x, b.y, Z * this.k).applyMatrix4(this.headM);
  }
  /** a point in the head's own cm, to world */
  private hc(x: number, y: number, z: number): V3 {
    return v(x, y, z).applyMatrix4(this.headM);
  }
  /** a head point pushed out to `depth` under the skin, along the line from the head's axis */
  private skinPt(X: number, Y: number, Z: number, depth = 0.5): V3 {
    const p = this.hp(X, Y, Z), o = this.hp(-1.5, Y, 0);
    return this.under(o, p.clone().sub(o), depth, 30);
  }

  // ------------------------------------------------------------------ the limbs
  /** a limb's joints and its frame along each segment: ant(erior) and med(ial) at t */
  private limb(kind: "arm" | "leg", side: 1 | -1) {
    const s = side > 0 ? ".R" : ".L";
    const X = v(1, 0, 0), Y = v(0, 1, 0);
    let joints: V3[], antOf: (seg: number, t: number, axis: V3) => V3;
    if (kind === "arm") {
      const hand = (n: string) => this.onBone("hand" + s, this.rig.header.points[n + s]);
      const W = this.J("hand" + s), M = hand("finger3-1"), Mt = hand("finger3-4");
      joints = [this.J("upperarm" + s), this.J("forearm" + s), W, M];
      // the palm faces the way the fingers curl
      const d1 = M.clone().sub(W).normalize(), d2 = Mt.clone().sub(M);
      const palm = d2.sub(d1.clone().multiplyScalar(d2.dot(d1))).normalize();
      antOf = (seg, t, axis) => {
        const a0 = X.clone().sub(axis.clone().multiplyScalar(X.dot(axis))).normalize();
        const a1 = palm.clone().sub(axis.clone().multiplyScalar(palm.dot(axis))).normalize();
        if (seg === 0) return a0;
        if (seg >= 2) return a1;
        const q = new THREE.Quaternion().setFromUnitVectors(a0, a1);
        return a0.applyQuaternion(new THREE.Quaternion().slerp(q, t)).normalize();
      };
    } else {
      joints = [this.J("thigh" + s), this.J("shin" + s), this.J("foot" + s), this.J("toes" + s), this.tail("toes" + s)];
      antOf = (seg, _t, axis) => {
        const r = seg <= 1 ? X : Y;
        return r.clone().sub(axis.clone().multiplyScalar(r.dot(axis))).normalize();
      };
    }
    /** a point in segment `seg` at t along it, on the ray at angle phi (0 front, 90 inside,
     *  180 behind, −90 outside), fraction f of the way out to the skin */
    const at = (seg: number, t: number, phi: number, f: number, far = 14): V3 => {
      const A = joints[seg], Bj = joints[seg + 1];
      const o = A.clone().lerp(Bj, t), axis = Bj.clone().sub(A).normalize();
      const ant = antOf(seg, t, axis), med = axis.clone().cross(ant).multiplyScalar(-side);
      const dir = ant.multiplyScalar(Math.cos(phi * RAD)).add(med.multiplyScalar(Math.sin(phi * RAD))).normalize();
      return o.addScaledVector(dir, this.hit(o, dir, far) * f);
    };
    const frame = (seg: number, t: number) => {
      const A = joints[seg], Bj = joints[seg + 1], axis = Bj.clone().sub(A).normalize();
      const ant = antOf(seg, t, axis);
      return { o: A.clone().lerp(Bj, t), axis, ant, med: axis.clone().cross(ant).multiplyScalar(-side) };
    };
    return { joints, at, frame, side };
  }

  /** the skin's vertices that one bone mostly moves (posed), for finding fingertips and toes */
  private vertsOf(names: string[], skinned: Float32Array): V3[] {
    const ids = new Set(names.map((n) => this.rig.bone(n)));
    const out: V3[] = [];
    for (let i = 0; i < this.rig.bodyVertices; i++) {
      let w = 0;
      for (let j = 0; j < this.rig.INF; j++) if (ids.has(this.rig.skinIndex[this.rig.INF * i + j])) w += this.rig.skinWeight[this.rig.INF * i + j];
      if (w > 0.6) out.push(v(skinned[3 * i], skinned[3 * i + 1], skinned[3 * i + 2]));
    }
    return out;
  }

  // ------------------------------------------------------------------ twigs out to the skin
  /** branches off a nerve every so often: motor ones end in the muscle, sensory ones fork out to just under the skin */
  private twigs(f: Fibre, every: number, o: { motor?: number; far?: number; r?: number; reach?: number } = {}): void {
    const L = len(f.p), rnd = this.rnd, motor = o.motor ?? 0.4, far = o.far ?? 16, r = o.r ?? 0.07;
    for (let s = every * (0.3 + 0.5 * rnd()); s < L - 0.5; s += every * (0.6 + 0.8 * rnd())) {
      const { dir, j, t } = along(f.p, s / L);
      // on the line the nerve is drawn along (a curve through its points), not the straight one between them
      const at = drawnAt(f.p, f.step, j, t);
      this.root = at;
      this.twigOf = this.fibres.includes(f) ? { of: f, j, t } : undefined;
      const out = perp(dir, rnd);
      const h = this.hit(at, out, far);
      if (h < 0.9 || h >= far) continue;
      const d0 = f.d0 + s;
      if (rnd() < motor) {
        const end = at.clone().addScaledVector(out, h * (0.35 + 0.3 * rnd())).addScaledVector(dir, (rnd() - 0.3) * 2);
        const mid = at.clone().lerp(end, 0.5).addScaledVector(dir, 0.6);
        const tw = this.add([at, mid, end], r * 1.2, r * 0.6, KIND.motor, d0, 0.8);
        // a muscle's few end branches
        for (let j = 0; j < 2; j++) {
          const e2 = end.clone().addScaledVector(perp(out, rnd), 0.8 + rnd()).addScaledVector(dir, (rnd() - 0.5) * 1.5);
          this.add([end, end.clone().lerp(e2, 0.5), e2], r * 0.6, r * 0.35, KIND.motor, d0 + len(tw.p), 0.6);
        }
      } else {
        const reach = o.reach ?? 0.45;
        const end = at.clone().addScaledVector(out, Math.max(0.5, h - reach));
        const fork = at.clone().lerp(end, 0.55 + 0.15 * rnd()).addScaledVector(dir, (rnd() - 0.3) * 1.6);
        this.add([at, at.clone().lerp(fork, 0.5).addScaledVector(dir, 0.4), fork], r, r * 0.8, KIND.sensory, d0, 0.8);
        const n = 2 + Math.floor(rnd() * 2);
        for (let j = 0; j < n; j++) {
          const d = out.clone().addScaledVector(perp(out, rnd), 0.35 + 0.35 * rnd()).addScaledVector(dir, (rnd() - 0.5) * 0.6).normalize();
          if (this.hit(fork, d, far) >= far) continue;
          const e = this.under(fork, d, reach, far);
          this.add([fork, fork.clone().lerp(e, 0.5).addScaledVector(dir, (rnd() - 0.5) * 0.8), e], r * 0.75, r * 0.3, KIND.sensory, d0 + fork.distanceTo(at), 0.6);
        }
      }
    }
    this.root = undefined;
    this.twigOf = undefined;
  }

  // ------------------------------------------------------------------ the whole system
  private build(): void {
    const k = this.k, hp = this.hp.bind(this), rnd = this.rnd;
    const skinned = (this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;

    // ---- the brain (head cm)
    this.brain();

    // ---- the torso: its middle at a height, and where the spinal canal is
    const spineJ = ["hips", "spine1", "spine2", "chest", "upperchest", "neck"].map((n) => this.J(n));
    const spineX = (y: number) => {
      for (let i = 1; i < spineJ.length; i++) {
        const a = spineJ[i - 1], b = spineJ[i];
        if (y <= b.y) return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1);
      }
      return spineJ[spineJ.length - 1].x;
    };
    const torso = (y: number) => {
      const o = v(spineX(y), y, 0);
      const fr = this.hit(o, v(1, 0, 0), 40), bk = this.hit(o, v(-1, 0, 0), 40);
      return { c: v(o.x + (fr - bk) / 2, y, 0), back: o.x - bk, front: o.x + fr };
    };
    const canalX = (y: number) => torso(y).back + (y > 40 ? 5.2 : 5.6);

    // ---- the spinal cord: down the head's own canal (its neck), then the body's
    const canalHead = (Y: number, z = 0) => this.hc(this.T.P(-4.9, 0).x, this.T.P(0, Y).y, z);
    const top = this.hc(this.T.P(-4.9, 0).x, this.T.P(0, 11.4).y, 0);
    const cord: V3[] = [];
    for (const Y of [11.4, 9.4, 7.4, 5.4, 3.4, 1.4, -0.6, -2.6]) cord.push(canalHead(Y));
    const join = cord[cord.length - 1];
    const T1y = join.y - 1.5, CONUS = 28;
    for (let y = join.y - 3; y > CONUS; y -= 3) {
      const t = THREE.MathUtils.smoothstep(join.y - y, 0, 10);
      cord.push(v(join.x + (canalX(y) - join.x) * t, y, 0));
    }
    cord.push(v(canalX(CONUS), CONUS, 0));
    // brainstem into the cord
    const stem = [hp(-0.3, 14.6, 0), hp(-0.9, 13.8, 0), hp(-1.5, 13.0, 0), hp(-2.8, 12.2, 0), top];
    this.add(stem, 0.6, 0.45, KIND.central, 0, 0.6);
    this.add(cord, 0.48, 0.36, KIND.central, len(stem), 1);
    const dCord = (y: number) => {
      // path distance from the brain to the cord at a height
      let best = 0, bd = Infinity, acc = len(stem);
      for (let i = 0; i < cord.length; i++) {
        if (i) acc += cord[i].distanceTo(cord[i - 1]);
        const d = Math.abs(cord[i].y - y);
        if (d < bd) [bd, best] = [d, acc];
      }
      return best;
    };
    // the cauda equina: roots running on down the canal to the sacrum
    const SACRUM = [12, 10.5, 9, 7.5, 6];
    for (let i = 0; i < 9; i++) {
      const z = (i - 4) * 0.22, end = 20 - i * 1.5;
      const pts: V3[] = [];
      for (let y = CONUS + 1; y >= end; y -= 2.5) pts.push(v(canalX(y), y, z * (1 + (CONUS - y) * 0.03)));
      this.add(pts, 0.16, 0.12, KIND.central, dCord(CONUS), 1);
    }

    // ---- the spinal nerves' exits, level by level (world): C1–C8 in the head's neck, then T1–Co
    type Level = { name: string; at: (side: number) => V3; y: number; d: number };
    const levels: Level[] = [];
    const cY = [10.8, 9.6, 8.0, 6.3, 4.5, 2.8, 1.0, -0.8];
    cY.forEach((Y, i) => {
      const at = (side: number) => canalHead(Y - 0.5, side * 1.7 * k);
      levels.push({ name: `C${i + 1}`, at, y: at(1).y, d: dCord(at(1).y) });
    });
    const lv = (name: string, y: number, root = y) => {
      levels.push({ name, y, d: dCord(Math.max(root, CONUS)), at: (side) => v(canalX(y) - 0.4, y - 0.6, side * 1.9) });
    };
    for (let i = 0; i < 12; i++) lv(`T${i + 1}`, T1y - ((T1y - 31) * i) / 11);
    for (let i = 0; i < 5; i++) lv(`L${i + 1}`, 28 - i * 3.3);
    SACRUM.forEach((y, i) => lv(`S${i + 1}`, y));
    const L = (name: string) => levels.find((l) => l.name === name)!;
    const root = (name: string, side: number) => {
      const l = L(name), ex = l.at(side);
      const inCord = v(ex.x + 0.4, ex.y + 0.6, side * 0.45);
      return { from: inCord, ex, d: l.d };
    };
    // every level's back branch (the dorsal ramus) out to the skin of the back
    for (const l of levels) {
      if (l.name.startsWith("C") && l.name !== "C2") continue;
      for (const side of this.side) {
        const { from, ex, d } = root(l.name, side);
        if (l.name === "C2") {
          const occ = [hp(-6.2, 12.0, side * 2.2), this.skinPt(-6.5, 15.5, side * 2.6, 0.6), this.skinPt(-5.0, 19.0, side * 2.4, 0.6), this.skinPt(-2.0, 21.5, side * 1.8, 0.6)];
          this.add([from, ex, ...occ], 0.12, 0.07, KIND.sensory, d, 0.6);
          continue;
        }
        const dir = v(-1, -0.15, side * 0.35).normalize();
        const end = this.under(ex, dir, 1.2, 25);
        const f = this.add([from, ex, ex.clone().lerp(end, 0.5).add(v(0, -1, side * 0.8)), end], 0.2, 0.12, KIND.mixed, d, 1);
        this.twigs(f, 3.5, { motor: 0.5, far: 6 });
      }
    }

    // ---- the cervical plexus: the neck's skin and the phrenic nerve down to the diaphragm
    for (const side of this.side) {
      for (const [n, Y, X] of [["C2", 9.0, -1.0], ["C3", 6.5, 1.5], ["C3", 5.0, 3.0], ["C4", 3.0, 2.0]] as const) {
        const { from, ex, d } = root(n, side);
        const end = this.skinPt(X, Y, side * 5, 0.5);
        const f = this.add([from, ex, hp(-3.0, (Y + 8) / 2, side * 3.6), end], 0.16, 0.1, KIND.sensory, d, 0.8);
        this.twigs(f, 2.5, { motor: 0, far: 4 });
      }
      const ph = [root("C3", side), root("C4", side), root("C5", side)];
      const neck = hp(1.2, -2, side * 2.9);
      for (const r of ph) this.add([r.from, r.ex, r.ex.clone().lerp(neck, 0.5).add(v(0.8, 0, side * 0.6)), neck], 0.13, 0.13, KIND.motor, r.d, 0.8);
      const t50 = torso(52), t42 = torso(42);
      const dome: V3[] = [neck, v(t50.c.x + 1.5, 56, side * 5.5), v(t50.c.x + 2, 50, side * 7.5), v(t42.c.x + 2, 44, side * 8.5), v(t42.c.x + 1, 41, side * 8)];
      const phr = this.add(dome, 0.14, 0.12, KIND.motor, L("C4").d + 5, 1);
      // its fan over the diaphragm's dome
      for (let i = 0; i < 6; i++) {
        const a = (i / 5 - 0.5) * 2.4;
        const end = v(t42.c.x + 1 + 7 * Math.cos(a), 39.5 - 1.5 * Math.abs(Math.sin(a)), side * (8 - 5 + 5 * Math.cos(a * 0.6)));
        this.add([dome[dome.length - 1], dome[dome.length - 1].clone().lerp(end, 0.5).add(v(0, 0.6, 0)), end], 0.08, 0.05, KIND.motor, phr.d0 + len(dome), 0.8);
      }
    }

    // ---- the brachial plexus and the arms
    for (const side of this.side) {
      const s = side > 0 ? ".R" : ".L";
      this.region = { chain: "arm" + s, root: this.J("upperarm" + s), r: 12 };
      const arm = this.limb("arm", side);
      const clav = this.J("clavicle" + s).lerp(this.J("upperarm" + s), 0.45).add(v(-1.5, 2.2, 0));
      const axilla = arm.at(0, 0.12, 100, 0.45);
      const roots = ["C5", "C6", "C7", "C8", "T1"].map((n) => root(n, side));
      roots.forEach((r, i) => {
        const mid = r.ex.clone().lerp(clav, 0.5).add(v(-0.5, -0.5 * i, side * 0.5));
        // on from the collarbone to the armpit in short steps: the armpit swings with the arm, and the bend spreads along them
        const under = [0.25, 0.5, 0.75].map((t) => clav.clone().lerp(axilla, t).add(v(0, (1 - 0.5 * i) * (1 - t), 0)));
        this.add([r.from, r.ex, mid, clav.clone().add(v(0, 1 - 0.5 * i, 0)), ...under, axilla], 0.18, 0.24, KIND.mixed, r.d, 1).blendFrom = 3;
      });
      const dA = roots[2].d + len([roots[2].ex, clav, axilla]);
      const named = (pts: V3[], r0: number, r1: number, every = 3.2, motor = 0.45, d = dA) => {
        const f = this.add(pts, r0, r1, KIND.mixed, d, 1);
        this.twigs(f, every, { motor });
        return f;
      };
      // the median nerve: inside the upper arm, the front of the elbow, down the middle of the forearm, the palm
      const median = named([axilla, arm.at(0, 0.3, 80, 0.5), arm.at(0, 0.65, 70, 0.5), arm.at(0, 0.95, 25, 0.45), arm.at(1, 0.1, 5, 0.45), arm.at(1, 0.5, 0, 0.45), arm.at(1, 0.92, 0, 0.55), arm.at(2, 0.2, 0, 0.5)], 0.3, 0.2);
      // the ulnar: inside, behind the elbow (the funny bone), down the little finger's side
      const ulnar = named([axilla, arm.at(0, 0.35, 105, 0.5), arm.at(0, 0.7, 135, 0.55), arm.at(0, 0.98, 155, 0.75), arm.at(1, 0.12, 120, 0.6), arm.at(1, 0.5, 90, 0.55), arm.at(1, 0.92, 70, 0.6), arm.at(2, 0.2, 60, 0.55)], 0.27, 0.18);
      // the radial: round the back of the humerus, out to the thumb's side
      const radial = named([axilla, arm.at(0, 0.25, 140, 0.5), arm.at(0, 0.5, 180, 0.45), arm.at(0, 0.78, -110, 0.55), arm.at(0, 0.97, -70, 0.55), arm.at(1, 0.1, -50, 0.5)], 0.3, 0.24);
      named([arm.at(1, 0.1, -50, 0.5), arm.at(1, 0.45, -70, 0.8), arm.at(1, 0.9, -110, 0.82), arm.at(2, 0.15, -140, 0.8), arm.at(2, 0.6, -120, 0.8)], 0.15, 0.1, 2.6, 0.1, radial.d0 + len(radial.p));
      named([arm.at(1, 0.1, -50, 0.5), arm.at(1, 0.3, 180, 0.45), arm.at(1, 0.7, 175, 0.5)], 0.17, 0.12, 2.6, 0.8, radial.d0 + len(radial.p));
      // the musculocutaneous: through the biceps, then the forearm's outside
      named([axilla, arm.at(0, 0.3, 50, 0.5), arm.at(0, 0.6, 10, 0.55), arm.at(0, 0.95, -35, 0.75), arm.at(1, 0.3, -30, 0.85), arm.at(1, 0.85, -15, 0.85)], 0.2, 0.12, 3, 0.4);
      // the axillary: round the back of the shoulder into the deltoid
      const ax = this.add([axilla, arm.at(0, 0.1, 160, 0.55), arm.at(0, 0.12, -150, 0.6), arm.at(0, 0.15, -90, 0.6)], 0.18, 0.12, KIND.mixed, dA, 0.8);
      this.twigs(ax, 1.5, { motor: 0.8 });
      // the forearm's inner skin (the medial cutaneous nerves)
      named([axilla, arm.at(0, 0.5, 110, 0.85), arm.at(0, 0.95, 120, 0.85), arm.at(1, 0.4, 120, 0.88), arm.at(1, 0.9, 110, 0.88)], 0.1, 0.08, 3, 0);
      // the fingers: median to the thumb, index, middle and half the ring; ulnar to the rest
      this.fingers(side, skinned, median, ulnar);
    }

    this.region = { chain: "torso" };
    // ---- round the ribs: the intercostals (T1–T11) and the subcostal (T12)
    for (let i = 1; i <= 12; i++) {
      const l = L(`T${i}`), drop = 7 + 0.3 * i;
      for (const side of this.side) {
        const { from, ex } = root(`T${i}`, side);
        const pts: V3[] = [from, ex];
        const t = torso(l.y);
        for (let th = 0.12; th <= 0.97; th += 0.06) {
          const y = l.y - drop * Math.pow(th, 1.3), tc = torso(y);
          const dir = v(-Math.cos(th * Math.PI), 0, side * Math.sin(th * Math.PI) * (i < 3 ? 0.7 : 1)).normalize();
          const o = v(t.c.x + (tc.c.x - t.c.x), y, 0);
          pts.push(this.under(o, dir, i < 3 ? 3.5 : 2.2, i <= 4 ? 12 + i : 30));
        }
        const f = this.add(pts, 0.15, 0.1, KIND.mixed, l.d, 1.2);
        this.twigs(f, 3.2, { motor: 0.45, far: 5, reach: 0.4 });
      }
    }

    // ---- the lumbar plexus (L1–L4): round the waist, the front and inside of the thighs
    const legs = this.side.map((side) => this.limb("leg", side));
    for (const side of this.side) {
      const leg = legs[side > 0 ? 0 : 1];
      const hipJ = leg.joints[0];
      const psoas = v(spineX(20) + 3.5, 19, side * 4.5);
      // the iliohypogastric and ilioinguinal (L1): round the waist to the groin
      this.region = { chain: "torso" };
      {
        const { from, ex, d } = root("L1", side);
        const pts: V3[] = [from, ex];
        for (let th = 0.15; th <= 0.95; th += 0.08) {
          const y = L("L1").y - 10 * Math.pow(th, 1.2);
          pts.push(this.under(v(spineX(y) + 2, y, 0), v(-Math.cos(th * Math.PI), 0, side * Math.sin(th * Math.PI)), 2.2, 30));
        }
        this.twigs(this.add(pts, 0.14, 0.1, KIND.mixed, d, 1.2), 3, { motor: 0.4, far: 5 });
      }
      const lroots = ["L2", "L3", "L4"].map((n) => root(n, side));
      lroots.forEach((r) => this.add([r.from, r.ex, r.ex.clone().lerp(psoas, 0.5).add(v(0.5, 0, side * 0.8)), psoas], 0.24, 0.26, KIND.mixed, r.d, 1));
      this.region = { chain: "leg" + (side > 0 ? ".R" : ".L"), root: hipJ, r: 18 };
      const dL = lroots[1].d + 8;
      const inguinal = hipJ.clone().add(v(4.5, 1.5, side * 0.5));
      // the femoral: under the inguinal ligament, down the front of the thigh in a spray of branches
      const fem = this.add([psoas, psoas.clone().lerp(inguinal, 0.5).add(v(1, 0, side * 1)), inguinal, leg.at(0, 0.1, 15, 0.5)], 0.32, 0.28, KIND.mixed, dL, 1);
      const femD = dL + len(fem.p);
      for (const [phi, end, f] of [[-40, 0.7, 0.6], [-10, 0.92, 0.55], [20, 0.95, 0.5], [50, 0.8, 0.6], [0, 0.5, 0.75], [-70, 0.55, 0.85]] as const) {
        const b = this.add([leg.at(0, 0.1, 15, 0.5), leg.at(0, 0.3, phi, f), leg.at(0, end, phi * 0.8, f)], 0.16, 0.1, KIND.mixed, femD, 1);
        this.twigs(b, 3, { motor: 0.55 });
      }
      // the saphenous: on down the inside of the knee and shin to the inner foot
      const saph = this.add([leg.at(0, 0.1, 15, 0.5), leg.at(0, 0.5, 70, 0.6), leg.at(0, 0.95, 110, 0.75), leg.at(1, 0.1, 100, 0.85), leg.at(1, 0.5, 90, 0.85), leg.at(1, 0.95, 80, 0.85), leg.at(2, 0.3, 70, 0.8), leg.at(2, 0.8, 60, 0.75)], 0.12, 0.09, KIND.sensory, femD, 1.2);
      this.twigs(saph, 3, { motor: 0 });
      // the obturator: through the pelvis to the inner thigh
      const obt = this.add([psoas, v(spineX(12) + 4, 11, side * 6.5), hipJ.clone().add(v(2.5, -3, -side * 4.5)), leg.at(0, 0.2, 90, 0.55), leg.at(0, 0.55, 95, 0.6)], 0.2, 0.12, KIND.mixed, dL, 1);
      this.twigs(obt, 3, { motor: 0.6 });
      // the lateral femoral cutaneous: out by the hip bone, down the outside of the thigh
      const lfc = this.add([psoas, v(spineX(16) + 6, 16, side * 10), hipJ.clone().add(v(5.5, 5, side * 3)), leg.at(0, 0.2, -50, 0.88), leg.at(0, 0.6, -70, 0.88)], 0.12, 0.08, KIND.sensory, dL, 1.2);
      this.twigs(lfc, 2.6, { motor: 0 });
    }

    this.region = { chain: "torso" };
    // ---- the sacral plexus (L4–S3): the sciatic down the back of each leg, and its branches to the foot
    for (const side of this.side) {
      const leg = legs[side > 0 ? 0 : 1];
      const hipJ = leg.joints[0];
      this.region = { chain: "torso" };
      const sp = v(spineX(8) - 2, 8.5, side * 5.5);
      const sroots = ["L4", "L5", "S1", "S2", "S3"].map((n) => root(n, side));
      sroots.forEach((r) => this.add([r.from, r.ex, r.ex.clone().lerp(sp, 0.5).add(v(-0.5, 0, side * 0.5)), sp], 0.3, 0.34, KIND.mixed, r.d, 1));
      this.region = { chain: "leg" + (side > 0 ? ".R" : ".L"), root: hipJ, r: 18 };
      const dS = sroots[2].d + 6;
      const notch = hipJ.clone().add(v(-6.5, -2.5, side * -0.5));
      const sci = this.add([sp, sp.clone().lerp(notch, 0.5).add(v(-1, -1, 0)), notch, leg.at(0, 0.15, 175, 0.5), leg.at(0, 0.45, 180, 0.45), leg.at(0, 0.78, 180, 0.45)], 0.5, 0.42, KIND.mixed, dS, 1.2);
      this.twigs(sci, 3, { motor: 0.7, far: 12 });
      const dK = dS + len(sci.p);
      const split = leg.at(0, 0.78, 180, 0.45);
      // the tibial: the back of the knee, the middle of the calf, behind the inner ankle, the sole
      const tib = this.add([split, leg.at(0, 0.97, 180, 0.45), leg.at(1, 0.08, 180, 0.45), leg.at(1, 0.5, 170, 0.45), leg.at(1, 0.95, 120, 0.6), leg.at(2, 0.15, 150, 0.6)], 0.34, 0.26, KIND.mixed, dK, 1.2);
      this.twigs(tib, 3, { motor: 0.65 });
      const dT = dK + len(tib.p);
      // the sural: down the back of the calf, behind the outer ankle, the foot's outer edge
      const sur = this.add([leg.at(1, 0.08, 180, 0.45), leg.at(1, 0.4, 180, 0.88), leg.at(1, 0.95, -150, 0.85), leg.at(2, 0.4, -110, 0.85), leg.at(2, 0.95, -100, 0.8)], 0.1, 0.08, KIND.sensory, dK + 6, 1.2);
      this.twigs(sur, 2.6, { motor: 0 });
      // the common peroneal: round the head of the fibula, then the shin's outside and front
      const per = this.add([split, leg.at(0, 0.95, -130, 0.65), leg.at(1, 0.06, -100, 0.8), leg.at(1, 0.12, -60, 0.7)], 0.26, 0.22, KIND.mixed, dK, 1);
      const dP = dK + len(per.p);
      const sup = this.add([leg.at(1, 0.12, -60, 0.7), leg.at(1, 0.5, -60, 0.75), leg.at(1, 0.85, -25, 0.85), leg.at(2, 0.3, -15, 0.85), leg.at(2, 0.8, 0, 0.85)], 0.15, 0.1, KIND.sensory, dP, 1);
      this.twigs(sup, 2.6, { motor: 0.2 });
      const deep = this.add([leg.at(1, 0.12, -60, 0.7), leg.at(1, 0.3, -10, 0.45), leg.at(1, 0.7, 0, 0.45), leg.at(1, 0.97, 5, 0.6), leg.at(2, 0.4, 30, 0.6)], 0.17, 0.12, KIND.mixed, dP, 1);
      this.twigs(deep, 3, { motor: 0.8 });
      this.toes(side, leg, tib, deep, dT, skinned);
      // the pudendal (S2–S4)
      const pud = root("S3", side);
      this.add([pud.from, pud.ex, v(spineX(4) + 2, 2, side * 4), v(spineX(0) + 7, -1, side * 2)], 0.14, 0.1, KIND.mixed, pud.d, 1);
    }

    this.region = { chain: "torso" };
    // ---- the sympathetic chains: beaded strands beside the vertebrae, joined at the tailbone
    for (const side of this.side) {
      const chain: V3[] = [hp(-2.6, 9.5, side * 2.0)];
      for (const Y of [6.5, 3.5, 0.5]) chain.push(this.hc(this.T.P(-4.9, 0).x + 2.6 * k, this.T.P(0, Y).y, side * 2.0 * k));
      for (let y = T1y - 2; y > 4; y -= 3) chain.push(v(canalX(y) + 3.2, y, side * (y > 20 ? 2.2 : 1.2 + 0.05 * y)));
      chain.push(v(canalX(4) + 2.5, 2.5, 0));
      this.add(chain, 0.08, 0.07, KIND.autonomic, 10, 1);
      // the ganglia, and their links to the spinal nerves
      for (let i = 1; i < chain.length - 1; i++) {
        const g = chain[i], t = chain[i + 1].clone().sub(chain[i - 1]).normalize();
        this.add([g.clone().addScaledVector(t, -0.4), g.clone().addScaledVector(t, 0.4)], 0.2, 0.2, KIND.autonomic, 10, 0.3);
        const lvl = levels.reduce((b, l) => (Math.abs(l.y - g.y) < Math.abs(b.y - g.y) ? l : b));
        if (Math.abs(lvl.y - g.y) < 2.5) this.add([g, lvl.at(side)], 0.06, 0.06, KIND.autonomic, 10, 0.5);
      }
    }

    // ---- the vagus: out of the brainstem, down the neck by the larynx, into the chest and belly
    for (const side of this.side) {
      const out = [hp(-2.6, 12.0, side * 1.0), hp(-3.0, 11.0, side * 2.6), hp(-1.6, 8.5, side * 2.9), hp(-0.8, 5.0, side * 2.7), hp(-0.6, 1.0, side * 2.6), hp(-0.8, -3.5, side * 2.5)];
      const chest: V3[] = [];
      for (const y of [T1y - 4, 56, 50, 44, 38, 32, 26]) chest.push(v(canalX(y) + 5.5 + (y < 40 ? 1.5 : 0), y, side * (y > 45 ? 2.6 : 1.4)));
      const vag = this.add([...out, ...chest], 0.17, 0.14, KIND.autonomic, 4, 1);
      // its plexuses: the heart, the lungs, the gut
      for (let i = 0; i < 14; i++) {
        const y = 52 - i * 2, from = v(canalX(y) + 5.5, y, side * 1.8);
        const end = from.clone().add(v(2 + 3 * rnd(), -2 - 2 * rnd(), side * (2 + 5 * rnd())));
        this.add([from, from.clone().lerp(end, 0.5).add(v(0, 0.8, 0)), end], 0.07, 0.04, KIND.autonomic, 30 + i, 0.6);
      }
      // the superior laryngeal: high in the neck down to the larynx
      this.add([hp(-1.6, 8.5, side * 2.9), hp(0.2, 5.0, side * 2.3), hp(1.2, 2.6, side * 1.8), hp(1.0, 1.5, side * 1.2)], 0.1, 0.07, KIND.autonomic, 12, 0.6);
      // the recurrent laryngeal: down into the chest, under the subclavian (right) or the aorta (left), back up to the larynx
      const lowY = side > 0 ? 59 : 52.5, xL = canalX(lowY) + 5.5;
      const loop = [v(xL, lowY + 2, side * 2.8), v(xL + 1.2, lowY - 1.2, side * (side > 0 ? 3.8 : 1.6)), v(xL - 0.4, lowY - 1.6, side * 2.4), v(xL - 0.8, lowY + 1, side * 1.4)];
      const up = [v(canalX(T1y - 4) + 5, T1y - 4, side * 1.2), hp(-0.2, -3.0, side * 1.1), hp(-0.3, -1.0, side * 1.0), hp(-0.2, 0.3, side * 0.8)];
      this.add([...loop, ...up], 0.11, 0.09, KIND.autonomic, 30, 0.6);
    }

    // ---- cranial nerves (the head's frame)
    this.cranial();
  }

  /** the brain: its folds as contours of a noise field over its outline, the cerebellum's folia, tracts inside */
  private brain(): void {
    const k = this.k, model = this.model, rnd = this.rnd;
    const prof = buildProfile(model, model.frame(REST_ARTIC), REST_ARTIC);
    const outline = prof.brain;
    const ph = model.bodyParams.pharynx;
    const unBy = (y: number) => (y / k >= 7 ? y / k : 7 - (7 - y / k) / ph);
    let y0 = Infinity, y1 = -Infinity;
    for (const p of outline) [y0, y1] = [Math.min(y0, p.y), Math.max(y1, p.y)];
    const section = (y: number) => {
      let F = -Infinity, Bk = Infinity;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length];
        if (a.y > y === b.y > y) continue;
        const x = a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
        F = Math.max(F, x);
        Bk = Math.min(Bk, x);
      }
      return F > Bk ? { F, Bk, W: interp(BRAIN_WIDTH, unBy(y)) * k, xw: Bk + (F - Bk) * 0.48 } : null;
    };
    const GAP = 0.22 * k;
    /** the brain's surface at height y, turn th (0 front, π/2 right, π back), drawn in by `inset` */
    const surf = (y: number, th: number, inset = 0): V3 | null => {
      const s = section(y);
      if (!s) return null;
      const c = Math.cos(th), sn = Math.sin(th);
      const p = c >= 0 ? 2.3 : 2.2;
      const x = c >= 0 ? s.xw + (s.F - s.xw) * Math.pow(c, 2 / p) : s.xw - (s.xw - s.Bk) * Math.pow(-c, 2 / p);
      const z = Math.sign(sn) * s.W * Math.pow(Math.abs(sn), 2 / p);
      const q = v(x, y, z);
      if (inset) q.lerp(v(s.xw, (y0 + y1) / 2 - 0.5 * k, 0), inset);
      q.z += Math.sign(sn) * GAP * Math.min(1, Math.abs(sn) * 8);
      return q;
    };
    // the cerebellum: an ellipsoid under the back of the brain, behind the stem
    const cb = { c: v(this.B(-4.9, 12.7).x, this.B(-4.9, 12.7).y, 0), a: 2.3 * k, b: 1.65 * k, w: 4.0 * k };
    const inCb = (p: V3, m = 1) => ((p.x - cb.c.x) / (cb.a * m)) ** 2 + ((p.y - cb.c.y) / (cb.b * m)) ** 2 + (p.z / (cb.w * m)) ** 2 < 1;

    // a smooth field: a sum of plane waves in random directions
    const waves = Array.from({ length: 12 }, () => {
      const d = v(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      return { d, w: (3.3 + 1.1 * rnd()) / k, ph: rnd() * 2 * Math.PI };
    });
    const field = (p: V3) => waves.reduce((s, q) => s + Math.sin(p.dot(q.d) * q.w + q.ph), 0);
    // marching squares over (height, turn), the turn round and round
    const NY = 170, NT = 360;
    const ys = Array.from({ length: NY }, (_, i) => y0 + 0.12 * k + ((y1 - y0 - 0.2 * k) * i) / (NY - 1));
    const P: (V3 | null)[] = [], Fv: number[] = [];
    for (let i = 0; i < NY; i++) {
      for (let j = 0; j < NT; j++) {
        const p = surf(ys[i], (j / NT) * 2 * Math.PI, 0.02);
        P.push(p);
        Fv.push(p ? field(p) : NaN);
      }
    }
    const id = (i: number, j: number) => i * NT + (((j % NT) + NT) % NT);
    // a point on a grid edge where the field crosses zero; edges keyed h (i, j)–(i, j+1) and v (i, j)–(i+1, j)
    const edgePt = (a: number, b: number) => {
      const fa = Fv[a], fb = Fv[b], t = fa / (fa - fb);
      return P[a]!.clone().lerp(P[b]!, t);
    };
    const segs: [number, number][] = [];
    const pts = new Map<number, V3>();
    const key = (kind: 0 | 1, i: number, j: number) => 2 * id(i, j) + kind;
    for (let i = 0; i < NY - 1; i++) {
      for (let j = 0; j < NT; j++) {
        const a = id(i, j), b = id(i, j + 1), c = id(i + 1, j + 1), d = id(i + 1, j);
        if ([a, b, c, d].some((q) => !P[q])) continue;
        // the cell's edges: bottom (a–b), right (b–c), top (d–c), left (a–d)
        const E = [[key(0, i, j), a, b], [key(1, i, j + 1), b, c], [key(0, i + 1, j), d, c], [key(1, i, j), a, d]] as const;
        const cross = E.filter(([, p, q]) => Fv[p] > 0 !== Fv[q] > 0);
        for (const [kk, p, q] of cross) if (!pts.has(kk)) pts.set(kk, edgePt(p, q));
        if (cross.length === 2) segs.push([cross[0][0], cross[1][0]]);
        else if (cross.length === 4) {
          segs.push([cross[0][0], cross[1][0]]);
          segs.push([cross[2][0], cross[3][0]]);
        }
      }
    }
    // chain the segments into lines
    const at = new Map<number, number[]>();
    segs.forEach(([a, b], s) => {
      for (const e of [a, b]) at.set(e, [...(at.get(e) ?? []), s]);
    });
    const used = new Uint8Array(segs.length);
    for (let s0 = 0; s0 < segs.length; s0++) {
      if (used[s0]) continue;
      used[s0] = 1;
      const chain = [segs[s0][0], segs[s0][1]];
      for (const dir of [1, -1]) {
        for (;;) {
          const end = dir > 0 ? chain[chain.length - 1] : chain[0];
          const next = (at.get(end) ?? []).find((s) => !used[s]);
          if (next === undefined) break;
          used[next] = 1;
          const o = segs[next][0] === end ? segs[next][1] : segs[next][0];
          if (dir > 0) chain.push(o);
          else chain.unshift(o);
        }
      }
      // split where it crosses the midline or enters the cerebellum; thin the points
      let run: V3[] = [];
      const flush = () => {
        if (run.length >= 3 && len(run) > 0.8 * k) this.add(run.map((q) => q.applyMatrix4(this.headM)), 0.075, 0.075, KIND.cerebrum, 2 + 18 * rnd(), 0.3);
        run = [];
      };
      for (const e of chain) {
        const q = pts.get(e)!.clone();
        const last = run[run.length - 1];
        if (inCb(q, 1.15) || (last && Math.sign(last.z) !== Math.sign(q.z))) {
          flush();
          continue;
        }
        if (!last || last.distanceTo(q) > 0.16 * k) run.push(q);
      }
      flush();
    }
    // the cerebellum's folia: ridges running across it, side to side, from its top over the back to under it
    for (let i = 0; i < 15; i++) {
      const al = -0.2 * Math.PI + (1.3 * Math.PI * i) / 14;
      const line: V3[] = [];
      for (let j = 0; j <= 40; j++) {
        const z = cb.w * (-1 + (2 * j) / 40), g = Math.sqrt(Math.max(0, 1 - (z / cb.w) ** 2)) * (0.82 + 0.18 * Math.abs(z / cb.w));
        const r = g * (1 + 0.04 * Math.sin(6 * z / k + i));
        line.push(v(cb.c.x - cb.a * r * Math.cos(al), cb.c.y + cb.b * r * Math.sin(al), z).applyMatrix4(this.headM));
      }
      this.add(line, 0.07, 0.07, KIND.cerebellum, 6 + 6 * rnd(), 0.3);
    }
    // tracts: from the stem up through the internal capsule, fanning out to the cortex
    for (let n = 0; n < 44; n++) {
      const side = n % 2 ? 1 : -1;
      const y = y0 + (y1 - y0) * (0.35 + 0.6 * rnd()), th = side * (0.15 + 0.7 * rnd()) * Math.PI;
      const end = surf(y, th, 0.08);
      if (!end || inCb(end, 1.2)) continue;
      const cap = v(this.B(0.9, 15.6).x, this.B(0.9, 15.6).y, side * 2.0 * k);
      const st = v(this.B(-0.6 - 0.8 * rnd(), 14.0 + 0.6 * rnd()).x, this.B(-0.6, 14.0 + 0.6 * rnd()).y, side * (0.4 + 0.6 * rnd()) * k);
      const mid = cap.clone().lerp(end, 0.45).add(v(0, 0.6 * k, 0));
      this.add([st, cap, mid, end].map((q) => q.applyMatrix4(this.headM)), 0.03, 0.025, KIND.tract, 1 + 3 * rnd(), 0.5);
    }
  }

  /** the cranial nerves, in the head's frame */
  private cranial(): void {
    const hp = this.hp.bind(this), k = this.k;
    const eyeC = this.B(6.15, 15.35), eyeR = 1.05 * k;
    for (const side of this.side) {
      // optic: from the back of each eye to the chiasm, then back to the visual cortex
      const eyeBack = this.hc(eyeC.x - eyeR, eyeC.y, side * 3.15 * k);
      const chiasm = hp(3.2, 14.6, side * 0.25);
      this.add([eyeBack, this.hc(eyeC.x - eyeR - 1.0 * k, eyeC.y - 0.15 * k, side * 2.4 * k), chiasm], 0.15, 0.12, KIND.sensory, 3, 0.4);
      const lgn = hp(-0.5, 14.8, side * 2.0);
      this.add([chiasm, hp(1.6, 14.5, side * 1.2), lgn], 0.11, 0.1, KIND.sensory, 4, 0.4);
      for (let i = 0; i < 4; i++) this.add([lgn, hp(-2.5, 15.4 + 0.3 * i, side * (2.6 + 0.3 * i)), hp(-5.2, 15.8 + 0.4 * i, side * (1.8 + 0.4 * i)), hp(-6.4, 15.9 + 0.45 * i, side * 0.9)], 0.07, 0.05, KIND.sensory, 6, 0.4);
      // olfactory: the bulbs over the nose's roof, filaments down into it
      const bulb = hp(5.4, 14.9, side * 0.55);
      this.add([hp(2.2, 14.9, side * 1.1), hp(4.0, 14.95, side * 0.7), bulb], 0.08, 0.11, KIND.sensory, 3, 0.4);
      for (let i = 0; i < 4; i++) this.add([bulb, hp(5.6 + 0.3 * i, 14.2, side * (0.35 + 0.1 * i)), hp(5.4 + 0.5 * i, 13.4 - 0.2 * i, side * 0.6)], 0.035, 0.03, KIND.sensory, 4, 0.3);
      // the eyes' muscles (III, IV, VI): the midbrain out to the back of the orbit
      for (let i = 0; i < 3; i++) this.add([hp(-0.4, 14.2 - 0.3 * i, side * 0.4), hp(2.0, 14.3 + 0.2 * i, side * (1.6 + 0.3 * i)), this.hc(eyeC.x - eyeR * 0.6, eyeC.y + (i - 1) * 0.6 * k, side * (3.15 * k + (i - 1) * 0.6 * k))], 0.04, 0.035, KIND.motor, 3, 0.4);
      // trigeminal (V, the face's feeling): the ganglion, then forehead, cheek and jaw
      const pons = hp(-1.2, 13.1, side * 0.9), gang = hp(0.6, 13.5, side * 2.6);
      this.add([pons, hp(-0.3, 13.3, side * 1.8), gang], 0.16, 0.2, KIND.sensory, 3, 0.4);
      const fan = (from: V3, ends: V3[], r: number, kind: number) => {
        for (const e of ends) this.add([from, from.clone().lerp(e, 0.5).add(v(0, 0.2, 0)), e], r, r * 0.4, kind, 6, 0.4);
      };
      const v1 = [gang, hp(3.6, 15.4, side * 2.6), hp(6.3, 16.5, side * 2.3)];
      this.add(v1, 0.13, 0.1, KIND.sensory, 4, 0.4);
      fan(v1[2], [this.skinPt(6.6, 19.6, side * 1.6), this.skinPt(6.2, 18.4, side * 3.4)], 0.06, KIND.sensory);
      const v2 = [gang, hp(3.0, 13.2, side * 2.5), hp(6.6, 13.9, side * 2.1)];
      this.add(v2, 0.13, 0.1, KIND.sensory, 4, 0.4);
      fan(v2[2], [this.skinPt(7.0, 12.4, side * 3.0), this.skinPt(7.4, 11.6, side * 1.7)], 0.06, KIND.sensory);
      const v3 = [gang, hp(0.4, 11.3, side * 3.1), hp(0.2, 9.2, side * 3.6), hp(3.0, 6.6, side * 3.3), hp(5.4, 5.9, side * 2.2)];
      this.add(v3, 0.13, 0.1, KIND.sensory, 4, 0.4);
      fan(v3[4], [this.skinPt(6.4, 5.4, side * 1.4)], 0.06, KIND.sensory);
      // facial (VII, the face's muscles): out behind the ear, through the parotid, a fan over the face
      const par = hp(-1.0, 9.8, side * 5.2);
      this.add([hp(-1.6, 12.6, side * 1.4), hp(-2.2, 12.0, side * 3.4), hp(-2.8, 10.8, side * 4.6), par], 0.17, 0.16, KIND.motor, 4, 0.4);
      for (const [X, Y, Z] of [[3.8, 17.2, 5.6], [5.6, 14.0, 4.6], [6.6, 11.6, 3.6], [5.6, 6.6, 2.6], [1.5, 3.5, 4.2]] as const) {
        const end = this.skinPt(X, Y, side * Z, 0.4), mid = this.skinPt((X - 1.0) / 2, (Y + 9.8) / 2, side * 5.0, 0.8);
        this.add([par, mid, end], 0.07, 0.04, KIND.motor, 7, 0.4);
      }
      // hypoglossal (XII): under the jaw into the tongue
      const hyp = [hp(-2.6, 11.4, side * 0.8), hp(-2.4, 9.0, side * 2.4), hp(0.2, 6.6, side * 2.5), hp(2.6, 6.6, side * 1.8), hp(3.8, 7.9, side * 1.0)];
      this.add(hyp, 0.11, 0.08, KIND.motor, 4, 0.4);

    }
  }

  /** the hands' digital nerves: median to the thumb side, ulnar to the little finger's */
  private fingers(side: 1 | -1, skinned: Float32Array, median: Fibre, ulnar: Fibre): void {
    const s = side > 0 ? ".R" : ".L";
    const hand = (n: string) => this.onBone("hand" + s, this.rig.header.points[n + s]);
    const W = this.J("hand" + s), T1 = hand("finger1-1"), M = hand("finger3-1"), Pk = hand("finger5-1");
    const axis = M.clone().sub(W).normalize();
    const radial = T1.clone().sub(Pk);
    radial.sub(axis.clone().multiplyScalar(radial.dot(axis))).normalize();
    const verts = this.vertsOf(["hand" + s], skinned);
    const reach = M.clone().sub(W).dot(axis);
    const bases = [M.clone().add(M.clone().sub(Pk).multiplyScalar(0.5)), M, M.clone().lerp(Pk, 0.5), Pk];
    const tips: V3[] = bases.map((b) => {
      const lat = b.clone().sub(W).dot(radial);
      let best = b.clone(), bu = -Infinity;
      for (const q of verts) {
        const d = q.clone().sub(W), u = d.dot(axis), l = d.dot(radial);
        if (u > reach * 0.9 && Math.abs(l - lat) < 0.9 && u > bu) [bu, best] = [u, q];
      }
      return best;
    });
    // the thumb: the hand's farthest point from the wrist on the thumb's side, past its base
    let thumb = T1.clone(), tb = -Infinity;
    const tdir = T1.clone().sub(W).normalize();
    for (const q of verts) {
      const d = q.clone().sub(T1);
      const score = d.dot(tdir) + 0.6 * d.dot(axis);
      if (q.clone().sub(W).dot(radial) > T1.clone().sub(W).dot(radial) - 1 && score > tb) [tb, thumb] = [score, q];
    }
    const centre = W.clone().lerp(M, 0.75);
    const inward = (p: V3, by = 0.35) => p.clone().lerp(centre, by / Math.max(0.5, p.distanceTo(centre)));
    const mEnd = median.p[median.p.length - 1], uEnd = ulnar.p[ulnar.p.length - 1];
    const dM = median.d0 + len(median.p), dU = ulnar.d0 + len(ulnar.p);
    const digit = (from: V3, base: V3, tip: V3, d: number, off: number) => {
      const o = radial.clone().multiplyScalar(off);
      this.add([from, base.clone().lerp(from, 0.4).add(o), inward(base.clone().add(o), 0.5), inward(base.clone().lerp(tip, 0.6).add(o), 0.35), inward(tip.clone().add(o.clone().multiplyScalar(0.5)), 0.3)], 0.08, 0.05, KIND.sensory, d, 0.5);
    };
    for (const off of [0.3, -0.3]) {
      digit(mEnd, T1, thumb, dM, off);
      digit(mEnd, bases[0], tips[0], dM, off);
      digit(mEnd, bases[1], tips[1], dM, off);
      digit(off > 0 ? mEnd : uEnd, bases[2], tips[2], off > 0 ? dM : dU, off);
      digit(uEnd, bases[3], tips[3], dU, off);
    }
    // the thenar muscles (the thumb's ball) from the median, the rest of the hand's from the ulnar
    this.add([mEnd, mEnd.clone().lerp(T1, 0.6), T1.clone().lerp(W, 0.3)], 0.07, 0.05, KIND.motor, dM, 0.5);
    this.add([uEnd, uEnd.clone().lerp(centre, 0.7), centre.clone().lerp(bases[0], 0.5)], 0.07, 0.05, KIND.motor, dU, 0.5);
  }

  /** the foot: plantar nerves from the tibial to the toes, the deep peroneal to the first web */
  private toes(side: 1 | -1, leg: ReturnType<Nerves["limb"]>, tib: Fibre, deep: Fibre, dT: number, skinned: Float32Array): void {
    const s = side > 0 ? ".R" : ".L";
    const verts = this.vertsOf(["toes" + s], skinned);
    const f = leg.frame(3, 0.5);
    const base = leg.joints[3];
    let lo = Infinity, hi = -Infinity;
    for (const q of verts) {
      const m = q.clone().sub(base).dot(f.med);
      [lo, hi] = [Math.min(lo, m), Math.max(hi, m)];
    }
    const tips: V3[] = [];
    for (let i = 0; i < 5; i++) {
      // big toe (medial) to little toe
      const m = hi - ((hi - lo) * (i + 0.5)) / 5;
      let best = base.clone(), bu = -Infinity;
      for (const q of verts) {
        const d = q.clone().sub(base);
        if (Math.abs(d.dot(f.med) - m) < (hi - lo) / 8 && d.dot(f.axis) > bu) [bu, best] = [d.dot(f.axis), q];
      }
      tips.push(best);
    }
    const heel = tib.p[tib.p.length - 1];
    const medPl = [heel, leg.at(2, 0.45, 150, 0.6), leg.at(2, 0.85, 140, 0.55)];
    const latPl = [heel, leg.at(2, 0.45, -150, 0.6), leg.at(2, 0.85, -150, 0.55)];
    const med = this.add(medPl, 0.15, 0.12, KIND.mixed, dT, 0.8);
    this.add(latPl, 0.13, 0.1, KIND.mixed, dT, 0.8);
    const toePt = (tip: V3, t: number) => tip.clone().lerp(base, t).addScaledVector(f.ant, -0.5);
    tips.forEach((tip, i) => {
      const from = (i < 3 ? medPl : latPl)[2];
      this.add([from, toePt(tip, 0.7), toePt(tip, 0.35), tip.clone().lerp(base, 0.08)], 0.07, 0.04, KIND.sensory, dT + 15, 0.5);
    });
    const dEnd = deep.p[deep.p.length - 1];
    this.add([dEnd, leg.at(2, 0.8, 40, 0.7), tips[0].clone().lerp(tips[1], 0.5).lerp(base, 0.6)], 0.07, 0.05, KIND.sensory, deep.d0 + len(deep.p), 0.5);
    this.twigs(med, 1.8, { motor: 0.5, far: 4 });
  }

  // ------------------------------------------------------------------ binding and posing
  /** bind each control point: to the head (above the neck's rim) or to the bones its skin moves with */
  private bindAll(skinned: Float32Array): void {
    const rig = this.rig, inv = this.headM.clone().invert();
    const rimY = rig.P[rig.bone("neck")].y + 2;
    const n = rig.n, K = 6;
    // each vertex's part of the body: the limb or the torso its weights mostly lie in
    const chainOf = (name: string) => {
      const m = name.match(/^(upperarm|forearm|hand|shoulderHelper|elbowHelper)\d?(\.[RL])$/) ?? name.match(/^(thigh|shin|foot|toes|kneeHelper|hipHelper|hipFront)\d?(\.[RL])$/);
      if (!m) return "torso";
      return (/^(thigh|shin|foot|toes|knee|hip)/.test(m[1]) ? "leg" : "arm") + m[2];
    };
    const boneChain = rig.bones.map((b) => chainOf(b.name));
    const vChain = Array.from({ length: n }, (_, i) => {
      const acc = new Map<string, number>();
      for (let j = 0; j < rig.INF; j++) {
        const w = rig.skinWeight[rig.INF * i + j];
        if (w) acc.set(boneChain[rig.skinIndex[rig.INF * i + j]], (acc.get(boneChain[rig.skinIndex[rig.INF * i + j]]) ?? 0) + w);
      }
      return [...acc].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "torso";
    });
    /** the bones moving the skin nearest p (of its own part of the body), by inverse distance */
    const weightsAt = (p: V3, reg: Region): Map<number, number> => {
      const torsoToo = reg.chain === "torso" || (reg.root && p.distanceTo(reg.root) < (reg.r ?? 0));
      const best: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        if (vChain[i] !== reg.chain && !(torsoToo && vChain[i] === "torso")) continue;
        const dx = skinned[3 * i] - p.x, dy = skinned[3 * i + 1] - p.y, dz = skinned[3 * i + 2] - p.z, d = dx * dx + dy * dy + dz * dz;
        if (best.length < K || d < best[best.length - 1][1]) {
          best.push([i, d]);
          best.sort((a, b) => a[1] - b[1]);
          if (best.length > K) best.pop();
        }
      }
      const wb = new Map<number, number>();
      for (const [i, d] of best) {
        const w = 1 / (Math.sqrt(d) + 0.5);
        for (let j = 0; j < rig.INF; j++) {
          const sw = rig.skinWeight[rig.INF * i + j], b = rig.skinIndex[rig.INF * i + j];
          if (sw) wb.set(b, (wb.get(b) ?? 0) + w * sw);
        }
      }
      return wb;
    };
    const top = (wb: Map<number, number>) => {
      const t = [...wb].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = t.reduce((s, [, w]) => s + w, 0);
      return t.map(([b, w]) => [b, w / sum] as const);
    };
    type Weights = Map<number, number>;
    const sum = (m: Weights) => [...m.values()].reduce((s, x) => s + x, 0) || 1;
    /** a mix of weight maps, each counted as summing to its share */
    const mixOf = (parts: [Weights, number][]): Weights => {
      const m: Weights = new Map();
      for (const [w, k] of parts) w.forEach((x, b) => m.set(b, (m.get(b) ?? 0) + (k * x) / sum(w)));
      return m;
    };
    /** a point bound: carried by the head (its point in the head's cm) or by bones */
    type Bind = (typeof this.bind)[number][number];
    const byBones = (p: V3, w: Weights): Bind => ({ bones: top(w).map(([b, x]) => ({ b, w: x, r: p.clone().sub(rig.P[b]).applyQuaternion(rig.S[b].clone().invert()).divideScalar(rig.sc[b]).add(rig.H[b]) })) });
    // the head carries what is above the jaw's line; the neck's nerves twist with the neck's skin
    const headward = (p: V3) => {
      const local = p.clone().applyMatrix4(inv);
      return local.y > 6 * this.k || p.y > rimY + 14 ? local : null;
    };

    // 1. each nerve's weights along it, smoothed, so no two neighbouring points follow different
    //    bones (a limb's nerve near the torso, or a root by the shoulder, would be pulled apart as
    //    the arm rises); a plexus's run into a limb goes over from the trunk's to the limb's
    const TRUNK: Region = { chain: "torso" };
    const nerveW = new Map<Fibre, (Weights | null)[]>();
    for (const f of this.fibres) {
      if (f.twig) continue;
      const onHead = f.p.map((p) => headward(p) !== null);
      let W = f.p.map((p, i) => (onHead[i] ? new Map() : weightsAt(p, f.blendFrom !== undefined && i < f.p.length - 1 ? TRUNK : f.region)));
      if (f.blendFrom !== undefined) {
        const a = f.blendFrom, b = f.p.length - 1;
        for (let i = a + 1; i < b; i++) W[i] = mixOf([[W[a], 1 - (i - a) / (b - a)], [W[b], (i - a) / (b - a)]]);
      } else {
        for (let pass = 0; pass < 3; pass++) {
          W = W.map((w, i) => {
            if (onHead[i]) return w;
            const nb = [i - 1, i + 1].filter((j) => j >= 0 && j < W.length && !onHead[j]);
            return mixOf([[w, 0.5], ...nb.map((j) => [W[j], 0.5 / nb.length] as [Weights, number])]);
          });
        }
      }
      nerveW.set(f, W.map((w, i) => (onHead[i] ? null : w)));
    }
    // 2. where nerves meet (a plexus's node, the armpit, a nerve's split) they share a point: its
    //    weights are all of theirs, so it can't come apart as they're posed
    const key = (p: V3) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;
    const meet = new Map<string, Weights[]>();
    for (const [f, W] of nerveW) f.p.forEach((p, i) => W[i] && meet.set(key(p), [...(meet.get(key(p)) ?? []), W[i]!]));
    const final = (f: Fibre, i: number): Weights | null => {
      const w = nerveW.get(f)?.[i];
      if (!w) return null;
      const all = meet.get(key(f.p[i]))!;
      return all.length > 1 ? mixOf(all.map((x) => [x, 1 / all.length])) : w;
    };
    // 3. a twig moves as its nerve does where it leaves it (or with the head, if the head carries the nerve there)
    /** a twig's frame: its nerve's bones' weights there, and how much of it is the head's (where the head carries one end of the nerve's piece) */
    const twigW = ({ of, j, t }: NonNullable<Fibre["twig"]>): { w: Weights; head: number } => {
      const ends: [Weights | null, number][] = [[final(of, j), 1 - t], [final(of, j + 1), t]];
      return { w: mixOf(ends.filter(([w]) => w) as [Weights, number][]), head: ends.reduce((h, [w, k]) => h + (w ? 0 : k), 0) };
    };
    const headTurn = new THREE.Matrix3().setFromMatrix4(inv);
    for (const f of this.fibres) {
      if (f.twig) {
        // it hangs off its nerve where it leaves it, turned as the nerve's bones turn there (or as
        // the head does, where the head carries the nerve)
        const { of, j, t } = f.twig, { w, head } = twigW(f.twig), root = drawnAt(of.p, of.step, j, t);
        this.bind.push(f.p.map((p) => ({
          off: head < 1 ? top(w).map(([b, x]) => ({ b, w: x * (1 - head), r: p.clone().sub(root).applyQuaternion(rig.S[b].clone().invert()).divideScalar(rig.sc[b]) })) : [],
          offHead: p.clone().sub(root).applyMatrix3(headTurn).multiplyScalar(head),
        })));
      } else {
        this.bind.push(f.p.map((p, i) => {
          const w = final(f, i);
          return w ? byBones(p, w) : { head: headward(p)! };
        }));
      }
    }
  }

  /** move every control point to the rig's pose now (and the head's place: after head.update) */
  pose(): void {
    const rig = this.rig, q = v(), headM = this.head.mount.matrix, headTurn = new THREE.Matrix3().setFromMatrix4(headM);
    this.fibres.forEach((f, i) => {
      // a twig's nerve was posed before it (it was made first)
      const root = f.twig ? drawnAt(f.twig.of.p, f.twig.of.step, f.twig.j, f.twig.t) : null;
      f.p.forEach((p, j) => {
        const b = this.bind[i][j];
        if (b.head) p.copy(b.head).applyMatrix4(headM);
        else if (b.off) {
          // the head's share of the turn is in offHead already
          p.copy(b.offHead!).applyMatrix3(headTurn).add(root!);
          for (const { b: bi, w, r } of b.off) p.addScaledVector(q.copy(r).multiplyScalar(rig.sc[bi]).applyQuaternion(rig.S[bi]), w);
        } else {
          p.set(0, 0, 0);
          for (const { b: bi, w, r } of b.bones!) p.addScaledVector(q.copy(r).sub(rig.H[bi]).multiplyScalar(rig.sc[bi]).applyQuaternion(rig.S[bi]).add(rig.P[bi]), w);
        }
      });
    });
  }
}

// ------------------------------------------------------------------ drawing
// Each fibre as a line: every sample-to-sample piece a flat strip facing the camera, as wide as the
// fibre in cm, shaded across its width as if it were round (a capsule drawn as an impostor). Its
// joints are cut square, so pieces don't overlap; its depth is the round surface's.

/** the colours, shared: what a point of a fibre looks like, given how squarely it faces the eye */
const SHADE = /* glsl */ `
uniform float uMode;
/** how far the pulses have run out from the brain (cm) */
uniform float uRun;
uniform float uNear;
uniform float uFar;
uniform float uGain;
uniform vec3 uRed;
uniform vec3 uPurple;
uniform vec3 uBlue;
uniform float uSignal;
/** all of it dimmer as the camera comes close (the lines widen with it, and the glow over them) */
uniform float uBright;
uniform vec4 uClear[4];
uniform float uClearAmt;
varying vec3 vW;
varying float vKind;
varying float vSeed;
varying float vDepth;
vec3 tri(float t) {
  return t < 0.5 ? mix(uRed, uPurple, t * 2.0) : mix(uPurple, uBlue, t * 2.0 - 1.0);
}
vec3 byKind(float k) {
  if (k < 0.5) return uPurple;                         // cerebrum
  if (k < 1.5) return uBlue;                           // cerebellum
  if (k < 2.5) return mix(uPurple, vec3(1.0), 0.15);   // stem and cord
  if (k < 3.5) return uPurple;                         // mixed nerves
  if (k < 4.5) return uRed;                            // motor
  if (k < 5.5) return uBlue;                           // sensory
  if (k < 6.5) return mix(uRed, uPurple, 0.45);        // autonomic
  return mix(uPurple, uBlue, 0.5);                     // tracts
}
/** how much is left of a nerve near the line of sight through an eye, the nose or the mouth (from
 *  just in front of it on back): the face's features stand out on a clearing */
float cleared() {
  float keep = 1.0;
  for (int i = 0; i < 4; i++) {
    vec3 c = uClear[i].xyz;
    float r = uClear[i].w;
    vec3 d = normalize(c - cameraPosition), p = vW - cameraPosition;
    float t = dot(p, d);
    if (t < dot(c - cameraPosition, d) - r) continue;
    float off = length(p - d * t);
    keep = min(keep, mix(0.12, 1.0, smoothstep(0.5 * r, r, off)));
  }
  return mix(1.0, keep, uClearAmt);
}
/** pulses running out from the brain along the nerves */
float pulse(float dist) {
  float ph = fract((dist - uRun) / 26.0 + (vKind < 1.5 ? vSeed : 0.0));
  return smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(0.03, 0.14, ph));
}
vec3 shade(float ndv, float dist) {
  float rim = 1.0 - ndv;
  vec3 col;
  if (uMode < 0.5) {
    // solid, by what each nerve does, with a faint signal running through it
    vec3 c = byKind(vKind);
    col = c * (0.16 + 0.84 * ndv) + vec3(1.0) * pow(ndv, 28.0) * 0.45 * uBright + c * pow(rim, 3.0) * 0.5;
    col += mix(c, vec3(1.0), 0.5) * pulse(dist) * uSignal;
  } else if (uMode < 1.5) {
    // x-ray, by depth: near red, far blue
    float t = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
    float brain = vKind < 1.5 || (vKind > 6.5) ? 0.6 : 1.0;
    col = (tri(t) * (0.1 + 0.9 * pow(rim, 1.7)) + mix(tri(t), vec3(1.0), 0.4) * pulse(dist) * uSignal * 0.6) * uGain * brain;
  } else {
    // signal: red at the brain to blue at the fingers and toes, pulses running out
    float t = clamp(dist / 120.0, 0.0, 1.0);
    vec3 c = tri(t);
    float brain = vKind < 1.5 || (vKind > 6.5) ? 0.65 : 1.0;
    col = (c * (0.14 + 0.86 * pow(rim, 1.5)) + mix(c, vec3(1.0), 0.4) * pulse(dist) * 0.9) * uGain * brain;
  }
  return col * cleared() * uBright;
}`;

const LINE_VERT = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
/** the radius at each end, and the path distance from the brain at each */
attribute vec4 iRD;
/** its kind, its fibre's seed, and whether each end is the fibre's (rounded) or a joint (cut square) */
attribute vec4 iK;
/** the drawing buffer's size (px), and the narrowest a line is drawn (px) */
uniform vec2 uRes;
uniform float uMinPx;
varying vec2 vQ;
varying vec3 vSeg;
varying vec2 vD;
varying vec2 vCap;
varying vec2 vEnds;
varying float vPx;
varying float vCover;
varying float vKind;
varying float vSeed;
varying float vDepth;
varying vec3 vW;
void main() {
  vec3 A = (modelMatrix * vec4(iA, 1.0)).xyz, B = (modelMatrix * vec4(iB, 1.0)).xyz;
  vec3 mid = 0.5 * (A + B);
  vec3 toCam = normalize(cameraPosition - mid);
  // the piece as seen: its axis laid in the plane facing the camera (end-on, it's a disc)
  vec3 ax = (B - A) - toCam * dot(B - A, toCam);
  float L = length(ax);
  vec3 dir = L > 1e-4 ? ax / L : normalize(cross(toCam, abs(toCam.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 side = cross(dir, toCam);
  // never thinner on screen than uMinPx: a line drawn wider than it is is dimmer for it
  float pxPerCm = uRes.y * projectionMatrix[1][1] / (2.0 * max(1.0, distance(cameraPosition, mid)));
  vec2 radii = iRD.xy * length(modelMatrix[0].xyz);
  float r = max(max(radii.x, radii.y), 1e-4);
  float grow = max(1.0, 0.5 * uMinPx / (pxPerCm * r));
  vCover = 1.0 / grow;
  float R = r * grow;
  // the strip covers the capsule round the piece: its length and a radius past each end
  float a = position.x * (L + 2.0 * R) - R;
  float b = position.y * R;
  vec3 w = mid - dir * (0.5 * L) + dir * a + side * b;
  vQ = vec2(a, b);
  vSeg = vec3(L, radii * grow);
  vD = iRD.zw;
  // joints are cut square, but not a piece seen end-on: its round ends are all there is of it
  // (only then: where lines add up, the overlapping ends of a chain of such pieces glow)
  vCap = L < 0.3 * R ? vec2(1.0) : iK.zw;
  vPx = pxPerCm;
  vKind = iK.x;
  vSeed = iK.y;
  vW = w;
  // its ends' own depths: the strip lies in one plane, the piece doesn't
  vEnds = vec2(-(viewMatrix * vec4(A, 1.0)).z, -(viewMatrix * vec4(B, 1.0)).z);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const LINE_FRAG = /* glsl */ `
${SHADE}
uniform mat4 projectionMatrix;
varying vec2 vQ;
varying vec3 vSeg;
varying vec2 vD;
varying vec2 vCap;
varying vec2 vEnds;
varying float vPx;
varying float vCover;
void main() {
  float L = vSeg.x;
  // a joint is cut square (a rounded end there would overlap the next piece's, a bead at every joint)
  if ((vQ.x < 0.0 && vCap.x < 0.5) || (vQ.x > L && vCap.y < 0.5)) discard;
  float t = clamp(vQ.x / max(L, 1e-4), 0.0, 1.0), r = mix(vSeg.y, vSeg.z, t);
  // how far out from the piece's axis, as a share of its radius: 1 at its edge
  float q = length(vec2(vQ.x - clamp(vQ.x, 0.0, L), vQ.y)) / r;
  if (q >= 1.0) discard;
  float ndv = sqrt(1.0 - q * q);
  // the round surface's depth: the piece's own there (its near end, seen end-on), nearer by the
  // bulge, so crossing nerves cut each other as tubes would
  float depth = L < r ? min(vEnds.x, vEnds.y) : mix(vEnds.x, vEnds.y, t);
  vec4 clip = projectionMatrix * vec4(0.0, 0.0, r * ndv - depth, 1.0);
  gl_FragDepth = 0.5 * clip.z / clip.w + 0.5;
  // the outermost px soft, where lines add up (a solid line just ends: a soft edge would be a dark fringe over what's behind)
  float edge = uMode < 0.5 ? 1.0 : clamp((1.0 - q) * r * vPx + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(shade(ndv, mix(vD.x, vD.y, t)) * vCover * edge, 1.0);
}`;

/** how the nerves are coloured: by what each does (motor red, sensory blue, mixed purple; solid),
 *  by depth as an x-ray (near red to far blue), or as signal (red at the brain to blue at the
 *  fingers and toes, pulses running out) */
export type NerveLook = "function" | "xray" | "signal";

const uniforms = () => ({
  uMode: { value: 0 },
  uRun: { value: 0 },
  uNear: { value: 100 },
  uFar: { value: 200 },
  uGain: { value: 1 },
  uSignal: { value: 0 },
  uBright: { value: 1 },
  uClear: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1e4, 0, 0.001)) },
  uClearAmt: { value: 0 },
  uRed: { value: new THREE.Vector3(1.0, 0.2, 0.32) },
  uPurple: { value: new THREE.Vector3(0.62, 0.34, 1.0) },
  uBlue: { value: new THREE.Vector3(0.22, 0.56, 1.0) },
  uRes: { value: new THREE.Vector2(1, 1) },
  uMinPx: { value: 1.3 },
});

/** a fibre smoothed (Catmull-Rom through its points) and sampled every `step` or so, with the distance along it */
function sampled(f: Fibre): { pts: V3[]; cum: number[] } {
  const P = f.p, n = P.length, pts: V3[] = [];
  for (let i = 0; i < n - 1; i++) {
    const m = Math.max(1, Math.ceil(P[i].distanceTo(P[i + 1]) / f.step));
    for (let j = 0; j < m; j++) pts.push(curveAt(P, i, j / m));
  }
  pts.push(P[n - 1].clone());
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, cum };
}

/** the line a fibre is drawn along, where it is now (for checking what's drawn) */
export const drawnLine = (f: Fibre): V3[] => sampled(f).pts;

/** the face's features in the head's cm, and how far round each the nerves clear away behind it */
function features(head: RigHead): [V3, number][] {
  const model = head.model, k = model.tract.scale, B = bodyPoint(model);
  const eye = B(6.15, 15.35);
  const lip = head.head.lipEdges(model, REST_ARTIC).upper, lipC = v();
  for (let i = 0; i < lip.length; i += 3) lipC.add(v(lip[i], lip[i + 1], lip[i + 2]));
  lipC.divideScalar(lip.length / 3);
  const prof = buildProfile(model, model.frame(REST_ARTIC), REST_ARTIC);
  const nose = prof.skinUpper.filter((p) => p.y > B(0, 10.9).y && p.y < B(0, 15).y).reduce((a, b) => (b.x > a.x ? b : a));
  return [[v(eye.x, eye.y, 3.15 * k), 2.3], [v(eye.x, eye.y, -3.15 * k), 2.3], [v(nose.x - 0.6 * k, nose.y + 0.6 * k, 0), 2.0], [lipC, 3.0]];
}

/**
 * The nerves drawn, and the head drawn to go with them: no skin, grid or ears, its own brain and
 * spine left to the nerves, the eyes, nose and lips standing out.
 */
export class NerveView {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  /** the pulses' strength in the function and x-ray looks (the signal look's are full) */
  signal = 0.3;
  /** how fast the pulses run out from the brain (cm/s) */
  speed = 12;
  /** how close the camera is to the head, 0 (the whole body, or further) to 1 (about the head
   *  filling the screen, or closer): a glow pass should weaken as it nears 1 (its own lines are dimmed) */
  close = 0;
  private run = 0;
  private readonly head: RigHead;
  private readonly parts = { brain: 0, skull: 0, spine: 0, ears: 0, pop: 2 };
  private readonly feats: [V3, number][];
  private readonly v3 = v();
  private readonly w3 = v();

  constructor(readonly nerves: Nerves) {
    const head = (this.head = nerves.head);
    head.setLook({ inner: 1, bone: 0.3, outline: 0, shell: 0, skin: 0, features: 2.6 });
    head.head.drawing = { ...head.head.drawing, fade: null, parts: this.parts };
    this.feats = features(head);
    this.mat = new THREE.ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, uniforms: uniforms() });
    // a strip faces the camera, but which way round it's wound depends on its piece's direction
    this.mat.side = THREE.DoubleSide;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.look = "function";
    this.pose();
  }

  set look(m: NerveLook) {
    const solid = m === "function";
    this.mat.uniforms.uMode.value = m === "function" ? 0 : m === "xray" ? 1 : 2;
    this.mat.uniforms.uGain.value = m === "xray" ? 1.1 : 1;
    this.mat.blending = solid ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.mat.transparent = !solid;
    this.mat.depthWrite = solid;
    this.mat.needsUpdate = true;
  }

  /** the canvas's size in CSS px and its pixel ratio (no line is drawn thinner than about a px) */
  resize(w: number, h: number, pixelRatio = 1): void {
    this.mat.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
    this.mat.uniforms.uMinPx.value = 1.3 * pixelRatio;
  }

  /** the nerves where the rig and head are now (after rig.pose and head.update) */
  pose(): void {
    this.nerves.pose();
    const all = this.nerves.fibres.map((f) => ({ f, ...sampled(f) }));
    const n = all.reduce((s, x) => s + Math.max(0, x.pts.length - 1), 0);
    const A = new Float32Array(3 * n), B = new Float32Array(3 * n), RD = new Float32Array(4 * n), K = new Float32Array(4 * n);
    let i = 0;
    for (const { f, pts, cum } of all) {
      const L = cum[cum.length - 1] || 1;
      for (let j = 0; j < pts.length - 1; j++, i++) {
        pts[j].toArray(A, 3 * i);
        pts[j + 1].toArray(B, 3 * i);
        RD.set([f.r0 + (f.r1 - f.r0) * (cum[j] / L), f.r0 + (f.r1 - f.r0) * (cum[j + 1] / L), f.d0 + cum[j], f.d0 + cum[j + 1]], 4 * i);
        K.set([f.kind, f.seed, j === 0 ? 1 : 0, j === pts.length - 2 ? 1 : 0], 4 * i);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    g.setAttribute("iA", new THREE.InstancedBufferAttribute(A, 3));
    g.setAttribute("iB", new THREE.InstancedBufferAttribute(B, 3));
    g.setAttribute("iRD", new THREE.InstancedBufferAttribute(RD, 4));
    g.setAttribute("iK", new THREE.InstancedBufferAttribute(K, 4));
    g.instanceCount = n;
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }

  /**
   * Every frame, in place of head.update (it calls it): the face drawn for its size on screen, the
   * head, then the pulses moved on `dt` seconds (or put at `at`: how far they've run, cm), the
   * x-ray's depth range and the clearings behind the face's features. `height`: the canvas's
   * height in CSS px. After it, if the rig moved: pose().
   */
  update(camera: THREE.PerspectiveCamera, artic: HumanArtic, tele: TelemetryMessage | null, dt: number, height: number, at?: number): void {
    const head = this.head, U = this.mat.uniforms, M = head.mount.matrixWorld, rig = this.nerves.rig;
    // everything where it is now, in the world: the rig's frame (the mesh's), the camera
    this.mesh.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    // the head's middle (half way up its bone; the mount is placed by head.update, below)
    const hb = rig.bone("head"), headC = this.v3.copy(rig.P[hb]).lerp(rig.P[hb].clone().add(this.w3.fromArray(rig.bones[hb].tail).sub(rig.H[hb]).applyQuaternion(rig.S[hb])), 0.5).applyMatrix4(this.mesh.matrixWorld);
    const scale = this.w3.setFromMatrixColumn(this.mesh.matrixWorld, 0).length();
    const dHead = eye.distanceTo(headC) / scale;
    // The face's lines are so many px wide whatever the head's size on screen: seen whole-body
    // they'd pile into a few px and bloom to white. So they're drawn as bright, as wide and with
    // more of it only as the head comes close; far off, softer and thinner, the vocal tract dimmer.
    const pxPerCm = height / (2 * dHead * Math.tan((camera.fov * Math.PI) / 360));
    const near = THREE.MathUtils.smoothstep(pxPerCm, 5, 16), mix = (a: number, b: number) => a + (b - a) * near;
    // close up, the features stand out by their width and the dark round them, in their own
    // colours: brighter (or white-cored) they'd wash out to white
    head.setFeatures(mix(1.15, 1.7));
    head.head.drawing.inner = mix(0.5, 1);
    head.head.drawing.bone = mix(0.12, 0.3);
    this.parts.pop = mix(1.1, 2.2);
    // and from head and shoulders in, everything dimmer: the nerves widen on screen (they're so
    // many cm wide), and their white highlights and the glow over them would wash the face out.
    // The function look's solid nerves wash out from further off (the torso view, the arms and
    // cord white); the others' dark middles hold out until head and shoulders.
    this.close = U.uMode.value === 0 ? THREE.MathUtils.smoothstep(pxPerCm, 4, 12) : THREE.MathUtils.smoothstep(pxPerCm, 8, 30);
    U.uBright.value = 1 - 0.35 * this.close;
    head.update(camera, artic, tele, dt);
    // the x-ray's depth range, in the view's depth as the shader measures it: the body's (about the
    // hips, ±30 cm) further off, sliding to the head's near and far sides (±14 cm) as the camera
    // comes in. (A switch from one to the other at 150 cm jumped every colour at once.)
    const toHead = 1 - THREE.MathUtils.smoothstep(dHead, 110, 220);
    const middle = this.w3.copy(rig.P[0]).applyMatrix4(this.mesh.matrixWorld).lerp(headC, toHead);
    const d = -middle.applyMatrix4(camera.matrixWorldInverse).z, span = THREE.MathUtils.lerp(30, 14, toHead) * scale;
    U.uNear.value = d - span;
    U.uFar.value = d + span;
    this.run = at ?? this.run + dt * this.speed;
    U.uRun.value = this.run;
    U.uSignal.value = this.signal;
    // the clearings behind the eyes, nose and mouth, while the face is towards the camera
    this.feats.forEach(([p, r], i) => {
      const w = this.w3.copy(p).applyMatrix4(M);
      (U.uClear.value as THREE.Vector4[])[i].set(w.x, w.y, w.z, r * scale);
    });
    const fwd = this.v3.set(1, 0, 0).transformDirection(M), toCam = this.w3.copy(this.feats[3][0]).applyMatrix4(M).sub(eye).negate().normalize();
    U.uClearAmt.value = THREE.MathUtils.smoothstep(fwd.dot(toCam), -0.2, 0.35);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
