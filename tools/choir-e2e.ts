/**
 * Moppet Choir in headless Chromium: live ensemble playback, timing, pause/seek/stop, repeated
 * starts, cancellation, exports, character switching and resource cleanup, plus every upstream mode.
 * Usage: bun tools/choir-e2e.ts [url] [outdir]   (a dev server or preview must be running)
 * Exits non-zero on any failure; prints measured numbers as JSON at the end.
 */
import { chromium, type Page } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { midiBytes } from "../src/choir/midi.ts";
import { makeRound } from "../src/choir/music.ts";

const url = process.argv[2] ?? "http://127.0.0.1:5317/";
const outDir = process.argv[3] ?? "out/choir-e2e";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const errors: string[] = [];
const report: Record<string, unknown> = {};
const fail = (m: string) => {
  errors.push(m);
  console.error("FAIL:", m);
};
const ok = (cond: boolean, m: string) => {
  if (cond) console.log("ok:", m);
  else fail(m);
};

const page: Page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

type W = Window & { __choir: { debug(): { workersAlive: number; sessionsMade: number; hasSession: boolean; singers: { id: string; rendered: number; frames: number; rtf: number }[] }; ensemble: { getState(): { status: string; time: number; duration: number; underruns: number; message: string; howPlaying: string; peak: number; limited: number; rtf: number; progress: number } }; moppet: { getState(): Record<string, never> }; engine: { latest: { body: { female: number; child: number }; t: { outRms: number; f0: number; artic: Float32Array } } | null; analyser: AnalyserNode | null; ctx: AudioContext | null; load: number; overrideTelemetry: (m: unknown) => void }; bench(): Promise<unknown> } };

// ---- every upstream mode still loads and starts
for (const mode of ["Play", "Speak", "Sing", "Bestiary", "Beatbox"]) {
  await page.getByRole("radio", { name: mode, exact: true }).click().catch(() => page.getByRole("button", { name: mode, exact: true }).click());
  await page.waitForTimeout(300);
  if (mode === "Play") {
    await page.getByRole("button", { name: /breathe in and start/i }).click();
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/upstream-${mode.toLowerCase()}.png` });
}
const upstreamOk = await page.evaluate(() => (window as unknown as W).__choir === undefined);
report.upstreamModes = upstreamOk ? "loaded all five before choir mode existed" : "choir loaded early";

await page.getByRole("radio", { name: "Moppet Choir", exact: true }).click().catch(() => page.getByRole("button", { name: "Moppet Choir", exact: true }).click());
await page.waitForTimeout(600);
const start = page.getByRole("button", { name: /start the choir stage/i });
if (await start.count()) await start.click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/moppet-idle.png`, fullPage: true });

// ---- measure this machine
report.bench = await page.evaluate(() => (window as unknown as W).__choir.bench());
console.log("bench:", JSON.stringify(report.bench));

const st = () => page.evaluate(() => {
  const e = (window as unknown as W).__choir.ensemble.getState();
  return { status: e.status as string, time: e.time, duration: e.duration, underruns: e.underruns, message: e.message as string, howPlaying: e.howPlaying as string, peak: e.peak, limited: e.limited, rtf: e.rtf };
});
const dbg = () => page.evaluate(() => (window as unknown as W).__choir.debug());
const until = async (fn: () => Promise<boolean>, ms: number, what: string) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await page.waitForTimeout(100);
  }
  fail(`timed out waiting: ${what}`);
  return false;
};

// ---- live generated composition: major, then minor
const playBtn = page.locator(".moppet-play");
ok((await playBtn.textContent())!.includes("invention"), "the play button names the generated piece");
await playBtn.click();
await until(async () => (await st()).status === "playing", 15000, "live playback starts");
await page.waitForTimeout(2500);
let s1 = await st();
ok(s1.howPlaying === "live", `Auto chose live (rtf ${s1.rtf.toFixed(2)})`);
ok(s1.time > 0.8, `the timeline advanced to ${s1.time.toFixed(2)} s`);
await page.screenshot({ path: `${outDir}/moppet-playing.png`, fullPage: true });

