/**
 * Talking skits: the Moppets speak instead of sing. A skit is scenes of lines; each line is said by
 * one Moppet in its own voice (body, size, posture and folds from the cast recipe), through
 * CHIMERA's speech planner. The skit becomes a Piece on a seconds grid (60 bpm: a beat is a
 * second), so the ensemble, mixer and stage play it like any song: one track per speaking Moppet,
 * one event per line, at a speaking pitch inside the Moppet's register.
 */
import { lyricsToSyllables } from "@chimera/wasm/engine.ts";
import type { CinemaCameraCue, CinemaShotPreset, Piece, ScoreEvent, StageActionKind, StageBlockingCue, StageMoveTarget, Track } from "./music.ts";
import { CAST, type MoppetVoice } from "./voices.ts";
import { GESTURES, type GestureName } from "./gestures.ts";
import { SONG_FILES } from "./songs.ts";

export interface SkitLine {
  who: string;
  say: string;
  /** what the speaker does as the line starts (default: a question tilts its head) */
  do?: GestureName;
  /** what everyone else in the scene does as the line ends (default: the last line gets a laugh) */
  react?: GestureName;
  /** directed character acting take triggered on this line */
  take?: string;
  /** full-body locomotion or stage action (`; move <target> ; jump ; dance ; celebrate`) */
  moves?: { action: StageActionKind; target?: StageMoveTarget; beats?: number }[];
  /** optional shot-directed cinema camera cut (`; cam <preset>`) */
  cam?: CinemaShotPreset;
}
export interface Skit {
  id: string;
  title: string;
  description: string;
  /** each scene brings its cast downstage together */
  scenes: SkitLine[][];
}

/** Seconds per syllable at the planner's normal rate, and per pause inside a line (sentence ends pause longer). */
const SYLLABLE = 0.215, COMMA = 0.25, STOP = 0.45;
/** Silence between two lines, and between two scenes (the cast changes places). */
const TURN = 0.45, SCENE = 2;

/** The time a line needs (the planner is fitted into it, see plan.ts). */
export function lineSeconds(say: string): number {
  const commas = (say.match(/[,;:](?=\s)/g) ?? []).length, stops = (say.match(/[.!?]+(?=\s)/g) ?? []).length;
  return 0.55 + lyricsToSyllables(say).length * SYLLABLE + commas * COMMA + stops * STOP;
}

/** Speaking pitch: a semitone above the bottom of the Moppet's singing register, as a speaking voice sits (+4 cost every Moppet words: voice-tuning log, experiment 6). */
export const speakingMidi = (v: Pick<MoppetVoice, "register">) => v.register[0] + 1;

export function makeSkit(skit: Skit, voices: readonly MoppetVoice[] = CAST): Piece {
  const events = new Map<string, ScoreEvent[]>();
  const scenes: NonNullable<Piece["scenes"]> = [];
  const cues: NonNullable<Piece["cues"]> = [];
  const takes: NonNullable<Piece["takes"]> = [];
  const blocking: StageBlockingCue[] = [];
  const cameraCues: CinemaCameraCue[] = [];
  let t = 1;
  skit.scenes.forEach((scene, s) => {
    if (s) t += SCENE - TURN;
    const start = t;
    for (const [i, line] of scene.entries()) {
      const v = voices.find((x) => x.id === line.who);
      if (!v) throw new Error(`${skit.title}: no Moppet called ${line.who}`);
      const beats = lineSeconds(line.say);
      const last = s === skit.scenes.length - 1 && i === scene.length - 1;
      const act = line.do ?? (/\?\s*$/.test(line.say) ? "tilt" : undefined);
      if (act) cues.push({ beat: +t.toFixed(3), who: v.id, gesture: act });
      if (line.take) takes.push({ beat: +t.toFixed(3), who: v.id, take: line.take, beats: +beats.toFixed(3) });
      for (const mv of line.moves ?? []) {
        blocking.push({ beat: +t.toFixed(3), beats: mv.beats ?? +beats.toFixed(3), who: v.id, action: mv.action, ...(mv.target ? { target: mv.target } : {}) });
      }
      if (line.cam) cameraCues.push({ beat: +t.toFixed(3), beats: +beats.toFixed(3), who: v.id, preset: line.cam });
      const react = line.react ?? (last ? "laugh" : undefined);
      if (react) for (const who of new Set(scene.map((l) => l.who))) if (who !== v.id) cues.push({ beat: +(t + beats - 0.2).toFixed(3), who, gesture: react });
      if (last) cues.push({ beat: +(t + beats + 1.4).toFixed(3), who: v.id, gesture: "bow" });
      const list = events.get(v.id) ?? [];
      list.push({ beat: +t.toFixed(3), beats: +beats.toFixed(3), midi: speakingMidi(v), text: line.say, line: i });
      events.set(v.id, list);
      t += beats + TURN;
    }
    scenes.push({ beat: start, beats: t - start, cast: [...new Set(scene.map((l) => l.who))] });
  });
  // tracks in cast order, so each Moppet keeps its place on the stage and in the mix
  const tracks: Track[] = voices.filter((v) => events.has(v.id)).map((v) => ({ id: v.id, events: events.get(v.id)! }));
  // the final bow happens on stage, so the skit runs until it is done
  const end = Math.max(t, ...cues.map((c) => c.beat + 1.4));
  scenes[scenes.length - 1].beats = end - scenes[scenes.length - 1].beat;
  return { kind: "skit", title: skit.title, key: "D", mode: "major", bpm: 60, beats: Math.ceil(end), chords: [], tracks, stage: tracks.map((tr) => tr.id), scenes, cues, ...(takes.length ? { takes } : {}), ...(blocking.length ? { blocking } : {}), ...(cameraCues.length ? { cameraCues } : {}), description: skit.description };
}

/** The written skits, from their lead sheets in songs/ (`kind: skit`). */
export const SKITS: Skit[] = SONG_FILES.flatMap((f) => (f.kind === "skit" ? [f.skit] : []));
export type SkitId = string;

/** What stops a script being performed: a speaker not in the cast, or too much to say. */
export function skitProblems(s: Partial<Skit>, voices: readonly MoppetVoice[] = CAST): string[] {
  if (!s.title || !Array.isArray(s.scenes) || !s.scenes.length) return ["it needs a title and at least one scene"];
  const out: string[] = [];
  const ids = new Set(voices.map((v) => v.id));
  const lines = s.scenes.flat();
  const strangers = [...new Set(lines.filter((l) => !ids.has(l?.who)).map((l) => String(l?.who)))];
  if (strangers.length) out.push(`these are not Moppets: ${strangers.join(", ")} (use ${[...ids].join(", ")})`);
  if (lines.length < 4 || lines.length > 14) out.push(`it has ${lines.length} lines; write 4 to 14`);
  const odd = lines.flatMap((l) => [l?.do, l?.react]).filter((g) => g !== undefined && !GESTURES.includes(g as GestureName));
  if (odd.length) out.push(`unknown gestures: ${[...new Set(odd)].join(", ")} (use ${GESTURES.join(", ")})`);
  const long = lines.filter((l) => typeof l?.say !== "string" || !l.say.trim() || l.say.length > 140);
  if (long.length) out.push(`${long.length} lines are empty or longer than 140 characters`);
  return out;
}
