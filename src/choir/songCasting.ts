/**
 * Declarative per-song Bible casting, riser band lineups, storyboard set plates, and directed takes (`S-5`, `D-9`).
 *
 * Every Studio 404 character uses one canonical Character Bible ID (`neon`, `cue`, `folio`, `watt`, `tracker`,
 * `tabby`, `gruff`, `chip`, `clank`, `zap`, `hertz`, `ozzi`, `deck`, `tally`, `clacker`, `click`, `fuzz`,
 * `leadsinger`, `moonbell`, `thrum`) across songs, voices, console, and stage.
 * `voiceToCast` is used strictly when an ensemble song deliberately casts a synthesis voice into a guest/band role.
 */
import type { Piece } from "./music.ts";
import { canonicalCastId, getCastCharacter, resolveDirectedTakeClip, type ActiveTakeState } from "./castManifest.ts";

export interface TimedDirectedTake {
  readonly who: string;
  readonly take: string;
  readonly startSec: number;
  readonly durationSec?: number;
}

export interface SetCue {
  readonly sectionPrefix?: string;
  readonly minBeat?: number;
  readonly setId: string;
}

export interface SongCastSpec {
  readonly voiceToCast?: Readonly<Record<string, string>>;
  readonly voiceDisplayOverrides?: Readonly<Record<string, { name: string; role?: string }>>;
  readonly riserBand?: readonly string[];
  readonly setId?: string;
  readonly setCues?: readonly SetCue[];
  readonly timedTakes?: readonly TimedDirectedTake[];
  readonly extraRiserCast?: readonly string[];
}

export const SPARE_PARTS_BAND: readonly string[] = ["click", "thrum", "clacker", "fuzz"];

export const SONG_CASTING: Readonly<Record<string, SongCastSpec>> = {
  "Ribbon and Felt": {
    riserBand: [],
    setId: "studio404-spotlight",
  },
  "Rock Royalty 404": {
    riserBand: [],
    setId: "arena-lit",
    setCues: [
      { sectionPrefix: "intro", setId: "stage-dark" },
      { sectionPrefix: "verse 1", setId: "arena-lit" },
      { sectionPrefix: "pre-chorus", setId: "rhythm-riser" },
      { sectionPrefix: "chorus", setId: "arena-lit" },
      { sectionPrefix: "verse 2", setId: "stage-left" },
      { sectionPrefix: "breakdown", setId: "caretaker-door" },
    ],
  },
  "Found Things": {
    riserBand: ["click", "thrum", "clacker", "moonbell"],
    setId: "arena-lit",
  },
  "Two Taps for a Stamp": {
    setId: "bench-right",
    timedTakes: [
      { who: "cue", take: "letter", startSec: 2.275, durationSec: 4.0 },
      { who: "chip", take: "stamp", startSec: 9.775, durationSec: 3.0 },
      { who: "cue", take: "letter", startSec: 21.025, durationSec: 4.0 },
      { who: "chip", take: "stamp", startSec: 30.4, durationSec: 3.0 },
      { who: "cue", take: "letter", startSec: 37.9, durationSec: 4.0 },
    ],
  },
  "Zero Four Zero Four": {
    setId: "bench-right",
  },
  "Sport Walkman Logger": {
    setId: "bench-right",
  },
  "Every Button": {
    setId: "bench-right",
  },
  "Hoot, Take 404": {
    setId: "bench-right",
  },
  "Prince of Patchbays": {
    riserBand: ["click", "thrum", "clacker", "fuzz"],
    setId: "arena-lit",
  },
  "Tracking Lines & Rabbit Ears": {
    setId: "bench-right",
  },
  "The Toaster Knows": {
    setId: "bench-right",
    timedTakes: [{ who: "gruff", take: "toaster-shrug", startSec: 22.8, durationSec: 3.0 }],
  },
  "All Rise, Lightly Browned": {
    setId: "bench-right",
    timedTakes: [{ who: "tabby", take: "toast", startSec: 23.5, durationSec: 6.0 }],
  },
  "One Quiet Bar": {
    riserBand: [],
    setId: "rhythm-riser",
  },
  "Band Night": {
    riserBand: ["click", "thrum", "clacker", "fuzz"],
    setId: "rhythm-riser",
  },
  "Borrowed Light": {
    riserBand: ["thrum"],
    setId: "stage-dark",
  },
  "The Neon Playbook": {
    riserBand: ["thrum", "clacker", "click"],
    extraRiserCast: ["tracker", "hertz"],
    setId: "arena-lit",
  },
  "Right on Cue": {
    setId: "right-on-cue",
  },
  "Take Two": {
    setId: "neon-repair",
  },
  "Four on a Cardboard Horse": {
    setId: "studio404-floor",
  },
  "Deep Hum & Twelve-Inch Fret": {
    riserBand: [],
    setId: "rhythm-riser",
  },
  "Bible · Chip": { riserBand: [], setId: "bench-right" },
  "Bible · Clacker": { riserBand: [], setId: "arena-lit" },
  "Bible · Clank": { riserBand: [], setId: "bench-right" },
  "Bible · Click": { riserBand: [], setId: "arena-lit" },
  "Bible · Cue": { riserBand: [], setId: "bench-right" },
  "Bible · Deck": { riserBand: [], setId: "bench-right" },
  "Bible · Folio": { riserBand: [], setId: "bench-right" },
  "Bible · Fuzz": { riserBand: [], setId: "arena-lit" },
  "Bible · Gruff": { riserBand: [], setId: "bench-right" },
  "Bible · Hertz": { riserBand: [], setId: "bench-right" },
  "Bible · LeadSinger": { riserBand: [], setId: "arena-lit" },
  "Bible · Moonbell": { riserBand: [], setId: "arena-lit" },
  "Bible · Neon": { riserBand: [], setId: "arena-lit" },
  "Bible · Ozzi": { riserBand: [], setId: "arena-lit" },
  "Bible · Tabby": { riserBand: [], setId: "bench-right" },
  "Bible · Tally": { riserBand: [], setId: "bench-right" },
  "Bible · Thrum": { riserBand: [], setId: "arena-lit" },
  "Bible · Tracker": { riserBand: [], setId: "bench-right" },
  "Bible · Watt": { riserBand: [], setId: "bench-right" },
  "Bible · Zap": { riserBand: [], setId: "bench-right" },
};

