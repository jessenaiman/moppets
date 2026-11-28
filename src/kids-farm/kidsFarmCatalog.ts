/**
 * Strictly isolated Sunny Meadow Farm School Kids Cast & Activity catalog.
 *
 * Isolation invariant: ZERO imports from Studio 404 Moppets (`CAST_MANIFEST`,
 * `src/choir/`, `src/song/`, or `src/stage/`). All assets live exclusively under
 * `/kids-farm/` so Moppets and Children's Education models never mix.
 */
import * as THREE from "three";

export type KidsFarmMoodId = "morning" | "afternoon" | "lullaby";

export interface KidsFarmMoodSpec {
  readonly id: KidsFarmMoodId;
  readonly label: string;
  readonly emoji: string;
  readonly skyTintHex: number;
  readonly fogHex: number;
  readonly keyColorHex: number;
  readonly keyIntensity: number;
  readonly hemiSkyHex: number;
  readonly hemiGroundHex: number;
  readonly hemiIntensity: number;
  readonly exposure: number;
  readonly barnLanternIntensity: number;
  readonly firefliesVisible: boolean;
}

export const KIDS_FARM_MOODS: readonly KidsFarmMoodSpec[] = [
  {
    id: "morning",
    label: "Sunny Morning",
    emoji: "☀️",
    skyTintHex: 0xffffff,
    fogHex: 0xd8f1ff,
    keyColorHex: 0xfff7e0,
    keyIntensity: 2.35,
    hemiSkyHex: 0xc8ebff,
    hemiGroundHex: 0x6f994a,
    hemiIntensity: 1.05,
    exposure: 1.08,
    barnLanternIntensity: 1.4,
    firefliesVisible: false,
  },
  {
    id: "afternoon",
    label: "Golden Afternoon",
    emoji: "🌻",
    skyTintHex: 0xffe4bd,
    fogHex: 0xf7dcb8,
    keyColorHex: 0xffd28d,
    keyIntensity: 2.1,
    hemiSkyHex: 0xffe3b5,
    hemiGroundHex: 0x7b723c,
    hemiIntensity: 0.92,
    exposure: 1.04,
    barnLanternIntensity: 2.2,
    firefliesVisible: false,
  },
  {
    id: "lullaby",
    label: "Starry Lullaby",
    emoji: "🌙",
    skyTintHex: 0x56689e,
    fogHex: 0x202b4f,
    keyColorHex: 0xa7c4ff,
    keyIntensity: 0.95,
    hemiSkyHex: 0x45588c,
    hemiGroundHex: 0x1b2638,
    hemiIntensity: 0.65,
    exposure: 0.95,
    barnLanternIntensity: 6.5,
    firefliesVisible: true,
  },
];

export type KidsFarmActivityId =
  | "wave"
  | "dance"
  | "clap"
  | "band"
  | "jump"
  | "sit"
  | "lullaby";

export interface KidsFarmActivitySpec {
  readonly id: KidsFarmActivityId;
  readonly label: string;
  readonly description: string;
  readonly preferredClips: readonly string[];
  readonly bounceAmp: number;
  readonly bounceHz: number;
  readonly moodHint?: KidsFarmMoodId;
}

export const KIDS_FARM_ACTIVITIES: readonly KidsFarmActivitySpec[] = [
  {
    id: "wave",
    label: "Wave Hello",
    description: "Every Farm School friend waves warmly from the barn porch!",
    preferredClips: ["waving", "wave_goodbye_01", "happy-idle", "idle"],
    bounceAmp: 0.012,
    bounceHz: 1.8,
  },
  {
    id: "dance",
    label: "Dance Party",
    description: "Happy barn-dance steps across the sunny porch deck!",
    preferredClips: ["dancing", "cheering", "cheer", "clapping"],
    bounceAmp: 0.025,
    bounceHz: 3.1,
  },
  {
    id: "clap",
    label: "Clap & Sing",
    description: "Keep the rhythm together for Old MacDonald’s chorus!",
    preferredClips: ["clapping", "cheering", "happy-idle"],
    bounceAmp: 0.018,
    bounceHz: 2.4,
  },
  {
    id: "band",
    label: "Barn Band Jam",
    description: "Each friend plays their signature Farm Band instrument pose!",
    preferredClips: ["guitar-playing", "playing-the-violin", "playing-drums"],
    bounceAmp: 0.015,
    bounceHz: 2.2,
  },
  {
    id: "jump",
    label: "Jump & Cheer",
    description: "Hooray! Celebratory barnyard hops and cheers!",
    preferredClips: ["cheering", "jump", "cheer"],
    bounceAmp: 0.022,
    bounceHz: 2.8,
  },
  {
    id: "sit",
    label: "Storytime Sit",
    description: "Settle down on the porch steps for Barn School storytime.",
    preferredClips: ["sitting-idle", "crouch-to-stand", "idle"],
    bounceAmp: 0.004,
    bounceHz: 0.9,
  },
  {
    id: "lullaby",
    label: "Sleepy Lullaby",
    description: "Big barn yawns under the fireflies and porch lantern.",
    preferredClips: ["yawn", "sleeping-idle", "idle"],
    bounceAmp: 0.005,
    bounceHz: 0.7,
    moodHint: "lullaby",
  },
];

