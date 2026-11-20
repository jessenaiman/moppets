import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const url = process.argv[2];
assert(url, "Usage: bun tools/watch-audio-e2e.mjs <screening-url>");

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/chromium",
  args: ["--autoplay-policy=no-user-gesture-required"],
});

try {
  const page = await browser.newPage();
  await page.goto(url);
  const tracks = page.locator("#songs + ul audio, #skits + ul audio");
  assert.equal(await tracks.count(), 36);
  assert(await tracks.evaluateAll((players) => players.every((audio) => audio.controls && audio.preload === "none")));
  // The first catalog contained a shorter intro and dialogue exports.
  const minimumSeconds = { intro: 81.6, rerun: 39.9, toaster: 34.9, letter: 29.9 };
  for (const track of await tracks.all()) {
    const source = await track.getAttribute("src");
    assert(source?.endsWith(".mp3"));
    const id = source.split("/").at(-1).slice(0, -4);
    try {
      await track.evaluate(async (audio) => {
        await audio.play();
      }, undefined, { timeout: 8000 });
      const element = await track.elementHandle();
      await page.waitForFunction((audio) => audio.currentTime > 0.15 && audio.webkitAudioDecodedByteCount > 0, element, { timeout: 8000 });
      const duration = await track.evaluate((audio) => {
        audio.currentTime = Math.max(0, audio.duration - 1);
        return audio.duration;
      });
      assert(duration >= (minimumSeconds[id] ?? 1), `Unexpected duration ${duration}`);
      await page.waitForFunction((audio) => !audio.seeking && audio.currentTime > audio.duration - 0.75, element, { timeout: 8000 });
      await track.evaluate((audio) => audio.pause());
    } catch (error) {
      throw new Error(`Playback failed for ${source}`, { cause: error });
    }
  }
  console.log("All 36 recordings decode and play after seeking near the end.");
} finally {
  await browser.close();
}
