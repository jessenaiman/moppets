import { existsSync } from "node:fs";
import { expect, test } from "bun:test";
import data from "../src/choir/anim/studio404.json";
import { STUDIO_404_CAST, STUDIO_404_CREW } from "../src/choir/studio404.ts";
import {
  criticsStateAt,
  duetCriticsStateAt,
  STUDIO_404_CLIP_NAMES,
  studio404ClipSeconds,
  studio404DanceAt,
  studio404PoseAt,
} from "../src/choir/studio404Anim.ts";

test("all 10 Studio 404 AniCraft clips have positive duration and seamless rest loop endpoints", () => {
  expect(STUDIO_404_CLIP_NAMES).toEqual([
    "neon-dance",
    "cue-dance",
    "clank-dance",
    "watt-dance",
    "gruff-dance",
    "tabby-dance",
    "chip-dance",
    "critics-idle",
    "critics-tracking",
    "critics-hertz",
  ]);
  const clips = data.clips as Record<string, number[][]>;
  for (const name of STUDIO_404_CLIP_NAMES) {
    expect(studio404ClipSeconds(name)).toBeGreaterThan(0.5);
    const rows = clips[name];
    expect(rows[0]).toEqual(rows[rows.length - 1]);
    const p = studio404PoseAt(name, 0.15, 1, true)!;
    expect(Number.isFinite(p.dx)).toBe(true);
    expect(Number.isFinite(p.dy)).toBe(true);
    expect(Number.isFinite(p.rot)).toBe(true);
  }
});

test("studio404DanceAt animates all 7 cast Moppets, scales by singing level, and stays still under reduced motion", () => {
  for (const id of ["vee", "scribe", "clank", "pip", "gruff", "tabby", "chip"]) {
    const singing = studio404DanceAt(id, 0.5, true, 0.8, false)!;
    const idle = studio404DanceAt(id, 0.5, false, 0, false)!;
    expect(Math.abs(singing.dy) + Math.abs(singing.rot)).toBeGreaterThan(0);
    expect(Math.abs(singing.rot)).toBeGreaterThanOrEqual(Math.abs(idle.rot));
    expect(studio404DanceAt(id, 0.5, true, 0.8, true)).toBeNull();
  }
});

test("criticsStateAt cycles cleanly through rest, tracking, and hertz poses", () => {
  expect(criticsStateAt(2, false, false)).toEqual({ art: "rest", pose: null });
  expect(criticsStateAt(7, true, true)).toEqual({ art: "rest", pose: null });
  expect(criticsStateAt(2, true, false).art).toBe("rest");
  expect(criticsStateAt(7, true, false).art).toBe("tracking");
  expect(criticsStateAt(14, true, false).art).toBe("hertz");
  expect(criticsStateAt(7, true, false).pose).not.toBeNull();
});

test("Studio 404 cast and crew have valid identities and stage sprite sheets on disk", () => {
  expect(Object.keys(STUDIO_404_CAST).length).toBeGreaterThanOrEqual(7);
  expect(STUDIO_404_CREW.critics.names).toBe("Tracking & Hertz");
  for (const persona of Object.values(STUDIO_404_CAST)) {
    expect(persona.name.length).toBeGreaterThan(0);
    expect(existsSync(`public/rehearsal/rigs/${persona.artKey}/closed.webp`)).toBe(true);
    expect(existsSync(`public/rehearsal/rigs/${persona.artKey}/sing-closed.webp`)).toBe(true);
    expect(existsSync(`public/rehearsal/rigs/${persona.artKey}/open.webp`)).toBe(true);
  }
  for (const crew of [STUDIO_404_CREW.tracking, STUDIO_404_CREW.hertz]) {
    expect(existsSync(`public${crew.rigBase}/closed.webp`)).toBe(true);
    expect(existsSync(`public${crew.rigBase}/sing-closed.webp`)).toBe(true);
    expect(existsSync(`public${crew.rigBase}/open.webp`)).toBe(true);
    expect(existsSync(`public${crew.artRest}`)).toBe(true);
    expect(existsSync(`public${crew.artSing}`)).toBe(true);
  }
  expect(existsSync("public/rehearsal/band/click-rest.webp")).toBe(true);
  expect(existsSync("public/rehearsal/band/click-play.webp")).toBe(true);
  for (const prop of ["mic-ribbon", "mic-boom", "mic-short", "mic-desk"]) {
    expect(existsSync(`public/rehearsal/props/${prop}.webp`)).toBe(true);
  }
});

test("duetCriticsStateAt drives Tracking and Hertz independently across idle, trade, and harmony", () => {
  expect(duetCriticsStateAt(2, false, false).tracking.singing).toBe(false);
  expect(duetCriticsStateAt(5, true, false).tracking.singing).toBe(true);
  expect(duetCriticsStateAt(5, true, false).hertz.singing).toBe(false);
  expect(duetCriticsStateAt(9, true, false).hertz.singing).toBe(true);
  expect(duetCriticsStateAt(13, true, false).tracking.singing).toBe(true);
  expect(duetCriticsStateAt(13, true, false).hertz.singing).toBe(true);
});
