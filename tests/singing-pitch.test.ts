import { expect, test } from "bun:test";
import { singingSource } from "../src/choir/character.ts";

test("an old saved vocal recipe cannot replace a scored pitch or apply vocal fry", () => {
  const saved = { f0: 45, vibratoDepth: 120, fry: 1, drift: 80, glide: .5, brightness: .67 };
  expect(singingSource(saved)).toEqual({ fry: 0, drift: 0, glide: 0, brightness: .67 });
});

test("an edit sent to a running singer uses straight tone even when the profile asks for glide", () => {
  expect(singingSource({ glide: .002, drift: 0 })).toEqual({ fry: 0, glide: 0, drift: 0 });
  expect(singingSource({ tension: .53 })).toEqual({ fry: 0, glide: 0, drift: 0, tension: .53 });
});
