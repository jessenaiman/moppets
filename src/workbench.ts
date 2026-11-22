/**
 * `video-shotcraft` Motion Workbench manifest (`references/workbench.md` §2-3).
 * Exposes `ShotcraftStage` + `MoppetComposition` with parameterized context props and schema
 * from the exact same score & `buildVideoProject` source of truth.
 */
import React from "react";
import { SONGBOOK } from "./choir/songbook.ts";
import { makeRound } from "./choir/music.ts";
import { CAST } from "./choir/voices.ts";
import { buildVideoProject, totalDurationFrames } from "./choir/videoProject.ts";
import { MoppetComposition } from "./remotion/MoppetComposition.tsx";

const defaultPiece = SONGBOOK.find((s) => s.id === "neon-playbook")?.make() ?? makeRound();
export const DEFAULT_PROJECT = buildVideoProject(defaultPiece, CAST, true);
export const TOTAL_FRAMES = totalDurationFrames(DEFAULT_PROJECT);

const StageUnit: React.FC<{
  title?: string;
  subheading?: string;
  cameraAutoFollow?: boolean;
  studio404?: boolean;
}> = ({
  title = DEFAULT_PROJECT.intro.heading,
  subheading = DEFAULT_PROJECT.intro.subheading,
  cameraAutoFollow = true,
  studio404 = true,
}) =>
  React.createElement(MoppetComposition, {
    ...DEFAULT_PROJECT,
    title,
    studio404,
    cameraAutoFollow,
    intro: { ...DEFAULT_PROJECT.intro, heading: title, subheading },
  });

export const WORKBENCH = {
  name: "Studio 404 · The Neon Playbook",
  fps: DEFAULT_PROJECT.fps,
  width: 1920,
  height: 1080,
  total: TOTAL_FRAMES,
  background: "#070203",
  shots: [
    {
      id: "studio404-stage",
      label: "Studio 404 Velvet Stage",
      from: 0,
      duration: TOTAL_FRAMES,
      component: StageUnit,
      props: {
        title: DEFAULT_PROJECT.intro.heading,
        subheading: DEFAULT_PROJECT.intro.subheading,
        cameraAutoFollow: true,
        studio404: true,
      },
      schema: [
        { type: "text", key: "title", label: "Title", default: DEFAULT_PROJECT.intro.heading },
        { type: "text", key: "subheading", label: "Subtitle", default: DEFAULT_PROJECT.intro.subheading },
        { type: "boolean", key: "cameraAutoFollow", label: "Follow Soloists", default: true },
        { type: "boolean", key: "studio404", label: "Studio 404 Cast", default: true },
      ],
      cardId: "shotcraft-stage",
      cardName: "Studio 404 Stage",
    },
  ],
  transitions: [],
  captions: DEFAULT_PROJECT.bubbles.map((b) => ({
    id: b.id,
    label: `${b.speaker}: ${b.text}`,
    from: Math.round((DEFAULT_PROJECT.intro.durationSec + b.startSec) * DEFAULT_PROJECT.fps),
    duration: Math.max(12, Math.round(b.durationSec * DEFAULT_PROJECT.fps)),
    props: { text: b.text, speaker: b.speaker, color: b.color },
  })),
  overlays: [],
  sfx: [],
  bgm: [],
  original: () => React.createElement(MoppetComposition, DEFAULT_PROJECT),
};
