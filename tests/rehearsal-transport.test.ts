import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { wavBytes } from "../src/choir/mix.ts";

type ChoirWindow = Window & {
  mixerLevels: number[][];
  rehearsalAudio?: AudioContext;
  __choir: {
    ensemble: typeof import("../src/choir/ensemble.ts").useEnsemble;
    moppet: typeof import("../src/choir/store.ts").useMoppet;
  };
};

test("the Remotion rehearsal sends singer faders to the running CHIMERA mixer", async () => {
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  try {
    await server.listen();
    const browser = await chromium.launch({ args: ["--mute-audio"] });
    try {
      const page = await browser.newPage();
      await page.addInitScript(() => {
        const scope = window as unknown as ChoirWindow;
        scope.mixerLevels = [];
        const BrowserAudioContext = window.AudioContext;
        window.AudioContext = class extends BrowserAudioContext {
          constructor(options?: AudioContextOptions) {
            super(options);
            if (options?.latencyHint === "interactive") scope.rehearsalAudio = this;
          }
        };
        const send = MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage = function (message, ...rest: [transferOrOptions?: Transferable[] | StructuredSerializeOptions]) {
          if (message?.type === "voiceLevels") scope.mixerLevels.push(message.values);
          return Reflect.apply(send, this, [message, ...rest]);
        };
      });
      // The plug-in recordings are local assets. Exercise the same decode and worklet paths with PCM fixtures.
      const samples = new Float32Array(48000);
      for (let i = 24000; i < 38400; i++) samples[i] = 0.15 * Math.sin(2 * Math.PI * 220 * i / 48000);
      const vocal = Buffer.from(wavBytes(samples, 48000));
      await page.route("**/plugin-vocals/*.ogg", route => route.fulfill({ contentType: "audio/wav", body: vocal }));
      await page.goto(server.resolvedUrls!.local[0]);
      const lesson = page.getByRole("combobox", { name: "Video lesson" });
      expect(await lesson.inputValue()).toBe("found");
      await lesson.selectOption("right-on-cue");
      await page.getByRole("button", { name: "Cue", exact: true }).first().click();

      const seek = page.getByRole("slider", { name: "Seek rehearsal" });
      await seek.press("ArrowRight");
      expect(await seek.inputValue()).toBe("1");
      await page.getByRole("button", { name: "Play video", exact: true }).click();
      const running = () => page.evaluate(() => {
        const choir = (window as unknown as ChoirWindow).__choir;
        const { status, time } = choir.ensemble.getState();
        return { status, time, cue: choir.moppet.getState().piece.tracks.findIndex(track => track.id === "scribe") };
      });
      const advancePast = (time: number) => page.waitForFunction(seconds =>
        (window as unknown as ChoirWindow).__choir.ensemble.getState().time > seconds, time);
      await advancePast(0.2);
      const before = await running();
      const timing = await page.evaluate(() => {
        const { vocalTiming } = (window as unknown as ChoirWindow).__choir.ensemble.getState();
        return vocalTiming?.envelopes.scribe.findIndex(level => level > 0.008);
      });
      expect(timing).toBe(30);
      await page.getByRole("slider", { name: "Cue volume", exact: true }).press("Home");
      const expected = Array.from({ length: 2 }, (_, i) => i === before.cue ? 0 : 1);
      await advancePast(before.time + 0.15);
      expect(await page.evaluate(() => (window as unknown as ChoirWindow).mixerLevels.at(-1))).toEqual(expected);
      expect((await running()).status).toBe("playing");
      expect(await page.locator(".vs-player-frame audio").count()).toBe(0);
      await page.getByRole("button", { name: "Pause video", exact: true }).click();
      expect((await running()).status).toBe("paused");
      await page.getByRole("button", { name: "Play video", exact: true }).click();
      await advancePast(0.8);
      await page.evaluate(() => (window as unknown as ChoirWindow).rehearsalAudio!.suspend());
      const play = page.getByRole("button", { name: "Play video", exact: true });
      await play.waitFor();
      const suspended = await running();
      expect(suspended.status).toBe("paused");
      await play.click();
      await advancePast(suspended.time + 0.15);
      expect(await page.evaluate(() => (window as unknown as ChoirWindow).rehearsalAudio!.state)).toBe("running");
      await page.getByRole("button", { name: "Pause video", exact: true }).click();
      await seek.press("Home");
      expect((await running()).time).toBe(0);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}, 30000);