// the analyser hears the selected Moppet, and the puppets' mouths follow telemetry
const measures = await page.evaluate(() => {
  const c = (window as unknown as W).__choir;
  const a = c.engine.analyser!;
  const buf = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return { analyserRms: Math.sqrt(sum / buf.length), telemetryBody: c.engine.latest?.body, tele: c.engine.latest?.t.outRms, f0: c.engine.latest?.t.f0, puppets: [...document.querySelectorAll<HTMLElement>(".puppet")].map((p) => ({ cel: p.style.getPropertyValue("--cel"), mouthOpen: p.classList.contains("mouth-open"), singing: p.classList.contains("singing") })) };
});
report.playingMeasures = measures;
ok(measures.analyserRms > 1e-4, `analyser is hearing a singer (rms ${measures.analyserRms.toExponential(2)})`);
ok(measures.telemetryBody !== undefined, "instrument views are on engine telemetry");

// the lead's sprite must really change: dance frames on the beat, mouth from engine telemetry
const cels = new Set<string>();
let mouthChanges = 0, lastMouth: boolean | null = null;
for (let i = 0; i < 40; i++) {
  const state = await page.evaluate(() => {
    const el = document.querySelectorAll<HTMLElement>(".puppet")[1]; // Scribe, the lead
    return { cel: el.style.getPropertyValue("--cel"), open: el.classList.contains("mouth-open") };
  });
  cels.add(state.cel);
  if (lastMouth !== null && state.open !== lastMouth) mouthChanges++;
  lastMouth = state.open;
  await page.waitForTimeout(60);
}
ok(cels.size >= 3, `the lead dances through sprite frames (${cels.size} frames seen)`);
ok(mouthChanges >= 2, `the lead's mouth opens and closes with telemetry (${mouthChanges} changes)`);

// ---- switching the inspected character during playback changes the instruments to that voice
await page.locator(".puppet").nth(2).click(); // Gruff
await page.waitForTimeout(400);
const bodyAfter = await page.evaluate(() => (window as unknown as W).__choir.engine.latest?.body);
ok(!!bodyAfter && bodyAfter.female === 0 && bodyAfter.child === 0, "the instruments switched to Gruff's body during playback");

// ---- repeated start, pause, resume, seek
await playBtn.click();
await until(async () => (await st()).status === "paused", 3000, "pause");
const pausedAt = (await st()).time;
await page.waitForTimeout(500);
ok(Math.abs((await st()).time - pausedAt) < 0.05, "the timeline holds while paused");
await playBtn.click();
await until(async () => (await st()).status === "playing", 4000, "resume");
await page.waitForTimeout(600);
ok((await st()).time > pausedAt, "the timeline resumed");
await page.evaluate(() => {
  const e = document.querySelector<HTMLInputElement>('input[aria-label="Song position"]')!;
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  proto.set!.call(e, String(Number(e.max) - 4));
  e.dispatchEvent(new Event("input", { bubbles: true }));
});
await until(async () => (await st()).time > 0 && (await st()).status === "playing", 30000, "seek settles");
await page.waitForTimeout(800);
const sought = await st();
ok(sought.time > sought.duration - 6 && sought.time <= sought.duration, `seek moved the playhead (${sought.time.toFixed(2)} of ${sought.duration.toFixed(2)})`);

// ---- plays to the end
await until(async () => (await st()).status === "ended", 40000, "plays to the end");
const ended = await st();
report.generatedMajor = { underruns: ended.underruns, peak: ended.peak, limited: ended.limited, rtf: ended.rtf };
ok(ended.peak > 0.05, `not silent (peak ${ended.peak.toFixed(2)})`);
ok(ended.peak <= 0.93, `bus never exceeds its ceiling (${ended.peak.toFixed(3)})`);

