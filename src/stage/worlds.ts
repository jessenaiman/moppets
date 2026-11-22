/**
 * Generic, OO StageWorld state & chapter engine (`S-29`).
 *
 * Works polymorphically for ANY song and ANY cast (solo, duet, or full choir)
 * with zero hardcoded character names, sprites, or song titles.
 * Engine-free: safe across live stage, Remotion `<Player>`, and headless export.
 */
import { rightOnCuePerformance, duetCel } from "../choir/rightOnCuePerformance";
import type { Piece } from "../choir/music.ts";
import { speechDetailForTrack, type KaraokeWordSpan } from "../choir/bubbles.ts";
import {
  resolvePerformerCel,
  resolvePerformerIdentity,
  type CharacterFmvManifest,
  type PerformerFrame,
  type PerformerPoseInput,
} from "../choir/performer.ts";
import { MOUTH_OPEN_THRESHOLD } from "../choir/pose.ts";

export type WorldLens = "diorama" | "caravan" | "filmstrip" | "chimera" | "signal" | "zine" | "vinyl" | "archive";
/** Backwards-compatible alias */
export type NeonWorldLens = WorldLens;

export interface WorldLensOption {
  readonly id: WorldLens;
  readonly label: string;
  readonly shortLabel: string;
  readonly tagline: string;
}

export const WORLD_LENSES: readonly WorldLensOption[] = [
  {
    id: "diorama",
    label: "1. Folded Diorama 3D",
    shortLabel: "Diorama 3D",
    tagline: "Three.js 3D pop-up cardstock storybook staging the current song's cast",
  },
  {
    id: "caravan",
    label: "2. Meadow Caravan 3D",
    shortLabel: "Caravan 3D",
    tagline: "Folded cardstock parade wagon & rocking horse carrying the cast across sunset hills",
  },
  {
    id: "filmstrip",
    label: "3. 35mm Flatbed",
    shortLabel: "35mm Reel",
    tagline: "Sprocketed analog 35mm cinema strip with live exposure glow & timecode",
  },
  {
    id: "chimera",
    label: "4. CHIMERA 3D X-Ray",
    shortLabel: "CHIMERA 3D",
    tagline: "Live multi-head CHIMERA anatomical airways animated by vocal physics",
  },
  {
    id: "signal",
    label: "5. Optical Signal",
    shortLabel: "Signal",
    tagline: "Harmonic waveforms & optical rings tinted to the active cast",
  },
  {
    id: "zine",
    label: "6. Kinetic Zine",
    shortLabel: "Zine",
    tagline: "Editorial print spread where typography becomes the stage",
  },
  {
    id: "vinyl",
    label: "7. Vinyl Turntable",
    shortLabel: "Vinyl LP",
    tagline: "Spinning record platter & liner sleeve for the current song",
  },
  {
    id: "archive",
    label: "8. Archive 404",
    shortLabel: "Archive 404",
    tagline: "Classic Studio 404 theatrical velvet curtain stage",
  },
] as const;

export const NEON_WORLD_LENSES = WORLD_LENSES;

export interface WorldPlateInfo {
  readonly index: number;
  readonly numberLabel: string;
  readonly sectionName: string;
  readonly chapterEyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly promptHint: string;
  readonly stampLeft: string;
  readonly stampRight: string;
  readonly startBeat: number;
  readonly endBeat: number;
  readonly isDark: boolean;
}

