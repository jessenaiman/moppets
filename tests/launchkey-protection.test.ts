import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";

test("a saved fry mapping cannot edit a voice during performance", async () => {
  const server = await createServer({server:{host:"127.0.0.1",port:0},logLevel:"error"});
  try {
    await server.listen();
    const browser = await chromium.launch({args:["--mute-audio"]});
    try {
      const page = await browser.newPage();
      await page.addInitScript(() => localStorage.setItem("moppet-midi-map-v2", JSON.stringify({21:"fry",74:"tension"})));
      await page.goto(server.resolvedUrls!.local[0]);
      const lesson = page.getByRole("combobox", { name: "Video lesson" });
      expect(await lesson.inputValue()).toBe("found");
      await lesson.selectOption("right-on-cue");
      await page.getByRole("button", { name: "Cue", exact: true }).first().click();
      await page.getByRole("button",{name:/Reset Cue vocals/}).waitFor();
      const result = await page.evaluate(() => {
        type Choir = {
          midi: typeof import("../src/choir/controller.ts").handleControl;
          moppet: typeof import("../src/choir/store.ts").useMoppet;
        };
        const choir = (window as unknown as {__choir:Choir}).__choir;
        const voices = choir.moppet.getState().voices;
        const before = JSON.stringify(voices);
        voices.forEach((_,i) => choir.midi({kind:"cc",channel:0,number:21+i,value:12+i}));
        choir.midi({kind:"cc",channel:0,number:74,value:127});
        choir.midi({kind:"bend",channel:0,number:0,value:1});
        const levels = JSON.parse(localStorage.getItem("moppet-character-volumes-v1")!);
        return {unchanged:before===JSON.stringify(choir.moppet.getState().voices),levels:voices.map(v=>levels[v.id])};
      });
      expect(result.unchanged).toBe(true);
      expect(result.levels).toEqual(Array.from({length:8},(_,i)=>(12+i)/127));
    } finally { await browser.close(); }
  } finally { await server.close(); }
}, 30000);
