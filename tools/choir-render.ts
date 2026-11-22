/**
 * Renders the listening pieces through the app's own path (planner, singer engines, shared
 * mix bus) to WAV files, with per-stem and mix measurements. Numbers do not establish musical
 * quality: the WAVs are for ears. Usage: bun tools/choir-render.ts [outDir]   (after `bun run wasm`)
 */
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeWav } from "../chimera/tools/lib/wav.ts";
import { initEngine, wasmModule } from "./wasm-harness.ts";
await initEngine();
const { CueCore, hopFor, midiToHz, SingerCore } = await import("../src/choir/singerCore.ts");
const { invent, makeIntroduction, makeChipSong, makeTabbySong, makeGruffShanty, makeRound } = await import("../src/choir/music.ts");
const { SONGBOOK } = await import("../src/choir/songbook.ts");
const { makeSkit, SKITS } = await import("../src/choir/skits.ts");
const { beatSeconds, LEAD_IN, pieceSeconds, planTrack } = await import("../src/choir/plan.ts");
const { CAST: voices, MIX_LEVEL } = await import("../src/choir/voices.ts");
const { extraStems, mixStems, pieceGains } = await import("../src/choir/mix.ts");
const { renderAccompaniment } = await import("../src/choir/bandSynth.ts");
const { beatReady, EnglishG2P, parseBeat } = await import("@chimera/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../public/data/cmudict.txt.gz", import.meta.url))).toString());
const out = process.argv[2] ?? "out/listen";
mkdirSync(out, { recursive: true });
const FS = 48000;
const pieces = { "1-introduction": makeIntroduction(), "2-invention-major-bossa-beatband": invent({ seed: 404, key: "D", mode: "major", progression: "doowop", groove: "bossa", palette: "beatband", soul: true }), "3-invention-dorian-funk-menagerie": invent({ seed: 88, key: "A", mode: "dorian", progression: "vamp", groove: "funk", palette: "menagerie", soul: true }), "4-jam-round": makeRound({ key: "D", bpm: 108 }), "5-chip-reads-the-manual": makeChipSong(), "legacy-tabby": makeTabbySong(), "legacy-gruff": makeGruffShanty(), ...Object.fromEntries(SONGBOOK.filter(x => !["chip", "tabby", "gruff", "intro"].includes(x.id)).map((x, i) => [`${6 + i}-${x.id}`, x.make()])), ...Object.fromEntries(SKITS.map((x) => [`skit-${x.id}`, makeSkit(x)])) };
const only = process.env.ONLY;
for (const [name, piece] of Object.entries(pieces)) {
  const outputName = piece.title === "Found Things" ? "13-found" : name;
  if (only && !name.includes(only) && outputName !== only) continue;
  const t0 = performance.now();
  const frames = Math.ceil(pieceSeconds(piece) * FS);
  const stems: Float32Array[] = [];
  const rows: string[] = [];
  for (const track of piece.tracks) {
    if (!track.events.length) {
      stems.push(new Float32Array(frames));
      rows.push(`${track.id} 0.00`);
      continue;
    }
    const voice = voices.find((v) => v.id === track.id)!;
    const plan = planTrack(track, piece, voice);
    const core = new SingerCore(new WebAssembly.Instance(wasmModule).exports as never, {
      sampleRate: FS, frames, hop: hopFor(FS), voice,
      gestures: plan.gestures, firstF0: midiToHz(plan.firstMidi),
    });
    try {
      while (core.rendered < frames) core.step();
    } finally {
      core.dispose();
    }
    const stem = core.stem;
    let peak = 0, bad = 0;
    for (const s of stem) { if (!Number.isFinite(s)) bad++; peak = Math.max(peak, Math.abs(s)); }
    if (bad) throw new Error(`${name}/${track.id}: ${bad} invalid samples`);
    if (peak < 1e-3) throw new Error(`${name}/${track.id}: silent stem`);
    rows.push(`${track.id} ${peak.toFixed(2)}`);
    stems.push(stem);
  }
  if (piece.title === "Found Things") {
    // Align cue sample zero with the WAV, including the instrumental intro.
    const fps = 30, window = FS / fps;
    const envelopes = Object.fromEntries(piece.tracks.map((track, index) => {
      const samples = stems[index];
      const levels = Array.from({length: Math.ceil(frames / window)}, (_, frame) => {
        const start = frame * window, end = Math.min(start + window, frames);
        let energy = 0;
        for (let i = start; i < end; i++) energy += samples[i] * samples[i];
        return Math.round(10000 * Math.sqrt(energy / (end - start))) / 10000;
      });
      return [track.id, levels];
    }));
    writeFileSync(`${out}/found-timing.json`, JSON.stringify({framesPerSecond: fps, envelopes}) + "\n");
  }
  const backing = renderAccompaniment(piece, FS, frames);
  if (backing) stems.push(backing);
  for (const e of extraStems(piece)) {
    const x = new WebAssembly.Instance(wasmModule, {}).exports as never;
    const core = e === "beat" ? new CueCore(x, { sampleRate: FS, frames, hop: hopFor(FS), beat: { steps: parseBeat(piece.beat!.text), bpm: piece.bpm, swing: piece.beat!.swing, startSeconds: LEAD_IN, ready: { ...beatReady({ female: 0, child: 0 }) } as Record<string, number> } }) : new CueCore(x, { sampleRate: FS, frames, hop: hopFor(FS), creature: { id: e, calls: piece.cameos!.filter((c) => c.creature === e).map((c) => ({ id: c.call, seconds: LEAD_IN + c.beat * beatSeconds(piece) })) } });
    while (core.rendered < frames) core.step();
    stems.push(core.stem);
    core.dispose();
  }
  const m = mixStems(stems, pieceGains(piece, MIX_LEVEL), frames);
  writeWav(`${out}/${outputName}.wav`, [m.samples, m.samples], FS);
  console.log(`${outputName}: ${(frames / FS).toFixed(1)} s audio in ${((performance.now() - t0) / 1000).toFixed(1)} s · mix peak ${m.peak.toFixed(3)} · invalid ${m.nonFinite} · stems peak: ${rows.join(", ")}`);
}
