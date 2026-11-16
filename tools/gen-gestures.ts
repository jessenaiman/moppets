/**
 * Moppet gesture clips, animated in AniCraft and played live on the stage.
 *
 * tools/moppets/gestures.anicraft is the source: one Moppet (Pip's resting cel, as a stand-in for
 * any of them) on a "moppet" layer, one motion tween per gesture, and a "gestures" layer whose
 * frame labels name each one. Open it in AniCraft (`anicraft tools/moppets/gestures.anicraft`),
 * change the timing, keys or eases, save, then run this to bring the clips into the app:
 *
 *   bun tools/gen-gestures.ts            samples every frame → src/choir/gestures.generated.json
 *                                        and a GIF of each clip in out/gestures/ to look at
 *   bun tools/gen-gestures.ts --author   rebuilds the first draft of the document (overwrites it)
 *
 * The symbol's registration point is the Moppet's feet, so rotation and scale pivot where it
 * stands, as the stage's puppets do. The JSON stores each frame's offset from rest: x and y as a
 * fraction of the puppet's height (+y down), scale as a factor, rotation in degrees (+ clockwise).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DOC = "tools/moppets/gestures.anicraft";
const OUT = "src/choir/gestures.generated.json";
const W = 480, H = 600, FPS = 24, REST = { x: 240, y: 570 };
/** The cel is 384 × 512 and its feet are 96 % of the way down (the stage's transform-origin). */
const CEL = { w: 384, h: 512, feet: 492 };

type Key = [frame: number, dx: number, dy: number, sx: number, sy: number, rot: number];
/**
 * The first draft of each gesture: keys at frames relative to the clip's start (offsets in stage
 * px from rest, scales in %), eased with `ease` between keys. Each ends where it began.
 */
const DRAFT: { name: string; frames: number; ease: string; keys: Key[] }[] = [
  // a belly laugh: three squashed bounces, rocking side to side
  { name: "laugh", frames: 26, ease: "QuadInOut", keys: [[0, 0, 0, 100, 100, 0], [3, 0, -14, 96, 106, -4], [6, 0, 0, 106, 92, 0], [9, 0, -12, 96, 105, 4], [12, 0, 0, 105, 93, 0], [15, 0, -10, 97, 104, -3], [18, 0, 0, 104, 95, 0], [25, 0, 0, 100, 100, 0]] },
  // a shrug: shoulders up and a little head tilt, held, then a drop
  { name: "shrug", frames: 22, ease: "CubicOut", keys: [[0, 0, 0, 100, 100, 0], [5, 0, -6, 97, 107, -5], [13, 0, -6, 97, 107, -5], [17, 0, 2, 103, 96, 0], [21, 0, 0, 100, 100, 0]] },
  // a gasp: a jolt upward and a lean back, then it settles
  { name: "gasp", frames: 20, ease: "CubicOut", keys: [[0, 0, 0, 100, 100, 0], [3, 0, -18, 92, 112, -9], [10, 0, -8, 96, 105, -6], [19, 0, 0, 100, 100, 0]] },
  // a nod: two dips forward
  { name: "nod", frames: 18, ease: "QuadInOut", keys: [[0, 0, 0, 100, 100, 0], [4, 0, 3, 101, 98, 7], [8, 0, 0, 100, 100, 0], [12, 0, 3, 101, 98, 7], [17, 0, 0, 100, 100, 0]] },
  // a question: a slow head-cock, held while it waits
  { name: "tilt", frames: 30, ease: "Smooth", keys: [[0, 0, 0, 100, 100, 0], [7, 0, -2, 99, 102, -11], [22, 0, -2, 99, 102, -11], [29, 0, 0, 100, 100, 0]] },
  // a bow from the feet, with a little anticipation back first
  { name: "bow", frames: 32, ease: "QuadInOut", keys: [[0, 0, 0, 100, 100, 0], [4, 0, 0, 100, 102, -4], [12, 0, 4, 100, 94, 24], [22, 0, 4, 100, 94, 24], [31, 0, 0, 100, 100, 0]] },
];

