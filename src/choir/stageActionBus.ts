import { create } from "zustand";
import { canonicalCastId, getCastCharacter, resolveDirectedTakeClip, type ActiveTakeState } from "./castManifest.ts";
import { gestureSeconds, type GestureName } from "./gestures.ts";
import { useController } from "./controller.ts";

export interface LiveTakeOverride {
  readonly castId: string;
  readonly clipKey: string;
  readonly startedAtMs: number;
  readonly durationSec: number;
}

export interface LiveGagOverride {
  readonly castId: string;
  readonly gagName: string;
  readonly startedAtMs: number;
  readonly durationSec: number;
}

export interface LiveGestureOverride {
  readonly castId: string;
  readonly gesture: GestureName | "double nod";
  readonly startedAtMs: number;
  readonly durationSec: number;
}

interface StageActionBusState {
  takes: Readonly<Record<string, LiveTakeOverride>>;
  gags: Readonly<Record<string, LiveGagOverride>>;
  gestures: Readonly<Record<string, LiveGestureOverride>>;
  tickMs: number;
  showIkOverlay: boolean;
  showVocalSyncHud: boolean;
}

export const useStageActionBus = create<StageActionBusState>(() => ({
  takes: {},
  gags: {},
  gestures: {},
  tickMs: 0,
  showIkOverlay: false,
  showVocalSyncHud: true,
}));

export function setShowIkOverlay(show: boolean): void {
  useStageActionBus.setState({ showIkOverlay: show });
}

export function setShowVocalSyncHud(show: boolean): void {
  useStageActionBus.setState({ showVocalSyncHud: show });
}

const GESTURE_ALIASES: Readonly<Record<string, GestureName | "double nod">> = {
  sing: "cheer",
  clap: "cheer",
  jump: "cheer",
  walk: "nod",
  step: "nod",
  spin: "gasp",
  fx: "gasp",
  nod: "nod",
  tilt: "tilt",
  laugh: "laugh",
  shrug: "shrug",
  "toaster-shrug": "shrug",
  gasp: "gasp",
  bow: "bow",
  cheer: "cheer",
  "double nod": "double nod",
};

const CANONICAL_3D_CLIPS: Readonly<Record<string, { clipKey: string; durationSec: number }>> = {
  idle: { clipKey: "idle", durationSec: 2.6 },
  sing: { clipKey: "sing", durationSec: 3.4 },
  walk: { clipKey: "walk", durationSec: 2.6 },
  step: { clipKey: "walk", durationSec: 2.6 },
  jump: { clipKey: "jump", durationSec: 1.65 },
  clap: { clipKey: "clap", durationSec: 1.85 },
  cheer: { clipKey: "jump", durationSec: 1.65 },
  spin: { clipKey: "spin", durationSec: 1.8 },
  fx: { clipKey: "spin", durationSec: 1.8 },
  bow: { clipKey: "bow", durationSec: 2.9 },
  overdrive: { clipKey: "overdrive", durationSec: 3.0 },
  "overdrive-arc": { clipKey: "overdrive", durationSec: 3.0 },
};

const MULTIPLANE_GAG_ACTIONS = new Set([
  "adjust-specs",
  "probe-arc",
  "overdrive",
  "overdrive-arc",
  "shred",
  "gag",
  "polarizer",
  "ticker-cue",
  "listening",
  "listen",
  "crt-answer",
]);

let rafId = 0;

function pruneAndTick(now: number) {
  const st = useStageActionBus.getState();
  let changed = false;
  let hasActive = false;

  const nextTakes: Record<string, LiveTakeOverride> = {};
  for (const [k, v] of Object.entries(st.takes)) {
    if ((now - v.startedAtMs) / 1000 < v.durationSec) {
      nextTakes[k] = v;
      hasActive = true;
    } else {
      changed = true;
    }
  }

  const nextGags: Record<string, LiveGagOverride> = {};
  for (const [k, v] of Object.entries(st.gags)) {
    if ((now - v.startedAtMs) / 1000 < v.durationSec) {
      nextGags[k] = v;
      hasActive = true;
    } else {
      changed = true;
    }
  }

  const nextGestures: Record<string, LiveGestureOverride> = {};
  for (const [k, v] of Object.entries(st.gestures)) {
    if ((now - v.startedAtMs) / 1000 < v.durationSec) {
      nextGestures[k] = v;
      hasActive = true;
    } else {
      changed = true;
    }
  }

  if (hasActive) {
    useStageActionBus.setState({
      ...(changed ? { takes: nextTakes, gags: nextGags, gestures: nextGestures } : {}),
      tickMs: now,
    });
    rafId = requestAnimationFrame(pruneAndTick);
  } else {
    rafId = 0;
    if (changed) {
      useStageActionBus.setState({ takes: nextTakes, gags: nextGags, gestures: nextGestures, tickMs: now });
    }
  }
}

function ensureBusTicker() {
  if (typeof requestAnimationFrame === "undefined" || rafId !== 0) return;
  rafId = requestAnimationFrame(pruneAndTick);
}

/**
 * Trigger a character-specific directed take, multiplane gag, or AniCraft gesture live on stage.
 * Automatically expires after `durationSec` and never affects headless Remotion MP4 exports.
 */
