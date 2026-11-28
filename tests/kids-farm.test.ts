import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import * as THREE from "three";
import { CAST_MANIFEST } from "../src/choir/castManifest.ts";
import { FARM_TUNES, farmMusic } from "../src/kids-farm/farmMusicPlayer.ts";
import { KIDS_FARM_ACTIVITIES, KIDS_FARM_CAST, sanitizeFarmClip } from "../src/kids-farm/kidsFarmCatalog.ts";

const KIDS_FARM_TEXTURES = [
  "public/kids-farm/textures/farm-sky-panorama.png",
  "public/kids-farm/textures/farm-meadow-ground.png",
  "public/kids-farm/textures/farm-red-barn-wood.png",
  "public/kids-farm/textures/farm-chalkboard-sign.png",
];

describe("Sunny Meadow Kids Farm 3D World isolation & asset readiness", () => {
  test("KIDS_FARM_CAST contains only the 6 Farm School characters with zero Studio 404 Moppets overlap", () => {
    const moppetIds = new Set(Object.keys(CAST_MANIFEST.characters));
    const farmIds = KIDS_FARM_CAST.map((c) => c.id);
    expect(farmIds).toEqual([
      "old-macdonald",
      "miss-hayley",
      "maisy-cow",
      "rusty-horse",
      "sam-pig",
      "puddles-duck",
    ]);

    for (const friend of KIDS_FARM_CAST) {
      expect(moppetIds.has(friend.id)).toBe(false);
      expect(friend.modelUrl.startsWith("/kids-farm/models/")).toBe(true);
      expect(friend.modelUrl.includes("/cast/")).toBe(false);
    }

    for (const [moppetId, moppet] of Object.entries(CAST_MANIFEST.characters)) {
      expect(farmIds.includes(moppetId)).toBe(false);
      expect(moppet.model3d?.url.includes("kids-farm")).toBe(false);
    }

    expect(KIDS_FARM_ACTIVITIES.length).toBe(7);
  });

  test("All 6 Kids Farm GLBs and 4 newly generated storybook textures exist on disk", () => {
    for (const friend of KIDS_FARM_CAST) {
      const diskPath = `public${friend.modelUrl}`;
      expect(existsSync(diskPath)).toBe(true);
      expect(statSync(diskPath).size).toBeGreaterThan(500_000);
    }
    for (const texPath of KIDS_FARM_TEXTURES) {
      expect(existsSync(texPath)).toBe(true);
      expect(statSync(texPath).size).toBeGreaterThan(10_000);
    }
  });

  test("sanitizeFarmClip removes scale, non-root position, and locks root XZ drift", () => {
    const raw = new THREE.AnimationClip("farm_dance", 1, [
      new THREE.VectorKeyframeTrack("mixamorig:Hips.scale", [0, 1], [1.1, 1.1, 1.1, 1.5, 1.5, 1.5]),
      new THREE.VectorKeyframeTrack("mixamorig:LeftArm.position", [0, 1], [0.2, 0.4, 0.1, 0.8, 0.9, 0.4]),
      new THREE.VectorKeyframeTrack("mixamorig:Hips.position", [0, 1], [0.01, 0.92, -0.03, 0.85, 1.12, 0.65]),
      new THREE.QuaternionKeyframeTrack("mixamorig:Spine.quaternion", [0, 1], [0, 0, 0, 1, 0, 0.15, 0, 0.988]),
    ]);

    const clean = sanitizeFarmClip(raw);
    expect(clean.tracks.map((t) => t.name)).toEqual([
      "mixamorig:Hips.position",
      "mixamorig:Spine.quaternion",
    ]);

    const hipsPos = clean.tracks[0]!;
    const expected = [0.01, 0.92, -0.03, 0.01, 1.12, -0.03];
    for (let i = 0; i < expected.length; i++) {
      expect(hipsPos.values[i]).toBeCloseTo(expected[i]!, 5);
    }
  });

  test("FARM_TUNES defines 3 public-domain kids sing-along arrangements with valid friend callouts", () => {
    expect(FARM_TUNES.map((t) => t.id)).toEqual([
      "old-macdonald",
      "barn-dance",
      "starry-lullaby",
    ]);
    const validIds = new Set(KIDS_FARM_CAST.map((c) => c.id));
    for (const tune of FARM_TUNES) {
      expect(tune.melody.length).toBeGreaterThan(8);
      expect(tune.chords.length).toBeGreaterThan(3);
      expect(tune.bars.length).toBeGreaterThanOrEqual(4);
      for (const bar of tune.bars) {
        if (bar.soloFriendId !== null) {
          expect(validIds.has(bar.soloFriendId)).toBe(true);
        }
      }
    }
    const idleBeat = farmMusic.getBeatState();
    expect(idleBeat.playing).toBe(false);
    expect(idleBeat.bpm).toBe(108);
  });
});