export interface WorldState {
  readonly songTitle: string;
  readonly castSummary: string;
  readonly primaryAccent: string;
  readonly secondaryAccent: string;
  readonly plates: readonly WorldPlateInfo[];
  readonly plateIndex: number;
  readonly plate: WorldPlateInfo;
  readonly scorePlateIndex: number;
  readonly plateTurn: number;
  readonly cast: readonly PerformerFrame[];
  readonly lead: PerformerFrame;
  readonly energyA: number;
  readonly energyB: number;
  readonly darkness: number;
  readonly sharedLight: number;
  readonly vocalLevel: number;
  readonly singing: boolean;
  readonly mouthOpen: boolean;
  readonly speakerName: string;
  readonly lineText: string;
  readonly words: readonly KaraokeWordSpan[];
  readonly lineProgress: number;
  readonly autoTiltX: number;
  readonly autoTiltY: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function titleCase(str: string): string {
  return str
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstLyricLine(piece: Piece): string {
  for (const track of piece.tracks) {
    const line = (track.phrases ?? track.lines)?.find((l) => l.trim().length > 0);
    if (line) return line.trim();
  }
  return piece.title;
}

/** Build 2–4 clean storybook plates dynamically from ANY song's `sections` or total beat span. */
export function buildSongPlates(piece: Piece, castSummary: string): readonly WorldPlateInfo[] {
  const totalBeats = Math.max(16, piece.beats || 64);
  const rawSections = (piece.sections ?? []).filter((s) => Number.isFinite(s.beat));

  // Group into up to 4 chapters so the book stepper stays crisp & tactile
  let slices: { name: string; startBeat: number; endBeat: number }[] = [];
  if (rawSections.length >= 2) {
    const chosen = rawSections.length <= 4
      ? rawSections
      : [
          rawSections[0],
          rawSections[Math.floor(rawSections.length / 3)],
          rawSections[Math.floor((rawSections.length * 2) / 3)],
          rawSections[rawSections.length - 1],
        ];
    slices = chosen.map((sec, idx) => ({
      name: sec.name,
      startBeat: sec.beat,
      endBeat: idx + 1 < chosen.length ? chosen[idx + 1].beat : totalBeats,
    }));
  } else {
    const q = totalBeats / 4;
    slices = [
      { name: "Opening", startBeat: 0, endBeat: q },
      { name: "Verse", startBeat: q, endBeat: q * 2 },
      { name: "Bridge", startBeat: q * 2, endBeat: q * 3 },
      { name: "Finale", startBeat: q * 3, endBeat: totalBeats },
    ];
  }

  const count = slices.length;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const stampSong = piece.title.toUpperCase().slice(0, 22);

  return slices.map((s, idx) => {
    const num = `${pad2(idx + 1)} / ${pad2(count)}`;
    const secClean = titleCase(s.name);
    const isDark = /dark|night|midnight|shadow|quiet/i.test(s.name);
    return {
      index: idx,
      numberLabel: num,
      sectionName: s.name,
      chapterEyebrow: `PLATE ${num} · ${s.name.toUpperCase()}`,
      title: idx === 0 ? piece.title : `${piece.title} — ${secClean}`,
      subtitle: `${castSummary} · ${secClean}`,
      promptHint: isDark
        ? "Lamps dim low — drag the diorama to tilt, or tap the hanging bell."
        : "Drag the paper table to tilt, switch worlds above, or tap the bell.",
      stampLeft: stampSong,
      stampRight: `PLATE ${pad2(idx + 1)}`,
      startBeat: s.startBeat,
      endBeat: Math.max(s.startBeat + 4, s.endBeat),
      isDark,
    };
  });
}

export function computeWorldState(params: {
  piece: Piece;
  voices: readonly { id: string; name: string; role?: string; color: string }[];
  poses: readonly PerformerPoseInput[];
  studio404: boolean;
  beat: number;
  timeSec: number;
  performing: boolean;
  still: boolean;
  selectedIndex?: number;
  plateOverride?: number | null;
  fmvManifests?: Record<string, CharacterFmvManifest | null>;
}): WorldState {
  const {
    piece,
    voices,
    poses,
    studio404,
    beat,
    performing,
    still,
    selectedIndex = 0,
    plateOverride = null,
    fmvManifests = {},
  } = params;

  // Determine the song's real onstage cast (solos -> 1 hero, duets -> 2, ensembles -> full cast)
  const onstageIds = piece.stage?.filter((id) => id !== "band");
  const trackIds = new Set(piece.tracks.filter((t) => t.events.length > 0).map((t) => t.id));
  const candidateIndices = voices
    .map((v, i) => ({ v, i }))
    .filter(({ v }) =>
      onstageIds && onstageIds.length > 0
        ? onstageIds.includes(v.id)
        : trackIds.size > 0
          ? trackIds.has(v.id)
          : true,
    );
  const castPairs = candidateIndices.length > 0 ? candidateIndices.slice(0, 8) : [{ v: voices[selectedIndex] ?? voices[0], i: selectedIndex }];

  const identities = castPairs.map(({ v }) => resolvePerformerIdentity(v, studio404, piece.title));

  // Determine each onstage member's lyrical prominence so the song's true lead is always featured
  const lyricWeight = (voiceId: string): number => {
    const tr = piece.tracks.find((t) => t.id === voiceId);
    if (!tr) return 0;
    const phrases = (tr.phrases ?? tr.lines ?? []).filter((l) => l.trim() && !/^(oo|mm|ah|hum|bom)$/i.test(l.trim()));
    const firstTrackBonus = piece.tracks[0]?.id === voiceId ? 2 : 0;
    return phrases.length * 10 + tr.events.filter((e) => e.line !== undefined).length + firstTrackBonus;
  };
  const songLeadIdentity = [...identities].sort((a, b) => lyricWeight(b.id) - lyricWeight(a.id))[0] ?? identities[0];
  const castSummary =
    identities.length === 1
      ? songLeadIdentity.name
      : identities.length === 2
        ? `${identities[0].name} & ${identities[1].name}`
        : `${songLeadIdentity.name} + ${identities.length - 1} voices`;

  const plates = buildSongPlates(piece, castSummary);
  const effectiveBeat = performing ? Math.max(0, beat) : 0;

  let scorePlateIndex = 0;
  for (let i = plates.length - 1; i >= 0; i--) {
    if (effectiveBeat >= plates[i].startBeat - 0.001) {
      scorePlateIndex = i;
      break;
    }
  }
  const plateIndex =
    plateOverride !== null && plateOverride >= 0 && plateOverride < plates.length
      ? plateOverride
      : scorePlateIndex;
  const plate = plates[plateIndex];

  const intoPlate = Math.max(0, effectiveBeat - plate.startBeat);
  const plateTurn = still || !performing ? 1 : clamp01(intoPlate / 1.6);

  // Build polymorphic PerformerFrames for every onstage cast member
  const duetTake = studio404 ? rightOnCuePerformance(piece, still ? 0 : effectiveBeat) : null;
  const cast: PerformerFrame[] = castPairs.map(({ i }, idx) => {
    const ident = identities[idx];
    const p = poses[i] ?? { singing: false, level: 0, open: 0, viseme: 0 };
    const mouthOpen = p.singing && p.open > MOUTH_OPEN_THRESHOLD;
    const cel = duetTake && (ident.artKey === "neon" || ident.artKey === "cue")
      ? duetCel(duetTake, ident.artKey)
      : resolvePerformerCel(ident.artKey, p, effectiveBeat, plateIndex, mouthOpen, fmvManifests[ident.artKey]);
    return {
      ...ident,
      singing: p.singing,
      level: p.level,
      open: p.open,
      mouthOpen,
      viseme: p.viseme,
      cel,
    };
  });

  // Song's canonical lead (highest lyrical weight) stays stable for palette/title/hero identity,
  // while activeSpeaker tracks whoever is singing lyrics right now.
  const songLead = cast.find((c) => c.id === songLeadIdentity.id) ?? cast[0];
  const activeLyricSinger = cast.find((c) => c.singing && lyricWeight(c.id) > 0) ?? songLead;

  // Resolve live karaoke words from whichever track is singing right now
  let detail: ReturnType<typeof speechDetailForTrack> = null;
  let speakerName = activeLyricSinger.name;
  if (performing) {
    for (const member of [activeLyricSinger, ...cast]) {
      const tr = piece.tracks.find((t) => t.id === member.id);
      const d = speechDetailForTrack(piece, tr, effectiveBeat);
      if (d) {
        detail = d;
        speakerName = member.name;
        break;
      }
    }
  }

  const words = detail?.words ?? [];
  const lineText = detail?.text ?? firstLyricLine(piece);
  const lineProgress = detail
    ? clamp01((effectiveBeat - detail.startBeat) / Math.max(0.25, detail.endBeat - detail.startBeat))
    : 0;

  const primaryAccent = songLead.color;
  const secondaryAccent = cast.find((c) => c.id !== songLead.id)?.color ?? songLead.accentB;

  const maxLevel = cast.reduce((m, c) => Math.max(m, c.singing ? Math.max(0.3, c.level) : 0.14), 0.14);
  const anySinging = cast.some((c) => c.singing);
  const anyMouthOpen = cast.some((c) => c.mouthOpen);
  const darkness = plate.isDark ? 0.88 : 0;
  const sharedLight = plateIndex === plates.length - 1 ? 1 : cast.filter((c) => c.singing).length >= 2 ? 0.85 : 0.25;

  const energyA = clamp01((anySinging ? 0.45 + maxLevel * 0.55 : 0.28) * (1 - darkness * 0.45) + sharedLight * 0.2);
  const energyB = clamp01((anySinging ? 0.35 + (cast[1]?.level ?? maxLevel) * 0.65 : 0.24) * (1 - darkness * 0.35) + sharedLight * 0.28);

  const actSpan = Math.max(4, plate.endBeat - plate.startBeat);
  const actNorm = clamp01((effectiveBeat - plate.startBeat) / actSpan);

  return {
    songTitle: piece.title,
    castSummary,
    primaryAccent,
    secondaryAccent,
    plates,
    plateIndex,
    plate,
    scorePlateIndex,
    plateTurn,
    cast,
    lead: songLead,
    energyA,
    energyB,
    darkness,
    sharedLight,
    vocalLevel: maxLevel,
    singing: anySinging,
    mouthOpen: anyMouthOpen,
    speakerName,
    lineText,
    words,
    lineProgress,
    autoTiltX: 14 - actNorm * 2,
    autoTiltY: -4 + actNorm * 8,
  };
}
