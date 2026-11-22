/**
 * Studio 404 band animation clips, authored in AniCraft (`tools/moppets/band.anicraft`) and
 * sampled per frame into `src/choir/band-anim.generated.json`.
 *
 * Usage:
 *   bun tools/gen-band-anim.ts --author   rebuilds tools/moppets/band.anicraft from the keyframe draft
 *   bun tools/gen-band-anim.ts            samples tools/moppets/band.anicraft → band-anim.generated.json + GIFs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DOC = "tools/moppets/band.anicraft";
const OUT = "src/choir/band-anim.generated.json";
const W = 512, H = 512, FPS = 24, REST = { x: 256, y: 486 };
const SPRITE = { w: 420, h: 420, feet: 404 };

type Key = [frame: number, dx: number, dy: number, sx: number, sy: number, rot: number];

const CLIPS: { name: string; frames: number; ease: string; keys: Key[] }[] = [
  // Thrum bass pluck: deep downward squash into a resonant rebound & warm lean
  {
    name: "thrum-pluck",
    frames: 14,
    ease: "CubicOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [2, -5, 6, 105, 93, -3.5],
      [5, 4, -8, 97, 105, 2.5],
      [9, -1, -2, 101, 99, -1],
      [13, 0, 0, 100, 100, 0],
    ],
  },
  // Clacker keys chord hit: crisp forward lean + bounce over his own keys
  {
    name: "clacker-play",
    frames: 12,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [2, 0, 4, 104, 95, 3.5],
      [5, 0, -7, 97, 104, -2.5],
      [8, 0, 1, 101, 99, 1],
      [11, 0, 0, 100, 100, 0],
    ],
  },
  // Rattle kick drum: chunky coffee-tin squash and pop
  {
    name: "rattle-kick",
    frames: 10,
    ease: "CubicOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [2, 0, 6, 109, 90, 0],
      [5, 0, -9, 95, 107, 0],
      [9, 0, 0, 100, 100, 0],
    ],
  },
  // Rattle snare hit: snappy whip tilt to the right
  {
    name: "rattle-snare",
    frames: 10,
    ease: "CubicOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [2, 4, -5, 97, 104, 8],
      [5, -2, 2, 103, 97, -3],
      [9, 0, 0, 100, 100, 0],
    ],
  },
  // Rattle hi-hat tap: quick crisp flick left
  {
    name: "rattle-hat",
    frames: 8,
    ease: "QuadOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [2, -3, -3, 99, 102, -4.5],
      [5, 1, 0, 100, 100, 1],
      [7, 0, 0, 100, 100, 0],
    ],
  },
  // Rattle crash cymbal: big celebratory rise & ring-out rock
  {
    name: "rattle-crash",
    frames: 16,
    ease: "CubicOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [3, 5, -14, 94, 109, 11],
      [7, -4, 3, 105, 95, -6],
      [11, 2, -4, 99, 102, 3],
      [15, 0, 0, 100, 100, 0],
    ],
  },
  // Rattle beatbox groove: happy rhythmic head-bobbing sway when drums sit out for CHIMERA's beatbox
  {
    name: "rattle-beatbox",
    frames: 16,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, -4],
      [4, -4, -6, 98, 103, 0],
      [8, 0, 2, 103, 97, 4],
      [12, 4, -6, 98, 103, 0],
      [15, 0, 0, 100, 100, -4],
    ],
  },
];

function cli(args: string[]): string {
  const r = spawnSync("anicraft-cli", args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`anicraft-cli ${args[0]}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function run(doc: string, steps: { cmd: string; params: object }[], save?: string): unknown[] {
  const file = "out/band-anim/steps.json";
  writeFileSync(file, JSON.stringify(steps));
  return JSON.parse(cli(["run", doc, file, ...(save ? ["--save", save] : [])]));
}

function pickStandIn(): string {
  const candidates = [
    "out/band-iso/final/rattle-rest.png",
    "out/band-iso/final/thrum-rest.png",
    "public/moppets/band/rattle-rest.png",
  ];
  for (const c of candidates) if (existsSync(c)) return resolve(c);
  throw new Error("No cut-out band PNG found for AniCraft stand-in. Run band cutout first.");
}

function author(): void {
  const img = pickStandIn();
  rmSync(DOC, { force: true });
  cli(["new", "--out", DOC, "--width", String(W), "--height", String(H), "--fps", String(FPS)]);
  const total = CLIPS.reduce((n, c) => n + c.frames, 0);
  const made = run(DOC, [
    { cmd: "file.import", params: { path: img, x: 0, y: 0 } },
    { cmd: "modify.convert_to_symbol", params: { name: "BandMember" } },
    { cmd: "doc.info", params: {} },
  ], DOC) as [{ layer: number }, { symbol: number; instance: number; layer: number }, { layers: { id: number; name: string }[] }];

  const { symbol, instance, layer } = made[1];
  const labels = made[2].layers.find((l) => l.id !== layer)!.id;
  const saved = JSON.parse(readFileSync(DOC, "utf8"));
  const bitmap = saved.document.library.find((x: { id: number }) => x.id === symbol).timeline.layers[0].keyframes[0].elements[0].id;

  run(DOC, [
    { cmd: "layer.rename", params: { layer, name: "band" } },
    { cmd: "layer.rename", params: { layer: labels, name: "clips" } },
    { cmd: "symbol.edit", params: { symbol } },
    { cmd: "element.select", params: { ids: [bitmap] } },
    { cmd: "element.set_transform", params: { x: -SPRITE.w / 2, y: -SPRITE.feet, scale_x: (SPRITE.w / 1024) * 100, scale_y: (SPRITE.h / 1024) * 100 } },
    { cmd: "symbol.exit", params: {} },
    { cmd: "element.select", params: { ids: [instance] } },
    { cmd: "element.set_transform", params: { x: REST.x, y: REST.y } },
  ], DOC);

  const steps: { cmd: string; params: object }[] = [];
  steps.push({ cmd: "timeline.insert_frame", params: { layers: [layer, labels], frame: 0, count: total - 1 } });
  let at = 0;
  for (const c of CLIPS) {
    if (at) steps.push({ cmd: "timeline.insert_keyframe", params: { layers: [layer, labels], frame: at } });
    steps.push({ cmd: "timeline.set_label", params: { label: c.name, layer: labels, frame: at } });
    at += c.frames;
  }
  at = 0;
  for (const c of CLIPS) {
    steps.push({ cmd: "timeline.create_motion_tween", params: { layer, frame: at } });
    for (const [f, dx, dy, sx, sy, rot] of c.keys) {
      const frame = at + f;
      steps.push(
        { cmd: "motion.set_key", params: { layer, frame, property: "x", value: REST.x + dx } },
        { cmd: "motion.set_key", params: { layer, frame, property: "y", value: REST.y + dy } },
        { cmd: "motion.set_key", params: { layer, frame, property: "scale_x", value: sx } },
        { cmd: "motion.set_key", params: { layer, frame, property: "scale_y", value: sy } },
        { cmd: "motion.set_key", params: { layer, frame, property: "rotation", value: rot } },
      );
    }
    for (const [f] of c.keys.slice(0, -1)) {
      steps.push({ cmd: "motion.set_ease", params: { layer, frame: at + f + 1, easing: c.ease } });
    }
    at += c.frames;
  }
  run(DOC, steps, DOC);
  console.log(`wrote ${DOC}: ${CLIPS.length} clips, ${total} frames`);
}

interface Info {
  layers: { id: number; name: string }[];
  stage: { fps: number };
}

function sample(): void {
  const info = (run(DOC, [{ cmd: "doc.info", params: {} }]) as Info[])[0];
  const band = info.layers.find((l) => l.name === "band");
  if (!band) throw new Error(`${DOC} needs a "band" layer`);
  const raw = JSON.parse(readFileSync(DOC, "utf8"));
  const labelLayer = raw.document.scenes[0].timeline.layers.find((l: { name: string }) => l.name === "clips");
  const spans: { name: string; start: number; frames: number }[] = labelLayer.keyframes
    .filter((k: { label: string }) => k.label)
    .map((k: { label: string; start: number; duration: number }) => ({ name: k.label, start: k.start, frames: k.duration }));
  const steps = spans.flatMap((s) => Array.from({ length: s.frames }, (_, f) => ({ cmd: "motion.info", params: { layer: band.id, frame: s.start + f } })));
  const values = (run(DOC, steps) as { values: Record<string, number> }[]).map((r) => r.values);
  const clips: Record<string, number[][]> = {};
  let k = 0;
  for (const s of spans) {
    const rows: number[][] = [];
    for (let f = 0; f < s.frames; f++) {
      const v = values[k++];
      const r = (n: number) => +n.toFixed(4);
      rows.push([r((v.x - REST.x) / SPRITE.h), r((v.y - REST.y) / SPRITE.h), r(v.scale_x / 100), r(v.scale_y / 100), r(v.rotation)]);
    }
    clips[s.name] = rows;
  }
  writeFileSync(OUT, JSON.stringify({ source: DOC, fps: info.stage.fps, columns: ["dx", "dy", "sx", "sy", "rot"], clips }, null, 1) + "\n");
  for (const s of spans) cli(["gif", DOC, "--out", `out/band-anim/${s.name}.gif`, "--from", String(s.start + 1), "--to", String(s.start + s.frames), "--scale", "0.5", "--overwrite", "yes"]);
  console.log(`wrote ${OUT}: ${spans.map((s) => `${s.name} ${s.frames}f`).join(", ")} · GIFs in out/band-anim/`);
}

mkdirSync("out/band-anim", { recursive: true });
if (process.argv.includes("--author")) author();
sample();
