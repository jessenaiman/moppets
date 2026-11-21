/**
 * Real-browser user-facing smoke test for Moppet Choir (`S-28` + `S-29`).
 * Run on commit / verification via `bun run check` against live dev/preview server.
 * Verifies:
 *  1. Opens straight into Neon's Take Two 3D Folded Songbook (data-lead-art="neon")
 *  2. Switching to Tabby's song + Diorama 3D mounts TABBY (NOT Neon!) with Tabby's title & sprite
 *  3. Switching to Found Things + Diorama 3D mounts the multi-singer ensemble across the 3D book
 *  4. CHIMERA 3D X-Ray lens renders live multi-head anatomical airways for the song's cast
 *  5. All 6 world lenses switch cleanly with 0 console/page errors
 *  6. Master Volume, unlocked Voice workshop + CHIMERA Physics Presets, live WASM keys (0 plugin-host calls)
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

  // 1. Default lands on Take Two in Diorama 3D with Neon
  const lessonCombo = page.getByRole("combobox", { name: "Video lesson" });
  if ((await lessonCombo.inputValue()) !== "take-two") throw new Error("Expected default lesson take-two");
  const initialLead = await page.locator(".nw-stage").getAttribute("data-lead-art");
  if (initialLead !== "neon") throw new Error(`Expected Neon on Take Two, got ${initialLead}`);

  // 2. Switch to Tabby's song + Diorama 3D -> MUST show TABBY, NOT Neon!
  await lessonCombo.selectOption("tabby");
  await page.waitForTimeout(200);
  await page.getByRole("tab", { name: "Diorama 3D" }).click();
  await page.waitForSelector('.nw-stage[data-world-lens="diorama"]', { timeout: 5000 });
  const tabbyLead = await page.locator(".nw-stage").getAttribute("data-lead-art");
  const tabbyTitle = await page.locator(".nw-chapter-title").textContent();
  if (tabbyLead !== "tabby") throw new Error(`Expected Tabby in Diorama 3D on Tabby's song, got "${tabbyLead}"`);
  if (!tabbyTitle?.includes("Tabby")) throw new Error(`Expected Tabby title in Diorama 3D, got "${tabbyTitle}"`);
  await page.waitForTimeout(350);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/tabby-diorama.png`, fullPage: false });
  }

  // 3. Switch to Found Things (multi-singer group song) + Diorama 3D -> renders multi-cast standees
  await lessonCombo.selectOption("found");
  await page.waitForTimeout(200);
  await page.getByRole("tab", { name: "Diorama 3D" }).click();
  await page.waitForSelector('.nw-stage[data-world-lens="diorama"]', { timeout: 5000 });
  const castKeys = (await page.locator(".nw-stage").getAttribute("data-cast-keys")) ?? "";
  if (castKeys.split(",").filter(Boolean).length < 4) {
    throw new Error(`Expected multi-singer cast on Found Things Diorama 3D, got "${castKeys}"`);
  }
  await page.waitForTimeout(350);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/found-ensemble-diorama.png`, fullPage: false });
  }

  // 4. Switch to CHIMERA 3D X-Ray lens on Found Things -> renders multi-head anatomical airways
  await page.getByRole("tab", { name: "CHIMERA 3D" }).click();
  await page.waitForSelector('.nw-stage[data-world-lens="chimera"]', { timeout: 5000 });
  const xrayHeads = await page.locator(".nw-xray-card").count();
  if (xrayHeads < 4) throw new Error(`Expected >= 4 CHIMERA 3D heads on Found Things, got ${xrayHeads}`);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/found-chimera-3d.png`, fullPage: false });
  }

  // 5. Switch across remaining lenses cleanly
  for (const label of ["Signal", "Zine", "Vinyl LP", "Archive 404", "Diorama 3D"]) {
    await page.getByRole("tab", { name: label }).click();
    await page.waitForTimeout(120);
  }

  // 6. Master volume + Play CHIMERA audio + unlocked Voice workshop + CHIMERA Physics Preset + live WASM key
  await lessonCombo.selectOption("take-two");
  await page.waitForTimeout(200);
  const masterSlider = page.getByRole("slider", { name: "Master volume" });
  await masterSlider.fill("0.8");
  const audioVol = await page.evaluate(() => (window as any).__choir.audio.getState().volume);
  if (Math.abs(audioVol - 0.8) > 0.02) throw new Error(`Master volume did not update audio store: ${audioVol}`);

  await page.getByRole("button", { name: "Play video" }).click();
  await page.waitForFunction(() => (window as any).__choir.ensemble.getState().time > 0.25, { timeout: 15000 });
  await page.getByRole("button", { name: "Pause video" }).click();

  await page.getByRole("button", { name: "Voice workshop" }).click();
  const tuvanBtn = page.getByRole("button", { name: "Tuvan Throat (Sygyt)" });
  await tuvanBtn.waitFor({ timeout: 5000 });
  await tuvanBtn.click();
  const ventricular = await page.evaluate(() => (window as any).__choir.moppet.getState().voices[0].artic.ventricular);
  if (ventricular < 0.8) throw new Error(`Expected Tuvan preset ventricular >= 0.8, got ${ventricular}`);

  await page.getByRole("button", { name: "Key C3" }).click();
  await page.waitForTimeout(250);
  if (pluginCalls.length > 0) throw new Error(`Unexpected external plugin calls: ${pluginCalls.join(", ")}`);

  if (errors.length > 0) {
    throw new Error(`Browser console/page errors:\n${errors.join("\n")}`);
  }

  console.log(`PASS: OO Performer & 6-World verification succeeded (Tabby=${tabbyLead}, FoundCast=${castKeys}, XRayHeads=${xrayHeads}, 0 errors).`);
} finally {
  await browser.close();
}