function cli(args: string[]): string {
  const r = spawnSync("anicraft-cli", args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`anicraft-cli ${args[0]}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function run(doc: string, steps: { cmd: string; params: object }[], save?: string): unknown[] {
  const file = `out/gestures/steps.json`;
  writeFileSync(file, JSON.stringify(steps));
  return JSON.parse(cli(["run", doc, file, ...(save ? ["--save", save] : [])]));
}

async function author(): Promise<void> {
  const cel = "out/gestures/pip-rest.png";
  // Pip's resting cel (the last of the eight): the stand-in every clip is drawn on
  const py = spawnSync("python3", ["-c", `from PIL import Image; Image.open('public/moppets/pip/closed.webp').convert('RGBA').crop((${3 * CEL.w},${CEL.h},${4 * CEL.w},${2 * CEL.h})).save('${cel}')`], { encoding: "utf8" });
  if (py.status !== 0) throw new Error(`cropping the cel needs Pillow: ${py.stderr}`);
  cli(["new", "--out", DOC, "--width", String(W), "--height", String(H), "--fps", String(FPS)]);
  const total = DRAFT.reduce((n, g) => n + g.frames, 0);
  const made = run(DOC, [
    { cmd: "file.import", params: { path: cel, x: 0, y: 0 } },
    { cmd: "modify.convert_to_symbol", params: { name: "Moppet" } },
    { cmd: "doc.info", params: {} },
  ], DOC) as [{ layer: number }, { symbol: number; instance: number; layer: number }, { layers: { id: number; name: string }[]; library: unknown[] }];
  const { symbol, instance, layer } = made[1];
  const labels = made[2].layers.find((l) => l.id !== layer)!.id;
  // the bitmap inside the symbol moves so the feet sit on its registration point
  const saved = JSON.parse(readFileSync(DOC, "utf8"));
  const bitmap = saved.document.library.find((x: { id: number }) => x.id === symbol).timeline.layers[0].keyframes[0].elements[0].id;
  const steps: { cmd: string; params: object }[] = [
    { cmd: "layer.rename", params: { layer, name: "moppet" } },
    { cmd: "layer.rename", params: { layer: labels, name: "gestures" } },
    { cmd: "symbol.edit", params: { symbol } },
    { cmd: "element.select", params: { ids: [bitmap] } },
    { cmd: "element.set_transform", params: { x: -CEL.w / 2, y: -CEL.feet } },
    { cmd: "symbol.exit", params: {} },
  ];
  steps.push({ cmd: "element.select", params: { ids: [instance] } }, { cmd: "element.set_transform", params: { x: REST.x, y: REST.y } });
  steps.push({ cmd: "timeline.insert_frame", params: { layers: [layer, labels], frame: 0, count: total - 1 } });
  let at = 0;
  for (const g of DRAFT) {
    if (at) steps.push({ cmd: "timeline.insert_keyframe", params: { layers: [layer, labels], frame: at } });
    steps.push({ cmd: "timeline.set_label", params: { label: g.name, layer: labels, frame: at } });
    at += g.frames;
  }
  at = 0;
  for (const g of DRAFT) {
    steps.push({ cmd: "timeline.create_motion_tween", params: { layer, frame: at } });
    for (const [f, dx, dy, sx, sy, rot] of g.keys) {
      const frame = at + f;
      steps.push(
        { cmd: "motion.set_key", params: { layer, frame, property: "x", value: REST.x + dx } },
        { cmd: "motion.set_key", params: { layer, frame, property: "y", value: REST.y + dy } },
        { cmd: "motion.set_key", params: { layer, frame, property: "scale_x", value: sx } },
        { cmd: "motion.set_key", params: { layer, frame, property: "scale_y", value: sy } },
        { cmd: "motion.set_key", params: { layer, frame, property: "rotation", value: rot } },
      );
    }
    for (const [f] of g.keys.slice(0, -1)) steps.push({ cmd: "motion.set_ease", params: { layer, frame: at + f + 1, easing: g.ease } });
    at += g.frames;
  }
  run(DOC, steps, DOC);
  console.log(`wrote ${DOC}: ${DRAFT.length} gestures, ${total} frames`);
}

interface Info {
  layers: { id: number; name: string; keyframes: { start: number; duration: number; label?: string }[] }[];
  stage: { fps: number };
}

function sample(): void {
  const info = (run(DOC, [{ cmd: "doc.info", params: {} }]) as Info[])[0];
  const moppet = info.layers.find((l) => l.name === "moppet");
  if (!moppet || !info.layers.some((l) => l.name === "gestures")) throw new Error(`${DOC} needs a "moppet" layer and a "gestures" layer of labels`);
  // frame labels live in the saved document (doc.info lists keyframes without them)
  const raw = JSON.parse(readFileSync(DOC, "utf8"));
  const labelLayer = raw.document.scenes[0].timeline.layers.find((l: { name: string }) => l.name === "gestures");
  const spans: { name: string; start: number; frames: number }[] = labelLayer.keyframes.filter((k: { label: string }) => k.label).map((k: { label: string; start: number; duration: number }) => ({ name: k.label, start: k.start, frames: k.duration }));
  const steps = spans.flatMap((s) => Array.from({ length: s.frames }, (_, f) => ({ cmd: "motion.info", params: { layer: moppet.id, frame: s.start + f } })));
  const values = (run(DOC, steps) as { values: Record<string, number> }[]).map((r) => r.values);
  const clips: Record<string, number[][]> = {};
  let k = 0;
  for (const s of spans) {
    const rows: number[][] = [];
    for (let f = 0; f < s.frames; f++) {
      const v = values[k++];
      const r = (n: number) => +n.toFixed(4);
      rows.push([r((v.x - REST.x) / CEL.h), r((v.y - REST.y) / CEL.h), r(v.scale_x / 100), r(v.scale_y / 100), r(v.rotation)]);
    }
    clips[s.name] = rows;
  }
  writeFileSync(OUT, JSON.stringify({ source: DOC, fps: info.stage.fps, columns: ["dx", "dy", "sx", "sy", "rot"], clips }, null, 1) + "\n");
  for (const s of spans) cli(["gif", DOC, "--out", `out/gestures/${s.name}.gif`, "--from", String(s.start + 1), "--to", String(s.start + s.frames), "--scale", "0.5", "--overwrite", "yes"]);
  console.log(`wrote ${OUT}: ${spans.map((s) => `${s.name} ${s.frames}f`).join(", ")} · GIFs in out/gestures/`);
}

mkdirSync("out/gestures", { recursive: true });
if (process.argv.includes("--author")) await author();
sample();
