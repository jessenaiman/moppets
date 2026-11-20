import { expect, test } from "bun:test";
import { bandClipSeconds, bandPoseAt, type BandClipName } from "../src/choir/bandAnim.ts";

const CLIPS: BandClipName[] = [
  "thrum-pluck",
  "clacker-play",
  "rattle-kick",
  "rattle-snare",
  "rattle-hat",
  "rattle-crash",
  "rattle-beatbox",
];

test("every AniCraft band clip has positive duration and returns to rest", () => {
  for (const name of CLIPS) {
    const dur = bandClipSeconds(name);
    expect(dur).toBeGreaterThan(0.2);
    const start = bandPoseAt(name, 0);
    expect(start).not.toBeNull();
    expect(bandPoseAt(name, -0.05)).toBeNull();
    expect(bandPoseAt(name, dur + 0.5)).toBeNull();
  }
});

test("rattle-beatbox loops seamlessly when drums sit out", () => {
  const dur = bandClipSeconds("rattle-beatbox");
  const a = bandPoseAt("rattle-beatbox", 0.1, 1, true);
  const b = bandPoseAt("rattle-beatbox", dur * 3 + 0.1, 1, true);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
});

test("velocity scale attenuates band pose displacement", () => {
  const loud = bandPoseAt("thrum-pluck", 0.1, 1.0)!;
  const soft = bandPoseAt("thrum-pluck", 0.1, 0.5)!;
  expect(Math.abs(soft.rot)).toBeLessThanOrEqual(Math.abs(loud.rot) + 1e-6);
  expect(Math.abs(soft.dy)).toBeLessThanOrEqual(Math.abs(loud.dy) + 1e-6);
});