// ---- the round, live, full length: count underruns and mixer drift
await page.getByRole("tab", { name: "02 · The jam round" }).click();
await page.waitForTimeout(200);
ok((await playBtn.textContent())!.toLowerCase().includes("jam round"), "the button says it will play the round");
await page.screenshot({ path: `${outDir}/moppet-round.png`, fullPage: true });
const wall0 = Date.now();
await playBtn.click();
await until(async () => (await st()).status === "playing", 15000, "round starts");
const startAt = Date.now();
await page.waitForTimeout(8000);
await page.screenshot({ path: `${outDir}/moppet-round-playing.png`, fullPage: true });
const mid = await st();
const elapsed = (Date.now() - startAt) / 1000;
report.roundDrift = { timelineS: mid.time, wallS: elapsed, diffS: +(mid.time - elapsed).toFixed(3), rtf: mid.rtf, underruns: mid.underruns, how: mid.howPlaying };
ok(Math.abs(mid.time - elapsed) < 0.35, `timeline tracks wall clock (${(mid.time - elapsed).toFixed(3)} s)`);
await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Stop playback"]')!.click());
await until(async () => (await st()).status === "idle", 2000, "stop");
const afterStopDbg = await dbg();
ok(afterStopDbg.hasSession, "stop keeps the rendered take");
report.roundUnderruns = (await st()).underruns;
console.log("round starting took", Date.now() - wall0, "ms");

// ---- the introduction, a generated minor piece, and a solo: real listening material
const seedInput = page.locator('input[type="number"]');
await page.getByRole("tab", { name: "The first hello" }).click();
await page.waitForTimeout(150);
ok((await playBtn.textContent())!.includes("Meet the whole choir"), "the introduction's button is labelled for the introduction");
await playBtn.click();
await until(async () => (await st()).status === "playing", 15000, "introduction starts");
await page.waitForTimeout(3000);
const introT = await st();
ok(introT.time > 2 && introT.howPlaying === "live", `introduction plays live (${introT.time.toFixed(1)} s)`);
report.introUnderruns = introT.underruns;
await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Stop playback"]')!.click());
await until(async () => (await st()).status === "idle", 2000, "stop intro");

await page.getByRole("tab", { name: "01 · Music school" }).click();
await page.locator('select').filter({ hasText: "Harmonic minor" }).selectOption("minor");
await seedInput.fill("88");
await page.waitForTimeout(150);
ok((await page.evaluate(() => (window as unknown as W).__choir.moppet.getState().piece as unknown as { mode: string; seed: number }).then((p) => p.mode === "minor" && p.seed === 88)), "minor scale and seed reach the score");
await playBtn.click();
await until(async () => (await st()).status === "playing", 15000, "minor piece starts");
await until(async () => (await st()).status === "ended", 120000, "minor piece plays to the end");
const minor = await st();
report.generatedMinor = { underruns: minor.underruns, peak: minor.peak, limited: minor.limited };
ok(minor.peak > 0.05 && minor.peak < 0.93, `minor piece is sound and clean (peak ${minor.peak.toFixed(2)})`);

await page.getByRole("button", { name: "▶ Sing my introduction" }).click();
await until(async () => (await st()).status === "playing", 15000, "solo starts");
ok((await playBtn.textContent())!.includes("Pause"), "solo plays through the same transport");
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Stop playback"]')!.click());
await until(async () => (await st()).status === "idle", 2000, "stop solo");

// song 03: Chip's solo, and the seventh Moppet
await page.getByRole("tab", { name: "03 · Chip’s song" }).click();
await page.waitForTimeout(150);
ok((await playBtn.textContent())!.includes("Chip"), "song 03 has its own label");
await playBtn.click();
await until(async () => (await st()).status === "playing", 15000, "Chip's song starts");
await page.waitForTimeout(2500);
const chip = await st();
ok(chip.time > 1.5 && chip.howPlaying === "live", `Chip's song plays live (${chip.time.toFixed(1)} s)`);
await page.screenshot({ path: `${outDir}/moppet-chip.png`, fullPage: true });
await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Stop playback"]')!.click());
await until(async () => (await st()).status === "idle", 2000, "stop Chip");

