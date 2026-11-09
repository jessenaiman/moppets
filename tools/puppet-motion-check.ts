/**
 * Puppet motion check through EffectCraft: renders one Moppet's real solo (engine audio plus the
 * pose track the app animates from), keys a stand-in felt face to that same track, and has
 * EffectCraft render it with the audio, so sync can be judged by eye and measured from frames.
 * Usage: bun tools/puppet-motion-check.ts [moppetId] [outDir]   (after `bun run wasm`; needs effectcraft-cli)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { initEngine, wasmModule } from "../tests/harness.ts";

await initEngine();
const { hopFor, midiToHz, SingerCore } = await import("../src/choir/singerCore.ts");
const { makeSolo } = await import("../src/choir/music.ts");
const { planTrack, pieceSeconds } = await import("../src/choir/plan.ts");
const { CAST: voices } = await import("../src/choir/voices.ts");
const { poseFromRecord } = await import("../src/choir/pose.ts");
const { wavBytes } = await import("../src/choir/mix.ts");
const { EnglishG2P } = await import("../src/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../public/data/cmudict.txt.gz", import.meta.url))).toString());

const id = process.argv[2] ?? "vee";
const out = resolve(process.argv[3] ?? "out/effectcraft");
mkdirSync(out, { recursive: true });

const FS = 48000, FPS = 30;
const v = voices.find((x) => x.id === id)!;
const piece = makeSolo(v);
const plan = planTrack(piece.tracks[0], piece, v);
const frames = Math.ceil(pieceSeconds(piece) * FS);
const core = new SingerCore(new WebAssembly.Instance(wasmModule, {}).exports as never, { sampleRate: FS, frames, hop: hopFor(FS), voice: v, gestures: plan.gestures, firstF0: midiToHz(plan.firstMidi) });
while (core.rendered < frames) core.step();

const hop = hopFor(FS);
const seconds = frames / FS;
const track = Array.from({ length: Math.ceil(seconds * FPS) }, (_, i) => {
  const t = i / FPS;
  const rec = Math.min(Math.floor((t * FS) / hop), Math.floor(core.rendered / hop) - 1);
  const p = poseFromRecord(core.tele!, rec * core.recordSize);
  return { t, open: p.open, jaw: p.jaw, round: p.round, singing: p.singing };
});
writeFileSync(`${out}/${id}-pose.json`, JSON.stringify(track));
let peak = 0;
for (const s of core.stem) peak = Math.max(peak, Math.abs(s));
const scaled = Float32Array.from(core.stem, (s) => (s * 0.8) / peak);
writeFileSync(`${out}/${id}.wav`, Buffer.from(wavBytes(scaled, FS)));

const keys = (f: (p: (typeof track)[number]) => string) => track.map((p) => `[${p.t.toFixed(4)},${f(p)}]`).join(",");
const jsx = `
var c = app.project.items.addComp("Puppet motion check", 640, 360, 1, ${seconds.toFixed(3)}, ${FPS});
c.bgColor = [0.14, 0.2, 0.17];
function ellipse(name, w, h, x, y, color) {
  var l = c.layers.addShape();
  l.name = name;
  var g = l.property("Contents").addProperty("ADBE Vector Group");
  var e = g.property("Contents").addProperty("ADBE Vector Shape - Ellipse");
  e.property("Size").setValue([w, h]);
  var f = g.property("Contents").addProperty("ADBE Vector Graphic - Fill");
  f.property("Color").setValue(color);
  l.property("Transform").property("Position").setValue([x, y]);
  return { layer: l, size: e.property("Size"), pos: l.property("Transform").property("Position") };
}
var color = ${JSON.stringify([parseInt(v.color.slice(1, 3), 16) / 255, parseInt(v.color.slice(3, 5), 16) / 255, parseInt(v.color.slice(5, 7), 16) / 255, 1])};
var jawK = [${keys((p) => `${(320).toFixed(1)},${(232 + p.jaw * 24 + p.open * 10).toFixed(2)}`)}];
var mouthK = [${keys((p) => `${(150 * (1 - p.round * 0.35)).toFixed(2)},${(8 + p.open * 88).toFixed(2)}`)}];
var jaw = ellipse("Jaw", 196, 84, 320, 232, color);
var cave = ellipse("Mouth (engine lip aperture)", 150, 60, 320, 208, [0.18, 0.15, 0.16, 1]);
var head = ellipse("Head", 230, 150, 320, 140, color);
var eyeL = ellipse("Eye L", 44, 44, 280, 120, [0.95, 0.92, 0.83, 1]);
var eyeR = ellipse("Eye R", 44, 44, 360, 120, [0.95, 0.92, 0.83, 1]);
for (var i = 0; i < jawK.length; i++) { jaw.pos.setValueAtTime(jawK[i][0], [jawK[i][1], jawK[i][2]]); cave.size.setValueAtTime(mouthK[i][0], [mouthK[i][1], mouthK[i][2]]); }
// the five EffectCraft techniques the app's rig mirrors: parenting, spring/follow-through
// expressions, wiggle, eased blink holds, and motion blur on the fast parts
function ear(name, x) {
  var e = ellipse(name, 26, 94, x, 60, color);
  e.layer.parent = head.layer;
  e.layer.motionBlur = true;
  return e;
}
var earL = ear("Ear L (follow-through)", 262), earR = ear("Ear R (follow-through)", 378);
// spring lag: the ear's rotation chases the jaw's motion a beat behind, with decay
var followExpr = 'var v = thisComp.layer("Jaw").transform.position.velocityAtTime(time - 0.07)[1]; var damp = 0; for (var i = 0; i < 4; i++) damp += thisComp.layer("Jaw").transform.position.velocityAtTime(time - 0.07 - i * 0.05)[1] * Math.exp(-i); damp * 0.06 + wiggle(2, 2)[0] * 0';
earL.layer.property("Transform").property("Rotation").expression = followExpr;
earR.layer.property("Transform").property("Rotation").expression = followExpr.replace("* 0.06", "* -0.06");
// idle wiggle on the eyes, eased blink holds on the lid
eyeL.layer.property("Transform").property("Position").expression = "wiggle(1.5, 1.2)";
eyeR.layer.property("Transform").property("Position").expression = "wiggle(1.3, 1.2)";
var lid = ellipse("Blink", 60, 60, 280, 120, color);
var lo = lid.layer.property("Transform").property("Opacity");
for (var b = 0.8; b < ${seconds.toFixed(2)}; b += 2.6) { lo.setValueAtTime(b - 0.06, 0); lo.setValueAtTime(b, 100); lo.setValueAtTime(b + 0.1, 100); lo.setValueAtTime(b + 0.16, 0); }
c.motionBlur = true;
var wav = app.project.importFile(new ImportOptions(new File(${JSON.stringify(`${out}/${id}.wav`)})));
c.layers.add(wav);
writeLn("keys " + jawK.length);
`;
writeFileSync(`${out}/${id}.jsx`, jsx);
const proj = `${out}/${id}.ecproj`;
const run = (args: string[]) => {
  const r = Bun.spawnSync(["effectcraft-cli", ...args], { stdout: "pipe", stderr: "pipe" });
  const text = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0) throw new Error(`effectcraft-cli ${args[0]}: ${text.slice(0, 800)}`);
  return text;
};
console.log(run(["script", `${out}/${id}.jsx`, "--empty", "--save-as", proj]).trim());
console.log(run(["render", "--project", proj, "--comp", "Puppet motion check", "--out", `${out}/${id}-motion.mp4`, "--format", "h264", "--audio", "on", "--quality", "draft"]).trim().split("\n").slice(-1)[0]);
const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0", `${out}/${id}-motion.mp4`]);
console.log("ffprobe:", probe.stdout.toString().trim().replace(/\n/g, " ; "));

// measure the rendered video: does the mouth region's darkness rise and fall with the pose track?
const frameDir = `${out}/frames-${id}`;
mkdirSync(frameDir, { recursive: true });
Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-i", `${out}/${id}-motion.mp4`, "-vf", "crop=120:30:260:200,scale=8:2,format=gray", "-f", "rawvideo", `${frameDir}/mouth.gray`]);
const gray = readFileSync(`${frameDir}/mouth.gray`);
const n = Math.floor(gray.length / 16);
const dark: number[] = [];
for (let i = 0; i < n; i++) {
  let s = 0;
  for (let k = 0; k < 16; k++) s += gray[i * 16 + k];
  dark.push(255 - s / 16);
}
const m = Math.min(n, track.length);
const a = track.slice(0, m).map((p) => p.open), b = dark.slice(0, m);
const mean = (x: number[]) => x.reduce((p, c) => p + c, 0) / x.length;
const ma = mean(a), mb = mean(b);
let num = 0, da = 0, db = 0;
for (let i = 0; i < m; i++) {
  num += (a[i] - ma) * (b[i] - mb);
  da += (a[i] - ma) ** 2;
  db += (b[i] - mb) ** 2;
}
let bestLag = 0, best = -2;
for (let lag = -6; lag <= 6; lag++) {
  let nn = 0, xa = 0, xb = 0;
  for (let i = Math.max(0, -lag); i < Math.min(m, m - lag); i++) {
    nn += (a[i] - ma) * (b[i + lag] - mb);
    xa += (a[i] - ma) ** 2;
    xb += (b[i + lag] - mb) ** 2;
  }
  const r = nn / Math.sqrt(xa * xb || 1);
  if (r > best) (best = r), (bestLag = lag);
}
// a mid-song frame, for looking at
Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-ss", "1.2", "-i", `${out}/${id}-motion.mp4`, "-frames:v", "1", `${out}/${id}-frame.png`]);
console.log(JSON.stringify({ moppet: id, frames: m, poseToPixelCorrelation: +(num / Math.sqrt(da * db || 1)).toFixed(3), bestLagFrames: bestLag, bestLagCorrelation: +best.toFixed(3), mouthOpenRange: [Math.min(...a).toFixed(2), Math.max(...a).toFixed(2)] }));
