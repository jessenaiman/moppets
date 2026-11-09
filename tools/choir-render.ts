/**
 * Renders the four listening pieces through the app's own path (planner, singer engines, shared
 * mix bus) to WAV files, with per-stem and mix measurements. Numbers do not establish musical
 * quality: the WAVs are for ears. Usage: bun tools/choir-render.ts [outDir]   (after `bun run wasm`)
 */
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { initEngine, wasmModule } from "../tests/harness.ts";
await initEngine();
const { CueCore, hopFor, midiToHz, SingerCore } = await import("../src/choir/singerCore.ts");
const { invent, makeIntroduction, makeChipSong, makeRound } = await import("../src/choir/music.ts");
const { beatSeconds, LEAD_IN, pieceSeconds, planTrack } = await import("../src/choir/plan.ts");
const { CAST: voices, MIX_LEVEL } = await import("../src/choir/voices.ts");
const { extraStems, mixStems, pieceGains, wavBytes } = await import("../src/choir/mix.ts");
const { renderPluck } = await import("../src/choir/pluck.ts");
const { beatReady, EnglishG2P, parseBeat } = await import("../src/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../public/data/cmudict.txt.gz", import.meta.url))).toString());
const out = process.argv[2] ?? "out/listen";
mkdirSync(out, { recursive: true });
const FS = 48000;
const pieces = { "1-introduction": makeIntroduction(), "2-invention-major-bossa-beatband": invent({ seed: 404, key: "D", mode: "major", progression: "doowop", groove: "bossa", palette: "beatband", soul: true }), "3-invention-dorian-funk-menagerie": invent({ seed: 88, key: "A", mode: "dorian", progression: "vamp", groove: "funk", palette: "menagerie", soul: true }), "4-jam-round": makeRound({ key: "D", bpm: 108 }), "5-chip-reads-the-manual": makeChipSong() };
const only = process.env.ONLY;
for (const [name, piece] of Object.entries(pieces)) {
  if (only && !name.includes(only)) continue;
  const t0 = performance.now();
  const frames = Math.ceil(pieceSeconds(piece) * FS);
  const stems: Float32Array[] = [];
  const rows: string[] = [];
  for (const t of piece.tracks) {
    const v = voices.find((x) => x.id === t.id)!;
    const p = planTrack(t, piece, v);
    const core = new SingerCore(new WebAssembly.Instance(wasmModule, {}).exports as never, { sampleRate: FS, frames, hop: hopFor(FS), voice: v, gestures: p.gestures, nasal: p.nasal, firstF0: midiToHz(p.firstMidi) });
    while (core.rendered < frames) core.step();
    let peak = 0, bad = 0;
    for (const s of core.stem) { if (!Number.isFinite(s)) bad++; peak = Math.max(peak, Math.abs(s)); }
    if (bad) throw new Error(`${name}/${t.id}: ${bad} invalid samples`);
    if (peak < 1e-3) throw new Error(`${name}/${t.id}: silent stem`);
    rows.push(`${t.id} ${peak.toFixed(2)}`);
    stems.push(core.stem);
    core.dispose();
  }
  if (piece.pluck) stems.push(renderPluck(piece, FS, frames));
  for (const e of extraStems(piece)) {
    const x = new WebAssembly.Instance(wasmModule, {}).exports as never;
    const core = e === "beat" ? new CueCore(x, { sampleRate: FS, frames, hop: hopFor(FS), beat: { steps: parseBeat(piece.beat!.text), bpm: piece.bpm, swing: piece.beat!.swing, startSeconds: LEAD_IN, ready: { ...beatReady({ female: 0, child: 0 }) } as Record<string, number> } }) : new CueCore(x, { sampleRate: FS, frames, hop: hopFor(FS), creature: { id: e, calls: piece.cameos!.filter((c) => c.creature === e).map((c) => ({ id: c.call, seconds: LEAD_IN + c.beat * beatSeconds(piece) })) } });
    while (core.rendered < frames) core.step();
    stems.push(core.stem);
    core.dispose();
  }
  const plan = pieceGains(piece, FS, LEAD_IN + piece.tracks.length * 20 * beatSeconds(piece), MIX_LEVEL);
  const m = mixStems(stems, plan.gains, frames, plan.section);
  writeFileSync(`${out}/${name}.wav`, Buffer.from(wavBytes(m.samples, FS)));
  console.log(`${name}: ${(frames / FS).toFixed(1)} s audio in ${((performance.now() - t0) / 1000).toFixed(1)} s · mix peak ${m.peak.toFixed(3)} · limited ${m.limited} · invalid ${m.nonFinite} · stems peak: ${rows.join(", ")}`);
}
