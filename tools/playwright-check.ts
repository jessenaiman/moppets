/** Verify native Remotion <Player> + ThreeCanvas playback, zero PlayerShell re-renders, authored MIDI staff, and live mode. */
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://127.0.0.1:5418/";
const screenshotDir = process.argv[3];

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--autoplay-policy=no-user-gesture-required"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const failedAssets: string[] = [];
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
  const audioResponses: number[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname === "/rehearsal/audio/found.mp3") {
      audioResponses.push(response.status());
    }
    if (response.status() >= 400 && !pathname.startsWith("/__video/") && !pathname.startsWith("/__rehearsal/")) {
      failedAssets.push(`${response.status()} ${pathname}`);
    }
  });

  const appUrl = (query: string) => new URL(query, url).href;

  for (const route of ["?watch=found", "?act=found"]) {
    await page.goto(appUrl(route), { waitUntil: "networkidle" });
    const shell = page.locator('[data-player-shell="native"]');
    const stage = page.getByRole("img", { name: "Cast stage" });
    const score = page.getByRole("region", { name: "Combined choir score" });
    const scrubber = page.getByRole("slider", { name: "Seek performance" });
    await stage.locator("canvas").waitFor();
    await score.getByRole("group", { name: /Vocal notation, bars/ }).first().locator("svg").waitFor();

    const canvasCount = await stage.locator("canvas").count();
    const maxFrame = await scrubber.getAttribute("max");
    if (canvasCount !== 1 || maxFrame !== "5351") {
      throw new Error(`Wrong canvas count (${canvasCount}) or Found Things duration (${maxFrame}) on ${route}`);
    }

    // Verify no <video> / <Html5Video> tags exist inside the active player shell
    const videoCount = await shell.locator("video").count();
    if (videoCount !== 0) {
      throw new Error(`Banned <video> element found inside PlayerShell on ${route} (count=${videoCount})`);
    }

    const rendersBeforePlay = Number(await shell.getAttribute("data-renders"));
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(
      () => Number(document.querySelector<HTMLInputElement>('[aria-label="Seek performance"]')?.value) >= 60,
      undefined,
      { timeout: 15000 },
    );
    const rendersDuringPlay = Number(await shell.getAttribute("data-renders"));
    if (rendersDuringPlay !== rendersBeforePlay) {
      throw new Error(`PlayerShell re-rendered during playback on ${route}: ${rendersBeforePlay} -> ${rendersDuringPlay}`);
    }

    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = await scrubber.inputValue();
    await page.waitForTimeout(250);
    if ((await scrubber.inputValue()) !== paused) {
      throw new Error(`Pause did not stop the playhead on ${route}`);
    }

    if (screenshotDir && route === "?act=found") {
      await page.screenshot({ path: `${screenshotDir}/act-found-playing.png` });
    }

    // Scrub to mid-song and verify the authored MIDI shared staff advances cleanly
    await scrubber.fill("2520");
    const lateSystem = await score.locator('[aria-current="step"]').getAttribute("aria-label");
    if (!lateSystem || lateSystem === "Vocal notation, bars 1–4") {
      throw new Error(`Authored score stayed on opening system on ${route}: ${lateSystem}`);
    }
    await scrubber.press("End");
    if ((await scrubber.inputValue()) !== "5351") {
      throw new Error(`Scrubbing did not reach final frame on ${route}`);
    }
    if (route === "?act=found") {
      await scrubber.fill("60");
      await page.getByRole("button", { name: "Auto-follow", exact: true }).click();
      if ((await stage.getAttribute("data-camera")) !== "wide") {
        throw new Error("Wide camera toggle did not reach CastStage");
      }
      await page.getByRole("button", { name: "Wide", exact: true }).click();
      if ((await stage.getAttribute("data-camera")) !== "follow") {
        throw new Error("Auto-follow camera toggle did not reach CastStage");
      }
    }
    console.log(
      `PASS ${route}: 1 ThreeCanvas, 0 <video>, full 5351f master, PlayerShell renders=${rendersBeforePlay}->${rendersDuringPlay} (0 playback re-renders), pause, scrub, authored staff (${lateSystem})`,
    );
  }

  if (!audioResponses.some((status) => status === 200 || status === 206)) {
    throw new Error(`Chromium did not receive /rehearsal/audio/found.mp3 (statuses=${audioResponses.join(",")})`);
  }

  // Verify live instrument mode (?mode=live) still works independently
  await page.goto(appUrl("?mode=live&act=cardboard-horse"), { waitUntil: "networkidle" });
  for (const [label, lens] of [
    ["Caravan 3D", "caravan"],
    ["35mm Reel", "filmstrip"],
    ["CHIMERA 3D", "chimera"],
    ["Signal", "signal"],
    ["Zine", "zine"],
    ["Vinyl LP", "vinyl"],
    ["Diorama 3D", "diorama"],
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await page.locator(`.nw-stage[data-world-lens="${lens}"]`).waitFor();
  }
  await page.getByRole("tab", { name: "Archive 404", exact: true }).click();
  await page.locator(".sc-stage.studio404").waitFor();

  await page.getByRole("slider", { name: "Master volume" }).fill("0.85");
  await page.locator(".moppet-play").click();
  await page.waitForFunction(() => (window as unknown as { __choir: { ensemble: { getState: () => { time: number } } } }).__choir.ensemble.getState().time > 0.25, undefined, { timeout: 15000 });
  await page.getByRole("button", { name: "Stop playback" }).click();

  await page.getByRole("button", { name: "Key C3" }).click();
  await page.waitForTimeout(250);
  if (pluginCalls.length > 0) throw new Error(`Unexpected external plugin calls: ${pluginCalls.join(", ")}`);
  if (failedAssets.length > 0) throw new Error(`HTTP 4xx/5xx asset failures:\n${failedAssets.join("\n")}`);
  if (errors.length > 0) throw new Error(`Browser console/page errors:\n${errors.join("\n")}`);

  console.log("PASS Live Puppets: 8 worlds, CHIMERA live synth, WASM keys, 0 HTTP errors, 0 console/page errors.");
} finally {
  await browser.close();
}
