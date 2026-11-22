/**
 * Build a complete Moppet in Google Flow: every image a puppet rig needs, made by `flow-clip`
 * through the signed-in Chrome session (Nano Banana 2.1: no credits on Ultra).
 *
 *   rest.png    full body, mouth closed           (from the reference art, if given)
 *   sing.png    the same frame, mouth open        (cels: the mouth swap)
 *   parts.png   disassembly sheet: head, body, arms, legs, apart (puppet pins / cut-out rig)
 *   poses.png   2x2: rest, anticipation, action, settle (keys to animate between)
 *
 * The character's description is its entry in docs/briefs/studio-404-cast-art.md, and the style is
 * that brief's "Every image" block (chroma blue #0047BB, not green: Cue's chest screen is green).
 * Each step after rest attaches rest.png as Flow's ingredient so the character stays the same.
 *
 *   bun tools/moppets/flow-moppet.ts cue --ref public/rehearsal/img/cue-rest.webp
 *   bun tools/moppets/flow-moppet.ts cue --only parts,poses      redo some steps
 *
 * Output: out/moppet-art/flow/<id>/. Cut the parts out with EffectCraft SAM + PhotoCraft Refine
 * Edge (tools/moppets/cut-band.ts shows how) before rigging. Needs Chrome connected:
 * `agent-browser --auto-connect get url` once, and Allow.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const id = process.argv[2];
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (!id || id.startsWith("--")) {
  console.error("usage: bun tools/moppets/flow-moppet.ts <id> [--ref image] [--only rest,sing,parts,poses]");
  process.exit(1);
}

const brief = readFileSync("docs/briefs/studio-404-cast-art.md", "utf8");
const style = brief.match(/## Every image\n\n((?:> .*\n)+)/)![1].replace(/^> /gm, "").replace(/\n/g, " ").trim();
const entry = brief.match(new RegExp(`^\\d+\\. \\*\\*${id}\\*\\*([\\s\\S]*?)(?=^\\d+\\. \\*\\*|^## )`, "im"));
if (!entry) throw new Error(`no entry for "${id}" in docs/briefs/studio-404-cast-art.md`);
const name = id[0].toUpperCase() + id.slice(1);
const who = `${name}: ${entry[1].replace(/\(references?:[^)]*\)\.?/i, "").replace(/\s+/g, " ").trim()}`;

const dir = `out/moppet-art/flow/${id}`;
mkdirSync(dir, { recursive: true });
const out = (f: string) => resolve(dir, f);

/** flow-clip takes a local PNG as an ingredient; the repo's art is WebP. */
function asPng(path: string): string {
  if (extname(path).toLowerCase() === ".png") return resolve(path);
  const png = out("ref.png");
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path, png], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`converting ${path} to PNG failed`);
  return png;
}

const ref = arg("--ref");
const same = "Keep this exact character: same design, colours, proportions and lighting.";
const STEPS: Record<string, { file: string; ingredient: () => string | undefined; prompt: string }> = {
  rest: {
    file: "rest.png",
    ingredient: () => (ref ? asPng(ref) : undefined),
    prompt: `${ref ? `${same} ` : ""}${who} Mouth closed, a gentle happy expression. ${style}`,
  },
  sing: {
    file: "sing.png",
    ingredient: () => out("rest.png"),
    prompt: `${same} The exact same image, pose, size and framing, but with the mouth open as if singing a warm note. Only the mouth changes. ${style}`,
  },
  parts: {
    file: "parts.png",
    ingredient: () => out("rest.png"),
    prompt: `${same} A practical disassembly parts sheet of this felt puppet: head, body, each arm with its hand, each leg, and any tail or cable, separated and laid out apart with wide gaps, each part whole and seen straight on, at the same scale as each other. Joints shown as clean felt edges. Flat solid chroma-blue background (#0047BB), even lighting, no shadows. Square image. No text, no labels, no borders.`,
  },
  poses: {
    file: "poses.png",
    ingredient: () => out("rest.png"),
    prompt: `${same} A 2x2 pose sheet of this felt puppet in four equal square cells: top-left rest, top-right anticipation (a small crouch back), bottom-left the action at its peak (leaning forward, singing, one arm up), bottom-right settle. Same scale and the same foot baseline in every cell, full body with margins. Flat solid chroma-blue background (#0047BB), even lighting, no shadows. Square image. No text, no borders.`,
  },
};

const only = arg("--only")?.split(",") ?? Object.keys(STEPS);
for (const step of Object.keys(STEPS)) {
  if (!only.includes(step)) continue;
  const s = STEPS[step];
  const ingredient = s.ingredient();
  if (ingredient && !existsSync(ingredient)) throw new Error(`${step} needs ${ingredient}: run the rest step first`);
  console.log(`\n== ${id}: ${step} -> ${dir}/${s.file}`);
  const r = spawnSync("flow-clip", ["--mode", "image", "--model", "Nano Banana 2.1", "--aspect", "1:1", "--prompt", s.prompt, "--out", out(s.file), ...(ingredient ? ["--ingredient", ingredient] : [])], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`flow-clip failed on ${step}`);
}
console.log(`\ndone: ${dir}/`);