// a control reaches the singer during playback
await page.getByRole("tab", { name: "02 · The jam round" }).click();
await playBtn.click();
await until(async () => (await st()).status === "playing", 15000, "round restarts");
await page.locator("#knob-roughness").evaluate((el: HTMLInputElement) => {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  proto.set!.call(el, "0.95");
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(200);
const rough = await page.evaluate(() => {
  const m = (window as unknown as W).__choir.moppet.getState() as unknown as { voices: { source: { roughness: number } }[]; selected: number };
  return m.voices[m.selected].source.roughness;
});
ok(rough === 0.95, "a workbench control writes the selected Moppet's recipe");
await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Stop playback"]')!.click());
await page.waitForTimeout(100);
await page.evaluate(() => ((window as unknown as W).__choir.moppet.getState() as unknown as { reset(): void }).reset());

// ---- start, cancel, start again, many times
for (let i = 0; i < 5; i++) {
  await playBtn.click();
  await page.waitForTimeout(40 + i * 15);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Stop playback"]')!.click());
  await page.waitForTimeout(20);
}
await page.waitForTimeout(300);
const leaked = (await dbg()).workersAlive;
ok(leaked <= 12, `workers after repeated starts: ${leaked} (one session at most)`);
report.workersAfterRepeatedStarts = leaked;

// ---- pre-render fallback with cancel, then a complete WAV + MIDI of the round
await page.locator('select').filter({ hasText: "Pre-render" }).selectOption("prerender");
await page.getByRole("tab", { name: "01 · Music school" }).click();
await playBtn.click();
await until(async () => (await st()).status === "rendering", 4000, "pre-render begins");
await page.waitForTimeout(300);
const progress = await page.evaluate(() => (window as unknown as W).__choir.ensemble.getState().progress as unknown as number);
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await until(async () => (await st()).status === "idle", 3000, "cancel");
ok((await dbg()).workersAlive === 0, "cancel ended the render workers");
report.prerenderProgressBeforeCancel = progress;

await page.getByRole("tab", { name: "02 · The jam round" }).click();
const wavPromise = page.waitForEvent("download", { timeout: 300000 });
await page.getByRole("button", { name: /round wav/i }).click();
const wav = await wavPromise;
const wavPath = `${outDir}/${wav.suggestedFilename()}`;
await wav.saveAs(wavPath);
ok(wav.suggestedFilename() === "jam-in-my-top-hat.wav", `WAV filename ${wav.suggestedFilename()}`);
await page.locator('select').filter({ hasText: "Pre-render" }).selectOption("auto");
const midiPromise = page.waitForEvent("download", { timeout: 5000 });
await page.getByRole("button", { name: "↓ MIDI" }).click();
const midi = await midiPromise;
const midiPath = `${outDir}/${midi.suggestedFilename()}`;
await midi.saveAs(midiPath);
const bytes = new Uint8Array(await Bun.file(midiPath).arrayBuffer());
const expected = midiBytes(makeRound({ key: "D", bpm: 108, repeats: 1 }));
ok(bytes.length === expected.length && bytes.every((b, i) => b === expected[i]), "downloaded MIDI is byte-identical to the score");

// ---- the WAV is real, finite, and not clipped
const wavBytes = new Uint8Array(await Bun.file(wavPath).arrayBuffer());
const d = new DataView(wavBytes.buffer);
ok(wavBytes.length > 1000 && d.getUint32(40, true) === wavBytes.length - 44, "WAV header is coherent");
let clip = 0, peakW = 0, sumW = 0;
const n = (wavBytes.length - 44) / 2;
for (let i = 0; i < n; i++) {
  const v = d.getInt16(44 + i * 2, true) / 32768;
  if (Math.abs(v) >= 0.999) clip++;
  peakW = Math.max(peakW, Math.abs(v));
  sumW += v * v;
}
report.roundWav = { seconds: n / 48000, peak: peakW, rms: Math.sqrt(sumW / n), clipped: clip };
ok(clip === 0, `no clipped samples (${clip})`);
ok(peakW > 0.1, `the WAV is not silent (${peakW.toFixed(2)})`);

// ---- phone layout and a leaving-mode clean-up
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/moppet-phone.png`, fullPage: true });
const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok(!hscroll, "no sideways scrolling on a phone");
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole("radio", { name: "Play", exact: true }).click().catch(() => page.getByRole("button", { name: "Play", exact: true }).click());
await page.waitForTimeout(300);
ok((await dbg()).workersAlive === 0, "leaving Moppet mode ends every worker");
ok((await page.evaluate(() => (window as unknown as W).__choir.engine.latest !== null)) === true, "Play mode's views returned to the live voice");

for (const e of errors) console.error("ERR:", e);
console.log(JSON.stringify(report, null, 2));
writeFileSync(`${outDir}/report.json`, JSON.stringify({ ...report, errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
