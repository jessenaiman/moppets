/**
 * Moppet clarity judge (the deciding judge of the voice tuning, docs/voice-tuning/README.md): can
 * Whisper understand each Moppet? Every Moppet speaks CHIMERA's judge sentences
 * (chimera/tools/asr/sentences.tsv: 20 training, 20 held out) in its own voice, through the same
 * planner and engine a skit uses; tools/moppet_clarity.py transcribes them with CHIMERA's Whisper
 * settings and scores word errors, per Moppet.
 *
 * Usage: bun tools/moppet-clarity.ts <outdir> [--against <earlier>/clarity.json] [--only <id>]
 *   (after `bun run wasm`; Whisper set up once with chimera/tools/asr/setup.sh)
 * Writes <outdir>/<id>/<n>.wav, <outdir>/jobs.json and <outdir>/clarity.json.
 */
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { initEngine, wasmModule } from "./wasm-harness.ts";
import { writeWav } from "../chimera/tools/lib/wav.ts";

await initEngine();
const { hopFor, midiToHz, SingerCore } = await import("../src/choir/singerCore.ts");
const { makeSkit } = await import("../src/choir/skits.ts");
const { planTrack, pieceSeconds } = await import("../src/choir/plan.ts");
const { CAST } = await import("../src/choir/voices.ts");
const { DEFAULT_SOURCE, EnglishG2P, NEUTRAL } = await import("@chimera/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../public/data/cmudict.txt.gz", import.meta.url))).toString());

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const outDir = process.argv[2];
if (!outDir || outDir.startsWith("--")) throw new Error("usage: bun tools/moppet-clarity.ts <outdir> [--against <earlier>/clarity.json] [--only <id>]");
const only = arg("only");
const FS = 48000;

const sentences = readFileSync(new URL("../chimera/tools/asr/sentences.tsv", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => l.split("\t"))
  .map(([kind, text, set]) => ({ kind, text, set }));

/**
 * The control: CHIMERA's own adult male with no character recipe, spoken the same way. When it
 * scores badly too, the trouble is how skits speak, not the Moppet.
 */
const PLAIN: (typeof CAST)[number] = {
  id: "plain",
  name: "Plain",
  role: "CHIMERA's adult male, no character",
  color: "#888",
  body: { female: 0, child: 0 },
  artic: { larynx: NEUTRAL.larynx, velum: NEUTRAL.velum, root: NEUTRAL.root, epilarynx: NEUTRAL.epilarynx, ventricular: NEUTRAL.ventricular },
  source: { tension: DEFAULT_SOURCE.tension, breathiness: DEFAULT_SOURCE.breathiness, roughness: DEFAULT_SOURCE.roughness, brightness: DEFAULT_SOURCE.brightness, pressure: DEFAULT_SOURCE.pressure, glide: DEFAULT_SOURCE.glide, drift: DEFAULT_SOURCE.drift },
  vibrato: 0,
  register: [44, 60],
  octave: -12,
  level: 1,
  lyrics: [],
};
const VOICES = [PLAIN, ...CAST];

/** One Moppet saying one sentence, as a one-line skit (its speaking pitch and pace). */
function speak(v: (typeof CAST)[number], text: string): Float32Array {
  const piece = makeSkit({ id: "clarity", title: "clarity", description: "", scenes: [[{ who: v.id, say: text }]] }, VOICES);
  const track = piece.tracks.find((t) => t.id === v.id)!;
  const p = planTrack(track, piece, v);
  const frames = Math.ceil(pieceSeconds(piece) * FS);
  const core = new SingerCore(new WebAssembly.Instance(wasmModule, {}).exports as never, { sampleRate: FS, frames, hop: hopFor(FS), voice: v, gestures: p.gestures, firstF0: midiToHz(p.firstMidi) });
  while (core.rendered < frames) core.step();
  return core.stem;
}

const jobs: { id: string; set: string; kind: string; text: string; wav: string }[] = [];
for (const v of VOICES) {
  if (only && v.id !== only) continue;
  mkdirSync(`${outDir}/${v.id}`, { recursive: true });
  const t0 = performance.now();
  sentences.forEach((s, n) => {
    const wav = `${outDir}/${v.id}/${String(n).padStart(2, "0")}.wav`;
    writeWav(wav, [speak(v, s.text)], FS);
    jobs.push({ id: v.id, ...s, wav });
  });
  console.log(`${v.name}: ${sentences.length} sentences rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
writeFileSync(`${outDir}/jobs.json`, JSON.stringify(jobs, null, 1));

const py = `${homedir()}/.cache/chimera-asr/.venv/bin/python`;
const against = arg("against");
const r = Bun.spawnSync([py, new URL("./moppet_clarity.py", import.meta.url).pathname, outDir, ...(against ? ["--against", against] : [])], { stdout: "inherit", stderr: "inherit" });
process.exit(r.exitCode ?? 1);