export function triggerCharacterAction(
  castIdOrVoice: string,
  actionName: string,
  opts?: { durationSec?: number; voiceId?: string },
): void {
  const canon = canonicalCastId(castIdOrVoice);
  const ch = getCastCharacter(canon);
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const normalized = actionName.trim().toLowerCase();

  const patch: Partial<StageActionBusState> = { tickMs: now };
  const st = useStageActionBus.getState();

  // 2. Character-specific directed take from the Character Bible manifest
  const directClip =
    resolveDirectedTakeClip(canon, normalized) ??
    (normalized === "fx" && ch
      ? (() => {
          const firstTake = Object.values(ch.directedTakes)[0];
          return firstTake ? resolveDirectedTakeClip(canon, firstTake) : null;
        })()
      : null);

  // 1. Multiplane gag props (Ozzi polarizer specs, Fuzz overdrive, Tally ticker cue, Hertz crt-answer, etc.)
  if (
    MULTIPLANE_GAG_ACTIONS.has(normalized) ||
    (Boolean(ch?.multiplane) && normalized === "fx") ||
    directClip?.clipKey === "ticker-cue" ||
    directClip?.clipKey === "listening" ||
    directClip?.clipKey === "crt-answer"
  ) {
    const dur = opts?.durationSec ?? 3.2;
    patch.gags = {
      ...st.gags,
      [canon]: { castId: canon, gagName: normalized, startedAtMs: now, durationSec: dur },
    };
  }

  const canonicalClip = CANONICAL_3D_CLIPS[normalized];
  if (directClip) {
    const clipDur = opts?.durationSec ?? Math.max(2.2, directClip.frames / Math.max(1, directClip.fps));
    patch.takes = {
      ...st.takes,
      [canon]: {
        castId: canon,
        clipKey: directClip.clipKey,
        startedAtMs: now,
        durationSec: clipDur,
      },
    };
  } else if (
    canonicalClip &&
    (ch?.model3d ||
      (Boolean(ch?.clips[canonicalClip.clipKey]) &&
        (normalized === "sing" || normalized === "walk" || normalized === "step")) ||
      normalized === "clap" ||
      normalized === "jump" ||
      normalized === "overdrive" ||
      normalized === "overdrive-arc")
  ) {
    patch.takes = {
      ...st.takes,
      [canon]: {
        castId: canon,
        clipKey: canonicalClip.clipKey,
        startedAtMs: now,
        durationSec: opts?.durationSec ?? canonicalClip.durationSec,
      },
    };
  }

  // 3. AniCraft gesture fallback or overlay (`nod`, `cheer`, `shrug`, `gasp`, `bow`, `laugh`, `tilt`)
  const mappedGesture = GESTURE_ALIASES[normalized];
  if (mappedGesture || (!directClip && !canonicalClip)) {
    const g: GestureName | "double nod" = mappedGesture ?? "cheer";
    const baseDur = g === "double nod" ? gestureSeconds("nod") * 2 : gestureSeconds(g);
    const dur = opts?.durationSec ?? Math.max(1.4, baseDur || 1.6);
    patch.gestures = {
      ...st.gestures,
      [canon]: { castId: canon, gesture: g, startedAtMs: now, durationSec: dur },
    };
    const controllerId = opts?.voiceId ?? canon;
    useController.setState({
      gesture: { id: controllerId, action: g === "double nod" ? "nod" : g, at: now },
      last: `${ch?.displayName ?? canon} · ${directClip?.clipKey ?? canonicalClip?.clipKey ?? actionName}`,
    });
  } else {
    useController.setState({
      last: `${ch?.displayName ?? canon} · ${directClip?.clipKey ?? canonicalClip?.clipKey ?? actionName}`,
    });
  }

  useStageActionBus.setState(patch);
  ensureBusTicker();
}

export function clearCharacterActions(): void {
  if (rafId !== 0 && typeof cancelAnimationFrame !== "undefined") {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  useStageActionBus.setState({ takes: {}, gags: {}, gestures: {}, tickMs: 0 });
}

export function getActiveBusTake(castId: string, tickMs: number, takes: Readonly<Record<string, LiveTakeOverride>>): ActiveTakeState | null {
  const entry = takes[canonicalCastId(castId)];
  if (!entry) return null;
  const elapsed = (tickMs - entry.startedAtMs) / 1000;
  if (elapsed < 0 || elapsed >= entry.durationSec) return null;
  return { clipKey: entry.clipKey, elapsedSec: elapsed, durationSec: entry.durationSec };
}

export function getActiveBusGag(castId: string, tickMs: number, gags: Readonly<Record<string, LiveGagOverride>>): boolean {
  const entry = gags[canonicalCastId(castId)];
  if (!entry) return false;
  const elapsed = (tickMs - entry.startedAtMs) / 1000;
  return elapsed >= 0 && elapsed < entry.durationSec;
}

export function getActiveBusGesture(
  castId: string,
  tickMs: number,
  gestures: Readonly<Record<string, LiveGestureOverride>>,
): { gesture: GestureName | "double nod"; elapsedSec: number } | null {
  const entry = gestures[canonicalCastId(castId)];
  if (!entry) return null;
  const elapsed = (tickMs - entry.startedAtMs) / 1000;
  if (elapsed < 0 || elapsed >= entry.durationSec) return null;
  return { gesture: entry.gesture, elapsedSec: elapsed };
}
