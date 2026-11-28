#!/usr/bin/env bun
/**
 * Mechanical Audio-Safety & Non-Friction Architecture Firewall.
 *
 * Enforces:
 *  1. Sacred CHIMERA audio/DSP modules never import React, Three.js, motion, or UI/stage code.
 *  2. Strictly ONE Moppets `new AudioContext(` owner (`src/audio/audio.ts`) outside vendored `src/chimera/`.
 *  3. `AudioWorkletNode` scope restricted to `ensemble.ts`, `live.ts`, `ChimeraTools.tsx`, `src/audio/`, and `src/chimera/`.
 *  4. Zero `remotion`, `@remotion/*`, `@react-three/*`, `<Html5Video>`, or `src/remotion/` resurrection
 *     (pure `three` is sanctioned for the real 3D/2.5D Three.js stage and CHIMERA 3D rig).
 *
 * Run via: `bun run verify:audio-firewall`
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const failures: string[] = [];

function read(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    failures.push(`MISSING required file: ${rel}`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

function walkTs(dirRel: string): string[] {
  const dir = path.join(ROOT, dirRel);
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(dirRel, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(rel));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// 1. Sacred CHIMERA audio/DSP modules must NEVER import React, Three, motion, or src/ui/
const SACRED_AUDIO_FILES = [
  "src/worklet/mixer.ts",
  "src/choir/mix.ts",
  "src/choir/vocalBus.ts",
  "src/choir/plan.ts",
  "src/choir/singerCore.ts",
];
const FORBIDDEN_AUDIO_IMPORTS =
  /\bfrom\s+["'](?:react|react-dom|remotion|@remotion\/|three|@react-three\/|motion|\.\.\/ui\/|\.\.\/stage\/)/;
for (const rel of SACRED_AUDIO_FILES) {
  const src = read(rel);
  if (FORBIDDEN_AUDIO_IMPORTS.test(src)) {
    failures.push(`AUDIO IMPORT VIOLATION: ${rel} imports UI/React/stage code`);
  }
}

// 2. Single Moppets `new AudioContext(` owner strictly inside src/audio/audio.ts (vendored src/chimera/ exempt)
const allSrc = walkTs("src");
for (const rel of allSrc) {
  if (rel.startsWith("src/chimera/")) continue;
  const src = read(rel);
  if (rel !== "src/audio/audio.ts" && /\bnew\s+(?:window\.)?(?:AudioContext|webkitAudioContext)\s*\(/.test(src)) {
    failures.push(`DUPLICATE AudioContext VIOLATION: ${rel} instantiates AudioContext (only src/audio/audio.ts may own it)`);
  }
}

// 3. AudioWorkletNode scope strictly inside ensemble.ts, live.ts, ChimeraTools.tsx, src/audio/, src/chimera/
const ALLOWED_WORKLET_FILES = new Set([
  "src/choir/ensemble.ts",
  "src/choir/live.ts",
  "src/ui/ChimeraTools.tsx",
]);
for (const rel of allSrc) {
  if (rel.startsWith("src/audio/") || rel.startsWith("src/chimera/") || ALLOWED_WORKLET_FILES.has(rel)) continue;
  const src = read(rel);
  if (/\bnew\s+AudioWorkletNode\s*\(/.test(src)) {
    failures.push(`AudioWorkletNode SCOPE VIOLATION: ${rel} constructs AudioWorkletNode outside allowed owners`);
  }
}

// 4. Zero Remotion / R3F packages or Html5Video resurrection
if (fs.existsSync(path.join(ROOT, "src/remotion"))) {
  failures.push("REMOTION DIRECTORY BAN: src/remotion must not exist");
}

const pkg = JSON.parse(read("package.json"));
const allDeps: Record<string, string> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
for (const name of Object.keys(allDeps)) {
  if (name === "remotion" || name.startsWith("@remotion/") || name.startsWith("@react-three/")) {
    failures.push(`RETIRED DEPENDENCY VIOLATION: package.json still lists ${name}`);
  }
}

const RETIRED_SRC_IMPORTS = /\bfrom\s+["'](?:remotion|@remotion\/|@react-three\/)/;
for (const rel of allSrc) {
  const src = stripComments(read(rel));
  if (RETIRED_SRC_IMPORTS.test(src)) {
    failures.push(`RETIRED IMPORT VIOLATION: ${rel} imports remotion or @react-three`);
  }
  if (/\bHtml5Video\b/.test(src)) {
    failures.push(`Html5Video HARD BAN: ${rel} references Html5Video`);
  }
}

if (failures.length > 0) {
  console.error("AUDIO-SAFETY FIREWALL FAILED:");
  for (const f of failures) console.error("  [FAIL]", f);
  process.exit(1);
}

console.log(
  `AUDIO-SAFETY FIREWALL PASSED (${SACRED_AUDIO_FILES.length} sacred audio files clean, ` +
    `1 Moppets AudioContext owner, native Three.js enabled, 0 Remotion/R3F/Html5Video).`,
);
