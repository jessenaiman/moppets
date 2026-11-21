import { expect, test } from "bun:test";
import { studio404DanceAt } from "../src/choir/studio404Anim.ts";

test("studio404DanceAt animates all 7 cast Moppets, scales by singing level, and stays still under reduced motion", () => {
  for (const id of ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"]) {
    const singing = studio404DanceAt(id, 0.5, true, 0.8, false)!;
    const idle = studio404DanceAt(id, 0.5, false, 0, false)!;
    expect(Math.abs(singing.dy) + Math.abs(singing.rot)).toBeGreaterThan(0);
    expect(Math.abs(singing.rot)).toBeGreaterThanOrEqual(Math.abs(idle.rot));
    expect(studio404DanceAt(id, 0.5, true, 0.8, true)).toBeNull();
  }
});
