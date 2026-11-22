/**
 * Studio 404 cast + balcony critics animation clips, authored in AniCraft
 * (`tools/moppets/studio404.anicraft`) and sampled per frame into `src/choir/anim/studio404.json`.
 *
 * Usage:
 *   bun tools/gen-studio404-anim.ts --author   rebuilds tools/moppets/studio404.anicraft from keyframes
 *   bun tools/gen-studio404-anim.ts            samples tools/moppets/studio404.anicraft → studio404.json + GIFs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DOC = "tools/moppets/studio404.anicraft";
const OUT = "src/choir/anim/studio404.json";
const W = 512, H = 512, FPS = 24, REST = { x: 256, y: 486 };
const SPRITE = { w: 420, h: 420, feet: 404 };

type Key = [frame: number, dx: number, dy: number, sx: number, sy: number, rot: number];

const CLIPS: { name: string; frames: number; ease: string; keys: Key[] }[] = [
  // Neon (vee): lively dual-tube step-tap bounce & crisp lean
  {
    name: "neon-dance",
    frames: 24,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [4, -4, 4, 104, 94, -3],
      [8, 3, -12, 97, 104, 3.5],
      [12, 0, 0, 103, 96, 0],
      [16, 4, 4, 104, 94, 3],
      [20, -3, -12, 97, 104, -3.5],
      [23, 0, 0, 100, 100, 0],
    ],
  },
  // Cue (scribe): steady teleprompter upright sway & gentle nod
  {
    name: "cue-dance",
    frames: 24,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [6, -3, -6, 98, 102, -2],
      [12, 0, 3, 102, 97, 0],
      [18, 3, -6, 98, 102, 2],
      [23, 0, 0, 100, 100, 0],
    ],
  },
  // Clank: boxy mechanical CRT-monitor tick-tock rock
  {
    name: "clank-dance",
    frames: 24,
    ease: "CubicOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [3, -4, 3, 103, 95, -4],
      [7, 0, -9, 98, 103, -2],
      [12, 4, 3, 103, 95, 4],
      [17, 0, -9, 98, 103, 2],
      [23, 0, 0, 100, 100, 0],
    ],
  },
  // Watt (pip): springy six-socket hop & eager diagonal tilt
  {
    name: "watt-dance",
    frames: 24,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [3, 0, 5, 106, 92, -2],
      [7, 4, -15, 95, 106, 5],
      [12, 0, 4, 105, 93, 0],
      [16, -4, -14, 95, 106, -5],
      [20, 0, 2, 102, 97, 1],
      [23, 0, 0, 100, 100, 0],
    ],
  },
  // Gruff: heavy valve-amp downbeat squash + deep warm sway
  {
    name: "gruff-dance",
    frames: 24,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [5, -5, 6, 108, 91, -2.5],
      [11, 0, -7, 97, 104, 0],
      [17, 5, 6, 108, 91, 2.5],
      [23, 0, 0, 100, 100, 0],
    ],
  },
  // Tabby: jazzy cracked-tablet cat sway & proud lift
  {
    name: "tabby-dance",
    frames: 24,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [5, 5, -9, 97, 104, 4.5],
      [11, 0, 3, 103, 96, 0],
      [17, -5, -9, 97, 104, -4.5],
      [23, 0, 0, 100, 100, 0],
    ],
  },
  // Chip: perky floppy-disk bird wing-bob hops
  {
    name: "chip-dance",
    frames: 24,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [3, 2, -13, 96, 105, 4],
      [6, 0, 3, 104, 94, 0],
      [9, -2, -11, 96, 105, -4],
      [12, 0, 3, 104, 94, 0],
      [16, 3, -14, 96, 105, 3.5],
      [20, -2, 2, 102, 97, -1],
      [23, 0, 0, 100, 100, 0],
    ],
  },
  // Tracking & Hertz: subtle curmudgeonly balcony sway on the beat
  {
    name: "critics-idle",
    frames: 32,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [8, -2, -3, 99, 101, -1.5],
      [16, 0, 1, 101, 99, 0],
      [24, 2, -3, 99, 101, 1.5],
      [31, 0, 0, 100, 100, 0],
    ],
  },
  // Tracking leans forward to deliver a sharp quip
  {
    name: "critics-tracking",
    frames: 24,
    ease: "CubicOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [5, -4, -6, 103, 103, -4],
      [13, -3, -5, 102, 102, -3],
      [19, 1, 1, 99, 99, 1],
      [23, 0, 0, 100, 100, 0],
    ],
  },
  // Hertz CRT-buzz jolt & shiver
  {
    name: "critics-hertz",
    frames: 20,
    ease: "QuadInOut",
    keys: [
      [0, 0, 0, 100, 100, 0],
      [3, 5, -5, 105, 96, 5],
      [6, -5, -3, 97, 103, -5],
      [9, 4, -4, 104, 97, 4],
      [13, -2, 1, 101, 99, -2],
      [19, 0, 0, 100, 100, 0],
    ],
  },
];

function cli(args: string[]): string {
  const r = spawnSync("anicraft-cli", args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`anicraft-cli ${args[0]}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function run(doc: string, steps: { cmd: string; params: object }[], save?: string): unknown[] {
  const file = "out/studio404-anim/steps.json";
  writeFileSync(file, JSON.stringify(steps));
  return JSON.parse(cli(["run", doc, file, ...(save ? ["--save", save] : [])]));
}

function pickStandIn(): string {
  const candidates = [
    "out/band-iso/final/rattle-rest.png",
    "out/band-iso/final/thrum-rest.png",
    "out/band-iso/final/clacker-rest.png",
  ];
  for (const c of candidates) if (existsSync(c)) return resolve(c);
  throw new Error("No 1024x1024 cut-out PNG found for AniCraft stand-in.");
}

function author(): void {
  const img = pickStandIn();
  rmSync(DOC, { force: true });
  cli(["new", "--out", DOC, "--width", String(W), "--height", String(H), "--fps", String(FPS)]);
  const total = CLIPS.reduce((n, c) => n + c.frames, 0);
  const made = run(DOC, [
    { cmd: "file.import", params: { path: img, x: 0, y: 0 } },
    { cmd: "modify.convert_to_symbol", params: { name: "Studio404Actor" } },
    { cmd: "doc.info", params: {} },
  ], DOC) as [{ layer: number }, { symbol: number; instance: number; layer: number }, { layers: { id: number; name: string }[] }];

  const { symbol, instance, layer } = made[1];
  const labels = made[2].layers.find((l) => l.id !== layer)!.id;
  const saved = JSON.parse(readFileSync(DOC, "utf8"));
  const bitmap = saved.document.library.find((x: { id: number }) => x.id === symbol).timeline.layers[0].keyframes[0].elements[0].id;

  run(DOC, [
    { cmd: "layer.rename", params: { layer, name: "actor" } },
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
  const actor = info.layers.find((l) => l.name === "actor");
  if (!actor) throw new Error(`${DOC} needs an "actor" layer`);
  const raw = JSON.parse(readFileSync(DOC, "utf8"));
  const labelLayer = raw.document.scenes[0].timeline.layers.find((l: { name: string }) => l.name === "clips");
  const spans: { name: string; start: number; frames: number }[] = labelLayer.keyframes
    .filter((k: { label: string }) => k.label)
    .map((k: { label: string; start: number; duration: number }) => ({ name: k.label, start: k.start, frames: k.duration }));
  const steps = spans.flatMap((s) => Array.from({ length: s.frames }, (_, f) => ({ cmd: "motion.info", params: { layer: actor.id, frame: s.start + f } })));
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
  for (const s of spans) cli(["gif", DOC, "--out", `out/studio404-anim/${s.name}.gif`, "--from", String(s.start + 1), "--to", String(s.start + s.frames), "--scale", "0.5", "--overwrite", "yes"]);
  console.log(`wrote ${OUT}: ${spans.map((s) => `${s.name} ${s.frames}f`).join(", ")} · GIFs in out/studio404-anim/`);
}

mkdirSync("out/studio404-anim", { recursive: true });
if (process.argv.includes("--author")) author();
sample();
