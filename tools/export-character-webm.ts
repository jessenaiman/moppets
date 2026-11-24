/** Encode the occupied cells of an existing, registered WebP sheet as an alpha WebM. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CharacterFmvManifest } from "../src/choir/performer.ts";

const [artKey, ...extraActions] = process.argv.slice(2);
const actions = [...new Set(["idle", "sing", ...extraActions])];
if (![artKey, ...actions].every(name => name && /^[a-z0-9][a-z0-9_-]*$/i.test(name))) {
  throw new Error("Usage: bun run character:webm <artKey> [additional action names]");
}
const publicDir = resolve("public");
const source = join(publicDir, "rehearsal", "fmv", artKey, "manifest.json");
const pack = JSON.parse(readFileSync(source, "utf8")) as CharacterFmvManifest;
if (pack.character !== artKey) throw new Error(`Character mismatch in ${source}`);

const root = resolve("out/character-clips");
mkdirSync(root, { recursive: true });
const run = mkdtempSync(join(root, "export-"));
const output = join(run, artKey);
mkdirSync(output);
try {
  const clips: Record<string, string> = {};
  for (const action of actions) {
    const sheet = pack.actions[action];
    if (!sheet) throw new Error(`No ${action} sheet in ${source}`);
    const { cols, rows, frames, fps } = sheet;
    if (![cols, rows, frames].every(n => Number.isSafeInteger(n) && n > 0) ||
        frames > cols * rows || !Number.isFinite(fps) || fps <= 0) {
      throw new Error(`Invalid grid or timing for ${artKey}/${action}`);
    }
    const image = sheet.atlasUrl.startsWith("/") ? join(publicDir, sheet.atlasUrl) : resolve(dirname(source), sheet.atlasUrl);
    const file = action + ".webm";
    // untile multiplies the input rate by the full grid size, including padding cells.
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-framerate", String(fps / (cols * rows)), "-i", image,
      "-vf", `untile=${cols}x${rows}`, "-frames:v", String(frames), "-r", String(fps), "-an",
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "18", "-auto-alt-ref", "0",
      join(output, file),
    ], { stdio: "inherit" });
    clips[action] = file;
  }
  writeFileSync(join(output, "manifest.json"), JSON.stringify({ artKey, clips }, null, 2) + "\n");
  console.log(output);
} catch (error) {
  rmSync(run, { recursive: true, force: true });
  throw error;
}
