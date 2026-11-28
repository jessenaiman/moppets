#!/usr/bin/env bun
/**
 * Normalizes Canon v2 `#00FF00` (and RGBA WebM) full-motion clips into uniform `576x720` 24 fps
 * H.264 `#00FF00` FMV streams under `public/moppets/tabby/fmv/` + `manifest.json` + QA lineup sheet.
 *
 * Ensures every action (`idle`, `sing`, `belt`, `chuckle`, `walk`, `toast`, `bow`) shares the exact
 * same character scale (`bodyHeightNorm`) and grounded floor anchor (`anchorX=0.5`, `anchorY=0.93`)
 * so state transitions in `THREE.VideoTexture` have zero size pop and zero foot drift.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export interface MopFmvClipSpec {
  videoUrl: string;
  width: number;
  height: number;
  aspect: number;
  fps: number;
  frames: number;
  durationSec: number;
  loop: boolean;
  anchorX: number;
  anchorY: number;
  bodyHeightNorm: number;
  sourceFile: string;
}

export interface MopFmvManifest {
  character: string;
  canonVersion: "canon-v2";
  generatedAt: string;
  fallbackImageUrl: string;
  actions: Record<string, MopFmvClipSpec>;
}

interface ClipSource {
  action: string;
  src: string;
  loop: boolean;
  /** Keep optional trim when a clip has lead-out/static tail frames */
  maxDurationSec?: number;
}

const OUT_W = 576;
const OUT_H = 720;
const STAND_H = 516;
const FOOT_Y = 670; // anchorY = 670/720 = 0.9306

const SOURCES_FILE = "/run/media/jesse/Speedy/Work/chimera-moppets/public/moppets/tabby/fmv-sources.json";
const OUT_DIR = "/run/media/jesse/Speedy/Work/chimera-moppets/public/moppets/tabby/fmv";
const MANIFEST_PATH = "/run/media/jesse/Speedy/Work/chimera-moppets/public/moppets/tabby/manifest.json";
const QA_LINEUP = "/home/jesse/.gemini/antigravity/brain/3424df23-2c1e-4c4f-a0a5-4565b41ef221/scratch/fmv-audit/normalized_lineup.png";

function probeClip(src: string): { width: number; height: number; durationSec: number; hasAlpha: boolean } {
  const args = src.endsWith(".webm")
    ? ["-v", "error", "-c:v", "libvpx-vp9", "-i", src, "-show_entries", "stream=width,height,pix_fmt:format=duration", "-of", "json"]
    : ["-v", "error", "-i", src, "-show_entries", "stream=width,height,pix_fmt:format=duration", "-of", "json"];
  const raw = execFileSync("ffprobe", args, { encoding: "utf8" });
  const parsed = JSON.parse(raw) as {
    streams?: { width?: number; height?: number; pix_fmt?: string }[];
    format?: { duration?: string };
  };
  const st = parsed.streams?.[0] ?? {};
  const hasAlpha = (st.pix_fmt ?? "").includes("a");
  return {
    width: st.width ?? 1280,
    height: st.height ?? 720,
    durationSec: Number(parsed.format?.duration ?? 4),
    hasAlpha,
  };
}

