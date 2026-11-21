/** Run against bun run preview. The live instrument must load independently of the screening desk. */
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:5418";
const browser = await chromium.launch({executablePath: process.env.CHROME ?? "/usr/bin/chromium"});

// Inspect the Vite source maps of the JavaScript actually requested by this tab.
async function loadedModules(page: Page) {
  const requests = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter(entry => new URL(entry.name).pathname.endsWith(".js"))
    .map(entry => entry.name)
    .filter(url => !new URL(url).pathname.includes("/rolldown-runtime-")));
  const sources = await Promise.all(requests.map(async url => {
    const response = await page.request.get(url + ".map");
    assert(response.ok(), `Missing source map for ${url}`);
    return (await response.json()).sources as string[];
  }));
  return sources.flat().join("\n");
}

try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/?mode=live");
  const toggle = page.getByRole("button", {name: "Live puppets", exact: true});
  await toggle.waitFor();
  assert.doesNotMatch(await loadedModules(page), /node_modules\/(?:remotion|@remotion|vexflow|three)\//);
  await page.locator(".moppet-play").first().click();
  await page.getByRole("button", {name: "Stop playback"}).first().click();

  await page.getByRole("button", {name: /Music desk/}).click();
  await page.locator(".s-score").waitFor();
  assert.match(await loadedModules(page), /node_modules\/vexflow\//);
  assert.doesNotMatch(await loadedModules(page), /node_modules\/(?:remotion|three)\//);
  await page.getByRole("button", {name: /Music desk/}).click();
  await toggle.click();
  const picker = page.getByLabel("Video lesson");
  await picker.waitFor();
  assert.match(await loadedModules(page), /node_modules\/remotion\//);
  assert.doesNotMatch(await loadedModules(page), /node_modules\/three\//);

  for (const id of ["chip", "tabby", "gruff", "intro", "round"]) {
    await picker.selectOption(id);
    await page.getByRole("button", {name: "Play video", exact: true}).click();
    await page.waitForFunction(id => Array.from(document.querySelectorAll("audio"))
      .some(audio => audio.currentSrc.endsWith("/" + id + ".mp3") && audio.currentTime > 0.2 && !audio.paused), id);
    await page.getByRole("button", {name: /Music desk/}).click();
    await page.getByRole("button", {name: /Edit words/}).click();
    const inputs = page.locator(".words-line input");
    const original = await inputs.first().inputValue();
    const replacement = await inputs.nth(1).inputValue();
    await inputs.first().fill(replacement);
    await page.locator(".words-editor").getByRole("button", {name: /^Download .+\.song$/}).waitFor();
    await page.locator(".words-editor").getByRole("button", {name: "Revert", exact: true}).click();
    assert.equal(await inputs.first().inputValue(), original);
    await page.getByRole("button", {name: /Music desk/}).click();
  }
  await picker.selectOption("take-two");
  await page.getByRole("button", {name: "Play video", exact: true}).click();
  await page.waitForFunction(() => performance.getEntriesByType("resource").some(e => e.name.includes("/assets/Auditions-")));
  assert.match(await loadedModules(page), /node_modules\/three\//);
  assert.deepEqual(errors, []);
  console.log("Verified live, notation, screening, 3D playback and five editable scores.");
} finally {
  await browser.close();
}
