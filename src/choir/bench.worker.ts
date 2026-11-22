/** One voice of the choir benchmark (src/choir/bench.ts). */
import { SingerCore, type EngineExports, type SingerConfig } from "./singerCore.ts";

self.onmessage = (e: MessageEvent<{ module: WebAssembly.Module; cfg: SingerConfig; seconds: number; fs: number }>) => {
  const { module, cfg, seconds, fs } = e.data;
  const x = new WebAssembly.Instance(module, {}).exports as unknown as EngineExports;
  const core = new SingerCore(x, cfg);
  while (core.rendered < fs) core.step();
  (self as unknown as { postMessage(v: unknown): void }).postMessage("warm");
  self.onmessage = () => {
    const t0 = performance.now();
    while (core.rendered < cfg.frames) core.step();
    (self as unknown as { postMessage(v: unknown): void }).postMessage((performance.now() - t0) / 1000 / (seconds - 1));
  };
};
