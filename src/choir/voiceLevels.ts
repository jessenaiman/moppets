import { create } from "zustand";

const STORAGE = "moppet-character-volumes-v1";
type Levels = Record<string, number>;
function readLevels(): Levels {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    const levels: Levels = {};
    for (const [id, value] of Object.entries(saved)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) levels[id] = value;
    }
    return levels;
  } catch { return {}; }
}

export const useVoiceLevels = create<{levels: Levels}>(() => ({ levels: readLevels() }));
export const voiceLevel = (id: string) => useVoiceLevels.getState().levels[id] ?? 1;

export function setVoiceLevel(id: string, value: number) {
  if (!Number.isFinite(value)) return;
  const levels = {...useVoiceLevels.getState().levels, [id]: Math.max(0, Math.min(1, value))};
  useVoiceLevels.setState({levels});
  try { localStorage.setItem(STORAGE, JSON.stringify(levels)); } catch { /* Session still works without storage. */ }
}
