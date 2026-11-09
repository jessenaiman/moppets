/**
 * Measures, on this device: (a) one singer's cost and six on one thread (what one AudioWorklet
 * would have to carry), and (b) six singers in six Workers at once (the host the choir uses).
 */
import { chimeraModule } from "../wasm/chimera.ts";
import { compose } from "./music.ts";
import { planTrack } from "./plan.ts";
import { voices } from "./voices.ts";
import { hopFor, midiToHz, SingerCore, type EngineExports, type SingerConfig } from "./singerCore.ts";

const SECONDS = 6, FS = 48000;

function configs(): SingerConfig[] {
  const piece = compose({ seed: 404 });
  return piece.tracks.map((t) => {
    const v = voices.find((x) => x.id === t.id)!;
    const plan = planTrack(t, piece, v);
    return { sampleRate: FS, frames: FS * SECONDS, hop: hopFor(FS), voice: v, gestures: plan.gestures, nasal: plan.nasal, firstF0: midiToHz(plan.firstMidi) };
  });
}

/** Render one config on the calling thread, return seconds of CPU per second of audio. */
function renderOne(cfg: SingerConfig): number {
  const x = new WebAssembly.Instance(chimeraModule(), {}).exports as unknown as EngineExports;
  const core = new SingerCore(x, cfg);
  // the engine JIT warms up over the first second; measure the settled part
  while (core.rendered < FS) core.step();
  const t0 = performance.now();
  while (core.rendered < cfg.frames) core.step();
  const rtf = (performance.now() - t0) / 1000 / (SECONDS - 1);
  core.dispose();
  return rtf;
}

export async function benchChoir(): Promise<Record<string, unknown>> {
  const cfgs = configs();
  const single: Record<string, number> = {};
  let sum = 0;
  for (const c of cfgs) {
    const r = renderOne(c);
    single[c.voice.id] = +r.toFixed(3);
    sum += r;
  }
  const workers = cfgs.map((c) => {
    const w = new Worker(new URL("./bench.worker.ts", import.meta.url), { type: "module" });
    w.postMessage({ module: chimeraModule(), cfg: c, seconds: SECONDS, fs: FS });
    return w;
  });
  await Promise.all(workers.map((w) => new Promise<void>((r) => (w.onmessage = () => r()))));
  const t0 = performance.now();
  const results = await Promise.all(workers.map((w) => new Promise<number>((r) => {
    w.onmessage = (e: MessageEvent<number>) => r(e.data);
    w.postMessage("go");
  })));
  const wall = (performance.now() - t0) / 1000 / (SECONDS - 1);
  workers.forEach((w) => w.terminate());
  return {
    cores: navigator.hardwareConcurrency,
    singleThreadRtfPerVoice: single,
    sixOnOneThreadRtf: +sum.toFixed(3),
    sixInWorkersPerVoiceRtf: results.map((r, i) => [cfgs[i].voice.id, +r.toFixed(3)]),
    sixInWorkersWallRtf: +wall.toFixed(3),
  };
}
