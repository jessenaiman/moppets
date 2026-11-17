import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Modules loaded where the wasm engine isn't (the singer and band workers, the mixer worklet, and
 * tools/choir-e2e.ts in plain bun) must not import the engine facade, which calls into the engine as
 * it loads. music.ts once gained an engine import and the choir e2e stopped running unnoticed.
 */
const ENGINE_FREE = ["src/choir/music.ts", "src/choir/band.ts", "src/choir/bandSynth.ts", "src/choir/mix.ts", "src/choir/midi.ts", "src/choir/timeline.ts", "src/choir/pluck.ts", "src/choir/captions.ts", "src/choir/singer.worker.ts", "src/worklet/mixer.ts"];
const FACADE = resolve("chimera/src/wasm/engine.ts");

/** Every module a file imports at run time (type-only imports are erased), transitively. */
function reach(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/^\s*(import|export)\s+(?!type\b)[^;]*?from\s+"((?:\.|@chimera\/)[^"]+)"/gm)) {
    if (/^\s*import\s*\{[^}]*\}/.test(m[0]) && /\{\s*(type\s+\w+\s*,?\s*)+\}/.test(m[0])) continue; // import { type A, type B }
    const spec = m[2].replace(/\?.*$/, "");
    const target = spec.startsWith("@chimera/") ? resolve("chimera/src", spec.slice("@chimera/".length)) : resolve(dirname(file), spec);
    if (/\.(ts|tsx)$/.test(target)) reach(target, seen);
  }
  return seen;
}

test("worker, worklet and tool modules never reach the engine facade", () => {
  for (const f of ENGINE_FREE) {
    const path = [...reach(resolve(f))];
    expect({ module: f, reachesEngine: path.includes(FACADE) }).toEqual({ module: f, reachesEngine: false });
  }
});

test("the check sees the engine through CHIMERA's alias (it went blind once the engine moved to chimera/)", () => {
  expect([...reach(resolve("src/choir/plan.ts"))]).toContain(FACADE);
});
