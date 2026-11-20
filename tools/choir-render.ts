/**
 * Renders the listening pieces through the app's own path (planner, singer engines, shared
 * mix bus) to WAV files, with per-stem and mix measurements. Numbers do not establish musical
 * quality: the WAVs are for ears. Usage: bun tools/choir-render.ts [outDir]   (after `bun run wasm`)
 */
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { bouncePart } from "./plugin-host.ts";
import { instrumentPart, scoredStemPath, partKey } from "../src/choir/pluginScore.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeWav } from "../chimera/tools/lib/wav.ts";
import { initEngine, wasmModule } from "../tests/harness.ts";
await initEngine();
const { CueCore, hopFor, midiToHz, SingerCore } = await import("../src/choir/singerCore.ts");
const { invent, makeIntroduction, makeChipSong, makeRound } = await import("../src/choir/music.ts");
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
const pieces = { "1-introduction": makeIntroduction(), "2-invention-major-bossa-beatband": invent({ seed: 404, key: "D", mode: "major", progression: "doowop", groove: "bossa", palette: "beatband", soul: true }), "3-invention-dorian-funk-menagerie": invent({ seed: 88, key: "A", mode: "dorian", progression: "vamp", groove: "funk", palette: "menagerie", soul: true }), "4-jam-round": makeRound({ key: "D", bpm: 108 }), "5-chip-reads-the-manual": makeChipSong(), ...Object.fromEntries(SONGBOOK.map((x, i) => [`${6 + i}-${x.id}`, x.make()])), ...Object.fromEntries(SKITS.map((x) => [`skit-${x.id}`, makeSkit(x)])) };
const only = process.env.ONLY;
for (const [name, piece] of Object.entries(pieces)) {
  if (only && !name.includes(only)) continue;
  const t0 = performance.now();
  const frames = Math.ceil(pieceSeconds(piece) * FS);
  const stems: Float32Array[] = [];
  const rows: string[] = [];
  for (const t of piece.tracks) {
    const v = voices.find((x) => x.id === t.id)!;
    const part=instrumentPart(piece,t,v),key=await partKey(part);
    const cached=piece.title === "Found Things" ? "public" + await scoredStemPath(piece,t,v) : `public/plugin-vocals/${key}.ogg`;
    if (piece.title === "Found Things" && !existsSync(cached)) throw Error("Run bun tools/render-found-vocals.ts first");
    const file=existsSync(cached)?cached:`${out}/${key}.wav`;
    if(!existsSync(file))await bouncePart(part,file);
    const raw=execFileSync("ffmpeg",["-v","error","-i",file,"-af","pan=mono|c0=c0","-ar",String(FS),"-f","f32le","-"],{maxBuffer:frames*4+65536});
    const stem=new Float32Array(frames);
    stem.set(new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)).subarray(0,frames));
    let peak = 0, bad = 0;
    for (const s of stem) { if (!Number.isFinite(s)) bad++; peak = Math.max(peak, Math.abs(s)); }
    if (bad) throw new Error(`${name}/${t.id}: ${bad} invalid samples`);
    if (peak < 1e-3) throw new Error(`${name}/${t.id}: silent stem`);
    rows.push(`${t.id} ${peak.toFixed(2)}`);
    stems.push(stem);
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
  const plan = pieceGains(piece, FS, LEAD_IN + piece.tracks.length * 20 * beatSeconds(piece), MIX_LEVEL);
  const m = mixStems(stems, plan.gains, frames, plan.section);
  writeWav(`${out}/${name}.wav`, [m.samples], FS);
  console.log(`${name}: ${(frames / FS).toFixed(1)} s audio in ${((performance.now() - t0) / 1000).toFixed(1)} s · mix peak ${m.peak.toFixed(3)} · limited ${m.limited} · invalid ${m.nonFinite} · stems peak: ${rows.join(", ")}`);
}
