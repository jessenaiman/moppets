import { preferPlaybackSession } from "@chimera/audio/session.ts";
import { moppet } from "../choir/cast/index.ts";
import type { AuditionScore } from "./score.ts";
import type { RenderRequest, RenderResult } from "./render.worker.ts";

export type AuditionMode = "gruff" | "vee" | "ensemble";

export function createAuditionTransport() {
  let context: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let startedAt = 0;
  let scoreZero = 0;
  let duration = 0;
  let generation = 0;
  let cancelRender: (() => void) | undefined;
  let worker: Worker | undefined;
  const cache = new Map<AuditionMode, { key: string; buffer: AudioBuffer; scoreZero: number }>();

  function stop() {
    generation++;
    cancelRender?.();
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
      source = undefined;
    }
  }

  function render(request: RenderRequest): Promise<RenderResult | null> {
    const renderer = worker ??= new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
      cancelRender = () => {
        renderer.terminate();
        worker = undefined;
        cancelRender = undefined;
        resolve(null);
      };
      renderer.onmessage = ({ data }: MessageEvent<RenderResult>) => {
        cancelRender = undefined;
        resolve(data);
      };
      renderer.onerror = (event) => {
        renderer.terminate();
        worker = undefined;
        cancelRender = undefined;
        reject(new Error(event.message || "CHIMERA could not render the chorus."));
      };
      renderer.postMessage(request);
    });
  }

  async function start(mode: AuditionMode, score: AuditionScore, onEnded: () => void) {
    stop();
    const current = generation;
    preferPlaybackSession();
    const ctx = context ??= new AudioContext({ latencyHint: "playback" });
    await ctx.resume();
    if (generation !== current) return;

    const key = JSON.stringify(score);
    let track = cache.get(mode);
    if (track?.key !== key) {
      const voices = score.parts
        .filter((part) => mode === "ensemble" || part.id === mode)
        .map((part) => {
          const voice = moppet(part.id)?.voice;
          if (!voice) throw new Error(`Missing CHIMERA voice for ${part.id}.`);
          return { part, voice };
        });
      const result = await render({ score, voices });
      if (generation !== current || !result) return;
      if ("error" in result) throw new Error(result.error);

      const buffer = ctx.createBuffer(1, result.pcm.length, result.sampleRate);
      buffer.copyToChannel(result.pcm, 0);
      track = { key, buffer, scoreZero: result.scoreZero };
      cache.set(mode, track);
    }
    const node = ctx.createBufferSource();
    node.buffer = track.buffer;
    node.connect(ctx.destination);
    node.onended = () => {
      if (source !== node) return;
      source = undefined;
      node.disconnect();
      onEnded();
    };
    source = node;
    duration = track.buffer.duration;
    scoreZero = track.scoreZero;
    startedAt = ctx.currentTime;
    node.start(startedAt);
  }

  function position() {
    if (!context || !source) return 0;
    const stamp = context.getOutputTimestamp?.();
    const audibleTime = stamp?.contextTime && stamp.performanceTime
      ? Math.min(context.currentTime, stamp.contextTime + Math.max(0, performance.now() - stamp.performanceTime) / 1000)
      : context.currentTime - (context.outputLatency || context.baseLatency);
    return Math.min(duration, Math.max(0, audibleTime - startedAt)) - scoreZero;
  }

  return { start, stop, position };
}