export interface KidsFarmFriendSpec {
  readonly id: string;
  readonly displayName: string;
  readonly species: string;
  readonly heightDu: number;
  readonly stageX: number;
  readonly stageZ: number;
  readonly yawDeg: number;
  readonly modelUrl: string;
  readonly soundBadge: string;
  readonly accentColor: string;
  readonly funFact: string;
  readonly bandClip: string;
}

/** Canonical 6 Farm School 3D characters standing across the Barn Porch Deck. */
export const KIDS_FARM_CAST: readonly KidsFarmFriendSpec[] = [
  {
    id: "old-macdonald",
    displayName: "Old MacDonald",
    species: "Friendly Farmer & Music Teacher",
    heightDu: 100,
    stageX: -2.55,
    stageZ: -0.25,
    yawDeg: 10,
    modelUrl: "/kids-farm/models/old-macdonald.glb",
    soundBadge: "E-I-E-I-O!",
    accentColor: "#d9483b",
    funFact: "Leads morning barnyard sing-alongs on his acoustic guitar from the red barn porch.",
    bandClip: "guitar-playing",
  },
  {
    id: "miss-hayley",
    displayName: "Miss Hayley",
    species: "Barn School Storyteller",
    heightDu: 96,
    stageX: -1.52,
    stageZ: 0.05,
    yawDeg: 6,
    modelUrl: "/kids-farm/models/miss-hayley.glb",
    soundBadge: "Sing Along!",
    accentColor: "#e67e22",
    funFact: "Teaches letters A-B-C, animal rhymes, and fiddle tunes beside the chalkboard.",
    bandClip: "playing-the-violin",
  },
  {
    id: "maisy-cow",
    displayName: "Maisy Cow",
    species: "Curious Spotted Calf",
    heightDu: 68,
    stageX: -0.52,
    stageZ: 0.25,
    yawDeg: 2,
    modelUrl: "/kids-farm/models/maisy-cow.glb",
    soundBadge: "Moo!",
    accentColor: "#2d7d46",
    funFact: "Wears a bright red bandana and loves counting buttercups around the pasture fence.",
    bandClip: "dancing",
  },
  {
    id: "rusty-horse",
    displayName: "Mr. Rusty",
    species: "Gentle Pony Percussionist",
    heightDu: 60,
    stageX: 0.52,
    stageZ: 0.22,
    yawDeg: -93,
    modelUrl: "/kids-farm/models/rusty-horse.glb",
    soundBadge: "Neigh!",
    accentColor: "#b86b2b",
    funFact: "Keeps a steady hoof-tap beat on wooden drums and apple crates.",
    bandClip: "playing-drums",
  },
  {
    id: "sam-pig",
    displayName: "Sam Pig",
    species: "Spectacled Garden Helper",
    heightDu: 45,
    stageX: 1.52,
    stageZ: 0.34,
    yawDeg: 82,
    modelUrl: "/kids-farm/models/sam-pig.glb",
    soundBadge: "Oink!",
    accentColor: "#e06c88",
    funFact: "Tends sunflowers and stacks giant painted ABC wooden blocks after class.",
    bandClip: "clapping",
  },
  {
    id: "puddles-duck",
    displayName: "Puddles Duck",
    species: "Blue-Capped Pond Explorer (26 DU canon)",
    heightDu: 34,
    stageX: 2.38,
    stageZ: 0.44,
    yawDeg: 76,
    modelUrl: "/kids-farm/models/puddles-duck.glb",
    soundBadge: "Quack!",
    accentColor: "#2e8bc0",
    funFact: "Splashes happily beside the lily-pad pond and leads the loudest happy cheers.",
    bandClip: "cheering",
  },
];

const FARM_ROOT_BONES = new Set(["armature", "root", "hip", "pelvis", "hips", "mixamorig:hips"]);

/** Runtime Three.js safety sanitizer for Kids Farm Mixamo clips (isolated from Studio 404). */
export function sanitizeFarmClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const orig of clip.tracks) {
    const dotIdx = orig.name.lastIndexOf(".");
    const nodePart = (dotIdx >= 0 ? orig.name.slice(0, dotIdx) : orig.name).toLowerCase();
    const leaf = nodePart.split("::").pop() ?? nodePart;
    const prop = dotIdx >= 0 ? orig.name.slice(dotIdx + 1).toLowerCase() : "";

    if (prop === "scale") continue;
    if (prop === "position") {
      if (!FARM_ROOT_BONES.has(nodePart) && !FARM_ROOT_BONES.has(leaf)) continue;
      const cloned = orig.clone();
      const v = cloned.values;
      if (v.length >= 3) {
        const x0 = v[0] ?? 0;
        const z0 = v[2] ?? 0;
        for (let i = 0; i + 2 < v.length; i += 3) {
          v[i] = x0;
          v[i + 2] = z0;
        }
      }
      tracks.push(cloned);
      continue;
    }
    tracks.push(orig);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}
