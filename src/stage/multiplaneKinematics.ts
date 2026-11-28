/**
 * Shared deterministic pose-to-pose kinematics & live rig evaluator (`S-51`, `D-137`).
 *
 * Used identically by `<MultiplaneActor3D>` and `<StageIkDebugOverlay>` so:
 * - limbs follow anticipation -> snap/action -> moving hold -> settle curves (zero continuous Math.sin idle wobble),
 * - curved braided hoses bend cleanly along C/S-arcs while rigid claws stay 100% stiff,
 * - every rendered joint reticle, distal claw tip, grounded foot pin, and CRT mouth tracks the exact live frame.
 */
import type { IkPointSpec, MultiplaneNodeSpec, MultiplaneRigSpec } from "../choir/castManifest.ts";

export interface MultiplanePoseInputs {
  readonly beat: number;
  readonly timeSec: number;
  readonly singing: boolean;
  readonly playingInstrument?: boolean;
  readonly level: number;
  readonly mouthOpen: boolean;
  readonly gagActive: boolean;
  readonly phaseIndex: number;
  readonly still?: boolean;
  readonly actionClip?: string | null;
  readonly actionElapsedSec?: number;
}

export interface EvaluatedNodePose {
  readonly node: MultiplaneNodeSpec;
  /** Local Three.js offset relative to parent pivot (or `(rig.centerX, rig.floorY)` for roots). */
  readonly localX: number;
  readonly localY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotZ: number;
  readonly visible: boolean;
  /** Curved hose deformation amplitude in node-local pixels (`0` for non-hose parts). */
  readonly hoseBendPx: number;
  /** World transform in Three.js rig space where `(0, 0)` = `(rig.centerX, rig.floorY)`, `+Y` up. */
  readonly worldMat: Mat2D;
}

export interface EvaluatedMultiplanePose {
  readonly byId: ReadonlyMap<number, EvaluatedNodePose>;
  readonly ikPoints: readonly IkPointSpec[];
  readonly mouthNorm: readonly [number, number];
  readonly gagActive: boolean;
  /** Vertical hop displacement in rig pixel space (grounded shadow stays at y=0). */
  readonly rootHopPx?: number;
}

export interface Mat2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

function makeTrs(tx: number, ty: number, rotZ: number, sx: number, sy: number): Mat2D {
  const cos = Math.cos(rotZ);
  const sin = Math.sin(rotZ);
  // Three.js Object3D computes v' = T + R * (S * v)
  return {
    a: cos * sx,
    b: sin * sx,
    c: -sin * sy,
    d: cos * sy,
    tx,
    ty,
  };
}

function mulMat2D(p: Mat2D, l: Mat2D): Mat2D {
  return {
    a: p.a * l.a + p.c * l.b,
    b: p.b * l.a + p.d * l.b,
    c: p.a * l.c + p.c * l.d,
    d: p.b * l.c + p.d * l.d,
    tx: p.a * l.tx + p.c * l.ty + p.tx,
    ty: p.b * l.tx + p.d * l.ty + p.ty,
  };
}

