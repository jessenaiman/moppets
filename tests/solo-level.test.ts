import { expect, test } from "bun:test";
import { BUS_GAIN, pieceGains } from "../src/choir/mix.ts";
import { SONGBOOK } from "../src/choir/songbook.ts";

test("Neon's staged solo uses solo headroom while the full choir uses ensemble headroom", () => {
  const solo = SONGBOOK.find(song => song.id === "take-two")!.make();
  const choir = SONGBOOK.find(song => song.id === "found")!.make();
  expect(pieceGains(solo, 48000, 0, {}).gains[0] * BUS_GAIN).toBeCloseTo(0.8);
  expect(pieceGains(choir, 48000, 0, {}).gains[0]).toBe(1);
});

test("Right on Cue keeps both voices at solo level when they trade lines", () => {
  const duet = SONGBOOK.find(song => song.id === "right-on-cue")!.make();
  const levels = { vee: 0.5, scribe: 1 };
  const { gains } = pieceGains(duet, 48000, 0, levels);
  for (const [i, track] of duet.tracks.entries()) {
    expect(gains[i] * BUS_GAIN).toBeCloseTo(0.8 * levels[track.id as keyof typeof levels]);
  }
});