function measureForegroundBox(
  src: string,
  hasAlpha: boolean,
  durationSec: number,
): {
  unionBox: [number, number, number, number];
  restHeight: number;
  medianCenterX: number;
  medianFootY: number;
} {
  const info = execFileSync(
    "python3",
    [
      "-c",
      `
import json, subprocess, sys
from PIL import Image

src = sys.argv[1]
has_alpha = sys.argv[2] == "1"
dur = float(sys.argv[3])
n_samples = 16
fps = n_samples / max(1.0, dur)

probe = json.loads(subprocess.check_output(
    ["ffprobe", "-v", "error"] + (["-c:v", "libvpx-vp9"] if src.endswith(".webm") else []) +
    ["-i", src, "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json"],
    text=True
))
w = probe["streams"][0]["width"]
h = probe["streams"][0]["height"]

cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
if src.endswith(".webm"):
    cmd += ["-c:v", "libvpx-vp9"]
cmd += ["-i", src, "-vf", f"fps={fps:.4f}", "-f", "rawvideo", "-pix_fmt", "rgba", "-"]
raw = subprocess.check_output(cmd)
frame_bytes = w * h * 4
boxes = []
heights = []
cxs = []
fys = []
for idx in range(len(raw) // frame_bytes):
    chunk = raw[idx * frame_bytes:(idx + 1) * frame_bytes]
    im = Image.frombytes("RGBA", (w, h), chunk)
    px = im.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    step = 2 if w >= 700 else 1
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b, a = px[x, y]
            fg = (a > 24) if has_alpha else ((g - max(r, int(b * 1.05))) < 45)
            if fg:
                if x < minx: minx = x
                if y < miny: miny = y
                if x > maxx: maxx = x
                if y > maxy: maxy = y
    if maxx > minx and maxy > miny:
        boxes.append((minx, miny, maxx, maxy))
        heights.append(maxy - miny)
        cxs.append((minx + maxx) / 2.0)
        fys.append(maxy)

ux0 = min(b[0] for b in boxes)
uy0 = min(b[1] for b in boxes)
ux1 = max(b[2] for b in boxes)
uy1 = max(b[3] for b in boxes)
heights.sort()
cxs.sort()
fys.sort()
rest_h = heights[int(len(heights) * 0.7)]
med_cx = cxs[len(cxs) // 2]
med_fy = fys[int(len(fys) * 0.7)]
print(json.dumps({
    "unionBox": [ux0, uy0, ux1, uy1],
    "restHeight": rest_h,
    "medianCenterX": med_cx,
    "medianFootY": med_fy,
}))
`,
      src,
      hasAlpha ? "1" : "0",
      String(durationSec),
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(info.trim());
}

if (import.meta.main) {
  const sources = JSON.parse(await Bun.file(SOURCES_FILE).text()) as ClipSource[];
  mkdirSync(OUT_DIR, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "mop-fmv-"));

  try {
    const actions: Record<string, MopFmvClipSpec> = {};
    const qaInputs: string[] = [];

    for (const item of sources) {
      const info = probeClip(item.src);
      const dur = item.maxDurationSec ? Math.min(info.durationSec, item.maxDurationSec) : info.durationSec;
      const box = measureForegroundBox(item.src, info.hasAlpha, dur);
      const scale = STAND_H / Math.max(120, box.restHeight);
      const scaledW = Math.max(2, Math.round(info.width * scale) & ~1);
      const scaledH = Math.max(2, Math.round(info.height * scale) & ~1);

      const cxScaled = box.medianCenterX * (scaledW / info.width);
      const fyScaled = box.medianFootY * (scaledH / info.height);
      const offsetX = Math.round(OUT_W / 2 - cxScaled);
      const offsetY = Math.round(FOOT_Y - fyScaled);

      const outMp4 = join(OUT_DIR, `${item.action}.mp4`);
      const decodeArgs = item.src.endsWith(".webm") ? ["-c:v", "libvpx-vp9"] : [];
      const trimArgs = item.maxDurationSec ? ["-t", String(dur)] : [];

      // Create pure #00FF00 background canvas and overlay scaled clip aligned to uniform (cx=OUT_W/2, footY=FOOT_Y)
      const bgExpr = `color=c=#00FF00:s=${OUT_W}x${OUT_H}:r=24`;
      const fgChain = info.hasAlpha
        ? `[0:v]fps=24,scale=${scaledW}:${scaledH}:flags=lanczos,format=rgba[fg]`
        : `[0:v]fps=24,scale=${scaledW}:${scaledH}:flags=lanczos,format=rgb24[fg]`;
      const vf = `${bgExpr}[bg];${fgChain};[bg][fg]overlay=x=${offsetX}:y=${offsetY}:shortest=1,format=yuv420p`;

      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          ...decodeArgs,
          "-i",
          item.src,
          ...trimArgs,
          "-filter_complex",
          vf,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-profile:v",
          "high",
          "-crf",
          "18",
          "-g",
          "12",
          "-movflags",
          "+faststart",
          "-an",
          outMp4,
        ],
        { stdio: "inherit" },
      );

      const outProbeRaw = execFileSync(
        "ffprobe",
        ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_frames:format=duration", "-of", "json", outMp4],
        { encoding: "utf8" },
      );
      const outProbe = JSON.parse(outProbeRaw) as {
        streams?: { width?: number; height?: number; nb_frames?: string }[];
        format?: { duration?: string };
      };
      const outDur = Number(outProbe.format?.duration ?? dur);
      const outFrames = Number(outProbe.streams?.[0]?.nb_frames ?? Math.round(outDur * 24));

      actions[item.action] = {
        videoUrl: `/moppets/tabby/fmv/${item.action}.mp4`,
        width: OUT_W,
        height: OUT_H,
        aspect: OUT_W / OUT_H,
        fps: 24,
        frames: outFrames,
        durationSec: Number(outDur.toFixed(3)),
        loop: item.loop,
        anchorX: 0.5,
        anchorY: Number((FOOT_Y / OUT_H).toFixed(4)),
        bodyHeightNorm: Number((STAND_H / OUT_H).toFixed(4)),
        sourceFile: basename(item.src),
      };

      const qaImg = join(tmp, `${item.action}.png`);
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          (outDur * 0.45).toFixed(2),
          "-i",
          outMp4,
          "-frames:v",
          "1",
          "-vf",
          `scale=240:300,drawtext=text='${item.action}':x=10:y=10:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.7`,
          qaImg,
        ],
        { stdio: "inherit" },
      );
      qaInputs.push(qaImg);
      console.log(`Prepared ${item.action}: ${outFrames}f (${outDur.toFixed(2)}s) scale=${scale.toFixed(3)} src=${basename(item.src)}`);
    }

    // Build side-by-side normalized lineup QA contact sheet
    if (qaInputs.length) {
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          ...qaInputs.flatMap((p) => ["-i", p]),
          "-filter_complex",
          `hstack=inputs=${qaInputs.length}`,
          QA_LINEUP,
        ],
        { stdio: "inherit" },
      );
    }

    const manifest: MopFmvManifest = {
      character: "tabby",
      canonVersion: "canon-v2",
      generatedAt: new Date().toISOString(),
      fallbackImageUrl: "/moppets/tabby/canon-front.webp",
      actions,
    };
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log("Wrote manifest:", MANIFEST_PATH);
    console.log("Wrote lineup QA:", QA_LINEUP);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
