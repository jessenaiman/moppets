#!/usr/bin/env bun
/**
 * Craft-Native Google Flow FMV-to-Sprite Precision Keyer & Slicer (S-27).
 *
 * Uses local EffectCraft CLI (`effectcraft-cli` GPU `ec.keying.keylight` + `effect.pickColor`)
 * combined with `ffprobe` and ImageMagick (`magick`) to turn green-screen Google Flow MP4
 * clips (or full Character Animation Pack ZIPs) into baseline-aligned transparent WebP cel
 * atlases and a `NeonFmvRigManifest` JSON auto-loaded by `NeonWorldsStage` / `ShotcraftStage`.
 *
 * Zero custom Python/JS chroma keyers; all keying runs inside EffectCraft.
 *
 * Usage:
 *   bun tools/slice-flow-fmv.ts --character neon --input clip.mp4 --action idle [--fps 12] [--start 0] [--end 4]
 *   bun tools/slice-flow-fmv.ts --character neon --zip ~/Downloads/Neon-Pack.zip [--fps 12]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

interface ClipSpec {
  atlasUrl: string;
  cols: number;
  rows: number;
  frames: number;
  fps: number;
  anchorX: number;
  anchorY: number;
  cellWidth: number;
  cellHeight: number;
  sourceClip: string;
  startSec: number;
  endSec: number;
  baselineDriftPx: number;
}

interface CharacterFmvManifest {
  character: string;
  version: number;
  generatedAt: string;
  actions: Record<string, ClipSpec>;
}

interface ProbeInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function run(cmd: string, args: string[], quiet = false): string {
  const out = execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.trim();
}

function probeVideo(file: string): ProbeInfo {
  const raw = run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,duration",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      file,
    ],
    true,
  );
  const parsed = JSON.parse(raw) as {
    streams?: { width?: number; height?: number; r_frame_rate?: string; duration?: string }[];
    format?: { duration?: string };
  };
  const s = parsed.streams?.[0] ?? {};
  const [num, den = 1] = (s.r_frame_rate ?? "24/1").split("/").map(Number);
  const fps = den ? num / den : 24;
  const duration = Number(s.duration ?? parsed.format?.duration ?? 4);
  return {
    width: s.width ?? 1280,
    height: s.height ?? 720,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 24,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 4,
  };
}

function inferActionFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (/idle|looping_idle/.test(lower)) return "idle";
  if (/roll|locomotion|snag|stepping/.test(lower)) return "roll";
  if (/sing_left|left_tube/.test(lower)) return "sing-left";
  if (/sing_right|right_tube/.test(lower)) return "sing-right";
  if (/sing|phrases|acting_take/.test(lower)) return "offer";
  if (/dark|quiet|listen/.test(lower)) return "dark-listen";
  if (/walk/.test(lower)) return "walk";
  if (/jump/.test(lower)) return "jump";
  if (/360|turntable|turn/.test(lower)) return "turn-360";
  if (/applause|clap/.test(lower)) return "applause";
  if (/bow|curtain/.test(lower)) return "bow";
  if (/sit|stand/.test(lower)) return "sit-stand";
  if (/reprise|flourish/.test(lower)) return "reprise";
  return basename(filename, ".mp4")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
}

interface BBox {
  w: number;
  h: number;
  x: number;
  y: number;
}

function measureAlphaBBox(pngPath: string): BBox | null {
  const out = run("magick", [pngPath, "-format", "%@", "info:"], true);
  const m = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/.exec(out.trim());
  if (!m) return null;
  const w = Number(m[1]),
    h = Number(m[2]),
    x = Number(m[3]),
    y = Number(m[4]);
  if (w <= 1 || h <= 1) return null;
  return { w, h, x, y };
}

function keyAndPackClip(opts: {
  character: string;
  inputFile: string;
  action: string;
  outDir: string;
  publicBase: string;
  fps: number;
  startSec?: number;
  endSec?: number;
  cellWidth: number;
  cellHeight: number;
  screenGain: number;
  clipBlack: number;
  clipWhite: number;
  shrinkGrow: number;
  softness: number;
  despotWhite: number;
  keyX: number;
  keyY: number;
  lockBaseline: boolean;
}): ClipSpec {
  const absInput = resolve(opts.inputFile);
  const info = probeVideo(absInput);
  const startSec = Math.max(0, opts.startSec ?? 0);
  const endSec = Math.min(info.duration, opts.endSec ?? info.duration);
  if (endSec <= startSec) {
    throw new Error(`Invalid range [${startSec}, ${endSec}] for ${absInput}`);
  }

  const work = mkdtempSync(join(tmpdir(), `flow-fmv-${opts.character}-${opts.action}-`));
  try {
    const ecproj = join(work, "key.ecproj");
    const rawFramesDir = join(work, "raw");
    const normFramesDir = join(work, "norm");
    mkdirSync(rawFramesDir, { recursive: true });
    mkdirSync(normFramesDir, { recursive: true });

    console.log(
      `[effectcraft] Keying ${basename(absInput)} (${info.width}x${info.height} @ ${info.fps}fps, ${startSec.toFixed(2)}s..${endSec.toFixed(2)}s -> ${opts.fps}fps)`,
    );

    // 1. Build EffectCraft Keylight project & auto-pick backdrop chroma from (keyX, keyY)
    run(
      "effectcraft-cli",
      [
        "--empty",
        "run",
        "file.import",
        JSON.stringify({ paths: [absInput] }),
        "comp.new",
        JSON.stringify({
          name: "key",
          width: info.width,
          height: info.height,
          frameRate: info.fps,
          duration: info.duration,
          open: true,
        }),
        "layer.addItem",
        JSON.stringify({ item: basename(absInput) }),
        "effect.apply",
        JSON.stringify({ effect: "ec.keying.keylight" }),
        "effect.pickColor",
        JSON.stringify({
          layer: "#1",
          effect: 1,
          param: "screenColour",
          x: opts.keyX,
          y: opts.keyY,
          average: true,
          time: startSec,
        }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenGain", value: opts.screenGain }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/clipBlack", value: opts.clipBlack }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/clipWhite", value: opts.clipWhite }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/screenShrinkGrow", value: opts.shrinkGrow }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/screenSoftness", value: opts.softness }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/screenDespotBlack", value: 2 }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/screenDespotWhite", value: opts.despotWhite }),
        "file.save",
        JSON.stringify({ path: ecproj }),
      ],
      true,
    );

    // 2. Render keyed RGBA PNG sequence directly out of EffectCraft
    run(
      "effectcraft-cli",
      [
        "--project",
        ecproj,
        "render",
        "--comp",
        "key",
        "--format",
        "png",
        "--channels",
        "rgba",
        "--fps",
        String(opts.fps),
        "--start",
        String(startSec),
        "--end",
        String(endSec),
        "--out",
        join(rawFramesDir, "f_%04d.png"),
      ],
      true,
    );

    const pngs = readdirSync(rawFramesDir)
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => join(rawFramesDir, f));

    if (pngs.length === 0) {
      throw new Error(`EffectCraft rendered 0 frames for ${absInput}`);
    }

    // 3. Measure union bounding box & neutral foot/caster baseline so every cel aligns <= 1px
    const boxes = pngs.map((p) => measureAlphaBBox(p));
    const valid = boxes.filter((b): b is BBox => b !== null);
    if (valid.length === 0) {
      throw new Error(`All keyed frames were fully transparent for ${absInput} — tune --clip-black or --key-point`);
    }

    const minX = Math.min(...valid.map((b) => b.x));
    const maxX = Math.max(...valid.map((b) => b.x + b.w));
    const minY = Math.min(...valid.map((b) => b.y));
    const maxY = Math.max(...valid.map((b) => b.y + b.h));

    // Anchor baseline to the 85th percentile bottom Y (resistant to mid-air jumps lifting feet)
    const bottoms = valid.map((b) => b.y + b.h).sort((a, b) => a - b);
    const refBottomY = bottoms[Math.min(bottoms.length - 1, Math.floor(bottoms.length * 0.85))];
    const refCenterX = Math.round((minX + maxX) / 2);

    const padX = Math.round((maxX - minX) * 0.08);
    const padTop = Math.round((maxY - minY) * 0.08);
    const padBottom = Math.round((maxY - minY) * 0.04);

    // Keep crop window symmetrically centered on refCenterX so anchorX = 0.50 exactly
    const halfSpanX = Math.max(refCenterX - minX, maxX - refCenterX) + padX;
    const cropX = Math.max(0, refCenterX - halfSpanX);
    const cropW = Math.min(info.width - cropX, halfSpanX * 2);
    const cropY = Math.max(0, minY - padTop);
    const cropH = Math.min(info.height - cropY, maxY - cropY + padBottom);

    // Scale uniformly to fit inside (cellWidth x cellHeight), grounded cleanly near bottom margin
    const targetMarginBottom = Math.round(opts.cellHeight * 0.04);
    const usableW = opts.cellWidth - 8;
    const usableH = opts.cellHeight - targetMarginBottom - 8;
    const scale = Math.min(usableW / cropW, usableH / cropH);
    const scaledW = Math.max(1, Math.round(cropW * scale));
    const scaledH = Math.max(1, Math.round(cropH * scale));

    const lockBaseline = opts.lockBaseline;
    const normList: string[] = [];
    for (let i = 0; i < pngs.length; i++) {
      const dst = join(normFramesDir, `n_${String(i).padStart(4, "0")}.png`);
      const box = boxes[i];
      // For grounded actions (everything except jump), lock each frame's bottom sole/caster to the exact target margin (0px drift)
      const frameBottomInCrop = box ? box.y + box.h - cropY : cropH;
      const bottomGapPx = Math.round((cropH - frameBottomInCrop) * scale);
      const extentOffsetY = lockBaseline ? targetMarginBottom - bottomGapPx : targetMarginBottom;
      const ySign = extentOffsetY >= 0 ? `-${extentOffsetY}` : `+${Math.abs(extentOffsetY)}`;
      run(
        "magick",
        [
          pngs[i],
          "-crop",
          `${cropW}x${cropH}+${cropX}+${cropY}`,
          "+repage",
          "-resize",
          `${scaledW}x${scaledH}!`,
          "-background",
          "none",
          "-gravity",
          "south",
          "-extent",
          `${opts.cellWidth}x${opts.cellHeight}+0${ySign}`,
          dst,
        ],
        true,
      );
      normList.push(dst);
    }

    // Verify packed baseline stability on grounded frames (first & last Neutral Rest frames)
    const firstBox = measureAlphaBBox(normList[0]);
    const lastBox = measureAlphaBBox(normList[normList.length - 1]);
    const baselineDriftPx =
      firstBox && lastBox ? Math.abs(firstBox.y + firstBox.h - (lastBox.y + lastBox.h)) : 0;

    // 4. Pack normalized RGBA cels into a single transparent WebP atlas
    const frames = normList.length;
    const cols = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(frames * (opts.cellHeight / opts.cellWidth)))));
    const rows = Math.ceil(frames / cols);

    mkdirSync(opts.outDir, { recursive: true });
    const atlasFile = join(opts.outDir, `${opts.action}.webp`);
    run(
      "magick",
      [
        "montage",
        ...normList,
        "-tile",
        `${cols}x${rows}`,
        "-geometry",
        `${opts.cellWidth}x${opts.cellHeight}+0+0`,
        "-background",
        "none",
        "-define",
        "webp:lossless=false",
        "-quality",
        "88",
        atlasFile,
      ],
      true,
    );

    const anchorY = Number(
      (1 - (targetMarginBottom + (maxY - refBottomY) * scale) / opts.cellHeight).toFixed(4),
    );
    const spec: ClipSpec = {
      atlasUrl: `${opts.publicBase}/${opts.action}.webp`,
      cols,
      rows,
      frames,
      fps: opts.fps,
      anchorX: 0.5,
      anchorY,
      cellWidth: opts.cellWidth,
      cellHeight: opts.cellHeight,
      sourceClip: basename(absInput),
      startSec,
      endSec,
      baselineDriftPx,
    };

    console.log(
      `[packed] ${opts.action}: ${frames} cels (${cols}x${rows} @ ${opts.cellWidth}x${opts.cellHeight}) -> ${atlasFile} (start/end baseline drift: ${baselineDriftPx}px)`,
    );
    return spec;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const character = getArg("character")?.toLowerCase();
  const input = getArg("input");
  const zip = getArg("zip");
  const dir = getArg("dir");
  if (!character || (!input && !zip && !dir)) {
    console.error(
      "Usage:\n" +
        "  bun tools/slice-flow-fmv.ts --character <name> --input <clip.mp4> [--action <key>] [--start S] [--end S] [--fps 12]\n" +
        "  bun tools/slice-flow-fmv.ts --character <name> --zip <FlowPack.zip> [--fps 12]\n" +
        "  bun tools/slice-flow-fmv.ts --character <name> --dir <folder> [--fps 12]",
    );
    process.exit(1);
  }

  const fps = Number(getArg("fps") ?? "12");
  const cellWidth = Number(getArg("cell-width") ?? "420");
  const cellHeight = Number(getArg("cell-height") ?? "480");
  const screenGain = Number(getArg("gain") ?? "112");
  const clipBlack = Number(getArg("clip-black") ?? "26");
  const clipWhite = Number(getArg("clip-white") ?? "84");
  const shrinkGrow = Number(getArg("shrink") ?? "-0.6");
  const softness = Number(getArg("softness") ?? "0.5");
  const despotWhite = Number(getArg("despot-white") ?? "2");
  const [keyX, keyY] = (getArg("key-point") ?? "40,40").split(",").map(Number);

  const outDir = resolve(getArg("out-dir") ?? `public/rehearsal/fmv/${character}`);
  const publicBase = getArg("public-base") ?? `/rehearsal/fmv/${character}`;
  mkdirSync(outDir, { recursive: true });

  const manifestPath = join(outDir, "manifest.json");
  let manifest: CharacterFmvManifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as CharacterFmvManifest)
    : {
        character,
        version: 1,
        generatedAt: new Date().toISOString(),
        actions: {},
      };

  const jobs: { file: string; action: string; startSec?: number; endSec?: number }[] = [];
  let tempUnzipDir: string | null = null;

  try {
    if (input) {
      const action = getArg("action") ?? inferActionFromFilename(input);
      const startSec = getArg("start") !== undefined ? Number(getArg("start")) : undefined;
      const endSec = getArg("end") !== undefined ? Number(getArg("end")) : undefined;
      jobs.push({ file: input, action, startSec, endSec });
    } else if (zip) {
      tempUnzipDir = mkdtempSync(join(tmpdir(), `flow-zip-${character}-`));
      run("unzip", ["-oq", resolve(zip), "-d", tempUnzipDir], true);
      const mp4s = readdirSync(tempUnzipDir)
        .filter((f) => f.toLowerCase().endsWith(".mp4"))
        .sort();
      for (const f of mp4s) {
        jobs.push({ file: join(tempUnzipDir, f), action: inferActionFromFilename(f) });
      }
    } else if (dir) {
      const mp4s = readdirSync(resolve(dir))
        .filter((f) => f.toLowerCase().endsWith(".mp4"))
        .sort();
      for (const f of mp4s) {
        jobs.push({ file: join(resolve(dir), f), action: inferActionFromFilename(f) });
      }
    }

    if (jobs.length === 0) {
      throw new Error("No .mp4 files found to slice.");
    }

    for (const job of jobs) {
      const spec = keyAndPackClip({
        character,
        inputFile: job.file,
        action: job.action,
        outDir,
        publicBase,
        fps,
        startSec: job.startSec,
        endSec: job.endSec,
        cellWidth,
        cellHeight,
        screenGain,
        clipBlack,
        clipWhite,
        shrinkGrow,
        softness,
        despotWhite,
        keyX,
        keyY,
        lockBaseline: !/jump/.test(job.action) && !process.argv.includes("--no-lock-baseline"),
      });
      manifest.actions[job.action] = spec;
    }

    manifest.generatedAt = new Date().toISOString();
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log(`[manifest] Wrote ${manifestPath} (${Object.keys(manifest.actions).length} action(s))`);
  } finally {
    if (tempUnzipDir) rmSync(tempUnzipDir, { recursive: true, force: true });
  }
}

main();
