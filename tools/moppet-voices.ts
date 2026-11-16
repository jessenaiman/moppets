/**
 * Moppet voice judge: is every Moppet its own voice? Sings one phrase, on the same notes, through
 * each default Moppet's recipe (the real plan and singer engine), measures three things a listener
 * hears as character, and fails when two Moppets differ clearly in none of them:
 *
 *  - size     formant scale: the geometric mean of F1..F3 of this Moppet's own airway (body, size
 *             and posture) on a neutral vowel, from the engine's transfer function. A big airway
 *             sounds big at any pitch, and the sung voice follows these resonances (see
 *             crates/chimera/tests/airway_size.rs). Audio LPC was tried first and misread pressed
 *             and very low voices. Distinct at >= 12 % apart.
 *  - colour   spectral envelope, 24 log bands 80 Hz to 8 kHz, dB RMS apart (vowel posture, nasality,
 *             brightness). Distinct at >= 4 dB.
 *  - grain    periodicity (autocorrelation peak as a harmonics-to-noise ratio): clean against
 *             rough, breathy or fry. Distinct at >= 3 dB.
 *
 * Same notes for everyone, so pitch can't make two voices seem different. Also writes each
 * Moppet's phrase, and its own solo introduction, to WAVs for listening.
 *
 * Usage: bun tools/moppet-voices.ts [outdir]   (after `bun run wasm`; default out/moppet-voices)
 * Exits 1 when a pair is too close.
 */
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { initEngine, wasmModule } from "../tests/harness.ts";
import { FFT, hann } from "./lib/fft.ts";
import { writeWav } from "./lib/wav.ts";
await initEngine();
const { hopFor, midiToHz, SingerCore } = await import("../src/choir/singerCore.ts");
const { makeSolo } = await import("../src/choir/music.ts");
const { planTrack, pieceSeconds } = await import("../src/choir/plan.ts");
const { CAST } = await import("../src/choir/voices.ts");
const { EnglishG2P, airwayModel, airwayTransfer, NEUTRAL, restTip } = await import("../src/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../public/data/cmudict.txt.gz", import.meta.url))).toString());

const outDir = process.argv[2] ?? "out/moppet-voices";
mkdirSync(outDir, { recursive: true });
const FS = 48000;
export const THRESHOLDS = { size: 0.12, colour: 4, grain: 3 };

type Voice = (typeof CAST)[number];
type Piece = ReturnType<typeof makeSolo>;

function sing(v: Voice, piece: Piece, seconds: number): Float32Array {
  const track = piece.tracks[0];
  const p = planTrack(track, piece, v);
  const frames = Math.ceil(seconds * FS);
  const core = new SingerCore(new WebAssembly.Instance(wasmModule, {}).exports as never, { sampleRate: FS, frames, hop: hopFor(FS), voice: v, gestures: p.gestures, nasal: p.nasal, firstF0: midiToHz(p.firstMidi) });
  while (core.rendered < frames) core.step();
  return core.stem;
}

/**
 * The shared phrase: Vee's introduction folded into A2..D3, the same notes for every voice. Low on
 * purpose: on higher notes a giant's F1 (about 230 Hz on /i/ and /u/) sits among the harmonics,
 * LPC skips it and reports F2, and big voices measured small.
 */
function sharedPhrase(): Piece {
  const base = makeSolo(CAST[0]);
  const t = base.tracks[0];
  return { ...base, tracks: [{ ...t, events: t.events.map((e) => ({ ...e, midi: 45 + ((((e.midi - 45) % 6) + 6) % 6) })) }] };
}

const N = 4096, BANDS = 24, LO = 80, HI = 8000;
const edges = Array.from({ length: BANDS + 1 }, (_, i) => LO * Math.pow(HI / LO, i / BANDS));
const fft = new FFT(N), win = hann(N);

/** F1..F3 of the Moppet's own airway at rest on a neutral vowel, with its character posture. */
function airwayFormants(v: Voice): number[] {
  const tip = restTip(NEUTRAL.jaw, NEUTRAL.tbX, NEUTRAL.tbY);
  const m = airwayModel(v.body, FS, v.size ?? 1);
  return airwayTransfer(m, { ...NEUTRAL, ttX: tip.x, ttY: tip.y, ...v.artic }).formants.slice(0, 3);
}

interface Print {
  f1: number;
  f2: number;
  size: number;
  env: Float64Array;
  grain: number;
}