export function getSongCastSpec(songTitle?: string): SongCastSpec | undefined {
  return songTitle ? SONG_CASTING[songTitle] : undefined;
}

/** Resolve the Studio 404 Bible `castId` for a CHIMERA voice track ID inside `songTitle`. */
export function resolveSongCastId(voiceId: string, _studio404 = true, songTitle?: string): string {
  const spec = getSongCastSpec(songTitle);
  const override = spec?.voiceToCast?.[voiceId];
  if (override) return canonicalCastId(override);
  return canonicalCastId(voiceId);
}

/** Determine upstage riser band / extra Bible characters for `piece` (never duplicating downstage cast). */
export function resolveRiserCastIds(piece: Piece, downstageCastIds: readonly string[], _studio404 = true): string[] {
  const downSet = new Set(downstageCastIds.map(canonicalCastId));
  const spec = getSongCastSpec(piece.title);
  const requested: string[] = [];

  if (spec?.riserBand !== undefined) {
    requested.push(...spec.riserBand);
  } else if (piece.stage?.includes("band")) {
    requested.push(...SPARE_PARTS_BAND);
  }
  if (spec?.extraRiserCast?.length) {
    requested.push(...spec.extraRiserCast);
  }

  const out: string[] = [];
  for (const raw of requested) {
    const cid = canonicalCastId(raw);
    if (!downSet.has(cid) && !out.includes(cid) && getCastCharacter(cid)) {
      out.push(cid);
    }
  }
  return out;
}

