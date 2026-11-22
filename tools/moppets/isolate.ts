/**
 * Cut Moppets out of their backgrounds with the Craft apps, headless:
 *
 *   1. PhotoCraft crops the frame and makes a classical cut-out: Select Subject minus the background
 *      colour. It keeps thin parts (horns, whiskers) but can miss or add whole regions.
 *   2. tools/moppets/prompts.py picks points deep inside that cut-out and far outside it.
 *   3. EffectCraft's Roto Brush with SAM 2.1 Tiny takes those points as foreground and background
 *      strokes and segments the whole character (one point alone often gave only a head).
 *   4. PhotoCraft loads both shapes as one selection on the raw frame (SAM's plus the classical
 *      one), subtracts the background colour, and Refine Edge (smart radius, decontaminate) gives
 *      the fur a soft edge without the background's tint.
 *
 * Sheets (default): out/moppet-art/sheets/<id>-{closed,open}.png and solo/{body,head}.png, 8 frames
 * of 384 × 512 on magenta each → out/moppet-iso/final/<sheet>-<frame>.png, frame-aligned.
 * Images (--images DIR): every PNG in DIR whole, any size, on --bg (default chroma blue #0047bb)
 * → out/moppet-iso/final/<name>.png.
 * raw/, cls/, sam/ and work/ beside final/ keep each step.
 *
 * Needs SAM 2.1 Tiny installed in EffectCraft (roto.model.install), and uv for prompts.py. Usage:
 *   bun tools/moppets/isolate.ts [sheet ...]                  e.g. gruff-closed vee-body (default: all)
 *   bun tools/moppets/isolate.ts --images DIR [--bg #rrggbb]  single drawings
 *   --refine: redo only step 4 from the saved raw, classical and SAM cut-outs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const SRC = resolve("out/moppet-art/sheets");
const OUT = resolve("out/moppet-iso");
const CAST = ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"];
const SHEETS: Record<string, string> = {};
for (const m of CAST) for (const s of ["closed", "open"]) SHEETS[`${m}-${s}`] = `${SRC}/${m}-${s}.png`;
SHEETS["vee-body"] = `${SRC}/solo/body.png`;
SHEETS["vee-head"] = `${SRC}/solo/head.png`;

const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const imagesDir = opt("--images");
const bg = (opt("--bg") ?? (imagesDir ? "#0047bb" : "#ff00ff")).toLowerCase();
const refineOnly = argv.includes("--refine");
const named = argv.filter((a) => !a.startsWith("--"));

/** step 1: only the background's own colour, narrowly */
const NO_BG = ["--cmd", "select.colorRange", "--params", JSON.stringify({ color: bg, fuzziness: 25, sampleAllLayers: false, mode: "subtract" })];
/**
 * The last cut: background seen through small gaps (between an arm and the body) is blended and
 * shaded, so the pure colour at 25 leaves a haze. On magenta, Moppets with no purple or pink felt
 * drop several shades of it; the others drop pure magenta more widely, which keeps their felt
 * (several shades turned Gruff's fur and Tabby's knee patch see-through: Gruff lost 14 % of his
 * solid px). Any other background: the pure colour, widely.
 */
const PURPLE_FELT = new Set(["scribe", "gruff", "tabby", "chip"]);
const finalKey = (name: string) => ["--cmd", "select.colorRange", "--params", JSON.stringify(bg === "#ff00ff" && !PURPLE_FELT.has(name.split("-")[0])
  ? { colors: ["#ff00ff", "#d000d0", "#a000a0", "#700070"], fuzziness: 60, sampleAllLayers: false, mode: "subtract" }
  : { color: bg, fuzziness: bg === "#ff00ff" ? 80 : 60, sampleAllLayers: false, mode: "subtract" })];

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")}…: ${(r.stderr || r.stdout).slice(-600)}`);
  return r.stdout;
}
/** a PNG's size, from its header */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

interface Frame { name: string; src: string; x: number; y: number; w: number; h: number }
const frames: Frame[] = [];
if (imagesDir) {
  for (const f of readdirSync(imagesDir).filter((f) => f.endsWith(".png")).sort()) {
    const name = basename(f, ".png");
    if (named.length && !named.includes(name)) continue;
    const [w, h] = pngSize(`${imagesDir}/${f}`);
    frames.push({ name, src: resolve(imagesDir, f), x: 0, y: 0, w, h });
  }
} else {
  for (const sheet of named.length ? named : Object.keys(SHEETS))
    for (let i = 0; i < 8; i++) frames.push({ name: `${sheet}-${i}`, src: SHEETS[sheet], x: (i % 4) * 384, y: Math.floor(i / 4) * 512, w: 384, h: 512 });
}

