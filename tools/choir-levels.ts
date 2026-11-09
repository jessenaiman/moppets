/**
 * Solo level of each default Moppet, sung through the real plan: what MIX_LEVEL in
 * src/choir/voices.ts is measured from. Usage: bun tools/choir-levels.ts  (after `bun run wasm`)
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { initEngine, wasmModule } from "../tests/harness.ts";
await initEngine();
const { hopFor, midiToHz, SingerCore } = await import("../src/choir/singerCore.ts");
const { compose } = await import("../src/choir/music.ts");
const { planTrack, pieceSeconds } = await import("../src/choir/plan.ts");
const { voices } = await import("../src/choir/voices.ts");
const { EnglishG2P } = await import("../src/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../public/data/cmudict.txt.gz", import.meta.url))).toString());

const FS = 48000;
for (const seed of [404, 7]) {
  const piece = compose({ seed });
  const rows: Record<string, { peak: number; rms: number; peakGain: number }> = {};
  for (const t of piece.tracks) {
    const v = voices.find((x) => x.id === t.id)!;
    const p = planTrack(t, piece, v);
    const frames = Math.ceil(pieceSeconds(piece) * FS);
    const x = new WebAssembly.Instance(wasmModule, {}).exports as never;
    const core = new SingerCore(x, { sampleRate: FS, frames, hop: hopFor(FS), voice: v, gestures: p.gestures, firstF0: midiToHz(p.firstMidi) });
    while (core.rendered < frames) core.step();
    let peak = 0, sum = 0;
    for (const s of core.stem) (peak = Math.max(peak, Math.abs(s))), (sum += s * s);
    rows[t.id] = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / frames).toFixed(4), peakGain: +(0.68 / peak).toFixed(2) };
  }
  console.log(seed, JSON.stringify(rows));
}
