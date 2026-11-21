import { expect, test } from "bun:test";
import { singingSource, shapeGesture } from "../src/choir/character.ts";
import { CAST } from "../src/choir/voices.ts";

test("saved recipes cannot override score pitch or fry; glide and drift stay in their sung ranges", () => {
  const saved = {f0: 45, vibratoDepth: 120, fry: 1, drift: 80, glide: .5, brightness: .67};
  expect(singingSource(saved))
    .toEqual({fry: 0, drift: 6, glide: .05, brightness: .67});
  expect(singingSource({glide: .002, drift: 0})).toEqual({fry: 0, glide: .025, drift: 3});
  expect(singingSource({glide: .038, drift: 4})).toEqual({fry: 0, glide: .038, drift: 4});
  expect(singingSource({tension: .53})).toEqual({fry: 0, tension: .53});
});

test("sung voiceless fricatives open the glottis without altering speech or their oral targets", () => {
  for (const label of ["s","f","h"]) {
    const gesture = {label, t0: 0, t1: .09, rampIn: .02, rampOut: .02, strength: 1, targets: {lipAp: .1}};
    expect(shapeGesture(gesture, CAST[0], false).targets).toEqual({lipAp: .1, abduction: .45});
    expect(shapeGesture(gesture, CAST[0], false, true)).toBe(gesture);
  }
});
