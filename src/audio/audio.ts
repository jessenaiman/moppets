/**
 * The Moppets' audio: one AudioContext at 48 kHz, a single direct master GainNode, and the choir
 * mixer's outputs wired straight through it (zero stacked EQ/reverb/compression wrappers).
 * Starting it also fetches the pronouncing dictionary.
 */
import { create } from "zustand";
import { g2p } from "./g2p.ts";
import type { StageWorldId } from "../stage/stageWorlds.ts";

export interface AppAudio {
  started: boolean;
  starting: boolean;
  error: string;
  volume: number;
  world: StageWorldId;
  start: () => Promise<void>;
  setVolume: (v: number) => void;
  setWorld: (world: StageWorldId) => void;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let recordDest: MediaStreamAudioDestinationNode | null = null;
let starting: Promise<void> | null = null;

export const useAudio = create<AppAudio>((set, get) => ({
  started: false,
  starting: false,
  error: "",
  volume: 1,
  world: "theater",
  start: () =>
    (starting ??= (async () => {
      if (ctx?.state === "running") return;
      set({ starting: true, error: "" });
      try {
        // the voices run in AudioWorklets, which browsers allow only on localhost or HTTPS
        if (!window.isSecureContext || typeof AudioWorkletNode === "undefined")
          throw new Error(`No sound here: browsers only allow the voices on localhost or HTTPS, and this page is ${location.origin}. Open it as http://localhost:${location.port || "80"}/ on this computer, or over HTTPS (for example \`tailscale serve\`) from another device.`);
        if (!ctx) {
          ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
          master = ctx.createGain();
          master.gain.value = get().volume;
          master.connect(ctx.destination);
          if (typeof ctx.createMediaStreamDestination === "function") {
            recordDest = ctx.createMediaStreamDestination();
            master.connect(recordDest);
          }
        }
        await ctx.resume();
        void g2p.load();
        set({ started: true, starting: false });
      } catch (e) {
        set({ starting: false, error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    })().finally(() => { starting = null; })),
  setVolume: (v) => {
    set({ volume: v });
    if (master && ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  },
  setWorld: (world) => {
    set({ world });
  },
}));

export const audio = {
  get ctx(): AudioContext | null {
    return ctx;
  },
  /** Shared live output stream from `master` for CHIMERA `MediaRecorder` clip capture (`recordClip.ts`). */
  recordStream(): MediaStream | null {
    return recordDest?.stream ?? null;
  },
  /** Play `mix` directly through the single master GainNode. */
  connect(mix: AudioNode): void {
    if (!master) throw new Error("audio not started");
    mix.connect(master);
  },
};
