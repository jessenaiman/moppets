import { create } from "zustand";

export type StageCameraPreset = "authored" | "wide" | "closeup" | "low-angle";
export type StageRigPreference = "auto-3d" | "multiplane-first";

export interface StageViewState {
  cameraMode: StageCameraPreset;
  rigPreference: StageRigPreference;
  variableStageEnabled: boolean;
  resetOrbitTick: number;
  setCameraMode: (mode: StageCameraPreset) => void;
  setRigPreference: (pref: StageRigPreference) => void;
  toggleRigPreference: () => void;
  setVariableStageEnabled: (enabled: boolean) => void;
  requestResetOrbit: () => void;
}

export const useStageView = create<StageViewState>((set) => ({
  cameraMode: "authored",
  rigPreference: "auto-3d",
  variableStageEnabled: true,
  resetOrbitTick: 0,
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setRigPreference: (rigPreference) => set({ rigPreference }),
  toggleRigPreference: () =>
    set((s) => ({ rigPreference: s.rigPreference === "auto-3d" ? "multiplane-first" : "auto-3d" })),
  setVariableStageEnabled: (variableStageEnabled) => set({ variableStageEnabled }),
  requestResetOrbit: () => set((s) => ({ resetOrbitTick: s.resetOrbitTick + 1 })),
}));
