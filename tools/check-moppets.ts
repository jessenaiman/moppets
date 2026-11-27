#!/usr/bin/env bun
/**
 * Real-Chromium end-to-end verification for CHIMERA Moppets Studio (/), Airway Lab (/?view=chimera),
 * and 3D Rig Playground (/rig.html), including live CHIMERA singing telemetry and 1280x720 video export.
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
  // 1. Studio / desktop verification
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
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(outDir, "01-studio-idle.png"), fullPage: true });

  // 2. Click Play and verify CHIMERA MIDI singing telemetry
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
    const ms = (window as unknown as { __moppetStudio?: { getFrame?: () => { phraseText: string; wordText: string; cueAction: string } } }).__moppetStudio;
    return {
      sampleRate: e?.ctx?.sampleRate ?? 0,
      rms: e?.latest?.t?.outRms ?? 0,
      f0: e?.latest?.t?.f0 ?? 0,
      frame: ms?.getFrame?.() ?? null,
    };
  });
  console.log("Singing telemetry:", JSON.stringify(singingTele));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, "02-studio-singing.png"), fullPage: true });

  // 3. Cycle action pads + camera close-up and capture stage shots
  await page.locator('[data-action="belt"]').click();
  await page.locator('[data-cam="closeup"]').click();
  await page.waitForTimeout(650);
  await page.screenshot({ path: join(outDir, "03-belt-closeup.png") });

  await page.locator('[data-action="walk"]').click();
  await page.locator('[data-cam="wide"]').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(outDir, "04-walk-wide.png") });

  await page.locator('[data-action="bow"]').click();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(outDir, "05-bow-wide.png") });

  // Reset overrides & stop song before export test
  await page.locator('[data-action="bow"]').click();
  await page.locator('[data-cam="auto"]').click();
  await page.locator('[data-testid="play-btn"]').click();
  await page.waitForTimeout(300);

  // 4. Test 1280x720 Export Video
  await page.locator('[data-testid="export-btn"]').click();
  await page.waitForTimeout(3600);
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
  if (!(dur >= 2.0)) errors.push(`Exported video duration too short: ${dur}s`);
  if (!(maxVolDb > -35)) errors.push(`Exported audio silent or too quiet: max_volume=${maxVolDb} dB`);

  await page.close();

  // 5. Verify Airway Lab (/?view=chimera) & /rig.html still load cleanly
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
