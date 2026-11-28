import { create } from "zustand";

const STORAGE = "moppet-character-volumes-v2";
const LEGACY_STORAGE = "moppet-character-volumes-v1";
type Levels = Record<string, number>;

function readLevels(): Levels {
  try {
    try {
      localStorage.removeItem(LEGACY_STORAGE);
    } catch {
      /* ignore storage block */
    }
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    const levels: Levels = {};
    for (const [id, value] of Object.entries(saved)) {
      // Never hydrate transient 0 mutes across page reloads.
      if (typeof value === "number" && Number.isFinite(value) && value > 0.01 && value <= 1) {
        levels[id] = value;
      }
    }
    return levels;
  } catch {
    return {};
  }
}

function persistLevels(levels: Levels): void {
  try {
    const persisted: Levels = {};
    for (const [id, value] of Object.entries(levels)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0.01 && value <= 1) {
        persisted[id] = value;
      }
    }
    if (Object.keys(persisted).length === 0) {
      localStorage.removeItem(STORAGE);
    } else {
      localStorage.setItem(STORAGE, JSON.stringify(persisted));
    }
  } catch {
    /* Session still works without storage. */
  }
}

export const useVoiceLevels = create<{ levels: Levels }>(() => ({ levels: readLevels() }));
export const voiceLevel = (id: string) => useVoiceLevels.getState().levels[id] ?? 1;

export function setVoiceLevel(id: string, value: number) {
  if (!Number.isFinite(value)) return;
  const clamped = Math.max(0, Math.min(1, value));
  const next = { ...useVoiceLevels.getState().levels };
  if (Math.abs(clamped - 1) < 0.005) {
    delete next[id];
  } else {
    next[id] = clamped;
  }
  useVoiceLevels.setState({ levels: next });
  persistLevels(next);
}

export function resetVoiceLevels() {
  useVoiceLevels.setState({ levels: {} });
  try {
    localStorage.removeItem(STORAGE);
    localStorage.removeItem(LEGACY_STORAGE);
  } catch {
    /* Session still works without storage. */
  }
}

export function unmuteVoices(voiceIds: readonly string[]) {
  const cur = useVoiceLevels.getState().levels;
  let changed = false;
  const next = { ...cur };
  for (const id of voiceIds) {
    if ((next[id] ?? 1) <= 0.01) {
      delete next[id];
      changed = true;
    }
  }
  if (!changed) return;
  useVoiceLevels.setState({ levels: next });
  persistLevels(next);
}
