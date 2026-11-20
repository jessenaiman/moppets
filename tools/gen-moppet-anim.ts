/**
 * One animation file per Moppet: `src/choir/anim/<id>.json`, sampled from AniCraft documents that
 * already exist (nothing is re-authored here, so edits made in AniCraft are kept).
 *
 * Where each Moppet's clips come from:
 *   1. `tools/moppets/anim/<id>.anicraft`, if it exists: that Moppet's own document. Save a copy
 *      of a shared document there, edit it in AniCraft, and only that Moppet changes.
 *   2. otherwise the shared document: `tools/moppets/band.anicraft` (clips named `<id>-*`) for
 *      thrum, clacker and rattle; `tools/moppets/gestures.anicraft` (every clip) for the singers.
 *
 * A document is read by its layer names: a "band" layer with a "clips" label layer, or a "moppet"
 * layer with a "gestures" label layer (and an optional "head" layer). They keep the geometry the
 * shared documents were authored with (the rest position and the sprite's height).
 *
 * To swap one Moppet's animation: replace its `src/choir/anim/<id>.json`, or drop a different
 * `.anicraft` at `tools/moppets/anim/<id>.anicraft` and rerun.
 *
 *   bun tools/gen-moppet-anim.ts              every Moppet
 *   bun tools/gen-moppet-anim.ts pip rattle   only these
 *
 * A GIF of every clip lands in out/moppet-anim/<document>/ to look at. The columns of each file
 * are named in its "columns": dx, dy (fractions of the sprite's height, +y down), sx, sy (factors),
 * rot (degrees, + clockwise) and, for the singers, headRot.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const BAND = "tools/moppets/band.anicraft";
const GESTURES = "tools/moppets/gestures.anicraft";
const OWN = (id: string) => `tools/moppets/anim/${id}.anicraft`;
const OUT = (id: string) => `src/choir/anim/${id}.json`;

const BAND_IDS = ["thrum", "clacker", "rattle"];
const SINGER_IDS = ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"];

/** The geometry each kind of document was authored with. */
const GEOMETRY = {
  band: { rest: { x: 256, y: 486 }, height: 420, mover: "band", labels: "clips" },
  singer: { rest: { x: 240, y: 570 }, height: 512, mover: "moppet", labels: "gestures" },
};

interface Sampled {
  fps: number;
  columns: string[];
  clips: Record<string, number[][]>;
}

function cli(args: string[]): string {
  const r = spawnSync("anicraft-cli", args, { encoding: "utf8", maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`anicraft-cli ${args[0]}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function run(doc: string, steps: { cmd: string; params: object }[]): any[] {
  const file = "out/moppet-anim/steps.json";
  writeFileSync(file, JSON.stringify(steps));
  return JSON.parse(cli(["run", doc, file]));
}

const cache = new Map<string, Sampled>();

/** Every labelled clip of a document, a row per frame. */
function sample(doc: string): Sampled {
  const hit = cache.get(doc);
  if (hit) return hit;
  const info = run(doc, [{ cmd: "doc.info", params: {} }])[0] as { layers: { id: number; name: string }[]; stage: { fps: number } };
  const kind = info.layers.some((l) => l.name === "band") ? "band" : "singer";
  const g = GEOMETRY[kind];
  const mover = info.layers.find((l) => l.name === g.mover);
  const head = info.layers.find((l) => l.name === "head");
  if (!mover) throw new Error(`${doc} needs a "${g.mover}" layer (and a "${g.labels}" layer of frame labels)`);
  // frame labels live in the saved document (doc.info lists keyframes without them)
  const raw = JSON.parse(readFileSync(doc, "utf8"));
  const labelLayer = raw.document.scenes[0].timeline.layers.find((l: { name: string }) => l.name === g.labels);
  if (!labelLayer) throw new Error(`${doc} needs a "${g.labels}" layer of frame labels`);
  const spans: { name: string; start: number; frames: number }[] = labelLayer.keyframes
    .filter((k: { label: string }) => k.label)
    .map((k: { label: string; start: number; duration: number }) => ({ name: k.label, start: k.start, frames: k.duration }));
  const probe = (layer: number) =>
    run(doc, spans.flatMap((s) => Array.from({ length: s.frames }, (_, f) => ({ cmd: "motion.info", params: { layer, frame: s.start + f } })))).map((r) => r.values as Record<string, number>);
  const values = probe(mover.id);
  const headValues = head ? probe(head.id) : [];
  const r = (n: number) => +n.toFixed(4);
  const clips: Record<string, number[][]> = {};
  let k = 0;
  for (const s of spans) {
    const rows: number[][] = [];
    for (let f = 0; f < s.frames; f++, k++) {
      const v = values[k];
      const row = [r((v.x - g.rest.x) / g.height), r((v.y - g.rest.y) / g.height), r(v.scale_x / 100), r(v.scale_y / 100), r(v.rotation)];
      if (head) row.push(r(headValues[k].rotation ?? 0));
      rows.push(row);
    }
    clips[s.name] = rows;
  }
  const dir = `out/moppet-anim/${basename(doc, ".anicraft")}`;
  mkdirSync(dir, { recursive: true });
  for (const s of spans) cli(["gif", doc, "--out", `${dir}/${s.name}.gif`, "--from", String(s.start + 1), "--to", String(s.start + s.frames), "--scale", "0.5", "--overwrite", "yes"]);
  const out = { fps: info.stage.fps, columns: ["dx", "dy", "sx", "sy", "rot", ...(head ? ["headRot"] : [])], clips };
  cache.set(doc, out);
  return out;
}

mkdirSync("out/moppet-anim", { recursive: true });
mkdirSync("src/choir/anim", { recursive: true });
const wanted = process.argv.slice(2);
for (const id of [...BAND_IDS, ...SINGER_IDS]) {
  if (wanted.length && !wanted.includes(id)) continue;
  const source = existsSync(OWN(id)) ? OWN(id) : BAND_IDS.includes(id) ? BAND : GESTURES;
  const all = sample(source);
  const clips = source === BAND ? Object.fromEntries(Object.entries(all.clips).filter(([name]) => name.startsWith(`${id}-`))) : all.clips;
  if (!Object.keys(clips).length) throw new Error(`${source} has no clips for ${id}`);
  writeFileSync(OUT(id), JSON.stringify({ moppet: id, source, fps: all.fps, columns: all.columns, clips }, null, 1) + "\n");
  console.log(`${OUT(id)} ← ${source}: ${Object.entries(clips).map(([n, rows]) => `${n} ${rows.length}f`).join(", ")}`);
}
