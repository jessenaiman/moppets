import { expect, test } from "bun:test";
import { BUS_GAIN, pieceGains } from "../src/choir/mix.ts";
import { SONGBOOK } from "../src/choir/songbook.ts";

test("Neon's staged solo uses solo headroom while the full choir uses ensemble headroom", () => {
  const solo = SONGBOOK.find(song => song.id === "take-two")!.make();
  const choir = SONGBOOK.find(song => song.id === "found")!.make();
  expect(pieceGains(solo, 48000, 0, {}).gains[0] * BUS_GAIN).toBeCloseTo(0.8);
  expect(pieceGains(choir, 48000, 0, {}).gains[0]).toBe(1);
});