for (const dir of ["raw", "cls", "sam", "work", "final"]) mkdirSync(`${OUT}/${dir}`, { recursive: true });
for (const f of frames) {
  const t0 = performance.now();
  if (!refineOnly) cut(f);
  refine(f);
  console.log(`${f.name}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
console.log(`done: ${OUT}/final`);

function paths(name: string) {
  return { raw: `${OUT}/raw/${name}.png`, cls: `${OUT}/cls/${name}-cls.png`, sam: `${OUT}/sam/${name}-sam.png`, proj: `${OUT}/work/${name}.ecproj` };
}

function cut({ name, src, x, y, w, h }: Frame) {
  const { raw, cls, sam, proj } = paths(name);
  // 1. the frame, and its classical cut-out
  sh("photocraft-cli", ["run", src, "--cmd", "image.crop", "--params", JSON.stringify({ x, y, width: w, height: h }), "--out", raw]);
  sh("photocraft-cli", ["run", raw, "--cmd", "select.subject", ...NO_BG, "--cmd", "select.refineEdge", "--params", JSON.stringify({ output: "layerMask" }), "--out", cls]);
  // 2. prompts from it
  const p = JSON.parse(sh("uv", ["run", "-q", "--no-project", "--with", "pillow", "--with", "numpy", "--with", "scipy", "python", "tools/moppets/prompts.py", cls])) as { fg: number[][]; bg: number[][] };
  // 3. Roto Brush with SAM, in one run (the model choice doesn't outlive a run), frozen for the render
  const steps = [
    "roto.model.select", JSON.stringify({ id: "sam2.1-hiera-tiny", wait: true }),
    "file.import", JSON.stringify({ paths: [raw] }),
    "comp.new", JSON.stringify({ name: "iso", width: w, height: h, frameRate: 24, duration: 2 / 24 }),
    "layer.addItem", JSON.stringify({ item: `${name}.png`, position: [w / 2, h / 2] }),
    ...p.fg.flatMap(([px, py]) => ["roto.stroke", JSON.stringify({ layer: "#1", kind: "fg", points: [[px, py], [px + 1, py + 1]], radius: 4, frame: 0 })]),
    ...p.bg.flatMap(([px, py]) => ["roto.stroke", JSON.stringify({ layer: "#1", kind: "bg", points: [[px, py], [px + 1, py + 1]], radius: 4, frame: 0 })]),
    "roto.propagate", JSON.stringify({ layer: "#1", wait: true }),
    "roto.freeze", JSON.stringify({ layer: "#1", wait: true }),
  ];
  const argsFile = `${OUT}/work/${name}.args`;
  writeFileSync(argsFile, steps.join("\n") + "\n");
  rmSync(proj, { force: true });
  sh("effectcraft-cli", ["--empty", "run", "--args-file", argsFile, "--save-as", proj]);
  sh("effectcraft-cli", ["--project", proj, "render-frame", "--comp", "iso", "--frame", "0", "--transparent", "--out", sam]);
}

function refine({ name, w, h }: Frame) {
  const { raw, cls, sam } = paths(name);
  // 4. both shapes as the selection on the raw frame, refined; nothing within 3 px of the frame's
  // edge is kept (some source frames have a drawn border line)
  const pcraft = `${OUT}/work/${name}.pcraft`;
  const place = (path: string) => ["--cmd", "file.placeEmbedded", "--params", JSON.stringify({ path, scale: 100, fit: false, smartObject: false, center: [w / 2, h / 2] })];
  const load = (layer: string, operation: string) => ["--cmd", "select.loadSelection", "--params", JSON.stringify({ channel: "transparency", layer: { name: layer }, operation })];
  const drop = (layer: string) => ["--cmd", "layer.delete", "--params", JSON.stringify({ layer: { name: layer } })];
  const clearBorder = ["--cmd", "select.rect", "--params", JSON.stringify({ x: 3, y: 3, width: w - 6, height: h - 6, antiAlias: false }), "--cmd", "select.inverse", "--cmd", "edit.clear"];
  sh("photocraft-cli", ["run", raw, ...place(sam), ...place(cls), ...load(`${name}-sam`, "new"), ...load(`${name}-cls`, "add"), ...drop(`${name}-sam`), ...drop(`${name}-cls`),
    "--cmd", "layer.select", "--params", JSON.stringify({ name: "Background" }), ...finalKey(name),
    "--cmd", "select.refineEdge", "--params", JSON.stringify({ smartRadius: true, radius: 4, decontaminate: true, amount: 100, output: "newLayerWithMask" }),
    "--cmd", "layer.layerMask.apply", ...clearBorder, "--out", pcraft]);
  sh("photocraft-cli", ["convert", pcraft, `${OUT}/final/${name}.png`]);
}
