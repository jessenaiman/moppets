/**
 * Export Moppet performances as videos to edit and share: the stage, frame-exact against the app's
 * own mix, with the words as captions. For each lesson:
 *
 *   out/video/<slug>/stage.mp4      the stage (H.264, 30 fps) with the full mix (AAC)
 *   out/video/<slug>/mix.wav        the mix alone, as the app's WAV export makes it
 *   out/video/<slug>/captions.srt   the lyric lines, or a skit's lines with their speakers
 *
 * Frames are not screen-recorded: the whole performance is rendered first, then the page draws each
 * frame on the song's clock (window.__choir.capture, see MoppetPanel.tsx) and it is screenshotted, so
 * mouths, gestures and dance frames match the sound exactly however slow the capture is.
 * tools/moppet-edit.ts then builds FilmCraft and EffectCraft projects from these.
 *
 * Usage: bun tools/moppet-video.ts [lesson ...] [--url http://127.0.0.1:5318/] [--fps 30] [--width 1080]
 *        (against `bun run preview`; lessons are the store's ids, e.g. autocomplete toaster round)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : dflt;
};
const url = opt("url", "http://127.0.0.1:5318/");
const fps = Number(opt("fps", "30"));
const width = Number(opt("width", "1080"));
const lessons = args.length ? args : ["autocomplete", "toaster"];

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
// twice the pixels of the layout, so the puppets are crisp in a 1080-wide video
const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(url, { waitUntil: "networkidle" });
await page.getByRole("radio", { name: "Moppets", exact: true }).click();
await page.waitForSelector(".stage .puppet");

type Capture = { wav: string; seconds: number; title: string; kind: string; captions: { start: number; end: number; text: string; who: string }[] };
type W = { __choir: { capture: { prepare(l: string): Promise<Capture>; begin(): void; frame(t: number, dt: number): void; end(): void } } };
const { srt } = await import("../src/choir/captions.ts");

for (const lesson of lessons) {
  const t0 = performance.now();
  // the page needs a user gesture to start audio, then renders the whole performance
  await page.locator(".stage").click({ position: { x: 5, y: 5 } });
  const cap = await page.evaluate((l) => (window as unknown as W).__choir.capture.prepare(l), lesson);
  const slug = cap.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dir = `out/video/${slug}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/mix.wav`, Buffer.from(cap.wav, "base64"));
  writeFileSync(`${dir}/captions.srt`, srt(cap.captions, cap.kind === "skit"));
  console.log(`${cap.title}: ${cap.seconds.toFixed(1)} s rendered in ${((performance.now() - t0) / 1000).toFixed(0)} s, ${cap.captions.length} captions`);

  await page.evaluate(() => (window as unknown as W).__choir.capture.begin());
  const box = (await page.locator(".stage").boundingBox())!;
  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-i", `${dir}/mix.wav`, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", `${dir}/stage.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<number>((ok) => ff.on("close", (c) => ok(c ?? 1)));
  const frames = Math.ceil(cap.seconds * fps);
  // a second of settling first, so the springs start from where the performance begins
  for (let k = -fps; k < frames; k++) {
    const t = Math.max(0, k / fps);
    await page.evaluate(([time, dt]) => (window as unknown as W).__choir.capture.frame(time, dt), [t, 1 / fps]);
    if (k < 0) continue;
    const png = await page.screenshot({ clip, type: "png" });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    if (k % (fps * 10) === 0) process.stdout.write(`  ${(k / fps).toFixed(0)} s / ${cap.seconds.toFixed(0)} s\r`);
  }
  ff.stdin.end();
  const code = await done;
  await page.evaluate(() => (window as unknown as W).__choir.capture.end());
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  console.log(`  → ${dir}/stage.mp4 (${clip.width * 2}×${clip.height * 2}, ${frames} frames) in ${((performance.now() - t0) / 1000).toFixed(0)} s total`);
}
await browser.close();
