#!/usr/bin/env bun
/**
 * Decode alpha_mode=1 VP9 WebM masters (via `-c:v libvpx-vp9` before `-i`) or key #00FF00 MP4s
 * (via EffectCraft Keylight + exterior border floodfill), normalize to uniform 448x560 cells
 * with grounded paw baseline locking, pack RGBA WebP atlases + VP9 alpha WebM, and emit 6x2 QA sheets.
 *
 * Usage:
 *   bun tools/pack-mop-fmv.ts --character tabby --action idle --input clip.webm [--fps 24] [--qa qa.png]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

export interface MopClipSpec {
  atlasUrl: string;
  webmUrl: string;
  cols: number;
  rows: number;
  frames: number;
  fps: number;
  cellWidth: number;
  cellHeight: number;
  anchorX: number;
  anchorY: number;
  baselineDriftPx: number;
  edgeClippedFrames: number;
  sourceClip: string;
}

export interface MopClipManifest {
  character: string;
  version: number;
  generatedAt: string;
  actions: Record<string, MopClipSpec>;
}

interface BBox {
  w: number;
  h: number;
  x: number;
  y: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function run(cmd: string, args: string[], quiet = true): string {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function probeVideo(file: string) {
  const raw = run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate,duration:stream_tags=alpha_mode",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    file,
  ]);
  const parsed = JSON.parse(raw) as {
    streams?: { width?: number; height?: number; r_frame_rate?: string; duration?: string; tags?: { alpha_mode?: string } }[];
    format?: { duration?: string };
  };
  const s = parsed.streams?.[0] ?? {};
  const [num, den = 1] = (s.r_frame_rate ?? "24/1").split("/").map(Number);
  const fps = den ? num / den : 24;
  const duration = Number(s.duration ?? parsed.format?.duration ?? 0);
  return {
    width: s.width ?? 720,
    height: s.height ?? 1280,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 24,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 4,
    alphaMode: s.tags?.alpha_mode === "1",
  };
}

function measureAlphaBBox(pngPath: string): BBox | null {
  const out = run("magick", [pngPath, "-format", "%@", "info:"]);
  const m = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/.exec(out.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  const x = Number(m[3]);
  const y = Number(m[4]);
  if (w <= 1 || h <= 1) return null;
  return { w, h, x, y };
}

function main() {
  const character = arg("character")?.toLowerCase();
  const action = arg("action")?.toLowerCase();
  const input = arg("input");
  if (!character || !action || !input) {
    console.error("Usage: bun tools/pack-mop-fmv.ts --character <id> --action <name> --input <file.webm|mp4> [--fps 24] [--qa <qa.png>] [--no-write]");
    process.exit(1);
  }

  const absInput = resolve(input);
  const info = probeVideo(absInput);
  const fps = Number(arg("fps") ?? "24");
  const cellWidth = Number(arg("cell-width") ?? "448");
  const cellHeight = Number(arg("cell-height") ?? "560");
  const outDir = resolve(arg("out-dir") ?? `public/moppets/${character}`);
  const publicBase = arg("public-base") ?? `/moppets/${character}`;
  const qaOut = arg("qa") ? resolve(arg("qa")!) : null;
  const dryRun = process.argv.includes("--no-write");
  const lockBaseline = action !== "jump";

  const work = mkdtempSync(join(tmpdir(), `mop-fmv-${character}-${action}-`));
  try {
    const cleanDir = join(work, "clean");
    const normDir = join(work, "norm");
    mkdirSync(cleanDir, { recursive: true });
    mkdirSync(normDir, { recursive: true });

    let cleanPngs: string[] = [];

    if (info.alphaMode && absInput.toLowerCase().endsWith(".webm")) {
      // Mode A: Native VP9 alpha_mode=1 WebM — decode with libvpx-vp9 BEFORE -i to keep RGBA alpha!
      const rawDir = join(work, "raw_rgba");
      mkdirSync(rawDir, { recursive: true });
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-c:v",
        "libvpx-vp9",
        "-i",
        absInput,
        "-vf",
        `fps=${fps}`,
        "-pix_fmt",
        "rgba",
        join(rawDir, "r_%04d.png"),
      ]);
      const rawPngs = readdirSync(rawDir)
        .filter((f) => f.endsWith(".png"))
        .sort()
        .map((f) => join(rawDir, f));
      if (!rawPngs.length) throw new Error(`0 RGBA frames decoded from ${absInput}`);

      // Subtle green-spill clamp on semi-transparent fringe pixels (a < 248) while keeping interior intact
      for (let i = 0; i < rawPngs.length; i++) {
        const dst = join(cleanDir, `c_${String(i).padStart(4, "0")}.png`);
        run("magick", [
          rawPngs[i],
          "-fx",
          "c == 1 && a < 0.97 && g > max(r,b)*1.12 ? max(r,b) : u",
          dst,
        ]);
        cleanPngs.push(dst);
      }
    } else {
      // Mode B: Opaque chroma MP4 — EffectCraft Keylight + 4-corner exterior floodfill protection
      const ecproj = join(work, "key.ecproj");
      const keyedDir = join(work, "keyed");
      const rawDir = join(work, "raw");
      mkdirSync(keyedDir, { recursive: true });
      mkdirSync(rawDir, { recursive: true });

      run("effectcraft-cli", [
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
        JSON.stringify({ layer: "#1", effect: 1, param: "screenColour", x: 36, y: 36, average: true, time: 0 }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenGain", value: 112 }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/clipBlack", value: 24 }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/clipWhite", value: 82 }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/screenShrinkGrow", value: -1.4 }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/screenSoftness", value: 0.7 }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/screenDespotBlack", value: 2 }),
        "prop.set",
        JSON.stringify({ layer: "#1", path: "effects/#1/screenMatte/screenDespotWhite", value: 2 }),
        "file.save",
        JSON.stringify({ path: ecproj }),
      ]);

      run("effectcraft-cli", [
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
        String(fps),
        "--start",
        "0",
        "--end",
        String(info.duration),
        "--out",
        join(keyedDir, "k_%04d.png"),
      ]);

      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        absInput,
        "-vf",
        `fps=${fps}`,
        join(rawDir, "r_%04d.png"),
      ]);

      const keyedPngs = readdirSync(keyedDir)
        .filter((f) => f.endsWith(".png"))
        .sort()
        .map((f) => join(keyedDir, f));
      const rawPngs = readdirSync(rawDir)
        .filter((f) => f.endsWith(".png"))
        .sort()
        .map((f) => join(rawDir, f));
      const nFrames = Math.min(keyedPngs.length, rawPngs.length);
      if (!nFrames) throw new Error(`0 frames rendered for ${absInput}`);

      for (let i = 0; i < nFrames; i++) {
        const dst = join(cleanDir, `c_${String(i).padStart(4, "0")}.png`);
        const extAlpha = join(work, `ext_${i}.png`);
        run("magick", [
          rawPngs[i],
          "-fuzz",
          "24%",
          "-fill",
          "none",
          "-draw",
          "color 4,4 floodfill",
          "-draw",
          `color ${info.width - 5},4 floodfill`,
          "-draw",
          `color 4,${info.height - 5} floodfill`,
          "-draw",
          `color ${info.width - 5},${info.height - 5} floodfill`,
          "-alpha",
          "extract",
          "-morphology",
          "Close",
          "Disk:2",
          extAlpha,
        ]);
        run("magick", [
          keyedPngs[i],
          "(",
          extAlpha,
          "-threshold",
          "50%",
          ")",
          "-compose",
          "Lighten",
          "-composite",
          "-fx",
          "c == 1 && g > max(r,b)*1.12 ? max(r,b) : u",
          dst,
        ]);
        cleanPngs.push(dst);
      }
    }

    // Measure bounding boxes & defect-check framing/clipping
    const boxes = cleanPngs.map((p) => measureAlphaBBox(p)).filter((b): b is BBox => b !== null);
    if (!boxes.length) throw new Error(`All frames empty after decode/key for ${absInput}`);

    let edgeClippedFrames = 0;
    for (const b of boxes) {
      if (b.x <= 1 || b.y <= 1 || b.x + b.w >= info.width - 1 || b.y + b.h >= info.height - 1) {
        edgeClippedFrames++;
      }
    }

    const minX = Math.min(...boxes.map((b) => b.x));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const bottoms = boxes.map((b) => b.y + b.h).sort((a, b) => a - b);
    const refBottomY = bottoms[Math.min(bottoms.length - 1, Math.floor(bottoms.length * 0.85))];
    const refCenterX = Math.round((minX + maxX) / 2);

    const padX = Math.round((maxX - minX) * 0.06);
    const padTop = Math.round((maxY - minY) * 0.06);
    const padBottom = Math.round((maxY - minY) * 0.03);
    const halfSpanX = Math.max(refCenterX - minX, maxX - refCenterX) + padX;
    const cropX = Math.max(0, refCenterX - halfSpanX);
    const cropW = Math.min(info.width - cropX, halfSpanX * 2);
    const cropY = Math.max(0, minY - padTop);
    const cropH = Math.min(info.height - cropY, maxY - cropY + padBottom);

    const targetMarginBottom = Math.round(cellHeight * 0.04);
    const scale = Math.min((cellWidth - 8) / cropW, (cellHeight - targetMarginBottom - 8) / cropH);
    const scaledW = Math.max(1, Math.round(cropW * scale));
    const scaledH = Math.max(1, Math.round(cropH * scale));

    const normList: string[] = [];
    for (let i = 0; i < cleanPngs.length; i++) {
      const dst = join(normDir, `n_${String(i).padStart(4, "0")}.png`);
      const box = boxes[i];
      const frameBottomInCrop = box ? box.y + box.h - cropY : cropH;
      const bottomGapPx = Math.round((cropH - frameBottomInCrop) * scale);
      const extentOffsetY = lockBaseline ? targetMarginBottom - bottomGapPx : targetMarginBottom;
      const ySign = extentOffsetY >= 0 ? `-${extentOffsetY}` : `+${Math.abs(extentOffsetY)}`;
      run("magick", [
        cleanPngs[i],
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
        `${cellWidth}x${cellHeight}+0${ySign}`,
        dst,
      ]);
      normList.push(dst);
    }

    const firstBox = measureAlphaBBox(normList[0]);
    const lastBox = measureAlphaBBox(normList[normList.length - 1]);
    const baselineDriftPx =
      firstBox && lastBox ? Math.abs(firstBox.y + firstBox.h - (lastBox.y + lastBox.h)) : 0;
    const frames = normList.length;
    const cols = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(frames * (cellHeight / cellWidth)))));
    const rows = Math.ceil(frames / cols);

    if (qaOut) {
      const picks: string[] = [];
      for (let k = 0; k < 12; k++) {
        const idx = Math.min(normList.length - 1, Math.round((k / 11) * (normList.length - 1)));
        picks.push(normList[idx]);
      }
      mkdirSync(join(qaOut, ".."), { recursive: true });
      run("magick", [
        "montage",
        ...picks,
        "-tile",
        "6x2",
        "-geometry",
        `${Math.round(cellWidth * 0.55)}x${Math.round(cellHeight * 0.55)}+4+4`,
        "-background",
        "#161218",
        "-bordercolor",
        "#2a2430",
        "-border",
        "1",
        qaOut,
      ]);
    }

    if (!dryRun) {
      mkdirSync(outDir, { recursive: true });
      const atlasFile = join(outDir, `${action}.webp`);
      const webmFile = join(outDir, `${action}.webm`);

      run("magick", [
        "montage",
        ...normList,
        "-tile",
        `${cols}x${rows}`,
        "-geometry",
        `${cellWidth}x${cellHeight}+0+0`,
        "-background",
        "none",
        "-define",
        "webp:lossless=false",
        "-quality",
        "88",
        atlasFile,
      ]);

      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        String(fps),
        "-i",
        join(normDir, "n_%04d.png"),
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-b:v",
        "0",
        "-crf",
        "20",
        "-auto-alt-ref",
        "0",
        webmFile,
      ]);

      const manifestPath = join(outDir, "manifest.json");
      const manifest: MopClipManifest = existsSync(manifestPath)
        ? (JSON.parse(readFileSync(manifestPath, "utf8")) as MopClipManifest)
        : { character, version: 1, generatedAt: new Date().toISOString(), actions: {} };
      const anchorY = Number((1 - (targetMarginBottom + (maxY - refBottomY) * scale) / cellHeight).toFixed(4));
      manifest.actions[action] = {
        atlasUrl: `${publicBase}/${action}.webp`,
        webmUrl: `${publicBase}/${action}.webm`,
        cols,
        rows,
        frames,
        fps,
        cellWidth,
        cellHeight,
        anchorX: 0.5,
        anchorY,
        baselineDriftPx,
        edgeClippedFrames,
        sourceClip: basename(absInput),
      };
      manifest.generatedAt = new Date().toISOString();
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    }

    console.log(
      JSON.stringify({
        action,
        source: basename(absInput),
        alphaMode: info.alphaMode,
        frames,
        cols,
        rows,
        atlasSize: `${cols * cellWidth}x${rows * cellHeight}`,
        baselineDriftPx,
        edgeClippedFrames,
        aspect: `${cropW}x${cropH}`,
        qaOut,
      }),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
