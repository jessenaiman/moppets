/**
 * The Moppets' audio: one AudioContext at 48 kHz, a master volume, and the choir mixer's outputs
 * wired through it. Starting it also fetches the pronouncing dictionary. (The engine itself is
 * loaded by main.tsx before any of the app is imported.)
 */
import { create } from "zustand";
import { g2p } from "./g2p.ts";

export interface AppAudio {
  started: boolean;
  starting: boolean;
  error: string;
  volume: number;
  start: () => Promise<void>;
  setVolume: (v: number) => void;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let starting: Promise<void> | null = null;

export const useAudio = create<AppAudio>((set, get) => ({
  started: false,
  starting: false,
  error: "",
  volume: 0.8,
  start: () =>
    (starting ??= (async () => {
      set({ starting: true, error: "" });
      try {
        // the voices run in AudioWorklets, which browsers allow only on localhost or HTTPS
        if (!window.isSecureContext || typeof AudioWorkletNode === "undefined")
          throw new Error(`No sound here: browsers only allow the voices on localhost or HTTPS, and this page is ${location.origin}. Open it as http://localhost:${location.port || "80"}/ on this computer, or over HTTPS (for example \`tailscale serve\`) from another device.`);
        ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
        master = ctx.createGain();
        master.gain.value = get().volume;
        master.connect(ctx.destination);
        await ctx.resume();
        void g2p.load();
        set({ started: true, starting: false });
      } catch (e) {
        starting = null;
        set({ starting: false, error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    })()),
  setVolume: (v) => {
    set({ volume: v });
    if (master && ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  },
}));

export const audio = {
  get ctx(): AudioContext | null {
    return ctx;
  },
  /** Play `mix` through the master volume. */
  connect(mix: AudioNode): void {
    if (!master) throw new Error("audio not started");
    mix.connect(master);
  },
};