/** Resolve the active storyboard set plate ID for `piece` at `beat`. */
export function resolvePieceSetId(
  piece: Piece,
  downstageCastIds: readonly string[],
  beat: number,
  _studio404 = true,
): string | null {
  const spec = getSongCastSpec(piece.title);
  if (spec?.setCues?.length && piece.sections?.length) {
    let activeSectionName = "";
    for (const sec of piece.sections) {
      if (sec.beat <= beat) activeSectionName = sec.name.toLowerCase();
    }
    for (let i = spec.setCues.length - 1; i >= 0; i--) {
      const cue = spec.setCues[i];
      if (cue.sectionPrefix && activeSectionName.startsWith(cue.sectionPrefix.toLowerCase())) {
        return cue.setId;
      }
      if (cue.minBeat !== undefined && beat >= cue.minBeat) {
        return cue.setId;
      }
    }
  }
  if (spec?.setId) return spec.setId;

  const SOLO_SETS = new Set(["chip", "clank", "cue", "gruff", "neon", "tabby", "watt", "zap"]);
  if (downstageCastIds.length === 1 && SOLO_SETS.has(downstageCastIds[0])) {
    return downstageCastIds[0];
  }
  return "studio404-floor";
}

/**
 * Determine whether performer (`voiceId`, `castId`) has an active directed take clip at `(beat, timeSec)`.
 */
export function resolveActiveDirectedTake(
  piece: Piece,
  voiceId: string,
  castId: string,
  beat: number,
  timeSec: number,
  beatSec: number,
  leadInSec: number,
): ActiveTakeState | null {
  const canon = canonicalCastId(castId);

  for (const tk of piece.takes ?? []) {
    if (tk.who !== voiceId && canonicalCastId(tk.who) !== canon) continue;
    const clip = resolveDirectedTakeClip(canon, tk.take);
    if (!clip) continue;
    const clipDur = clip.frames / Math.max(1, clip.fps);
    const startSec = leadInSec + tk.beat * beatSec;
    const elapsed = timeSec - startSec;
    if (elapsed >= 0 && elapsed < clipDur) {
      return { clipKey: clip.clipKey, elapsedSec: elapsed, durationSec: clipDur };
    }
  }

  const spec = getSongCastSpec(piece.title);
  for (const tk of spec?.timedTakes ?? []) {
    if (tk.who !== voiceId && canonicalCastId(tk.who) !== canon) continue;
    const clip = resolveDirectedTakeClip(canon, tk.take);
    if (!clip) continue;
    const clipDur = tk.durationSec ?? clip.frames / Math.max(1, clip.fps);
    const elapsed = timeSec - tk.startSec;
    if (elapsed >= 0 && elapsed < clipDur) {
      return { clipKey: clip.clipKey, elapsedSec: elapsed, durationSec: clipDur };
    }
  }

  for (const cue of piece.cues ?? []) {
    if (cue.who !== voiceId && canonicalCastId(cue.who) !== canon) continue;
    const clip = resolveDirectedTakeClip(canon, cue.gesture);
    if (!clip) continue;
    if (cue.gesture === "bow" && beat < piece.beats - 12 && piece.kind !== "skit") continue;
    const clipDur = clip.frames / Math.max(1, clip.fps);
    const startSec = leadInSec + cue.beat * beatSec;
    const elapsed = timeSec - startSec;
    if (elapsed >= 0 && elapsed < clipDur) {
      return { clipKey: clip.clipKey, elapsedSec: elapsed, durationSec: clipDur };
    }
  }

  return null;
}

export function resolveMultiplaneGagActive(
  piece: Piece,
  voiceId: string,
  castId: string,
  beat: number,
  timeSec: number,
  beatSec: number,
  leadInSec: number,
): boolean {
  const canon = canonicalCastId(castId);
  for (const tk of piece.takes ?? []) {
    if (tk.who !== voiceId && canonicalCastId(tk.who) !== canon) continue;
    if (
      tk.take === "adjust-specs" ||
      tk.take === "probe-arc" ||
      tk.take === "overdrive" ||
      tk.take === "overdrive-arc" ||
      tk.take === "shred" ||
      tk.take === "ticker-cue" ||
      tk.take === "crt-answer" ||
      tk.take === "tilt" ||
      tk.take === "gasp" ||
      tk.take === "listening" ||
      tk.take === "listen"
    ) {
      const startSec = leadInSec + tk.beat * beatSec;
      const dur = Math.max(2.6, (tk.beats ?? 4) * beatSec);
      if (timeSec >= startSec && timeSec < startSec + dur) return true;
    }
  }
  return false;
}
