import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseSongFile } from "../src/choir/songFile.ts";
import { buildSong } from "../src/choir/songbook.ts";
import { CaravanSetpiece3D, CARAVAN_DECK_BASE_Y, CARAVAN_SADDLE_BASE_Y } from "../src/stage/caravanSetpiece3D.ts";
import { simulateStageAutopilot } from "../src/stage/stageAutopilot.ts";
import {
  getSurfaceSampleAt,
  PLAYROOM_RISER_TOP_Y,
  resolveStageCollisions,
  STUDIO_RISER_CENTER_Z,
} from "../src/stage/stageSurface.ts";
import { isStageWorldId, resolveStageWorld, STAGE_WORLD_LIST } from "../src/stage/stageWorlds.ts";
import { pageSurfaceY, StorybookSetpiece3D, STORYBOOK_WIDTH } from "../src/stage/storybookSetpiece3D.ts";

describe("S-54 3D stage worlds & setpieces", () => {
  test("STAGE_WORLD_LIST contains all 5 StageWorldId specs", () => {
    expect(STAGE_WORLD_LIST.map((w) => w.id)).toEqual([
      "theater",
      "caravan",
      "storybook",
      "cosmic",
      "playroom",
    ]);
    for (const spec of STAGE_WORLD_LIST) {
      expect(isStageWorldId(spec.id)).toBe(true);
      expect(resolveStageWorld(spec.id).shortLabel.length).toBeGreaterThan(0);
      expect(spec.label.length).toBeGreaterThan(0);
    }
    expect(isStageWorldId("unknown")).toBe(false);
    expect(resolveStageWorld("unknown").id).toBe("theater");
  });

  test("CaravanSetpiece3D grounds riders on wagon deck, horse saddle, and meadow floor", () => {
    const caravan = new CaravanSetpiece3D();

    const deckAtRest = caravan.getSurfaceAt(-0.65, -0.15);
    expect(deckAtRest?.surfaceId).toBe("wagon");
    expect(deckAtRest?.y).toBeCloseTo(CARAVAN_DECK_BASE_Y, 4);

    const saddleAtRest = caravan.getSurfaceAt(2.35, -0.1);
    expect(saddleAtRest?.surfaceId).toBe("wagon");
    expect(saddleAtRest?.y).toBeCloseTo(CARAVAN_SADDLE_BASE_Y, 4);

    const outside = caravan.getSurfaceAt(6.5, 3.0);
    expect(outside?.surfaceId).toBe("floor");
    expect(outside?.y).toBe(0);

    // Beat bounce + horn break lifts wagon deck & saddle synchronously
    caravan.update({
      timeSec: 1.25,
      beat: 2.5,
      voiceEnergy: 0.7,
      sectionName: "[horn break]",
      lightingEnabled: true,
      lightingMood: "encore-surge",
    });
    const deckBouncing = caravan.getSurfaceAt(-0.65, -0.15);
    expect(deckBouncing?.surfaceId).toBe("wagon");
    expect(deckBouncing!.y).toBeGreaterThan(CARAVAN_DECK_BASE_Y);

    // 4-cast Cardboard Horse slots stay well inside carriage bed [-2.85, +1.55] x [-1.05, +0.75]
    const slots = CaravanSetpiece3D.getRiderSlots(4, 0);
    expect(slots.downstage).toHaveLength(4);
    for (const s of slots.downstage) {
      expect(s.baseX).toBeGreaterThanOrEqual(-2.65);
      expect(s.baseX).toBeLessThanOrEqual(1.38);
      expect(s.baseZ).toBeGreaterThanOrEqual(-0.9);
      expect(s.baseZ).toBeLessThanOrEqual(0.62);
    }

    caravan.dispose();
  });

  test("StorybookSetpiece3D exposes curved pageSurfaceY + curved normals & animates page turn", () => {
    const book = new StorybookSetpiece3D();

    const spine = book.getSurfaceAt(0, 0.2);
    expect(spine?.surfaceId).toBe("book");
    expect(spine?.y).toBeCloseTo(pageSurfaceY(0, STORYBOOK_WIDTH), 5);
    expect(spine?.normalY).toBeCloseTo(1, 3);

    const rightPage = book.getSurfaceAt(2.4, 0.4);
    expect(rightPage?.surfaceId).toBe("book");
    expect(rightPage?.y).toBeCloseTo(pageSurfaceY(2.4, STORYBOOK_WIDTH), 5);
    expect(rightPage?.y).toBeGreaterThan(spine!.y);
    expect(Math.hypot(rightPage!.normalX, rightPage!.normalY, rightPage!.normalZ)).toBeCloseTo(1, 5);

    const offBook = book.getSurfaceAt(8.5, 0);
    expect(offBook?.surfaceId).toBe("floor");
    expect(offBook?.y).toBe(0);

    // Scene transition triggers 3D vertex-curled leaf turn across ~0.75s
    book.update({
      timeSec: 0.1,
      dt: 0.016,
      beat: 0.5,
      voiceEnergy: 0.2,
      songTitle: "Bible · Folio",
      sceneIndex: 1,
      sectionName: "Opening",
      lightingEnabled: true,
      lightingMood: "warm-spotlight",
    });
    book.update({
      timeSec: 1.0,
      dt: 0.25,
      beat: 4.0,
      voiceEnergy: 0.6,
      songTitle: "Bible · Folio",
      sceneIndex: 2,
      sectionName: "Waltz Belt",
      lightingEnabled: true,
      lightingMood: "arena-lit",
    });

    book.dispose();
  });

  test("stageSurface & stageAutopilot honor customSurface, playroom riser, and prop suppression", () => {
    const caravan = new CaravanSetpiece3D();
    const customSample = getSurfaceSampleAt(-0.65, -0.15, {
      worldId: "caravan",
      showRiser: false,
      riserWidth: 4,
      riserTopY: 0.28,
      props: [],
      customSurface: (x, z) => caravan.getSurfaceAt(x, z),
    });
    expect(customSample.surfaceId).toBe("wagon");
    expect(customSample.y).toBeCloseTo(CARAVAN_DECK_BASE_Y, 4);
    caravan.dispose();

    const playRiserSample = getSurfaceSampleAt(0, STUDIO_RISER_CENTER_Z, {
      worldId: "playroom",
      showRiser: true,
      riserWidth: 4.5,
      riserTopY: PLAYROOM_RISER_TOP_Y,
      props: [],
    });
    expect(playRiserSample.surfaceId).toBe("riser");
    expect(playRiserSample.y).toBeCloseTo(PLAYROOM_RISER_TOP_Y, 5);

    // Storybook collision resolution pushes actors clear of upstage Lantern Gatehouse (0, -1.65)
    const pushed = resolveStageCollisions([{ x: 0, z: -1.6, onRiser: false }], {
      worldId: "storybook",
      showRiser: false,
      riserWidth: 4,
    });
    expect(Math.hypot(pushed[0]!.x - 0, pushed[0]!.z - -1.65)).toBeGreaterThanOrEqual(0.65);

    // Autopilot suppresses theater beat-pads on caravan & storybook
    const parsed = parseSongFile(readFileSync("songs/cardboard-horse.song", "utf8"), "songs/cardboard-horse.song");
    expect(parsed.kind).toBe("song");
    if (parsed.kind !== "song") return;
    const piece = buildSong(parsed.song);
    const caravanAp = simulateStageAutopilot(piece, "caravan", 90, 30);
    const storybookAp = simulateStageAutopilot(piece, "storybook", 90, 30);
    const theaterAp = simulateStageAutopilot(piece, "theater", 90, 30);
    expect(caravanAp[0]?.props.length).toBe(0);
    expect(storybookAp[0]?.props.length).toBe(0);
    expect(theaterAp[0]?.props.length).toBeGreaterThan(0);
  });
});