/** What the sung audio shows: spectral envelope and periodicity. */
function fingerprint(x: Float32Array): Pick<Print, "env" | "grain"> {
  const env = new Float64Array(BANDS);
  let frames = 0, grain = 0;
  for (let s = 0; s + N < x.length; s += N / 2) {
    let e = 0;
    for (let i = 0; i < N; i++) e += x[s + i] ** 2;
    if (Math.sqrt(e / N) < 0.01) continue;
    frames++;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * win[i];
    fft.transform(re, im);
    const band = new Float64Array(BANDS);
    let total = 0;
    for (let k = 1; k < N / 2; k++) {
      const f = (k * FS) / N, p = re[k] ** 2 + im[k] ** 2;
      total += p;
      if (f < LO || f >= HI) continue;
      band[Math.min(BANDS - 1, Math.floor((Math.log(f / LO) / Math.log(HI / LO)) * BANDS))] += p;
    }
    for (let b = 0; b < BANDS; b++) env[b] += 10 * Math.log10(band[b] / total + 1e-12);
    let best = 0;
    for (let lag = Math.floor(FS / 500); lag < FS / 70; lag++) {
      let c = 0, a = 0, b2 = 0;
      for (let i = 0; i < 2048; i++) (c += x[s + i] * x[s + i + lag]), (a += x[s + i] ** 2), (b2 += x[s + i + lag] ** 2);
      best = Math.max(best, c / Math.sqrt(a * b2 + 1e-12));
    }
    grain += 10 * Math.log10(best / Math.max(1e-6, 1 - best));
  }
  for (let b = 0; b < BANDS; b++) env[b] /= frames;
  return { env, grain: grain / frames };
}

const phrase = sharedPhrase();
const phraseSeconds = Math.min(7, pieceSeconds(phrase));
const prints: Record<string, Print> = {};
for (const v of CAST) {
  const x = sing(v, phrase, phraseSeconds);
  const f = airwayFormants(v);
  prints[v.id] = { ...fingerprint(x), f1: f[0], f2: f[1], size: Math.cbrt(f[0] * f[1] * f[2]) };
  writeWav(`${outDir}/${v.id}-same-notes.wav`, [x], FS);
  const own = makeSolo(v);
  writeWav(`${outDir}/${v.id}-introduction.wav`, [sing(v, own, pieceSeconds(own))], FS);
}

console.log("Moppet   size  F1    F2     grain dB   (F1, F2: its airway on a neutral vowel)");
for (const v of CAST) {
  const p = prints[v.id];
  console.log(`${v.id.padEnd(8)} ${(p.size / prints[CAST[0].id].size).toFixed(2).padStart(4)}  ${p.f1.toFixed(0).padStart(4)}  ${p.f2.toFixed(0).padStart(5)}  ${p.grain.toFixed(1).padStart(6)}`);
}
console.log("(size: resonance scale against the first Moppet; lower = bigger)\n");

const rows: { a: string; b: string; size: number; colour: number; grain: number; distinct: string[] }[] = [];
for (let i = 0; i < CAST.length; i++)
  for (let j = i + 1; j < CAST.length; j++) {
    const a = prints[CAST[i].id], b = prints[CAST[j].id];
    const size = Math.abs(Math.log(a.size / b.size));
    const colour = Math.sqrt(a.env.reduce((s, x, k) => s + (x - b.env[k]) ** 2, 0) / BANDS);
    const grain = Math.abs(a.grain - b.grain);
    const distinct = [size >= Math.log(1 + THRESHOLDS.size) && "size", colour >= THRESHOLDS.colour && "colour", grain >= THRESHOLDS.grain && "grain"].filter(Boolean) as string[];
    rows.push({ a: CAST[i].id, b: CAST[j].id, size, colour, grain, distinct });
  }
rows.sort((p, q) => p.distinct.length - q.distinct.length || p.colour - q.colour);
console.log("pair              size %  colour dB  grain dB  distinct in");
for (const r of rows) console.log(`${(r.a + "/" + r.b).padEnd(16)} ${((Math.exp(r.size) - 1) * 100).toFixed(0).padStart(7)}  ${r.colour.toFixed(1).padStart(9)}  ${r.grain.toFixed(1).padStart(8)}  ${r.distinct.join(", ") || "NOTHING"}`);
const twins = rows.filter((r) => !r.distinct.length);
writeFileSync(`${outDir}/report.json`, JSON.stringify({ thresholds: THRESHOLDS, prints: Object.fromEntries(Object.entries(prints).map(([k, p]) => [k, { f1: p.f1, f2: p.f2, grain: p.grain }])), pairs: rows }, null, 2));
console.log(`\n${twins.length ? `FAIL: ${twins.map((r) => `${r.a}/${r.b}`).join(", ")} sound alike` : "ok: every Moppet is its own voice"} · WAVs in ${outDir}`);
process.exit(twins.length ? 1 : 0);
