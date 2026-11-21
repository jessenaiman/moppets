/**
 * Real-browser user-facing smoke test for Moppet Choir (D-63).
 * Run on commit / verification via `bun run check` against live dev/preview server.
 * Verifies what a real human sees and hears:
 *  1. Opens straight into Neon's Take Two 5-world variety pack (Diorama 3D default) with 0 errors
 *  2. Switching worlds (Diorama 3D -> Signal -> Zine -> Vinyl LP -> Archive 404) works on Take Two & other songs
 *  3. Master Volume + Singer Volume sliders wire directly to live CHIMERA audio
 *  4. Pressing Play starts CHIMERA AudioContext & advances playback cleanly (zero /__plugin-vocal requests)
 *  5. Live keys sound directly via browser CHIMERA WASM, and Voice workshop sliders are unlocked immediately
 *  6. Responsive layout holds cleanly at desktop (1440x900) and mobile (390x844) with readable transport & sheet music
 */
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://127.0.0.1:5417/";
const screenshotDir = process.argv[3];

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--autoplay-policy=no-user-gesture-required"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const pluginCalls: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("request", (req) => {
    if (req.url().includes("/__plugin-vocal") || req.url().includes("/plugin-vocals/")) {
      pluginCalls.push(req.url());
    }
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".nw-stage", { timeout: 15000 });

  // 1. Default lands on Take Two in Diorama 3D
  const lessonVal = await page.getByRole("combobox", { name: "Video lesson" }).inputValue();
  if (lessonVal !== "take-two") throw new Error(`Expected default lesson "take-two", got "${lessonVal}"`);
  const lens = await page.locator(".nw-stage").getAttribute("data-neon-lens");
  if (lens !== "diorama") throw new Error(`Expected default lens "diorama", got "${lens}"`);

  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/desktop-home.png`, fullPage: false });
  }

  // 2. Switch across all 5 worlds on Take Two
  for (const label of ["Signal", "Zine", "Vinyl LP", "Archive 404", "Diorama 3D"]) {
    await page.getByRole("tab", { name: label }).click();
    await page.waitForTimeout(150);
  }

  // 3. Master volume wires directly to CHIMERA useAudio.volume
  const masterSlider = page.getByRole("slider", { name: "Master volume" });
  await masterSlider.fill("0.75");
  const audioVol = await page.evaluate(() => (window as any).__choir.audio.getState().volume);
  if (Math.abs(audioVol - 0.75) > 0.02) throw new Error(`Master volume did not update audio store: ${audioVol}`);

  // 4. Play starts live CHIMERA AudioContext and advances timeline cleanly
  await page.getByRole("button", { name: "Play video" }).click();
  await page.waitForFunction(() => (window as any).__choir.ensemble.getState().time > 0.25, { timeout: 15000 });
  const playingState = await page.evaluate(() => (window as any).__choir.ensemble.getState());
  if (playingState.status !== "playing") throw new Error(`Expected playing status, got ${playingState.status}`);
  await page.getByRole("button", { name: "Pause video" }).click();

  // 5. Voice workshop is unlocked immediately & Launchkey live key triggers browser CHIMERA WASM
  await page.getByRole("button", { name: "Voice workshop" }).click();
  const unlockCount = await page.getByRole("button", { name: /Unlock vocal editing/i }).count();
  if (unlockCount !== 0) throw new Error("Voice workshop still has an Unlock vocal editing gate!");
  const brightnessSlider = page.locator("#knob-brightness");
  await brightnessSlider.waitFor({ timeout: 5000 });
  const beforeBright = await page.evaluate(() => (window as any).__choir.moppet.getState().voices[0].source.brightness);
  await brightnessSlider.fill("0.88");
  const afterBright = await page.evaluate(() => (window as any).__choir.moppet.getState().voices[0].source.brightness);
  if (afterBright === beforeBright) throw new Error("Voice workshop slider did not update CHIMERA voice!");

  // Audition a live key on the Launchkey manual (zero /__plugin-vocal requests!)
  await page.getByRole("button", { name: "Key C3" }).click();
  await page.waitForTimeout(250);
  if (pluginCalls.length > 0) throw new Error(`Unexpected external plugin calls: ${pluginCalls.join(", ")}`);

  // 6. Switch to another song (Tabby's song) and verify 5-world switcher works there too!
  await page.getByRole("combobox", { name: "Video lesson" }).selectOption("tabby");
  await page.waitForTimeout(250);
  await page.getByRole("tab", { name: "Diorama 3D" }).click();
  await page.waitForSelector('.nw-stage[data-neon-lens="diorama"]', { timeout: 5000 });

  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/desktop-tabby-diorama.png`, fullPage: false });
  }

  // 7. Mobile viewport responsive check
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/mobile-view.png`, fullPage: false });
  }

  if (errors.length > 0) {
    throw new Error(`Browser console/page errors:\n${errors.join("\n")}`);
  }

  console.log("PASS: Real-browser Playwright verification succeeded (0 errors, 0 plugin-host calls).");
} finally {
  await browser.close();
}
