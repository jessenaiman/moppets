import { expect, test } from "bun:test";
import { Choreographer } from "../src/choir/choreo.ts";

const IDS = ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"];

test("Choreographer enforces minimum horizontal separation across atRest and onStage ticks", () => {
  const c = new Choreographer(IDS);
  // 60 seconds of atRest chatter & wandering
  for (let step = 0; step < 60 * 20; step++) {
    const actors = c.step(
      {
        playing: false,
        beat: 0,
        now: step * 0.05,
        featured: IDS.map(() => false),
        singing: IDS.map(() => false),
        poke: null,
        still: false,
      },
      0.05,
    );
    const xs = actors.map((a) => a.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(0.105);
    }
    for (const a of actors) {
      expect(Math.abs(a.face)).toBeGreaterThanOrEqual(0.8);
    }
  }

  // Featured solo/duet transitions during performance
  for (let beat = 0; beat < 32; beat += 0.25) {
    const soloIdx = Math.floor(beat / 4) % IDS.length;
    const actors = c.step(
      {
        playing: true,
        beat,
        now: beat * 0.5,
        featured: IDS.map((_, idx) => idx === soloIdx || idx === (soloIdx + 3) % IDS.length),
        singing: IDS.map((_, idx) => idx === soloIdx),
        poke: null,
        still: false,
      },
      0.05,
    );
    const xs = actors.map((a) => a.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(0.105);
    }
    for (const a of actors) {
      expect(Math.abs(a.face)).toBeGreaterThanOrEqual(0.8);
    }
  }
});
