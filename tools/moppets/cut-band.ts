/**
 * Cut out the Studio 404 band puppet images (`out/band-art/*.png`) using the live Craft pipeline:
 *   1. Launches a dedicated EffectCraft window with `--control <port>`.
 *   2. Drives it live via `effectcraft-cli --bridge <port>` with SAM 2.1 Tiny (`roto.model.select`,
 *      `roto.stroke` dots from `tools/moppets/prompts.py`, `roto.propagate`, `roto.freeze`,
 *      `render-frame --transparent`).
 *   3. Refines edges with `photocraft-cli` (`select.refineEdge` smartRadius + decontaminate) and
 *      writes both `out/band-iso/final/<name>.png` and `public/moppets/band/<name>.webp`.
 *   4. Closes the exact EffectCraft window cleanly via `app.quit` (`force: true`) and verifies exit.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const PORT = Number(process.env.EFFECTCRAFT_PORT || 9884);
const SRC = resolve("out/band-art");
const OUT = resolve("out/band-iso");
const PUB = resolve("public/moppets/band");
const BG = "#0047bb";

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 4).join(" ")}…: ${(r.stderr || r.stdout).slice(-600)}`);
  return r.stdout;
}

function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

async function waitBridge(port: number, timeoutMs = 20000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = spawnSync("effectcraft-cli", ["--bridge", String(port), "info"], { encoding: "utf8" });
    if (r.status === 0) return;
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`EffectCraft --control ${port} did not become ready within ${timeoutMs}ms`);
}

async function quitBridge(port: number, pid: number): Promise<void> {
  spawnSync("effectcraft-cli", ["--bridge", String(port), "exec", "app.quit", "--params", JSON.stringify({ force: true })], { encoding: "utf8" });
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already exited
  }
}

async function main(): Promise<void> {
  if (!existsSync(SRC)) throw new Error(`Missing source dir: ${SRC}`);
  const files = readdirSync(SRC).filter((f) => f.endsWith(".png")).sort();
  if (!files.length) throw new Error(`No PNGs in ${SRC}`);

  for (const dir of ["raw", "cls", "sam", "work", "final"]) mkdirSync(`${OUT}/${dir}`, { recursive: true });
  mkdirSync(PUB, { recursive: true });

  console.log(`Launching live EffectCraft (--control ${PORT})…`);
  const ec = spawn("effectcraft", ["--control", String(PORT)], { stdio: "ignore", detached: false });
  if (!ec.pid) throw new Error("Failed to spawn effectcraft");

  try {
    await waitBridge(PORT);
    console.log(`EffectCraft bridge ready on port ${PORT} (pid ${ec.pid})`);

    // Select SAM 2.1 Tiny once on the live bridge
    sh("effectcraft-cli", ["--bridge", String(PORT), "exec", "roto.model.select", "--params", JSON.stringify({ id: "sam2.1-hiera-tiny", wait: true })]);

    for (const file of files) {
      const name = basename(file, ".png");
      const src = resolve(SRC, file);
      const [w, h] = pngSize(src);
      const raw = `${OUT}/raw/${name}.png`;
      const cls = `${OUT}/cls/${name}-cls.png`;
      const sam = `${OUT}/sam/${name}-sam.png`;
      const pcraft = `${OUT}/work/${name}.pcraft`;
      const finalPng = `${OUT}/final/${name}.png`;
      const finalWebp = `${PUB}/${name}.webp`;
      const t0 = performance.now();

      // 1. Copy raw + classical cutout for prompt generation
      sh("photocraft-cli", ["run", src, "--cmd", "image.crop", "--params", JSON.stringify({ x: 0, y: 0, width: w, height: h }), "--out", raw]);
      sh("photocraft-cli", [
        "run", raw,
        "--cmd", "select.subject",
        "--cmd", "select.colorRange", "--params", JSON.stringify({ color: BG, fuzziness: 25, sampleAllLayers: false, mode: "subtract" }),
        "--cmd", "select.refineEdge", "--params", JSON.stringify({ output: "layerMask" }),
        "--out", cls,
      ]);

      // 2. Prompt dots from classical mask
      const p = JSON.parse(sh("uv", ["run", "-q", "--no-project", "--with", "pillow", "--with", "numpy", "--with", "scipy", "python", "tools/moppets/prompts.py", cls])) as { fg: number[][]; bg: number[][] };

      // 3. Drive live EffectCraft --control window via --bridge with SAM 2.1 Tiny
      const compName = `cut-${name}`;
      const steps = [
        "roto.model.select", JSON.stringify({ id: "sam2.1-hiera-tiny", wait: true }),
        "file.import", JSON.stringify({ paths: [raw] }),
        "comp.new", JSON.stringify({ name: compName, width: w, height: h, frameRate: 24, duration: 2 / 24, open: true }),
        "layer.addItem", JSON.stringify({ item: `${name}.png`, position: [w / 2, h / 2] }),
        ...p.fg.flatMap(([px, py]) => ["roto.stroke", JSON.stringify({ layer: "#1", kind: "fg", points: [[px, py], [px + 2, py + 2]], radius: 5, frame: 0 })]),
        ...p.bg.flatMap(([px, py]) => ["roto.stroke", JSON.stringify({ layer: "#1", kind: "bg", points: [[px, py], [px + 2, py + 2]], radius: 5, frame: 0 })]),
        "roto.propagate", JSON.stringify({ layer: "#1", wait: true }),
        "roto.freeze", JSON.stringify({ layer: "#1", wait: true }),
      ];
      const argsFile = `${OUT}/work/${name}.args`;
      writeFileSync(argsFile, steps.join("\n") + "\n");
      sh("effectcraft-cli", ["--bridge", String(PORT), "run", "--args-file", argsFile]);
      sh("effectcraft-cli", ["--bridge", String(PORT), "render-frame", "--comp", compName, "--frame", "0", "--transparent", "--out", sam]);

      // 4. PhotoCraft Refine Edge (SAM + classical union, subtract chroma blue, decontaminate)
      const place = (path: string) => ["--cmd", "file.placeEmbedded", "--params", JSON.stringify({ path, scale: 100, fit: false, smartObject: false, center: [w / 2, h / 2] })];
      const load = (layer: string, operation: string) => ["--cmd", "select.loadSelection", "--params", JSON.stringify({ channel: "transparency", layer: { name: layer }, operation })];
      const drop = (layer: string) => ["--cmd", "layer.delete", "--params", JSON.stringify({ layer: { name: layer } })];
      const clearBorder = ["--cmd", "select.rect", "--params", JSON.stringify({ x: 3, y: 3, width: w - 6, height: h - 6, antiAlias: false }), "--cmd", "select.inverse", "--cmd", "edit.clear"];
      rmSync(pcraft, { force: true });
      sh("photocraft-cli", [
        "run", raw,
        ...place(sam), ...place(cls),
        ...load(`${name}-sam`, "new"), ...load(`${name}-cls`, "add"),
        ...drop(`${name}-sam`), ...drop(`${name}-cls`),
        "--cmd", "layer.select", "--params", JSON.stringify({ name: "Background" }),
        "--cmd", "select.colorRange", "--params", JSON.stringify({ color: BG, fuzziness: 55, sampleAllLayers: false, mode: "subtract" }),
        "--cmd", "select.refineEdge", "--params", JSON.stringify({ smartRadius: true, radius: 4, smooth: 1, feather: 0.5, contrast: 10, decontaminate: true, amount: 85, output: "newLayerWithMask" }),
        "--cmd", "layer.layerMask.apply",
        ...clearBorder,
        "--out", pcraft,
      ]);
      sh("photocraft-cli", ["convert", pcraft, finalPng]);
      sh("photocraft-cli", ["convert", pcraft, finalWebp]);
      console.log(`cut ${name}: ${((performance.now() - t0) / 1000).toFixed(1)} s → ${finalWebp}`);
    }
  } finally {
    console.log(`Closing EffectCraft (--control ${PORT}, pid ${ec.pid}) via app.quit…`);
    await quitBridge(PORT, ec.pid);
    console.log("EffectCraft exited cleanly.");
  }
}

await main();
