/**
 * Deterministic Video-Game Autopilot Engine for Studio 404 (`S-61`):
 * Runs a fixed-timestep (30Hz) video-game FSM + steering + 3D prop physics simulation
 * completely deterministically from frame 0 -> totalFrames so:
 *  - Characters interact playfully with world-specific 3D objects ON AUTOPILOT (zero manual control)
 *  - Walking advances `walk-4x2.webp` strictly by horizontal distance traveled (`0 px` foot slide)
 *  - Jumping & prop bouncing obey each world's real gravity & restitution (`theater`, `cosmic`, `playroom`)
 *  - Every frame `f` is O(1) lookup & bit-identical between Remotion `<Player>` and 1080p MP4 export (`0` useFrame!)
 */
import type { Piece } from "../choir/music.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import { resolveStageWorld, type StageWorldId } from "./stageWorlds.ts";

export type AutopilotMode = "rigged" | "walk" | "turnaround" | "jump" | "reaction" | "bow";

export type AutopilotPoseTag =
  | "idle"
  | "listen"
  | "knock"
  | "sing"
  | "belt"
  | "gasp"
  | "dance"
  | "reach-left"
  | "reach-right"
  | "celebrate";

export type StagePropKind =
  | "beat-pad"
  | "hanging-chime"
  | "glass-ripple"
  | "cosmic-orb"
  | "lunar-disc"
  | "xylo-tile"
  | "toy-ball"
  | "pinwheel";

export interface StagePropState {
  readonly id: string;
  readonly kind: StagePropKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotZ: number;
  readonly rotY: number;
  readonly radius: number;
  /** Spring depression (0..1) for floor pads / tiles. */
  readonly compression: number;
  /** Reactive glow / ripple energy (0..1) triggered by character interaction. */
  readonly energy: number;
  /** Accent hex color for this prop. */
  readonly color: string;
}

export interface AutopilotActorFrame {
  /** World X position on stage (`-3.6 .. +3.6`, `0` = center). */
  readonly x: number;
  /** World Y height above floor (`0` = feet planted on floor). */
  readonly y: number;
  /** World Z depth (`-0.8 .. +0.9`, `0.2` = downstage center). */
  readonly z: number;
  /** Facing direction (`1` = right/front, `-1` = left). */
  readonly facing: 1 | -1;
  /** Render mode selected by the autopilot FSM. */
  readonly mode: AutopilotMode;
  /** Semantic acting pose when `mode === "rigged"`. */
  readonly poseTag: AutopilotPoseTag;
  /** Normalized progress `0..1` inside active jump/spin/reaction/bow action. */
  readonly actionPhase: number;
  /** Discrete frame index for `walk`, `turnaround`, `jump`, `reaction`, or `bow`. */
  readonly sheetFrame: number;
  /** Monotonic horizontal distance walked in world units (drives stride-locked walk). */
  readonly walkDistance: number;
  /** World-space point Tabby is glancing toward (prop she just booped, or audience lens). */
  readonly gazeX: number;
  readonly gazeY: number;
  /** Subtle lean in radians for momentum/anticipation. */
  readonly leanRad: number;
  /** Squash/stretch around floor contact (`1,1` neutral). */
  readonly squashX: number;
  readonly stretchY: number;
  /** ID of prop currently being interacted with (if any). */
  readonly interactingPropId: string | null;
}

export interface StageAutopilotFrame {
  readonly frame: number;
  readonly timeSec: number;
  readonly beat: number;
  readonly actor: AutopilotActorFrame;
  readonly props: readonly StagePropState[];
}

