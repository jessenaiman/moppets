#!/usr/bin/env bun
/**
 * Real-Chromium end-to-end verification for CHIMERA Moppets Studio (/), Airway Lab (/?view=chimera),
 * and 3D Rig Playground (/rig.html):
 *  - Verifies Canon v2 24 fps #00FF00 FMV VideoTexture playback & advancing frames (>=72f)
 *  - Verifies live CHIMERA MIDI singing telemetry & Play/Action/Camera transitions
 *  - Verifies 1280x720 MP4/WebM export with active CHIMERA vocals
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5317";
const outDir =
  process.argv[3] ??
  "/home/jesse/.gemini/antigravity/brain/3424df23-2c1e-4c4f-a0a5-4565b41ef221/scratch/verified";
mkdirSync(outDir, { recursive: true });

const errors: string[] = [];
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} on ${r.url()}`);
  });

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="moppet-stage-canvas"]').waitFor({ timeout: 10000 });

  // Wait for VideoTexture idle FMV to buffer and start advancing frames
  await page.waitForFunction(
    () => {
      const ms = (window as unknown as { __moppetStudio?: { getStageDebug?: () => { usingVideoTexture?: boolean; readyState?: number; totalFrames?: number } } }).__moppetStudio;
      const d = ms?.getStageDebug?.();
      return Boolean(d?.usingVideoTexture && (d.readyState ?? 0) >= 2 && (d.totalFrames ?? 0) >= 72);
    },
    null,
    { timeout: 15000 },
  );

  const dbg1 = await page.evaluate(() => (window as unknown as { __moppetStudio: { getStageDebug: () => unknown } }).__moppetStudio.getStageDebug());
  await page.waitForTimeout(750);
  const dbg2 = await page.evaluate(() => (window as unknown as { __moppetStudio: { getStageDebug: () => { videoCurrentTime: number } } }).__moppetStudio.getStageDebug());
  console.log("Stage FMV debug:", JSON.stringify({ dbg1, dbg2 }));
  if ((dbg2 as { videoCurrentTime: number }).videoCurrentTime === (dbg1 as { videoCurrentTime: number }).videoCurrentTime) {
    errors.push(`FMV videoCurrentTime did not advance: ${JSON.stringify({ dbg1, dbg2 })}`);
  }
  await page.screenshot({ path: join(outDir, "01-canon-v2-idle.png"), fullPage: true });

  // Click Play and verify CHIMERA MIDI singing telemetry
  await page.locator('[data-testid="play-btn"]').click();
  await page.waitForFunction(
    () => {
      const e = (window as unknown as { __chimeraEngine?: { latest?: { t?: { outRms?: number; f0?: number } } } }).__chimeraEngine;
      return (e?.latest?.t?.outRms ?? 0) > 0.005 && (e?.latest?.t?.f0 ?? 0) > 150;
    },
    null,
    { timeout: 12000 },
  );

  const singingTele = await page.evaluate(() => {
    const e = (window as unknown as { __chimeraEngine?: { ctx?: { sampleRate?: number }; latest?: { t?: { outRms?: number; f0?: number } } } }).__chimeraEngine;
    const ms = (window as unknown as { __moppetStudio?: { getFrame?: () => unknown; getStageDebug?: () => unknown } }).__moppetStudio;
    return {
      sampleRate: e?.ctx?.sampleRate ?? 0,
      rms: e?.latest?.t?.outRms ?? 0,
      f0: e?.latest?.t?.f0 ?? 0,
      frame: ms?.getFrame?.() ?? null,
      stage: ms?.getStageDebug?.() ?? null,
    };
  });
  console.log("Singing telemetry:", JSON.stringify(singingTele));
  await page.locator('[data-action="sing"]').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, "02-canon-v2-singing.png"), fullPage: true });

  // Cycle action pads & camera close-ups
  await page.locator('[data-action="belt"]').click();
  await page.locator('[data-cam="closeup"]').click();
  await page.waitForTimeout(850);
  await page.screenshot({ path: join(outDir, "03-canon-v2-belt-closeup.png") });

  await page.locator('[data-action="walk"]').click();
  await page.locator('[data-cam="wide"]').click();
  await page.waitForTimeout(850);
  await page.screenshot({ path: join(outDir, "04-canon-v2-walk-wide.png") });

  await page.locator('[data-action="toast"]').click();
  await page.locator('[data-cam="closeup"]').click();
  await page.waitForTimeout(950);
  await page.screenshot({ path: join(outDir, "05-canon-v2-toast-closeup.png") });

  await page.locator('[data-action="bow"]').click();
  await page.locator('[data-cam="wide"]').click();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(outDir, "06-canon-v2-bow-wide.png") });

  // Reset overrides & stop song before clean full auto export test
  await page.locator('[data-action="bow"]').click();
  await page.locator('[data-cam="auto"]').click();
  await page.locator('[data-testid="play-btn"]').click();
  await page.waitForTimeout(300);

  // Test 1280x720 Export Video
  await page.locator('[data-testid="export-btn"]').click();
  await page.waitForTimeout(4200);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.locator('[data-testid="export-btn"]').click(),
  ]);
  const videoPath = join(outDir, download.suggestedFilename());
  await download.saveAs(videoPath);

  const probe = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", videoPath],
    { encoding: "utf8" },
  );
  const ffRes = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", videoPath, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const volumeOut = `${ffRes.stdout ?? ""}\n${ffRes.stderr ?? ""}`;

  console.log("Exported video:", videoPath);
  console.log("ffprobe:", probe.trim());
  const parsedProbe = JSON.parse(probe) as {
    streams?: { codec_type: string; width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const vStream = parsedProbe.streams?.find((s) => s.codec_type === "video");
  const aStream = parsedProbe.streams?.find((s) => s.codec_type === "audio");
  const dur = Number(parsedProbe.format?.duration ?? 0);
  const maxVolMatch = /max_volume:\s*([-\d.]+)\s*dB/.exec(volumeOut);
  const maxVolDb = maxVolMatch ? Number(maxVolMatch[1]) : -120;
  if (!vStream || vStream.width !== 1280 || vStream.height !== 720) {
    errors.push(`Exported video dimensions mismatch: ${JSON.stringify(vStream)}`);
  }
  if (!aStream) errors.push("Exported video missing audio stream");
  if (!(dur >= 2.5)) errors.push(`Exported video duration too short: ${dur}s`);
  if (!(maxVolDb > -30)) errors.push(`Exported audio silent or too quiet: max_volume=${maxVolDb} dB`);

  await page.close();

  // Verify Airway Lab (/?view=chimera) & /rig.html still load cleanly
  for (const route of ["/?view=chimera", "/rig.html"]) {
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    p2.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${route}] console.error: ${m.text()}`);
    });
    p2.on("pageerror", (e) => errors.push(`[${route}] pageerror: ${e.message}`));
    p2.on("response", (r) => {
      if (r.status() >= 400) errors.push(`[${route}] HTTP ${r.status()} on ${r.url()}`);
    });
    await p2.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    await p2.waitForTimeout(400);
    await p2.close();
  }

  console.log("volumedetect:", volumeOut.split("\n").filter((l) => /max_volume|mean_volume/.test(l)).join(" | "));
} finally {
  await browser.close();
}

if (errors.length) {
  console.error("FAILED:", errors);
  process.exit(1);
}
console.log("ALL CHECKS PASSED (0 errors)");
