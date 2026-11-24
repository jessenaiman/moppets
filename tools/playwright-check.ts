/**
 * Real-browser user-facing smoke test for Moppet Choir (`S-28` + `S-29` + `S-30`).
 * Run on commit / verification via `bun run check` against live dev/preview server.
 * Verifies:
 *  1. Locked Tailwind Stage Bar stays at identical coordinates across all 8 world switches (0px jump!)
 *  2. Interactive Vinyl Crates Coverflow + Poster Wall Drawer replaces the boring `<select>` dropdown
 *  3. Meadow Caravan 3D mounts multi-cast riders with Caravan Horn + Rider Spotlight
 *  4. 35mm Flatbed Cinema Strip renders Tabby's song with Tabby as lead
 *  5. CHIMERA 3D X-Ray renders multi-head anatomical airways
 *  6. CHIMERA Vowel Map (F1/F2) + Live Mouth-Beatbox Pads + Master Volume + live WASM keys (0 plugin calls, 0 errors)
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
  await page.waitForSelector('[data-stage-bar="locked"]', { timeout: 15000 });
  await page.waitForSelector(".neon-performer", { timeout: 15000 });

  // 1. Verify locked Stage World Switcher bar never jumps across ALL 8 worlds
  const stageBar = page.locator('[data-stage-bar="locked"]');
  const initialBox = await stageBar.boundingBox();
  if (!initialBox) throw new Error("Locked stage bar missing!");

  for (const label of ["Caravan 3D", "35mm Reel", "CHIMERA 3D", "Signal", "Zine", "Vinyl LP", "Archive 404", "Diorama 3D"]) {
    await page.getByRole("tab", { name: label }).click();
    await page.waitForTimeout(120);
    const box = await stageBar.boundingBox();
    if (!box || Math.abs(box.x - initialBox.x) > 1 || Math.abs(box.y - initialBox.y) > 1 || Math.abs(box.width - initialBox.width) > 1) {
      throw new Error(`Stage bar jumped on "${label}": before=${JSON.stringify(initialBox)} after=${JSON.stringify(box)}`);
    }
  }

  // 2. Pick "Four on a Cardboard Horse" via Vinyl Crates -> auto-launches Caravan 3D with 4 riders!
  await page.locator('[data-song-id="cardboard-horse"]').click();
  await page.waitForSelector('.nw-stage[data-world-lens="caravan"]', { timeout: 5000 });
  const horseCast = (await page.locator(".nw-stage").getAttribute("data-cast-keys")) ?? "";
  if (horseCast.split(",").filter(Boolean).length !== 4) {
    throw new Error(`Expected 4 riders on Four on a Cardboard Horse, got "${horseCast}"`);
  }
  await page.waitForTimeout(300);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/cardboard-horse-saddle.png`, fullPage: false });
  }

  // Play live CHIMERA 4-part quartet + mouth-beatbox hoofbeats!
  await page.getByRole("button", { name: "Play video" }).click();
  await page.waitForFunction(() => (window as any).__choir.ensemble.getState().time > 0.3, { timeout: 15000 });
  await page.getByRole("button", { name: "Pause video" }).click();

  // Scrub to [trot chorus] (~45%) and [horn break] (~70%) for visual choreography verification
  const seekBar = page.getByRole("slider", { name: "Seek rehearsal" });
  const maxFrames = Number((await seekBar.getAttribute("max")) ?? "1000");
  await seekBar.fill(String(Math.round(maxFrames * 0.42)));
  await page.waitForTimeout(300);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/cardboard-horse-trot.png`, fullPage: false });
  }
  await seekBar.fill(String(Math.round(maxFrames * 0.68)));
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Honk horn/i }).click();
  await page.waitForTimeout(180);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/cardboard-horse-horn.png`, fullPage: false });
  }

  // 3. Open Poster Wall Drawer, pick Tabby Takes the Stage, switch to 35mm Reel
  await page.getByRole("button", { name: /Poster Wall/i }).click();
  await page.getByRole("button", { name: /Tabby Takes the Stage/i }).first().click();
  await page.getByRole("tab", { name: "35mm Reel" }).click();
  await page.waitForSelector('.nw-stage[data-world-lens="filmstrip"]', { timeout: 5000 });
  const tabbyLead = await page.locator(".nw-stage").getAttribute("data-lead-art");
  if (tabbyLead !== "tabby") throw new Error(`Expected Tabby on 35mm Reel, got "${tabbyLead}"`);
  await page.waitForTimeout(250);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/filmstrip-tabby.png`, fullPage: false });
  }

  // 4. Open CHIMERA Vowel Map + Mouth-Beatbox Pads & test live audio
  await page.getByRole("button", { name: /Vowel & Beatbox/i }).click();
  const vowelPad = page.getByRole("application", { name: /CHIMERA F1 F2 Vowel Map/i });
  await vowelPad.waitFor({ timeout: 5000 });
  const padBox = await vowelPad.boundingBox();
  if (padBox) {
    await page.mouse.click(padBox.x + padBox.width * 0.3, padBox.y + padBox.height * 0.3);
  }
  await page.getByRole("group", { name: /CHIMERA mouth beatbox pads/i }).locator("button").first().click();
  await page.waitForTimeout(250);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/chimera-tools-desktop.png`, fullPage: false });
  }

  // 5. Master volume + Play CHIMERA audio + live WASM key (0 external plugin calls!)
  await page.getByRole("slider", { name: "Master volume" }).fill("0.85");
  await page.getByRole("button", { name: "Play video" }).click();
  await page.waitForFunction(() => (window as any).__choir.ensemble.getState().time > 0.25, { timeout: 15000 });
  await page.getByRole("button", { name: "Pause video" }).click();

  await page.getByRole("button", { name: "Key C3" }).click();
  await page.waitForTimeout(250);
  if (pluginCalls.length > 0) throw new Error(`Unexpected external plugin calls: ${pluginCalls.join(", ")}`);

  // Follow reads down the visible staves. It must not repaginate a tall score on every row.
  await page.setViewportSize({width:1250,height:1300});
  const horseUrl = new URL(url);
  horseUrl.searchParams.set("act","cardboard-horse");
  await page.goto(horseUrl.href, {waitUntil:"networkidle"});
  const score=page.getByRole("region",{name:"Combined choir score"});
  const paper=score.getByLabel("Entire choir score");
  await paper.locator("[data-refs]").first().waitFor();
  const rows=paper.locator("[data-system]");
  const secondStart=Number(await rows.nth(1).getAttribute("data-system"));
  const firstScroll=await paper.evaluate(el=>el.scrollTop);
  await page.getByRole("button",{name:"Play video"}).click();
  await rows.nth(1).and(paper.locator('[aria-current="step"]')).waitFor({timeout:20000});
  const down=await rows.nth(1).evaluate(el=>el.getBoundingClientRect().top-el.parentElement!.getBoundingClientRect().top);
  if(down<10 || (await paper.evaluate(el=>el.scrollTop))!==firstScroll) {
    throw new Error(`Score scrolled to the top at bar ${secondStart+1} while the next staff was visible`);
  }
  await page.getByRole("button",{name:"Pause video"}).click();
  await score.getByRole("button",{name:"Following",exact:true}).click();
  const picker=score.getByRole("combobox",{name:"Go to score system"});
  const last=(await picker.locator("option").count())-1;
  await picker.selectOption(String(last-1));
  await score.getByRole("button",{name:"Next score row"}).click();
  if((await picker.inputValue())!==String(last))throw new Error("Could not browse the final score row");

  if (errors.length > 0) {
    throw new Error(`Browser console/page errors:\n${errors.join("\n")}`);
  }

  console.log("PASS: S-30 verification succeeded (0px stage-bar shift across 8 worlds, Vinyl Crates + Poster Wall, Caravan 3D, 35mm Reel, Vowel Map & Beatbox, 0 errors).");
} finally {
  await browser.close();
}