interface MutableProp {
  id: string;
  kind: StagePropKind;
  x: number;
  y: number;
  z: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  vx: number;
  vy: number;
  vz: number;
  rotZ: number;
  rotY: number;
  angularVel: number;
  radius: number;
  compression: number;
  compVel: number;
  energy: number;
  color: string;
  cooldown: number;
  phase: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const MOVE_TARGET_X: Record<string, number> = {
  "wide-left": -1.75,
  left: -1.25,
  center: 0,
  right: 1.25,
  "wide-right": 1.75,
};

const MOVE_TARGET_Z: Record<string, number> = {
  "wide-left": 0.15,
  left: 0.18,
  center: 0.22,
  right: 0.18,
  "wide-right": 0.15,
  forward: 0.72,
  back: -0.45,
};

function spawnWorldProps(worldId: StageWorldId): MutableProp[] {
  if (worldId === "cosmic") {
    return [
      {
        id: "lunar-disc",
        kind: "lunar-disc",
        x: 0,
        y: 0,
        z: 0.2,
        baseX: 0,
        baseY: 0,
        baseZ: 0.2,
        vx: 0,
        vy: 0,
        vz: 0,
        rotZ: 0,
        rotY: 0,
        angularVel: 0,
        radius: 2.8,
        compression: 0,
        compVel: 0,
        energy: 0.25,
        color: "#57e8d4",
        cooldown: 0,
        phase: 0,
      },
      {
        id: "orb-1",
        kind: "cosmic-orb",
        x: -1.85,
        y: 1.75,
        z: 0.35,
        baseX: -1.85,
        baseY: 1.75,
        baseZ: 0.35,
        vx: 0,
        vy: 0,
        vz: 0,
        rotZ: 0,
        rotY: 0,
        angularVel: 0.6,
        radius: 0.32,
        compression: 0,
        compVel: 0,
        energy: 0.35,
        color: "#5ff2d6",
        cooldown: 0,
        phase: 0.2,
      },
      {
        id: "orb-2",
        kind: "cosmic-orb",
        x: 1.75,
        y: 2.05,
        z: 0.25,
        baseX: 1.75,
        baseY: 2.05,
        baseZ: 0.25,
        vx: 0,
        vy: 0,
        vz: 0,
        rotZ: 0,
        rotY: 0,
        angularVel: -0.7,
        radius: 0.34,
        compression: 0,
        compVel: 0,
        energy: 0.35,
        color: "#b784ff",
        cooldown: 0,
        phase: 1.7,
      },
      {
        id: "orb-3",
        kind: "cosmic-orb",
        x: -0.65,
        y: 2.65,
        z: -0.2,
        baseX: -0.65,
        baseY: 2.65,
        baseZ: -0.2,
        vx: 0,
        vy: 0,
        vz: 0,
        rotZ: 0,
        rotY: 0,
        angularVel: 0.5,
        radius: 0.28,
        compression: 0,
        compVel: 0,
        energy: 0.3,
        color: "#ffd074",
        cooldown: 0,
        phase: 3.1,
      },
      {
        id: "orb-4",
        kind: "cosmic-orb",
        x: 2.55,
        y: 1.35,
        z: -0.1,
        baseX: 2.55,
        baseY: 1.35,
        baseZ: -0.1,
        vx: 0,
        vy: 0,
        vz: 0,
        rotZ: 0,
        rotY: 0,
        angularVel: -0.55,
        radius: 0.29,
        compression: 0,
        compVel: 0,
        energy: 0.3,
        color: "#7dd3fc",
        cooldown: 0,
        phase: 4.5,
      },
    ];
  }

  if (worldId === "playroom") {
    const tileColors = ["#ff6b6b", "#ffb84d", "#51cf96", "#4dabf7", "#b197fc"];
    const tiles: MutableProp[] = tileColors.map((color, i) => {
      const tx = (i - 2) * 1.15;
      return {
        id: `tile-${i}`,
        kind: "xylo-tile",
        x: tx,
        y: 0.04,
        z: 0.22,
        baseX: tx,
        baseY: 0.04,
        baseZ: 0.22,
        vx: 0,
        vy: 0,
        vz: 0,
        rotZ: 0,
        rotY: 0,
        angularVel: 0,
        radius: 0.52,
        compression: 0,
        compVel: 0,
        energy: 0.12,
        color,
        cooldown: 0,
        phase: i * 0.7,
      };
    });
    return [
      ...tiles,
      {
        id: "toy-ball",
        kind: "toy-ball",
        x: -1.15,
        y: 0.34,
        z: 0.42,
        baseX: -1.15,
        baseY: 0.34,
        baseZ: 0.42,
        vx: 0.85,
        vy: 2.8,
        vz: 0,
        rotZ: 0,
        rotY: 0,
        angularVel: -2.2,
        radius: 0.32,
        compression: 0,
        compVel: 0,
        energy: 0.3,
        color: "#ff7e67",
        cooldown: 0,
        phase: 0,
      },
      {
        id: "pinwheel",
        kind: "pinwheel",
        x: 2.95,
        y: 1.55,
        z: -0.35,
        baseX: 2.95,
        baseY: 1.55,
        baseZ: -0.35,
        vx: 0,
        vy: 0,
        vz: 0,
        rotZ: 0,
        rotY: 0,
        angularVel: 1.4,
        radius: 0.52,
        compression: 0,
        compVel: 0,
        energy: 0.2,
        color: "#ffd166",
        cooldown: 0,
        phase: 0,
      },
    ];
  }

  if (worldId === "caravan" || worldId === "storybook") {
    // Caravan & Storybook have dedicated hero 3D setpieces (parade wagon/horse and open pop-up book)
    return [];
  }

  // Default: `theater` — Studio 404 Velvet Spotlight Stage
  return [
    {
      id: "pad-left",
      kind: "beat-pad",
      x: -1.78,
      y: 0.02,
      z: 0.2,
      baseX: -1.78,
      baseY: 0.02,
      baseZ: 0.2,
      vx: 0,
      vy: 0,
      vz: 0,
      rotZ: 0,
      rotY: 0,
      angularVel: 0,
      radius: 0.62,
      compression: 0,
      compVel: 0,
      energy: 0.14,
      color: "#e3bd7f",
      cooldown: 0,
      phase: 0,
    },
    {
      id: "pad-center",
      kind: "beat-pad",
      x: 0,
      y: 0.02,
      z: 0.24,
      baseX: 0,
      baseY: 0.02,
      baseZ: 0.24,
      vx: 0,
      vy: 0,
      vz: 0,
      rotZ: 0,
      rotY: 0,
      angularVel: 0,
      radius: 0.76,
      compression: 0,
      compVel: 0,
      energy: 0.28,
      color: "#4fd8b8",
      cooldown: 0,
      phase: 1,
    },
    {
      id: "pad-right",
      kind: "beat-pad",
      x: 1.78,
      y: 0.02,
      z: 0.2,
      baseX: 1.78,
      baseY: 0.02,
      baseZ: 0.2,
      vx: 0,
      vy: 0,
      vz: 0,
      rotZ: 0,
      rotY: 0,
      angularVel: 0,
      radius: 0.62,
      compression: 0,
      compVel: 0,
      energy: 0.14,
      color: "#f2a65a",
      cooldown: 0,
      phase: 2,
    },
    {
      id: "chime-left",
      kind: "hanging-chime",
      x: -2.05,
      y: 2.55,
      z: -0.15,
      baseX: -2.05,
      baseY: 2.55,
      baseZ: -0.15,
      vx: 0,
      vy: 0,
      vz: 0,
      rotZ: 0,
      rotY: 0,
      angularVel: 0,
      radius: 0.42,
      compression: 0,
      compVel: 0,
      energy: 0.15,
      color: "#ffcf7d",
      cooldown: 0,
      phase: 0.3,
    },
    {
      id: "chime-right",
      kind: "hanging-chime",
      x: 2.05,
      y: 2.55,
      z: -0.15,
      baseX: 2.05,
      baseY: 2.55,
      baseZ: -0.15,
      vx: 0,
      vy: 0,
      vz: 0,
      rotZ: 0,
      rotY: 0,
      angularVel: 0,
      radius: 0.42,
      compression: 0,
      compVel: 0,
      energy: 0.15,
      color: "#57e5c5",
      cooldown: 0,
      phase: 1.4,
    },
    {
      id: "glass-ripple",
      kind: "glass-ripple",
      x: 0,
      y: 1.65,
      z: 0.95,
      baseX: 0,
      baseY: 1.65,
      baseZ: 0.95,
      vx: 0,
      vy: 0,
      vz: 0,
      rotZ: 0,
      rotY: 0,
      angularVel: 0,
      radius: 0.72,
      compression: 0,
      compVel: 0,
      energy: 0,
      color: "#6bf2d6",
      cooldown: 0,
      phase: 0,
    },
  ];
}

/**
 * Compute target waypoint `(targetX, targetZ)` from score `move` cues + autopilot prop interest.
 */
function resolveWaypoint(
  piece: Piece,
  beat: number,
): { targetX: number; targetZ: number; moveSpanSec: number; moveActive: boolean } {
  const moves = (piece.blocking ?? [])
    .filter((b) => b.action === "move" && b.target)
    .sort((a, b) => a.beat - b.beat);

  let tx = 0;
  let tz = 0.22;
  let active = false;
  let spanBeats = 4;

  for (const m of moves) {
    const t = m.target!;
    const nextX = t === "forward" || t === "back" ? tx : (MOVE_TARGET_X[t] ?? 0);
    const nextZ = MOVE_TARGET_Z[t] ?? tz;
    const dur = Math.max(1.8, m.beats || 4);
    if (beat >= m.beat + dur) {
      tx = nextX;
      tz = nextZ;
    } else if (beat >= m.beat) {
      tx = nextX;
      tz = nextZ;
      active = true;
      spanBeats = dur;
      break;
    } else {
      break;
    }
  }

  return { targetX: tx, targetZ: tz, moveSpanSec: spanBeats * beatSeconds(piece), moveActive: active };
}

/**
 * Run the complete deterministic fixed-step video-game simulation for a piece & world.
 * Cached once per `[piece, worldId, totalFrames, fps]` via `useMemo` (`< 2ms` runtime).
 */
export function simulateStageAutopilot(
  piece: Piece,
  worldId: StageWorldId,
  totalFrames: number,
  fps = 30,
): readonly StageAutopilotFrame[] {
  const world = resolveStageWorld(worldId);
  const phys = world.physics;
  const bs = beatSeconds(piece);
  const dt = 1 / Math.max(1, fps);

  const props = spawnWorldProps(worldId);
  const frames: StageAutopilotFrame[] = new Array(Math.max(1, totalFrames));

  const curtainCallBeat =
    piece.sections?.find((s) => s.name.toLowerCase().includes("curtain"))?.beat ?? Number.POSITIVE_INFINITY;
  const jumpCues = (piece.blocking ?? []).filter((b) => b.action === "jump");
  const danceCues = (piece.blocking ?? []).filter((b) => b.action === "dance");
  const celebrateCues = (piece.blocking ?? []).filter((b) => b.action === "celebrate");
  const gestureCues = piece.cues ?? [];
  const leadTrack = piece.tracks.find((t) => t.id === "tabby") ?? piece.tracks[0];

  // Actor kinematic physics state
  let x = 0;
  let y = 0;
  let z = 0.22;
  let vx = 0;
  let vy = 0;
  let facing: 1 | -1 = 1;
  let walkDistance = 0;
  let squashX = 1;
  let stretchY = 1;
  let gazeX = 0;
  let gazeY = 1.65;
  let reactTimer = 0;
  let reactCell = 2;
  let interactPropId: string | null = null;
  let jumpCueTriggered = new Set<number>();
  let spinTimer = 0;
  let spinDuration = 1.35;
  let landCushionTimer = 0;
  let knockPulseDone = new Set<number>();

  // Stride calibration for `walk-4x2.webp`: 8 frames = 2 full steps = ~1.52 world units (0 px foot slide!)
  const STRIDE_WORLD_UNITS_PER_CYCLE = 1.52;

  for (let f = 0; f < frames.length; f++) {
    const timeSec = f * dt;
    const beat = (timeSec - LEAD_IN) / bs;
    const safeBeat = Math.max(0, beat);

    // Check active vocal note on lead track
    const noteNow =
      leadTrack?.events.some((e) => beat >= e.beat && beat < e.beat + e.beats) ?? false;
    const activeSection = [...(piece.sections ?? [])]
      .reverse()
      .find((s) => safeBeat >= s.beat)?.name.toLowerCase() ?? "";

    const inCurtainCall = beat >= curtainCallBeat - 0.15;
    const inDance = danceCues.some((c) => beat >= c.beat && beat < c.beat + Math.max(2, c.beats || 4));
    const inCelebrate = celebrateCues.some((c) => beat >= c.beat && beat < c.beat + Math.max(2, c.beats || 4));

    // Check score gesture cues near current beat
    const activeGesture = gestureCues.find((g) => {
      const elapsedSec = (beat - g.beat) * bs;
      return elapsedSec >= 0 && elapsedSec < 1.15;
    });

    // 1. Trigger score jumps & spin around ("Watch me leap and spin around!")
    for (let ji = 0; ji < jumpCues.length; ji++) {
      const jc = jumpCues[ji];
      if (!jumpCueTriggered.has(ji) && beat >= jc.beat && beat < jc.beat + 0.5) {
        jumpCueTriggered.add(ji);
        vy = phys.jumpVelocity;
        squashX = 0.88;
        stretchY = 1.14;
        // Follow the leap with a true 360° turnaround spin right after landing!
        spinTimer = -0.78; // negative = armed countdown until landing / mid-air finish
        spinDuration = 1.15;
      }
    }

    // 2. Trigger glass-knock ripple during `[knock at the glass]` ("Tap tap! Is that me?")
    if (activeSection.includes("knock")) {
      const tapBeats = [0.1, 0.7];
      for (let ti = 0; ti < tapBeats.length; ti++) {
        if (!knockPulseDone.has(ti) && beat >= tapBeats[ti]) {
          knockPulseDone.add(ti);
          const glass = props.find((p) => p.kind === "glass-ripple");
          if (glass) {
            glass.energy = 1.0;
            glass.x = x;
            glass.y = 1.65;
          }
        }
      }
    }

    // 3. Determine steering target from score waypoints + playful autopilot prop interest
    const wp = resolveWaypoint(piece, safeBeat);
    let desiredX = wp.targetX;
    let desiredZ = wp.targetZ;

    if (inCurtainCall) {
      desiredX = 0;
      desiredZ = 0.25;
    } else if (inDance) {
      // Playful left-paw / right-paw rhythm travel during dance break
      desiredX = Math.sin(safeBeat * Math.PI * 0.5) * 1.15;
      desiredZ = 0.34;
    } else if (!wp.moveActive && !noteNow && beat > 1.5 && reactTimer <= 0 && y === 0) {
      // Between vocal phrases, autopilot gently nudges toward nearest playful prop (ball or orb)
      const playful = props.find((p) => (p.kind === "toy-ball" || p.kind === "cosmic-orb") && p.cooldown <= 0);
      if (playful && Math.abs(playful.x - x) < 2.2) {
        desiredX = clamp(playful.x - Math.sign(playful.x - x || 1) * 0.45, -2.5, 2.5);
      }
    }

    // Horizontal steering (max speed calibrated cleanly to walk cycle)
    const dx = desiredX - x;
    const dz = desiredZ - z;
    const distX = Math.abs(dx);
    const maxSpeed = inDance ? 2.15 : 1.75;

    if (distX > 0.06 && !inCurtainCall) {
      const targetVx = clamp(dx * 2.6, -maxSpeed, maxSpeed);
      vx += (targetVx - vx) * Math.min(1, dt * 8.5);
      if (Math.abs(vx) > 0.14) facing = vx > 0 ? 1 : -1;
    } else {
      vx *= Math.pow(0.06, dt);
      if (Math.abs(vx) < 0.03) vx = 0;
    }

    const prevX = x;
    x = clamp(x + vx * dt, -3.15, 3.15);
    z = clamp(z + dz * Math.min(1, dt * 3.2), -0.65, 0.85);

    // Vertical physics (real world gravity!)
    const wasAirborne = y > 0.001;
    if (y > 0 || vy > 0) {
      vy += phys.gravity * dt;
      y += vy * dt;
      if (y <= 0) {
        y = 0;
        vy = 0;
        if (wasAirborne) {
          landCushionTimer = 0.22;
          squashX = 1.14;
          stretchY = 0.86;
          // Arm spin immediately upon landing from the leap!
          if (spinTimer < 0) spinTimer = spinDuration;
          // Landing shockwave hits nearby floor pads/tiles/disc!
          for (const p of props) {
            if (p.kind === "beat-pad" || p.kind === "xylo-tile" || p.kind === "lunar-disc") {
              if (Math.abs(p.x - x) < p.radius + 0.85) {
                p.compVel += 7.5;
                p.energy = 1.0;
              }
            }
            if (p.kind === "hanging-chime" && Math.abs(p.x - x) < 2.2) {
              p.angularVel += (p.x >= x ? 1 : -1) * 2.8;
              p.energy = Math.max(p.energy, 0.85);
            }
          }
        }
      }
    }

    // Smooth squash/stretch return to neutral
    squashX += (1 - squashX) * Math.min(1, dt * 11);
    stretchY += (1 - stretchY) * Math.min(1, dt * 11);
    if (landCushionTimer > 0) landCushionTimer = Math.max(0, landCushionTimer - dt);
    if (reactTimer > 0) reactTimer = Math.max(0, reactTimer - dt);
    if (spinTimer > 0) spinTimer = Math.max(0, spinTimer - dt);

    // Accumulate exact ground distance for 0-slide walk cycle (with clean speed hysteresis so mode never flickers!)
    const groundedSpeed = y <= 0.001 ? Math.abs(x - prevX) / dt : 0;
    const isWalking = groundedSpeed > 0.42 && y <= 0.001 && spinTimer <= 0 && !inCurtainCall;
    if (isWalking) {
      walkDistance += Math.abs(x - prevX);
    }

    // 4. Update Interactive 3D World Props & Trigger Autopilot Collisions!
    interactPropId = null;
    let nearestHotProp: MutableProp | null = null;
    let nearestHotScore = 0;

    for (const p of props) {
      if (p.cooldown > 0) p.cooldown = Math.max(0, p.cooldown - dt);
      p.energy = Math.max(0.08, p.energy * Math.pow(0.18, dt));

      if (p.kind === "beat-pad" || p.kind === "xylo-tile") {
        // Trigger floor pad / xylophone tile whenever Tabby steps over it!
        const underfoot = y <= 0.08 && Math.abs(p.x - x) < p.radius * 0.88;
        const targetComp = underfoot ? 0.72 : 0;
        const springForce = (targetComp - p.compression) * 95 - p.compVel * 11;
        p.compVel += springForce * dt;
        p.compression = clamp(p.compression + p.compVel * dt, 0, 1);
        if (underfoot && p.cooldown <= 0) {
          p.energy = 1.0;
          p.cooldown = 0.45;
          interactPropId = p.id;
        }
      } else if (p.kind === "lunar-disc") {
        // Lunar disc tilts gently with Tabby's weight & glows on singing energy
        const targetTilt = clamp(-x * 0.025, -0.08, 0.08);
        p.rotZ += (targetTilt - p.rotZ) * Math.min(1, dt * 5);
        p.rotY += dt * 0.22;
        if (noteNow) p.energy = Math.max(p.energy, 0.55);
      } else if (p.kind === "hanging-chime") {
        // Damped harmonic pendulum + autopilot reach/bat when Tabby walks underneath!
        const nearX = Math.abs(p.x - x) < 0.95;
        if (nearX && p.cooldown <= 0 && (inCelebrate || inDance || (noteNow && Math.floor(safeBeat) % 4 === 0))) {
          p.angularVel += (vx >= 0 ? 1 : -1) * 3.4;
          p.energy = 1.0;
          p.cooldown = 1.8;
          reactTimer = 0.45;
          reactCell = 2; // joyful reach / jazz hands
          interactPropId = p.id;
        }
        const accel = -14.0 * p.rotZ - 1.65 * p.angularVel;
        p.angularVel += accel * dt;
        p.rotZ = clamp(p.rotZ + p.angularVel * dt, -0.65, 0.65);
      } else if (p.kind === "glass-ripple") {
        // Pure visual pulse triggered by knock & chorus echoes
        p.energy = Math.max(0, p.energy * Math.pow(0.14, dt));
        if (activeSection.includes("echo") && Math.abs(safeBeat - Math.round(safeBeat)) < 0.06 && Math.round(safeBeat) % 4 === 0) {
          p.energy = Math.max(p.energy, 0.65);
          p.x = x;
        }
      } else if (p.kind === "cosmic-orb") {
        // Gentle orbital spring pull back toward home orbit + low-G boop physics!
        const orbitX = p.baseX + Math.sin(timeSec * 0.7 + p.phase) * 0.52;
        const orbitY = p.baseY + Math.cos(timeSec * 0.95 + p.phase) * 0.34;
        const dxOrb = p.x - x;
        const dyOrb = p.y - (y + 1.55);
        const distOrb = Math.hypot(dxOrb, dyOrb);

        if (distOrb < 1.35 && p.cooldown <= 0 && !inCurtainCall) {
          // Autopilot boop! Tabby bats the cosmic orb into a glowing harmonic recoil!
          const nx = dxOrb / Math.max(0.15, distOrb);
          const ny = dyOrb / Math.max(0.15, distOrb);
          p.vx += nx * 3.4 + vx * 0.45;
          p.vy += ny * 2.4 + 1.1;
          p.angularVel = (nx >= 0 ? 1 : -1) * 4.5;
          p.energy = 1.0;
          p.cooldown = 1.4;
          interactPropId = p.id;
          if (!isWalking && y <= 0.01) {
            reactTimer = 0.42;
            reactCell = dxOrb >= 0 ? 5 : 3;
          }
        }

        // Elastic return toward orbital track
        p.vx += (orbitX - p.x) * 1.9 * dt;
        p.vy += (orbitY - p.y) * 2.2 * dt;
        p.vx *= Math.pow(0.32, dt);
        p.vy *= Math.pow(0.32, dt);
        p.x = clamp(p.x + p.vx * dt, -3.5, 3.5);
        p.y = clamp(p.y + p.vy * dt, 0.75, 3.25);
        p.rotY += p.angularVel * dt;
        p.angularVel += ((p.phase % 2 === 0 ? 0.6 : -0.6) - p.angularVel) * dt * 1.5;
      } else if (p.kind === "toy-ball") {
        // Real playful bouncy ball physics (gravity + floor bounce + wall bounce + Tabby paw kick!)
        p.vy += phys.gravity * 0.62 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotZ -= (p.vx / Math.max(0.1, p.radius)) * dt;

        // Floor bounce
        if (p.y <= p.radius) {
          p.y = p.radius;
          if (Math.abs(p.vy) > 0.7) {
            p.vy = -p.vy * phys.bounceRestitution;
            p.energy = Math.max(p.energy, 0.65);
          } else {
            // Subtle beat bounce so the ball stays lively on rhythm peaks!
            p.vy = noteNow && Math.abs(safeBeat - Math.round(safeBeat)) < 0.08 ? 2.4 : 0;
          }
        }
        // Stage side bounds bounce back into play
        if (p.x < -3.35) {
          p.x = -3.35;
          p.vx = Math.abs(p.vx) * 0.85 + 0.5;
        } else if (p.x > 3.35) {
          p.x = 3.35;
          p.vx = -Math.abs(p.vx) * 0.85 - 0.5;
        }

        // Autopilot paw kick / juggle whenever the ball comes within reach of Tabby!
        const distBall = Math.hypot(p.x - x, p.y - (y + 0.65));
        if (distBall < 0.92 && p.cooldown <= 0 && !inCurtainCall) {
          const kickDir = x > 1.2 ? -1 : x < -1.2 ? 1 : (facing || 1);
          p.vx = kickDir * (2.6 + (f % 5) * 0.22);
          p.vy = 4.6;
          p.energy = 1.0;
          p.cooldown = 0.95;
          interactPropId = p.id;
          if (!isWalking) {
            reactTimer = 0.36;
            reactCell = 3; // playful side-kick joy!
          }
        }
      } else if (p.kind === "pinwheel") {
        // Spins fast when Tabby moves/jumps nearby or belts a note
        const distPin = Math.abs(p.x - x);
        if ((distPin < 2.2 && (isWalking || y > 0.1)) || inCelebrate) {
          p.angularVel = Math.min(11, p.angularVel + dt * 14);
          p.energy = Math.max(p.energy, 0.8);
        } else {
          p.angularVel += (1.1 - p.angularVel) * dt * 1.4;
        }
        p.rotZ += p.angularVel * dt;
      }

      const hotScore = p.energy * (p.kind === "toy-ball" || p.kind === "cosmic-orb" || p.kind === "hanging-chime" ? 1.4 : 0.7);
      if (hotScore > nearestHotScore && p.energy > 0.45) {
        nearestHotScore = hotScore;
        nearestHotProp = p;
      }
    }

    // 5. Smooth attentive eye/head gaze toward recently interacted prop or audience lens
    const targetGazeX = nearestHotProp && !noteNow ? nearestHotProp.x : x;
    const targetGazeY = nearestHotProp && !noteNow ? nearestHotProp.y : 1.75;
    gazeX += (targetGazeX - gazeX) * Math.min(1, dt * 6);
    gazeY += (targetGazeY - gazeY) * Math.min(1, dt * 6);

    // 6. Select Autopilot Render Mode & Exact Sheet Frame / Pose Tag
    let mode: AutopilotMode = "rigged";
    let poseTag: AutopilotPoseTag = "idle";
    let actionPhase = 0;
    let sheetFrame = 0;

    if (inCurtainCall) {
      mode = "bow";
      const bowElapsed = Math.max(0, (beat - curtainCallBeat) * bs);
      actionPhase = clamp(bowElapsed / 4.0, 0, 1);
      sheetFrame = Math.min(47, Math.floor(bowElapsed * 12));
      poseTag = "celebrate";
    } else if (y > 0.02 || (landCushionTimer > 0.08 && !isWalking)) {
      mode = "jump";
      if (y <= 0.02) {
        // Landing crouch -> settle (cells 6..7)
        sheetFrame = landCushionTimer > 0.14 ? 6 : 7;
        actionPhase = 0.9;
      } else {
        // Ascending (1..2), Apex tuck (3), Descending (4..5)
        const vNorm = clamp(vy / Math.max(1, phys.jumpVelocity), -1, 1);
        if (vNorm > 0.55) sheetFrame = 1;
        else if (vNorm > 0.15) sheetFrame = 2;
        else if (vNorm > -0.25) sheetFrame = 3;
        else if (vNorm > -0.65) sheetFrame = 4;
        else sheetFrame = 5;
        actionPhase = clamp(0.5 - vNorm * 0.45, 0.1, 0.85);
      }
      poseTag = "celebrate";
    } else if (spinTimer > 0) {
      // Authentic 360° 8-view turnaround spin!
      mode = "turnaround";
      actionPhase = 1 - spinTimer / Math.max(0.1, spinDuration);
      sheetFrame = Math.min(7, Math.floor(actionPhase * 8));
      poseTag = "dance";
    } else if (isWalking) {
      // Stride-locked 8-frame walk cycle (`0 px` foot slide!)
      mode = "walk";
      const cyclePos = (walkDistance / STRIDE_WORLD_UNITS_PER_CYCLE) % 1;
      actionPhase = cyclePos;
      sheetFrame = Math.floor(cyclePos * 8) % 8;
      poseTag = "dance";
    } else {
      // Primary continuous rigged 2.5D Tabby with steady head & CHIMERA mouth sync (NEVER flashes into reaction sheets mid-song!)
      mode = "rigged";
      if (activeSection.includes("knock") && beat < 2.2) {
        poseTag = "knock";
      } else if (activeGesture?.gesture === "gasp") {
        poseTag = "gasp";
      } else if (inCelebrate || activeGesture?.gesture === "cheer") {
        poseTag = "celebrate";
      } else if (inDance) {
        poseTag = "dance";
      } else if (reactTimer > 0 && !noteNow) {
        poseTag = gazeX >= x ? "reach-right" : "reach-left";
      } else if (interactPropId && !noteNow) {
        poseTag = gazeX >= x ? "reach-right" : "reach-left";
      } else if (noteNow) {
        poseTag = activeSection.includes("return") || activeSection.includes("echo") ? "belt" : "sing";
      } else if (beat < 0.2) {
        poseTag = "listen";
      } else {
        poseTag = "idle";
      }
    }

    const leanRad = isWalking
      ? facing * 0.055
      : clamp((vx * 0.03) + (inDance ? Math.sin(safeBeat * Math.PI) * 0.065 : 0), -0.14, 0.14);

    frames[f] = {
      frame: f,
      timeSec,
      beat,
      actor: {
        x,
        y,
        z,
        facing,
        mode,
        poseTag,
        actionPhase,
        sheetFrame,
        walkDistance,
        gazeX,
        gazeY,
        leanRad,
        squashX,
        stretchY,
        interactingPropId: interactPropId,
      },
      props: props.map((p) => ({
        id: p.id,
        kind: p.kind,
        x: p.x,
        y: p.y,
        z: p.z,
        rotZ: p.rotZ,
        rotY: p.rotY,
        radius: p.radius,
        compression: p.compression,
        energy: p.energy,
        color: p.color,
      })),
    };
  }

  return frames;
}
