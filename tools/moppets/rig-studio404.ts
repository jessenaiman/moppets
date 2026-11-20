/**
 * Ponytail EffectCraft rig builder for all 7 Studio 404 Moppets.
 * Modeled directly on the workshop "Cue - animation study" workflow:
 *   1. Transform tweens (foot-anchored squash/stretch Scale + sway Rotation)
 *   2. Puppet pins with EffectCraft tweens (3 whole-character pins: feet, crown, waist)
 *   3. Mouth sprite swaps (rest vs sing layers with swapped opacity + exported closed/open 4x2 sheets)
 *
 * Output:
 *   - tools/moppets/studio404-rigs.ecproj  (7 showcase comps showing all 3 techniques together)
 *   - public/rehearsal/rigs/<key>/{closed,open}.webp  (1536x1024 RGBA 4x2 sheets)
 *
 * Usage: bun tools/moppets/rig-studio404.ts [key ...]   (no keys: all of them)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const W = 384;
const H = 512;
const FPS = 24;
const ALL_KEYS = ["neon", "cue", "clank", "watt", "gruff", "tabby", "chip", "zap"];
// Keys named on the command line rig only those (e.g. `zap`), into their own project, leaving the
// shared studio404-rigs.ecproj and everyone else's sheets untouched.
const ONLY = process.argv.slice(2);
const KEYS = ONLY.length ? ONLY : ALL_KEYS;
const OUT_DIR = resolve("out/studio404-rigs");
const PROJ = ONLY.length ? resolve(OUT_DIR, `rigs-${ONLY.join("-")}.ecproj`) : resolve("tools/moppets/studio404-rigs.ecproj");

function webpSize(path: string): [number, number] {
  const b = readFileSync(path);
  const tag = b.toString("ascii", 12, 16);
  if (tag === "VP8X") {
    return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
  }
  if (tag === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (tag === "VP8 ") {
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  throw new Error(`Unsupported WebP header "${tag}" in ${path}`);
}

function ec(args: string[]): string {
  const r = spawnSync("effectcraft-cli", ["--gpu", ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`effectcraft-cli ${args.join(" ")} failed:\n${r.stderr}\n${r.stdout}`);
  return r.stdout;
}

function sh(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed`);
}

function pushTweens(
  cmds: { command: string; params: Record<string, unknown> }[],
  layer: string,
  w: number,
  h: number,
  isOpenMouth: boolean,
): void {
  const base = Math.min(1, 336 / w) * 100;
  const sc = (kx: number, ky: number) => [Number((base * kx).toFixed(2)), Number((base * ky).toFixed(2)), 100];
  const crownDx = Math.round(w * 0.088);

  // 1. Foot-anchored Transform tweens (duration = 1.0s at 24fps, sampled every 0.125s -> cel 7 = calm rest at 0.875s)
  cmds.push(
    { command: "prop.set", params: { layer, path: "transform/anchor", value: [w / 2, h - 8, 0] } },
    { command: "prop.set", params: { layer, path: "transform/position", value: [W / 2, 492, 0] } },
  );
  const scaleKeys: [number, number[]][] = [
    [0.0, sc(1.05, 0.94)],
    [0.125, sc(0.96, 1.05)],
    [0.25, sc(1.0, 1.0)],
    [0.375, sc(1.01, 0.98)],
    [0.5, sc(1.05, 0.94)],
    [0.625, sc(0.96, 1.05)],
    [0.75, sc(1.0, 1.0)],
    [0.875, sc(1.0, 1.0)],
  ];
  scaleKeys.forEach(([time, value]) =>
    cmds.push({ command: "prop.addKey", params: { layer, path: "transform/scale", time, value } }),
  );
  const rotKeys: [number, number][] = [
    [0.0, 3.2],
    [0.125, 1.8],
    [0.25, 0.0],
    [0.375, -1.6],
    [0.5, -3.2],
    [0.625, -1.8],
    [0.75, 0.0],
    [0.875, 0.0],
  ];
  rotKeys.forEach(([time, value]) =>
    cmds.push({ command: "prop.addKey", params: { layer, path: "transform/rotation", time, value } }),
  );

  // 2. Three whole-body Puppet pins (feet pinned, crown tweened, waist anchored — matching "Cue - animation study")
  cmds.push(
    { command: "puppet.addPin", params: { layer, position: [w / 2, h - 15], density: 50, expansion: 3, triangles: 350 } },
    { command: "puppet.addPin", params: { layer, position: [w / 2, 60] } },
    { command: "puppet.addPin", params: { layer, position: [w / 2, 250] } },
  );
  const crownKeys: [number, [number, number]][] = [
    [0.0, [w / 2 - crownDx, 72]],
    [0.125, [w / 2 - Math.round(crownDx * 0.65), 62]],
    [0.25, [w / 2 - Math.round(crownDx * 0.2), 58]],
    [0.375, [w / 2 + Math.round(crownDx * 0.4), 62]],
    [0.5, [w / 2 + crownDx, 72]],
    [0.625, [w / 2 + Math.round(crownDx * 0.6), 62]],
    [0.75, [w / 2 + Math.round(crownDx * 0.15), 58]],
    [0.875, [w / 2, 60]],
  ];
  crownKeys.forEach(([time, value], i) =>
    cmds.push({
      command: i === 0 ? "keys.set" : "prop.addKey",
      params: { layer, path: "effects/#1/mesh/deform/pin#2/position", time, value },
    }),
  );

  // 3. Mouth sprite-swap keyframes on the top open-mouth layer (closed bottom stays 100)
  if (isOpenMouth) {
    const swapKeys: [number, number][] = [
      [0.0, 0],
      [0.125, 100],
      [0.25, 100],
      [0.375, 0],
      [0.5, 100],
      [0.625, 100],
      [0.75, 0],
      [0.875, 0],
    ];
    swapKeys.forEach(([time, value]) =>
      cmds.push({
        command: "prop.addKey",
        params: { layer, path: "transform/opacity", time, value },
      }),
    );
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const importPaths = KEYS.flatMap((k) => [
  resolve(`public/rehearsal/img/${k}-rest.webp`),
  resolve(`public/rehearsal/img/${k}-sing.webp`),
]);

// Build one clean EffectCraft project containing all 7 showcase comps
const setupCmds: { command: string; params: Record<string, unknown> }[] = [
  { command: "file.import", params: { paths: importPaths } },
];

for (const key of KEYS) {
  const [w, h] = webpSize(resolve(`public/rehearsal/img/${key}-rest.webp`));
  setupCmds.push({
    command: "comp.new",
    params: { name: key, width: W, height: H, frameRate: FPS, duration: 1.0, open: true },
  });
  setupCmds.push({ command: "layer.addItem", params: { item: `${key}-rest.webp`, position: [W / 2, 492] } });
  pushTweens(setupCmds, "#1", w, h, false);
  setupCmds.push({ command: "layer.addItem", params: { item: `${key}-sing.webp`, position: [W / 2, 492] } });
  pushTweens(setupCmds, "#1", w, h, true);
}

const setupPath = resolve(OUT_DIR, "setup-commands.json");
writeFileSync(setupPath, JSON.stringify(setupCmds, null, 2));
rmSync(PROJ, { force: true });
ec(["--empty", "run", "--commands", setupPath, "--save-as", PROJ]);
console.log(`authored ${PROJ} (${KEYS.length} Studio 404 comps)`);

// Render both variants (closed & open) via headless batch renderQueue without mutating PROJ on disk
function exportVariant(variant: "closed" | "open"): void {
  const vDir = resolve(OUT_DIR, variant);
  mkdirSync(vDir, { recursive: true });
  const cmds: { command: string; params: Record<string, unknown> }[] = [];
  for (const key of KEYS) {
    const keyDir = resolve(vDir, key);
    mkdirSync(keyDir, { recursive: true });
    cmds.push({ command: "comp.open", params: { comp: key } });
    if (variant === "closed") {
      // Hide top sing layer (#1) and leave rest layer (#2) active
      cmds.push({ command: "layer.setSwitch", params: { layers: ["#1"], switch: "video", value: false } });
    } else {
      // Hide rest layer (#2) and force sing layer (#1) constant 100% opacity in memory
      cmds.push(
        { command: "layer.setSwitch", params: { layers: ["#2"], switch: "video", value: false } },
        { command: "prop.setExpression", params: { layer: "#1", path: "transform/opacity", expression: "100", enabled: true } },
      );
    }
    cmds.push({
      command: "renderQueue.add",
      params: {
        comp: key,
        format: "png",
        channels: "rgba",
        timeSpan: "custom",
        start: 0,
        duration: 1.0,
        frameRate: 8,
        output: `${keyDir}/[#].png`,
      },
    });
  }
  cmds.push({ command: "renderQueue.render", params: { wait: true } });
  const qFile = resolve(OUT_DIR, `export-${variant}.json`);
  writeFileSync(qFile, JSON.stringify(cmds, null, 2));
  ec(["--project", PROJ, "run", "--commands", qFile]);
}

exportVariant("closed");
exportVariant("open");

for (const key of KEYS) {
  const rigDir = resolve(`public/rehearsal/rigs/${key}`);
  mkdirSync(rigDir, { recursive: true });
  for (const variant of ["closed", "open"] as const) {
    const dir = resolve(OUT_DIR, variant, key);
    // Find rendered 8 PNG files sorted cleanly
    const pngs: string[] = [];
    for (let i = 0; i < 8; i++) {
      const cand = [resolve(dir, `${i}.png`), resolve(dir, `${i + 1}.png`), resolve(dir, `${String(i).padStart(4, "0")}.png`), resolve(dir, `${String(i + 1).padStart(4, "0")}.png`)].find((p) => existsSync(p));
      if (!cand) throw new Error(`Missing rendered cel ${i} in ${dir}`);
      pngs.push(cand);
    }
    sh("ffmpeg", [
      "-y", "-loglevel", "error",
      ...pngs.flatMap((p) => ["-i", p]),
      "-filter_complex", "[0:v][1:v][2:v][3:v]hstack=inputs=4[top];[4:v][5:v][6:v][7:v]hstack=inputs=4[bot];[top][bot]vstack=inputs=2",
      "-c:v", "libwebp", "-lossless", "0", "-q:v", "90",
      resolve(rigDir, `${variant}.webp`),
    ]);
  }
  console.log(`packed public/rehearsal/rigs/${key}/{closed,open}.webp`);
}
