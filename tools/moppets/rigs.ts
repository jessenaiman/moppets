/**
 * The Moppets rigged in AniCraft: each one's rest cel as a body and a head symbol, joined by a
 * neck bone (an armature layer per Moppet), with a test head tilt keyed so the rig can be watched.
 *
 *   in:  out/moppet-rigs/<id>-{body,head}.png  (PhotoCraft cuts of the rest cel; Vee's own body and head art)
 *   out: out/moppet-rigs/moppets.anicraft
 *
 * Built through `anicraft-cli serve` (JSON lines), since ids (bitmaps, instances, bones) come back
 * from each step. Open the result with AniCraft to see and pose it.
 *
 * Usage: bun tools/moppets/rigs.ts
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const DIR = "out/moppet-rigs";
const OUT = `${DIR}/moppets.anicraft`;
const CEL = { w: 384, h: 512, feet: 492 };
const STAGE = { width: CEL.w * 7, height: 640, fps: 24 };
const FEET_Y = 600;
const FRAMES = 48;

/** The neck joint on the rest cel (px), and where the head is drawn: Vee's head art is its own, smaller sheet. */
const CAST: { id: string; neck: [number, number]; head?: { w: number; h: number; neckY: number } }[] = [
  { id: "vee", neck: [165, 221], head: { w: 253, h: 338, neckY: 0.8078 } },
  { id: "scribe", neck: [190, 214] },
  { id: "clank", neck: [192, 170] },
  { id: "pip", neck: [171, 266] },
  { id: "gruff", neck: [170, 242] },
  { id: "tabby", neck: [214, 238] },
  { id: "chip", neck: [194, 248] },
];

const proc = spawn("anicraft-cli", ["serve"], { stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
await lines.next(); // {"ready": true}
let nextId = 1;
async function cmd(name: string, params: object = {}): Promise<Record<string, any>> {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ id, cmd: name, params }) + "\n");
  const r = JSON.parse((await lines.next()).value as string);
  if (!r.ok) throw new Error(`${name} ${JSON.stringify(params)}: ${r.error}`);
  return r.result ?? {};
}

await cmd("doc.set_stage", { ...STAGE, background: "#2a231d" });
await cmd("timeline.insert_frame", { frame: 0, count: FRAMES - 1 });
const report: string[] = [];
for (const [i, m] of CAST.entries()) {
  const left = i * CEL.w, top = FEET_Y - CEL.feet;
  const at = (x: number, y: number): [number, number] => [left + x, top + y];
  const layer = (await cmd("layer.new", { name: m.id })).layer;
  const part = async (file: string, cx: number, cy: number, name: string) => {
    const { bitmap } = await cmd("file.import_to_library", { path: `${DIR}/${file}`, name });
    await cmd("library.place", { bitmap, x: cx, y: cy });
    return (await cmd("modify.convert_to_symbol", { name })).instance as number;
  };
  const body = await part(`${m.id}-body.png`, ...at(CEL.w / 2, CEL.h / 2), `${m.id} body`);
  // a full-cel head lines up with its body; Vee's head sits with its neck on the body's
  const hc = m.head ? at(m.neck[0], m.neck[1] - m.head.h * (m.head.neckY - 0.5)) : at(CEL.w / 2, CEL.h / 2);
  const head = await part(`${m.id}-head.png`, ...hc, `${m.id} head`);
  const joint = at(...m.neck);
  const { bone } = await cmd("bone.add", { from: body, to: head, head: joint, tail: [joint[0], joint[1] - 90], name: `${m.id} neck` });
  await cmd("bone.set_limits", { bone, constrain: true, min: -25, max: 25 });
  // the test move: a head tilt one way, then the other, then back (keys at 0, 12, 24, 36, 47)
  for (const [frame, angle] of [[0, 0], [12, -14], [24, 0], [36, 14], [47, 0]]) await cmd("bone.pose", { bone, angle, frame });
  report.push(`${m.id}: layer ${layer}, body ${body}, head ${head}, bone ${bone}`);
}
const info = await cmd("bone.info", { frame: 12 });
await cmd("file.save_as", { path: OUT, confirm: true });
proc.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n");
console.log(report.join("\n"));
console.log("bone.info at frame 12:", JSON.stringify(info).slice(0, 1200));
console.log(`wrote ${OUT}`);
