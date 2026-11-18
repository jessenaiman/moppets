/**
 * Cut every Moppet frame out of its magenta sprite sheet with the Craft apps, headless:
 *
 *   1. PhotoCraft crops the frame (384 × 512) and makes a classical cut-out: Select Subject minus
 *      pure magenta. It keeps thin parts (horns, whiskers) but can miss or add whole regions.
 *   2. tools/moppets/prompts.py picks points deep inside that cut-out and far outside it.
 *   3. EffectCraft's Roto Brush with SAM 2.1 Tiny takes those points as foreground and background
 *      strokes and segments the whole character (one point alone often gave only a head).
 *   4. PhotoCraft loads both shapes as one selection on the raw frame (SAM's plus the classical
 *      one), subtracts pure magenta, and Refine Edge (smart radius, decontaminate) gives the fur a
 *      soft edge without the pink tint.
 *
 *   in:  out/moppet-art/sheets/<id>-{closed,open}.png, out/moppet-art/sheets/solo/{body,head}.png
 *   out: out/moppet-iso/final/<sheet>-<frame>.png (384 × 512, frame-aligned); raw/, cls/, sam/, work/ beside it
 *
 * Needs SAM 2.1 Tiny installed in EffectCraft (roto.model.install), and uv for prompts.py. Usage:
 *   bun tools/moppets/isolate.ts [sheet ...]      e.g. gruff-closed vee-body (default: all)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve("out/moppet-art/sheets");
const OUT = resolve("out/moppet-iso");
const CAST = ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"];
const ALL: Record<string, string> = {};
for (const m of CAST) for (const s of ["closed", "open"]) ALL[`${m}-${s}`] = `${SRC}/${m}-${s}.png`;
ALL["vee-body"] = `${SRC}/solo/body.png`;
ALL["vee-head"] = `${SRC}/solo/head.png`;
const W = 384, H = 512;
const NO_MAGENTA = ["--cmd", "select.colorRange", "--params", JSON.stringify({ color: "#ff00ff", fuzziness: 25, sampleAllLayers: false, mode: "subtract" })];

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")}…: ${(r.stderr || r.stdout).slice(-600)}`);
  return r.stdout;
}

for (const dir of ["raw", "cls", "sam", "work", "final"]) mkdirSync(`${OUT}/${dir}`, { recursive: true });
const sheets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ALL);
for (const sheet of sheets) {
  for (let i = 0; i < 8; i++) {
    const name = `${sheet}-${i}`, x = (i % 4) * W, y = Math.floor(i / 4) * H;
    const raw = `${OUT}/raw/${name}.png`, cls = `${OUT}/cls/${name}-cls.png`, sam = `${OUT}/sam/${name}-sam.png`, proj = `${OUT}/work/${name}.ecproj`;
    const t0 = performance.now();
    // 1. the frame, and its classical cut-out
    sh("photocraft-cli", ["run", ALL[sheet], "--cmd", "image.crop", "--params", JSON.stringify({ x, y, width: W, height: H }), "--out", raw]);
    sh("photocraft-cli", ["run", raw, "--cmd", "select.subject", ...NO_MAGENTA, "--cmd", "select.refineEdge", "--params", JSON.stringify({ output: "layerMask" }), "--out", cls]);
    // 2. prompts from it
    const p = JSON.parse(sh("uv", ["run", "-q", "--no-project", "--with", "pillow", "--with", "numpy", "--with", "scipy", "python", "tools/moppets/prompts.py", cls])) as { fg: number[][]; bg: number[][] };
    // 3. Roto Brush with SAM, in one run (the model choice doesn't outlive a run), frozen for the render
    const steps = [
      "roto.model.select", JSON.stringify({ id: "sam2.1-hiera-tiny", wait: true }),
      "file.import", JSON.stringify({ paths: [raw] }),
      "comp.new", JSON.stringify({ name: "iso", width: W, height: H, frameRate: 24, duration: 2 / 24 }),
      "layer.addItem", JSON.stringify({ item: `${name}.png`, position: [W / 2, H / 2] }),
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
    // 4. both shapes as the selection on the raw frame, refined
    const pcraft = `${OUT}/work/${name}.pcraft`;
    const place = (path: string) => ["--cmd", "file.placeEmbedded", "--params", JSON.stringify({ path, scale: 100, fit: false, smartObject: false, center: [W / 2, H / 2] })];
    const load = (layer: string, operation: string) => ["--cmd", "select.loadSelection", "--params", JSON.stringify({ channel: "transparency", layer: { name: layer }, operation })];
    const drop = (layer: string) => ["--cmd", "layer.delete", "--params", JSON.stringify({ layer: { name: layer } })];
    sh("photocraft-cli", ["run", raw, ...place(sam), ...place(cls), ...load(`${name}-sam`, "new"), ...load(`${name}-cls`, "add"), ...drop(`${name}-sam`), ...drop(`${name}-cls`),
      "--cmd", "layer.select", "--params", JSON.stringify({ name: "Background" }), ...NO_MAGENTA,
      "--cmd", "select.refineEdge", "--params", JSON.stringify({ smartRadius: true, radius: 4, decontaminate: true, amount: 100, output: "newLayerWithMask" }),
      "--cmd", "layer.layerMask.apply", "--out", pcraft]);
    sh("photocraft-cli", ["convert", pcraft, `${OUT}/final/${name}.png`]);
    console.log(`${name}: ${p.fg.length} fg / ${p.bg.length} bg points, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
}
console.log(`done: ${OUT}/final`);