function applyMat2D(m: Mat2D, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

function easeOutBack(t: number): number {
  const u = clamp(t, 0, 1) - 1;
  const s = 1.55;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

/** Quantize time onto classic "on-twos" (`12fps`) cartoon steps for crisp expressive holds. */
export function quantizeTwosSec(timeSec: number): number {
  return Math.floor(Math.max(0, timeSec) * 12) / 12;
}

/**
 * Evaluate curved hose bend point in node-local Three.js space for normalized progress `u in [0..1]`.
 * Matches `<CurvedHoseLimbMesh>` vertex displacement identically so `IK` reticles track bent wrists.
 */
export function evaluateHoseOffset(
  node: MultiplaneNodeSpec,
  bendPx: number,
  uRaw: number,
): { readonly dx: number; readonly dy: number; readonly tangentAngle: number } {
  if (!node.hoseDeform || Math.abs(bendPx) < 0.01) {
    return { dx: 0, dy: 0, tangentAngle: 0 };
  }
  const { bendEndU, axis } = node.hoseDeform;
  const endU = clamp(bendEndU, 0.2, 0.95);
  const clampedU = clamp(uRaw, 0, 1);
  // Smooth arch inside flexible cable `[0..endU]`: peak bend around `u = 0.72 * endU`, zero slope past wrist collar.
  const cableT = Math.min(1, clampedU / endU);
  // Bezier arch peaking smoothly toward the claw collar then holding rigid slope into `[endU..1]`
  const bendShape = Math.sin(cableT * Math.PI * 0.65);
  const arch = bendPx * bendShape;
  const endArch = bendPx * Math.sin(Math.PI * 0.65);
  const slope = (bendPx * Math.PI * 0.65 * Math.cos(Math.PI * 0.65)) / Math.max(1, endU);

  if (clampedU <= endU) {
    return axis === "y-down"
      ? { dx: arch, dy: 0, tangentAngle: 0 }
      : { dx: 0, dy: arch, tangentAngle: 0 };
  }

  // Keep distal hardware/claw (`u > endU`) 100% rigid with tangent follow-through from wrist collar
  const tail = clampedU - endU;
  const dxLocal = axis === "y-down" ? endArch + slope * tail : 0;
  const dyLocal = axis === "y-down" ? 0 : endArch + slope * tail;
  return { dx: dxLocal, dy: dyLocal, tangentAngle: 0 };
}

/**
 * Deterministic pose-to-pose envelope (`S-51`):
 * - Quiet attentive holds when idle (no game-engine sine breathing wobble).
 * - Musical beat/phrase Anticipation -> Action Snap -> Moving Hold -> Settle when singing.
 */
export function evaluateMultiplanePose(
  rig: MultiplaneRigSpec,
  inputs: MultiplanePoseInputs,
): EvaluatedMultiplanePose {
  const still = Boolean(inputs.still);
  const safeBeat = Number.isFinite(inputs.beat) ? Math.max(0, inputs.beat) : 0;
  const rawTime = Number.isFinite(inputs.timeSec) ? Math.max(0, inputs.timeSec) : 0;
  const steppedTime = still ? 0 : quantizeTwosSec(rawTime);
  const phase = inputs.phaseIndex * 0.25;
  const isTally = rig.id === "tally";
  const isLatch = rig.id === "latch";
  const isFuzz = rig.id === "fuzz";
  const isHertz = rig.id === "hertz";
  const clip = !still ? (inputs.actionClip ?? "").trim().toLowerCase() : "";
  // Decoupled body phrasing (`S-3`): body follows phrase-level musical groove (`inputs.singing` or instrumental groove), NEVER syllable `mouthOpen` or `level`!
  const phraseActive = !still && (inputs.singing || Boolean(inputs.playingInstrument) || ((isFuzz || isHertz) && clip === "sing"));

  // Beat cycle inside a 2-beat musical gesture bar
  const cycleBeat = (((safeBeat + phase) % 2) + 2) % 2;
  const uBeat = cycleBeat / 2; // 0..1 across 2 beats

  // Anticipation -> Action -> Moving Hold -> Settle scalar envelope (`-0.25` ant, `+1.0` action/hold)
  let actionEnv = 0;
  if (phraseActive) {
    if (uBeat < 0.14) {
      // Crisp beat anticipation dip
      actionEnv = -0.24 * easeOutCubic(uBeat / 0.14);
    } else if (uBeat < 0.34) {
      // Snap into main pose
      actionEnv = -0.24 + 1.24 * easeOutBack((uBeat - 0.14) / 0.2);
    } else if (uBeat < 0.78) {
      // Readable cartoon Moving Hold (~44% of phrase!)
      actionEnv = 0.94 + 0.06 * (1 - (uBeat - 0.34) / 0.44);
    } else {
      // Ease out settle back toward neutral stance
      actionEnv = 0.94 * (1 - easeOutCubic((uBeat - 0.78) / 0.22));
    }
  }

  // Quiet idle look-hold: hold stillness for ~75% of 4-beat bar, crisp attentive head turn on beat 3
  const idleBarU = (((safeBeat + inputs.phaseIndex * 0.7) % 4) + 4) % 4;
  let idleAttention = 0;
  if (!still && !phraseActive) {
    if (idleBarU >= 2.2 && idleBarU < 2.45) {
      idleAttention = easeOutCubic((idleBarU - 2.2) / 0.25);
    } else if (idleBarU >= 2.45 && idleBarU < 3.45) {
      idleAttention = 1; // clean held attentive listen pose
    } else if (idleBarU >= 3.45 && idleBarU < 3.75) {
      idleAttention = 1 - easeOutCubic((idleBarU - 3.45) / 0.3);
    }
  }

  // Climax hold before gag/riff accent (`motion-doctrine`: 0.3-0.6s stillness before climax)
  const gagPower = !still && inputs.gagActive ? 1 : 0;

  // 1. Grounded pelvis weight & gentle musical sway (feet stay pinned at y = 0; zero vocal RMS pumping!)
  const pelvisDrop = still
    ? 0
    : phraseActive
      ? -(actionEnv < 0 ? 7 : 4 * (1 - actionEnv))
      : -idleAttention * 2.2;
  const pelvisSwayX = still
    ? 0
    : phraseActive
      ? (Math.floor(safeBeat / 2) % 2 === 0 ? 1 : -1) * actionEnv * 5.5
      : idleAttention * 2.5;
  const swayNorm = clamp(pelvisSwayX / 10, -1, 1);

  // 2. Torso lean + subtle 12fps breath accent (zero vocal-amplitude inflation!)
  const breathCycle = (steppedTime % 2.5) / 2.5;
  const quietBreath = still ? 0 : (breathCycle < 0.4 ? easeOutCubic(breathCycle / 0.4) : 1 - easeOutCubic((breathCycle - 0.4) / 0.6));
  const torsoLean = still
    ? 0
    : phraseActive
      ? actionEnv * 0.042 * (Math.floor(safeBeat / 2) % 2 === 0 ? 1 : -1)
      : idleAttention * 0.02;
  const torsoBreathScaleY = still ? 1 : 1 + quietBreath * 0.009;

  // 3. Steady expressive head phrasing (zero syllable head-dipping or vocal RMS nodding!)
  const phraseLagBeat = Math.max(0, safeBeat - 0.18);
  const lagBarEven = Math.floor((phraseLagBeat + phase) / 2) % 2 === 0;
  const headTilt = still
    ? 0
    : phraseActive
      ? actionEnv * (lagBarEven ? -0.042 : 0.042)
      : idleAttention * 0.045;
  const headVocalNodY = 0;

  // 4. Secondary cords / cables follow-through
  const cordWhip = still
    ? 0
    : phraseActive
      ? actionEnv * 0.075 * (lagBarEven ? 1 : -1) + gagPower * 0.14
      : idleAttention * 0.025;
  const antennaWave = still ? 0 : phraseActive ? actionEnv * 0.065 : idleAttention * 0.02;

  // 5. Classic cartoon arm & guitar phrasing (beat-locked musical phrasing, zero vocal RMS pumping!)
  const strumSubBeat = (((safeBeat * 2 + phase) % 1) + 1) % 1;
  const strumPick = strumSubBeat < 0.25 ? easeOutCubic(strumSubBeat / 0.25) : 1 - easeOutCubic((strumSubBeat - 0.25) / 0.75);
  const fuzzGrooveBoost = isFuzz && phraseActive ? 1.45 : 1;
  const guitarStrumR = still
    ? 0
    : phraseActive
      ? ((strumPick - 0.4) * 0.34 * fuzzGrooveBoost) + gagPower * 0.18
      : 0.02 * idleAttention;
  const guitarFretL = still
    ? 0
    : phraseActive
      ? actionEnv * 0.095 * fuzzGrooveBoost + (strumSubBeat < 0.5 ? 0.035 : -0.025)
      : idleAttention * 0.015;
  const guitarTorque = still ? 0 : phraseActive ? actionEnv * (isFuzz ? 0.11 : 0.045) + gagPower * 0.12 : 0;

  // Asymmetric conductor/actor arms for non-guitar performers
  const clankPhraseR = lagBarEven ? 0.85 : 0.35;
  const clankPhraseL = lagBarEven ? 0.28 : 0.9;
  let armSwingL = still ? 0 : phraseActive ? -(actionEnv * 0.42 * clankPhraseL) : idleAttention * 0.035;
  let armSwingR = still ? 0 : phraseActive ? actionEnv * 0.44 * clankPhraseR : -idleAttention * 0.03;

  // Interactive gestures & Cast Pads (`clap`, `walk`, `step`, `cheer`, `jump`, `bow`, `adjust-specs`, `probe-arc`, `ticker-cue`, `shred`, `overdrive`, etc.)
  const actEl = inputs.actionElapsedSec !== undefined ? Math.max(0, inputs.actionElapsedSec) : rawTime;
  const isProbeArc = clip === "probe-arc";
  const isSpecsGag = !still && inputs.gagActive && !isProbeArc && !isTally && !isLatch && !isFuzz && !isHertz;
  const isHertzCrtAnswer =
    !still && isHertz && (clip === "crt-answer" || clip === "tilt" || clip === "gasp" || Boolean(inputs.gagActive));
  const isTallyTickerCue =
    !still && isTally && (clip === "ticker-cue" || clip === "gasp" || Boolean(inputs.gagActive));
  const tallySingActive = !still && isTally && (inputs.singing || Boolean(inputs.playingInstrument) || clip === "sing");

  let rootHopPx = 0;
  let gestureTorsoDrop = 0;
  let gestureSwayX = 0;
  let gestureTorsoLean = 0;
  let gestureHeadTilt = 0;
  let gestureCordWhip = 0;
  let gestureAntenna = 0;
  let gestureHoseBendL = 0;
  let gestureHoseBendR = 0;
  let gestureGuitarTorque = 0;
  let fuzzArmOverride = false;
  let fuzzBootRock = 0;
  let fuzzBootHop = 0;
  let walkCycle = 0;
  let isWalking = false;
  let tallyCloakScaleDeltaX = 0;
  let tallyTickerScaleX = 1;
  let tallyTickerScaleY = 1;
  let tallyTickerWaveRot = 0;
  let tallyEarSnapRot = 0;
  let tallyClapBeatFlash = false;
  let tallyClapDip = false;
  let latchSquashX = 1;
  let latchSquashY = 1;
  let latchStompShiftY = 0;
  let latchTiltExtra = 0;
  let latchClapJawOpen = false;

  if (!still && clip) {
    if (clip === "clap") {
      const cycle = (phraseActive ? safeBeat * 1.15 : actEl * 1.65) + phase;
      const u = ((cycle % 1) + 1) % 1;
      const dip = u < 0.08 ? easeOutCubic(u / 0.08) : 0;
      const snap = u >= 0.08 && u < 0.64 ? Math.sin(((u - 0.08) / 0.56) * Math.PI) : 0;
      const bounce = Math.abs(Math.sin(cycle * Math.PI));
      rootHopPx = (isTally ? 36 : isLatch ? 42 : 28) * snap + (isTally || isLatch ? 12 : 10) * bounce;
      gestureTorsoDrop = (isTally || isLatch ? -16 : -10) * dip + (isTally || isLatch ? 6 : 4) * snap;
      gestureTorsoLean = Math.sin(cycle * Math.PI) * (isTally ? 0.11 : isLatch ? 0.16 : 0.085);
      gestureHeadTilt = (isTally ? -0.14 : -0.07) * snap;
      armSwingL = 0.72 * snap + 0.18 * bounce;
      armSwingR = -(0.72 * snap + 0.18 * bounce);
      gestureHoseBendL = 34 * snap;
      gestureHoseBendR = -34 * snap;
      gestureAntenna = (isTally ? 0.24 : 0.14) * bounce;
      if (isTally) {
        // Wing-cloak open spread on dip anticipation -> crisp wing clap compression on snap!
        tallyCloakScaleDeltaX = 0.16 * dip - 0.22 * snap;
        tallyEarSnapRot = 0.26 * snap;
        tallyTickerWaveRot = 0.16 * Math.sin(cycle * Math.PI * 2);
        tallyClapBeatFlash = snap > 0.25;
        tallyClapDip = dip > 0.45;
      } else if (isLatch) {
        // Coiled-spring stomp crouch -> crisp pedal snap upward + jaw clap
        latchSquashY = 1 - 0.16 * dip + 0.11 * snap;
        latchSquashX = 1 + 0.12 * dip - 0.06 * snap;
        latchStompShiftY = -4 * dip;
        latchClapJawOpen = snap > 0.25;
      } else if (isFuzz) {
        fuzzArmOverride = true;
        rootHopPx = 34 * snap + 12 * bounce;
        gestureTorsoDrop = -15 * dip + 6 * snap;
        gestureTorsoLean = Math.sin(cycle * Math.PI) * 0.11;
        gestureHeadTilt = -0.14 * snap;
        gestureGuitarTorque = 0.16 * dip - 0.24 * snap;
        armSwingL = -0.44 * snap + 0.14 * dip;
        armSwingR = 0.46 * snap - 0.14 * dip;
        gestureHoseBendL = 36 * snap;
        gestureHoseBendR = -36 * snap;
        fuzzBootRock = Math.sin(cycle * Math.PI) * 0.09;
      } else if (isHertz) {
        // Bring red & black alligator clamp hands together in front of felt vest (`y = 248`) + happy bounce & ear wiggle
        rootHopPx = 30 * snap + 10 * bounce;
        gestureTorsoDrop = -12 * dip + 5 * snap;
        gestureTorsoLean = Math.sin(cycle * Math.PI) * 0.085;
        gestureHeadTilt = -0.09 * snap;
        armSwingL = 1.06 * snap + 0.22 * bounce;
        armSwingR = -(1.06 * snap + 0.22 * bounce);
        gestureAntenna = 0.26 * bounce;
        gestureCordWhip = Math.sin(cycle * Math.PI * 2) * 0.14;
      }
    } else if (clip === "probe-arc") {
      const dur = 2.4;
      const u = clamp(actEl / dur, 0, 1);
      const env = u < 0.12 ? easeOutCubic(u / 0.12) : u < 0.84 ? 1 : 1 - easeOutCubic((u - 0.84) / 0.16);
      const sweep = Math.sin(u * Math.PI * 2.5);
      const raise = clamp(0.65 + 0.35 * Math.abs(sweep), 0, 1) * env;
      rootHopPx = 22 * Math.abs(sweep) * env;
      gestureTorsoLean = sweep * 0.09 * env;
      gestureHeadTilt = -sweep * 0.11 * env;
      armSwingL = -1.08 * raise;
      armSwingR = 1.08 * raise;
      gestureHoseBendL = -52 * raise;
      gestureHoseBendR = 52 * raise;
      gestureCordWhip = sweep * 0.18 * env;
      gestureAntenna = sweep * 0.24 * env;
    } else if (clip === "walk" || clip === "step" || clip === "walk-left" || clip === "walk-right") {
      isWalking = true;
      walkCycle = actEl * 7.8;
      rootHopPx = Math.abs(Math.sin(walkCycle)) * (isLatch ? 36 : isFuzz ? 28 : isTally ? 24 : 18);
      gestureSwayX = Math.sin(walkCycle) * (isLatch ? 20 : isFuzz ? 14 : isTally ? 13 : 7);
      gestureTorsoLean = Math.sin(walkCycle) * (isLatch ? 0.19 : isFuzz ? 0.11 : isTally ? 0.085 : 0.06);
      gestureHeadTilt = -Math.sin(walkCycle) * (isFuzz ? 0.09 : isTally ? 0.065 : 0.04);
      armSwingL = Math.sin(walkCycle) * (isFuzz ? 0.34 : 0.56);
      armSwingR = -Math.sin(walkCycle) * (isFuzz ? 0.38 : 0.56);
      gestureHoseBendL = Math.sin(walkCycle) * 28;
      gestureHoseBendR = -Math.sin(walkCycle) * 28;
      gestureCordWhip = Math.cos(walkCycle) * 0.09;
      if (isTally) {
        tallyEarSnapRot = Math.sin(walkCycle) * 0.16;
        tallyTickerWaveRot = Math.cos(walkCycle) * 0.14;
      } else if (isLatch) {
        const hopAbs = Math.abs(Math.sin(walkCycle));
        latchSquashY = 1 + (hopAbs - 0.35) * 0.14;
        latchSquashX = 1 - (hopAbs - 0.35) * 0.08;
      } else if (isFuzz) {
        fuzzArmOverride = true;
        gestureGuitarTorque = Math.sin(walkCycle) * 0.13;
        fuzzBootRock = Math.sin(walkCycle) * 0.14;
        fuzzBootHop = Math.abs(Math.sin(walkCycle)) * 12;
      } else if (isHertz) {
        rootHopPx = Math.abs(Math.sin(walkCycle)) * 24;
        gestureSwayX = Math.sin(walkCycle) * 12;
        gestureTorsoLean = Math.sin(walkCycle) * 0.085;
        gestureHeadTilt = -Math.sin(walkCycle) * 0.055;
        armSwingL = Math.sin(walkCycle) * 0.58;
        armSwingR = -Math.sin(walkCycle) * 0.58;
        gestureAntenna = -Math.sin(walkCycle) * 0.22;
        gestureCordWhip = Math.cos(walkCycle) * 0.14;
      }
    } else if (isFuzz && (clip === "shred" || clip === "overdrive" || clip === "overdrive-arc")) {
      // Rockstar overdrive & shred power-stance: high ruler-neck tilt, 16th picking, distortion jump & cord thrash
      fuzzArmOverride = true;
      const dur = 2.6;
      const u = clamp(actEl / dur, 0, 1);
      if (u < 0.08) {
        const ant = easeOutCubic(u / 0.08);
        gestureTorsoDrop = -15 * ant;
        gestureHeadTilt = 0.09 * ant;
        gestureGuitarTorque = 0.16 * ant;
      } else {
        const burst = u < 0.2 ? easeOutBack((u - 0.08) / 0.12) : 1;
        const taper = u > 0.84 ? 1 - easeOutCubic((u - 0.84) / 0.16) : 1;
        const env = burst * taper;
        rootHopPx = 38 * Math.abs(Math.sin(u * Math.PI * 2.5)) * env;
        gestureTorsoLean = -0.11 * env;
        gestureHeadTilt = Math.sin(actEl * 13) * 0.16 * env;
        gestureGuitarTorque = (-0.34 + Math.sin(actEl * 14) * 0.14) * env;
        armSwingR = Math.sin(actEl * 24) * 0.54 * env;
        armSwingL = (-0.46 + Math.cos(actEl * 11) * 0.18) * env;
        gestureHoseBendL = 42 * env;
        gestureHoseBendR = -40 * env;
        gestureCordWhip = Math.sin(actEl * 15) * 0.24 * env;
        fuzzBootRock = Math.sin(actEl * 10) * 0.11 * env;
      }
    } else if (isLatch && (clip === "listening" || clip === "listen")) {
      // Attentive spring-pedal eavesdrop lean + radar hop
      const dur = 2.2;
      const u = clamp(actEl / dur, 0, 1);
      const env = u < 0.14 ? easeOutCubic(u / 0.14) : u < 0.84 ? 1 : 1 - easeOutCubic((u - 0.84) / 0.16);
      rootHopPx = 14 * Math.abs(Math.sin(actEl * 6.5)) * env;
      gestureSwayX = 18 * env;
      gestureTorsoLean = 0.11 * env;
      latchSquashY = 1 + (0.08 + 0.03 * Math.sin(actEl * 8)) * env;
      latchSquashX = 1 - 0.05 * env;
    } else if (clip === "ticker-cue" || (isTally && clip === "gasp")) {
      // Elastic broadcast ticker-feed dispense + proud owl head cock + cloak wing flare
      const dur = 3.2;
      const u = clamp(actEl / dur, 0, 1);
      if (u < 0.09) {
        const ant = easeOutCubic(u / 0.09);
        gestureTorsoDrop = -14 * ant;
        gestureHeadTilt = -0.12 * ant;
        tallyTickerScaleX = 1 - 0.34 * ant;
        tallyCloakScaleDeltaX = -0.09 * ant;
      } else {
        const burst = u < 0.24 ? easeOutBack((u - 0.09) / 0.15) : 1;
        const taper = u > 0.78 ? 1 - easeOutCubic((u - 0.78) / 0.22) : 1;
        const env = burst * taper;
        const wave = Math.sin(actEl * 16);
        rootHopPx = 26 * Math.abs(Math.sin(u * Math.PI * 3)) * taper;
        gestureTorsoLean = -0.075 * env;
        gestureHeadTilt = 0.17 * env;
        tallyTickerScaleX = 1 + 0.38 * env;
        tallyTickerScaleY = 1 + 0.14 * Math.sin(actEl * 22) * env;
        tallyTickerWaveRot = wave * 0.21 * env;
        tallyCloakScaleDeltaX = 0.15 * env;
        tallyEarSnapRot = Math.abs(Math.sin(actEl * 18)) * 0.34 * env;
        gestureAntenna = wave * 0.28 * env;
      }
    } else if (isHertz && (clip === "crt-answer" || clip === "tilt" || clip === "gasp")) {
      // Comedic CRT Answer broadcast zap: anticipation crouch -> SMPTE color bars pop, head askew, rabbit ears & clamps up!
      const dur = clip === "crt-answer" ? 2.4 : 1.8;
      const u = clamp(actEl / dur, 0, 1);
      if (u < 0.08) {
        const ant = easeOutCubic(u / 0.08);
        gestureTorsoDrop = -12 * ant;
        gestureHeadTilt = 0.08 * ant;
        gestureAntenna = -0.16 * ant;
        armSwingL = 0.18 * ant;
        armSwingR = -0.18 * ant;
      } else {
        const burst = u < 0.22 ? easeOutBack((u - 0.08) / 0.14) : 1;
        const taper = u > 0.84 ? 1 - easeOutCubic((u - 0.84) / 0.16) : 1;
        const env = burst * taper;
        rootHopPx = 28 * Math.abs(Math.sin(u * Math.PI * 2.2)) * env;
        gestureTorsoLean = Math.sin(actEl * 10) * 0.09 * env;
        gestureHeadTilt = (-0.21 + 0.08 * Math.sin(actEl * 18)) * env;
        gestureAntenna = Math.sin(actEl * 24) * 0.44 * env;
        gestureCordWhip = Math.sin(actEl * 20) * 0.3 * env;
        armSwingL = -1.24 * env;
        armSwingR = 1.24 * env;
      }
    } else if (clip === "cheer" || clip === "jump") {
      const dur = clip === "jump" ? 1.55 : 1.65;
      const u = clamp(actEl / dur, 0, 1);
      if (u < 0.08) {
        const dip = Math.sin((u / 0.08) * Math.PI);
        gestureTorsoDrop = -16 * dip;
        armSwingL = 0.28 * dip;
        armSwingR = -0.28 * dip;
        if (isTally) tallyCloakScaleDeltaX = -0.14 * dip;
        if (isLatch) {
          latchSquashY = 1 - 0.22 * dip;
          latchSquashX = 1 + 0.16 * dip;
        }
      } else if (u < 0.84) {
        const air = (u - 0.08) / 0.76;
        const arc = 4 * air * (1 - air);
        const dbl = clip === "cheer" ? Math.abs(Math.sin(air * Math.PI * 2)) : arc;
        const lift = clamp(0.55 * arc + 0.45 * dbl, 0, 1);
        rootHopPx = (clip === "jump" ? (isLatch ? 78 : 68) : isLatch ? 62 : 54) * lift;
        gestureTorsoLean = Math.sin(air * Math.PI * 3) * (isLatch ? 0.18 : 0.09) * lift;
        gestureHeadTilt = -0.1 * lift;
        armSwingL = -1.04 * lift;
        armSwingR = 1.04 * lift;
        gestureHoseBendL = -42 * lift;
        gestureHoseBendR = 42 * lift;
        gestureAntenna = 0.22 * lift;
        if (isTally) tallyCloakScaleDeltaX = 0.18 * lift;
        if (isLatch) {
          latchSquashY = 1 + 0.15 * lift;
          latchSquashX = 1 - 0.09 * lift;
        }
        if (isFuzz) {
          fuzzArmOverride = true;
          gestureGuitarTorque = -0.26 * lift;
        }
      } else {
        const land = Math.sin(((u - 0.84) / 0.16) * Math.PI);
        gestureTorsoDrop = -12 * land;
        if (isLatch) {
          latchSquashY = 1 - 0.18 * land;
          latchSquashX = 1 + 0.15 * land;
        }
      }
    } else if (clip === "bow") {
      const u = clamp(actEl / 2.5, 0, 1);
      const hold = u < 0.2 ? easeOutCubic(u / 0.2) : u < 0.72 ? 1 : 1 - easeOutCubic((u - 0.72) / 0.28);
      gestureTorsoDrop = (isFuzz ? -20 : -18) * hold;
      gestureTorsoLean = (isFuzz ? 0.34 : 0.22) * hold;
      gestureHeadTilt = (isFuzz ? 0.24 : 0.16) * hold;
      armSwingL = (isFuzz ? 0.52 : 0.45) * hold;
      armSwingR = -(isFuzz ? 0.52 : 0.45) * hold;
      if (isFuzz) {
        fuzzArmOverride = true;
        gestureGuitarTorque = -0.26 * hold;
      }
    } else if (clip === "nod" || clip === "double nod") {
      const beats = clip === "double nod" ? 2 : 1;
      const pulse = Math.max(0, Math.sin(clamp(actEl / 1.4, 0, 1) * Math.PI * beats * 2));
      gestureHeadTilt = 0.14 * pulse;
      gestureTorsoDrop = -4 * pulse;
    } else if (clip === "tilt") {
      const env = Math.sin(clamp(actEl / 1.5, 0, 1) * Math.PI);
      gestureHeadTilt = 0.18 * env;
      gestureTorsoLean = 0.06 * env;
    } else if (clip === "shrug" || clip === "gasp" || clip === "laugh") {
      const env = Math.sin(clamp(actEl / 1.5, 0, 1) * Math.PI);
      const vib = clip === "laugh" ? Math.abs(Math.sin(actEl * 13)) : 1;
      rootHopPx = (clip === "gasp" ? 26 : 16) * env * vib;
      armSwingL = -0.68 * env * vib;
      armSwingR = 0.68 * env * vib;
      gestureHeadTilt = -0.09 * env * vib;
      if (isFuzz) {
        fuzzArmOverride = true;
        gestureGuitarTorque = -0.14 * env * vib;
      }
    }
  }

  // Fallback Fuzz overdrive shred stance when `.song` take sets `gagActive` cleanly without explicit clip string
  if (!still && isFuzz && inputs.gagActive && clip !== "shred" && clip !== "overdrive" && clip !== "overdrive-arc") {
    fuzzArmOverride = true;
    gestureTorsoLean -= 0.09;
    gestureHeadTilt += Math.sin(actEl * 13) * 0.14;
    gestureGuitarTorque = -0.28 + Math.sin(actEl * 14) * 0.12;
    armSwingR = Math.sin(actEl * 22) * 0.48;
    armSwingL = -0.4 + Math.cos(actEl * 10) * 0.14;
    gestureCordWhip += Math.sin(actEl * 14) * 0.2;
  }

  // Fallback ticker-cue flare when `.song` take sets `gagActive` cleanly on Tally without matching clip string
  if (!still && isTallyTickerCue && clip !== "ticker-cue" && clip !== "gasp") {
    const wave = Math.sin(actEl * 16);
    tallyTickerScaleX = 1.28;
    tallyTickerScaleY = 1 + 0.1 * Math.sin(actEl * 22);
    tallyTickerWaveRot = wave * 0.18;
    tallyCloakScaleDeltaX = 0.12;
    tallyEarSnapRot = Math.abs(Math.sin(actEl * 18)) * 0.28;
    gestureHeadTilt += 0.14;
    gestureAntenna += wave * 0.22;
  }

  // Fallback CRT Answer zap when `.song` take sets `gagActive` cleanly on Hertz without clip string
  if (!still && isHertzCrtAnswer && clip !== "crt-answer" && clip !== "tilt" && clip !== "gasp") {
    gestureTorsoLean += Math.sin(actEl * 10) * 0.08;
    gestureHeadTilt += -0.18 + 0.06 * Math.sin(actEl * 18);
    gestureAntenna += Math.sin(actEl * 24) * 0.38;
    gestureCordWhip += Math.sin(actEl * 20) * 0.24;
    armSwingL = -1.08;
    armSwingR = 1.08;
  }

  const hertzCrtU = isHertzCrtAnswer ? clamp(actEl / (clip === "crt-answer" ? 2.4 : 1.8), 0, 1) : 0;
  const hertzStaticFlash = isHertzCrtAnswer && clip !== "" && hertzCrtU >= 0.78 && hertzCrtU < 0.89;

  const tallyBlinkCycle = (steppedTime + phase * 1.1) % 3.3;
  const tallyIrisClosed = !still && isTally && (tallyBlinkCycle > 3.12 || tallyClapDip);
  const tallyIrisOpen =
    !still &&
    isTally &&
    !tallyIrisClosed &&
    ((tallySingActive && (inputs.mouthOpen || inputs.level > 0.2 || clip === "sing")) ||
      isTallyTickerCue ||
      clip === "jump" ||
      clip === "cheer");
  const tallyDomeLit =
    !still &&
    isTally &&
    (tallySingActive ||
      isTallyTickerCue ||
      tallyClapBeatFlash ||
      clip === "jump" ||
      clip === "cheer");

  const isLatchListening =
    !still &&
    isLatch &&
    (clip === "listening" || clip === "listen" || (!inputs.singing && !clip && idleAttention > 0.35));
  const isLatchSpeaking =
    !still &&
    isLatch &&
    !isLatchListening &&
    ((inputs.singing && (inputs.mouthOpen || inputs.level > 0.08)) || clip === "sing" || latchClapJawOpen);
  if (isLatchSpeaking && !clip) {
    // Expressive spring-pedal jaw stomp emphasis while singing phrases
    const jawBeat = Math.max(0, actionEnv);
    latchSquashY *= 0.96 + 0.05 * jawBeat;
    latchSquashX *= 1.03 - 0.02 * jawBeat;
    latchTiltExtra = -0.045 * (inputs.mouthOpen ? 1 : 0.4) + 0.065 * jawBeat;
  } else if (isLatch && clip === "sing") {
    latchTiltExtra = 0.06 * Math.sin(actEl * 8);
    latchSquashY *= 0.97 + 0.05 * Math.abs(Math.sin(actEl * 8));
  } else if (isLatch && (clip === "nod" || clip === "double nod" || clip === "tilt" || clip === "bow" || clip === "shrug" || clip === "gasp" || clip === "laugh")) {
    latchTiltExtra = gestureHeadTilt * 0.9;
  }

  const gagRamp = isSpecsGag ? clamp(actEl / 0.14, 0.35, 1) : 0;
  const effectivePelvisDrop = pelvisDrop + gestureTorsoDrop;
  const effectivePelvisSway = pelvisSwayX + gestureSwayX;
  const effectiveTorsoLean = torsoLean + gestureTorsoLean;
  const effectiveHeadTilt = headTilt + gestureHeadTilt + (isSpecsGag ? 0.06 * gagRamp : 0);
  const effectiveCordWhip = cordWhip + gestureCordWhip;
  const effectiveAntenna = antennaWave + gestureAntenna;
  const effectiveSwayNorm = clamp(effectivePelvisSway / 10, -1, 1);

  // Build parented lookup
  const nodeById = new Map<number, MultiplaneNodeSpec>();
  for (const n of rig.nodes) nodeById.set(n.id, n);

  const hasVariants = rig.nodes.some(
    (n) => n.role === "gagVariant" || n.role === "singVariant" || n.role === "altVariant" || n.role === "restVariant",
  );
  const hasGuitar = rig.nodes.some((n) => n.role === "guitar");
  const hasRestVariant = rig.nodes.some((n) => n.role === "restVariant");

  const byId = new Map<number, EvaluatedNodePose>();

  const evalNode = (
    spec: MultiplaneNodeSpec,
    parentShiftX: number,
    parentShiftY: number,
    hasTorsoAncestor: boolean,
    hasHeadAncestor: boolean,
    parentWorld: Mat2D | null,
  ): EvaluatedNodePose => {
    const existing = byId.get(spec.id);
    if (existing) return existing;

    const posX = spec.position[0] ?? 0;
    const posY = spec.position[1] ?? 0;
    let scX = (spec.scale[0] ?? 100) / 100;
    let scY = (spec.scale[1] ?? 100) / 100;
    const ancX = spec.anchor[0] ?? 0;
    const ancY = spec.anchor[1] ?? 0;

    let gx: number;
    let gy: number;
    const pSpec = spec.parent != null ? nodeById.get(spec.parent) : undefined;
    if (pSpec) {
      gx = posX - (pSpec.anchor[0] ?? 0);
      gy = -(posY - (pSpec.anchor[1] ?? 0));
    } else {
      gx = posX - rig.centerX;
      gy = -(posY - rig.floorY);
    }

    let visible = true;
    if (isTally && (spec.id === 598 || spec.id === 621 || spec.id === 706 || spec.id === 729 || spec.id === 752)) {
      if (spec.id === 598) visible = !tallyDomeLit;
      else if (spec.id === 621) visible = tallyDomeLit;
      else if (spec.id === 752) visible = tallyIrisClosed;
      else if (spec.id === 729) visible = tallyIrisOpen;
      else visible = !tallyIrisClosed && !tallyIrisOpen;
    } else if (isLatch && (spec.id === 3 || spec.id === 4 || spec.id === 5)) {
      if (spec.id === 4) visible = isLatchSpeaking;
      else if (spec.id === 5) visible = isLatchListening;
      else visible = !isLatchSpeaking && !isLatchListening;
    } else if (isHertz && (spec.id === 525 || spec.id === 548 || spec.id === 571)) {
      if (spec.id === 525) visible = !isHertzCrtAnswer;
      else if (spec.id === 571) visible = isHertzCrtAnswer && !hertzStaticFlash;
      else visible = isHertzCrtAnswer && hertzStaticFlash;
    } else if (hasVariants) {
      // S-3: NEVER swap whole-body `singVariant`/`altVariant` on a beat clock or syllable toggle!
      // Keep the primary rig body (`restVariant`, or `singVariant` if no `restVariant`) rock-steady unless an explicit `gagActive` triggers.
      if (spec.role === "gagVariant") {
        visible = Boolean(inputs.gagActive);
      } else if (spec.role === "restVariant") {
        visible = !inputs.gagActive;
      } else if (spec.role === "singVariant") {
        visible = !inputs.gagActive && !hasRestVariant;
      } else if (spec.role === "altVariant") {
        visible = false;
      }
    }

    let rotZ = -(spec.rotationDeg * Math.PI) / 180;
    let localShiftX = 0;
    let localShiftY = 0;
    let nextTorso = hasTorsoAncestor;
    let nextHead = hasHeadAncestor;
    let hoseBendPx = spec.hoseDeform?.restBendPx ?? 0;

    if (spec.role === "legs") {
      localShiftX = -parentShiftX;
      localShiftY = -parentShiftY;
      const isLeftBoot = isWalking && /(_l|left)/i.test(spec.name);
      const isRightBoot = isWalking && /(_r|right)/i.test(spec.name);
      if (isLeftBoot || isRightBoot) {
        const stride = isLeftBoot ? Math.sin(walkCycle) : -Math.sin(walkCycle);
        const lift = Math.max(0, stride);
        if (isTally && /leg/i.test(spec.name)) {
          // Tripod_Leg_L/R pivot from upper hip `[10.5, 10]`; swing leg forward/back cleanly to meet the foot
          localShiftY += lift * 18;
          localShiftX += stride * 6;
          rotZ += stride * 0.22;
        } else if (isTally && /foot/i.test(spec.name)) {
          // Tripod_Foot_L/R pivot at sole `[51, 90]`; travel laterally in lockstep with lower leg tip + heel-toe flex
          localShiftY += lift * 26;
          localShiftX += stride * 40;
          rotZ += stride * 0.15;
        } else if (isHertz) {
          localShiftY += lift * 26;
          localShiftX += stride * 18;
          rotZ += stride * 0.15;
        } else {
          localShiftY += lift * 22;
          localShiftX += stride * 12;
          rotZ += stride * 0.14;
        }
      } else if (isFuzz && spec.id === 27 && (isWalking || fuzzBootRock !== 0)) {
        rotZ += fuzzBootRock;
        localShiftY += fuzzBootHop;
      } else {
        rotZ += still ? 0 : effectiveSwayNorm * 0.012;
        const legSquash = still ? 1 : 1 - Math.abs(effectiveSwayNorm) * 0.01;
        scY *= legSquash;
        if (spec.height > 0) {
          const baseScaleY = (spec.scale[1] ?? 100) / 100;
          localShiftY -= (1 - legSquash) * Math.max(0, spec.height - ancY) * baseScaleY;
        }
      }
    } else if (spec.role === "torso") {
      if (!hasTorsoAncestor) {
        localShiftX = effectivePelvisSway;
        localShiftY = spec.sourceType === "Null" ? effectivePelvisDrop : effectivePelvisDrop * 0.85;
        nextTorso = true;
      } else if (spec.sourceType === "Footage") {
        localShiftY = -effectivePelvisDrop * 0.15;
      }
      if (spec.sourceType === "Footage") {
        rotZ += effectiveTorsoLean;
        scY *= torsoBreathScaleY;
        if (isTally) {
          const phraseCloakSpread = tallySingActive ? actionEnv * 0.045 : idleAttention * 0.02;
          scX *= 1 + tallyCloakScaleDeltaX + phraseCloakSpread;
        }
      }
    } else if (spec.role === "head" || spec.role === "head-jaw") {
      if (!hasHeadAncestor) {
        rotZ += effectiveHeadTilt;
        localShiftY = headVocalNodY;
        nextHead = true;
      }
    } else if (spec.role === "hairOrTrim") {
      rotZ += effectiveCordWhip + (isTally ? tallyTickerWaveRot + (phraseActive ? actionEnv * 0.08 * (lagBarEven ? 1 : -1) : 0) : 0);
      if (isTally && spec.id === 660) {
        scX *= tallyTickerScaleX;
        scY *= tallyTickerScaleY;
      }
    } else if (isTally && spec.id === 575) {
      // Clothespin right ear perks on musical phrases & snaps briskly on ticker-cue / clap
      rotZ += still ? 0 : (phraseActive ? actionEnv * 0.16 : idleAttention * 0.11) - tallyEarSnapRot;
    } else if (isTally && (spec.id === 706 || spec.id === 729 || spec.id === 752)) {
      // Brass camera iris clicks & dials mechanically while singing or adjusting focus
      rotZ += still ? 0 : (tallySingActive ? actionEnv * 0.18 : idleAttention * 0.09) + (isTallyTickerCue ? Math.sin(actEl * 12) * 0.24 : 0);
    } else if (isTally && spec.id === 621 && isTallyTickerCue) {
      scX *= 1.08;
      scY *= 1.08;
    } else if (isLatch && (spec.id === 3 || spec.id === 4 || spec.id === 5)) {
      // Latch_Pelvis (`id: 2`) is a Null parent, so visible pedal variants apply grounded squash/tilt around `[480, 451.2]` soles
      rotZ += effectiveTorsoLean + latchTiltExtra;
      scX *= latchSquashX;
      scY *= torsoBreathScaleY * latchSquashY;
      localShiftY += latchStompShiftY;
    } else if (spec.role === "antenna") {
      rotZ += effectiveAntenna * (isTally ? 1.45 : 1);
    } else if (spec.role === "armL") {
      const delta = hasGuitar && !(isFuzz && fuzzArmOverride) ? guitarFretL : armSwingL;
      rotZ += delta;
      hoseBendPx = (spec.hoseDeform?.restBendPx ?? 0) + (phraseActive ? actionEnv * 28 : idleAttention * 6) + gestureHoseBendL;
    } else if (spec.role === "guitar") {
      rotZ += guitarTorque + gestureGuitarTorque;
    } else if (spec.role === "armR") {
      if (rig.hasPurplePolarizerGagProp && spec.id === 217) {
        const gagLift = isSpecsGag ? gagRamp : 0;
        rotZ += armSwingR * (1 - gagLift) - gagLift * 1.42;
      } else {
        const delta = hasGuitar && !(isFuzz && fuzzArmOverride) ? guitarStrumR : armSwingR;
        rotZ += delta;
        hoseBendPx = (spec.hoseDeform?.restBendPx ?? 0) + (phraseActive ? actionEnv * (hasGuitar ? -24 : 28) : -idleAttention * 5) + gestureHoseBendR;
      }
    } else if (rig.hasPurplePolarizerGagProp && spec.id === 1220 && isSpecsGag) {
      rotZ -= 2.28 * gagRamp;
    }

    const localX = gx + localShiftX;
    const localY = gy + localShiftY;
    const localMat = makeTrs(localX, localY, rotZ, scX, scY);
    const worldMat = parentWorld ? mulMat2D(parentWorld, localMat) : localMat;

    const evaluated: EvaluatedNodePose = {
      node: spec,
      localX,
      localY,
      scaleX: scX,
      scaleY: scY,
      rotZ,
      visible,
      hoseBendPx,
      worldMat,
    };
    byId.set(spec.id, evaluated);

    for (const child of rig.nodes) {
      if (child.parent === spec.id) {
        evalNode(
          child,
          parentShiftX + localShiftX,
          parentShiftY + localShiftY,
          nextTorso,
          nextHead,
          worldMat,
        );
      }
    }
    return evaluated;
  };

  for (const root of rig.nodes) {
    if (root.parent == null || !nodeById.has(root.parent)) {
      evalNode(root, 0, 0, false, false, null);
    }
  }

  // Convert Three.js rig space `(0, 0) = (rig.centerX, rig.floorY), +Y up` -> `[0..1]` in `rig.compWidth × rig.compHeight`
  const toNorm = (tx: number, ty: number): [number, number] => {
    const cx = rig.centerX + tx;
    const cy = rig.floorY - ty;
    return [
      Number(clamp(cx / Math.max(1, rig.compWidth), 0, 1).toFixed(4)),
      Number(clamp(cy / Math.max(1, rig.compHeight), 0, 1).toFixed(4)),
    ];
  };

  const findPose = (pred: (n: MultiplaneNodeSpec) => boolean) => {
    const spec = rig.nodes.find(pred);
    return spec ? byId.get(spec.id) : undefined;
  };

  const pelvisPose = findPose((n) => n.role === "torso" && /pelvis/i.test(n.name)) ?? findPose((n) => n.role === "legs" && n.parent == null);
  const spinePose =
    findPose((n) => n.role === "torso" && /coat_front|coat_torso|torso|chest|chassis/i.test(n.name) && n.id !== pelvisPose?.node.id) ??
    findPose((n) => n.role === "torso" && n.id !== pelvisPose?.node.id) ??
    pelvisPose;
  const neckPose = findPose((n) => n.role === "head" && /neck|null/i.test(n.name));
  const headPose =
    findPose((n) => n.role === "head" && n.sourceType === "Footage") ??
    findPose((n) => (n.role === "singVariant" || n.role === "altVariant") && n.sourceType === "Footage") ??
    neckPose;
  const armLPose = findPose((n) => n.role === "armL");
  const handLPose = findPose((n) => n.role === "handL");
  const armRPose = findPose((n) => n.role === "armR");
  const handRPose = findPose((n) => n.role === "handR");
  const propPose = findPose((n) => n.role === "guitar" || n.role === "gagVariant" || n.role === "antenna");

  const ikPoints: IkPointSpec[] = [
    {
      id: "root-foot",
      label: "Root Foot Anchor",
      role: "root-foot",
      ...(() => {
        const [x, y] = toNorm(0, 0);
        return { x, y };
      })(),
    },
  ];

  const pushOrigin = (
    id: string,
    label: string,
    role: IkPointSpec["role"],
    p: EvaluatedNodePose | undefined,
    parent: string,
  ) => {
    if (!p) return;
    const [x, y] = toNorm(p.worldMat.tx, p.worldMat.ty);
    ikPoints.push({ id, label, role, x, y, parent });
  };

  pushOrigin("pelvis", pelvisPose?.node.name ?? "Pelvis", "pelvis", pelvisPose, "root-foot");
  if (spinePose && spinePose !== pelvisPose) {
    pushOrigin("spine", spinePose.node.name, "spine", spinePose, pelvisPose ? "pelvis" : "root-foot");
  }
  const spineParent = spinePose && spinePose !== pelvisPose ? "spine" : pelvisPose ? "pelvis" : "root-foot";
  if (neckPose) {
    pushOrigin("neck", neckPose.node.name, "neck", neckPose, spineParent);
  }

  // Resolve exact CRT mouth / vocal head point when available
  let mouthNorm: [number, number];
  if (rig.crtFace) {
    const facePose = byId.get(rig.crtFace.nodeId) ?? headPose;
    if (facePose) {
      const mPxX = rig.crtFace.screenCenter[0] + rig.crtFace.mouth[0];
      const mPxY = rig.crtFace.screenCenter[1] + rig.crtFace.mouth[1];
      const lx = mPxX - (facePose.node.anchor[0] ?? 0);
      const ly = -(mPxY - (facePose.node.anchor[1] ?? 0));
      const [wx, wy] = applyMat2D(facePose.worldMat, lx, ly);
      mouthNorm = toNorm(wx, wy);
    } else {
      mouthNorm = [0.5, 0.25];
    }
  } else if (headPose && headPose.node.height > 0) {
    const mPxX = headPose.node.width * 0.5;
    const mPxY = headPose.node.height * 0.62;
    const lx = mPxX - (headPose.node.anchor[0] ?? 0);
    const ly = -(mPxY - (headPose.node.anchor[1] ?? 0));
    const [wx, wy] = applyMat2D(headPose.worldMat, lx, ly);
    mouthNorm = toNorm(wx, wy);
  } else {
    mouthNorm = [0.5, 0.25];
  }

  ikPoints.push({
    id: "head-jaw",
    label: headPose?.node.name ?? "Head / Jaw",
    role: "head-jaw",
    x: mouthNorm[0],
    y: mouthNorm[1],
    parent: neckPose ? "neck" : spineParent,
  });

  const pushDistal = (
    id: string,
    role: "hand-l" | "hand-r",
    parentId: string,
    armPose: EvaluatedNodePose | undefined,
    handPose: EvaluatedNodePose | undefined,
  ) => {
    if (handPose) {
      pushOrigin(id, handPose.node.name, role, handPose, parentId);
      return;
    }
    if (!armPose) return;
    const n = armPose.node;
    const [dxPx, dyPx] = n.distalOffset ?? [
      n.scale[0] < 0 ? n.width * 0.08 : n.width * 0.92,
      n.height * 0.5,
    ];
    let lx = dxPx - (n.anchor[0] ?? 0);
    let ly = -(dyPx - (n.anchor[1] ?? 0));
    if (n.hoseDeform) {
      const denom = n.hoseDeform.axis === "y-down" ? Math.max(1, n.height) : Math.max(1, n.width);
      const num =
        n.hoseDeform.axis === "y-down"
          ? dyPx
          : n.hoseDeform.axis === "x-left"
            ? n.width - dxPx
            : dxPx;
      const off = evaluateHoseOffset(n, armPose.hoseBendPx, num / denom);
      lx += off.dx;
      ly += off.dy;
    }
    const [wx, wy] = applyMat2D(armPose.worldMat, lx, ly);
    const [nx, ny] = toNorm(wx, wy);
    ikPoints.push({ id, label: `${n.name} claw`, role, x: nx, y: ny, parent: parentId });
  };

  pushOrigin("shoulder-l", armLPose?.node.name ?? "Left Shoulder", "shoulder-l", armLPose, spineParent);
  pushDistal("hand-l", "hand-l", armLPose ? "shoulder-l" : spineParent, armLPose, handLPose);
  pushOrigin("shoulder-r", armRPose?.node.name ?? "Right Shoulder", "shoulder-r", armRPose, spineParent);
  pushDistal("hand-r", "hand-r", armRPose ? "shoulder-r" : spineParent, armRPose, handRPose);

  if (propPose) {
    pushOrigin("prop", propPose.node.name, "prop", propPose, propPose.node.parent === headPose?.node.id ? "head-jaw" : spineParent);
  }

  return {
    byId,
    ikPoints,
    mouthNorm,
    gagActive: Boolean(inputs.gagActive),
    rootHopPx,
  };
}
