/**
 * The lead-sheet format for Moppet songs, skits and round words: one text file per piece in
 * `songs/`, read by `parseSongFile` and written by `printSongFile`. See `docs/writing-songs.md`.
 *
 * A song (kind: song, the default) is the songbook's `Song`:
 *
 *   title: Autocomplete
 *   lead: scribe
 *   key: G major
 *   bpm: 120
 *   beat: B . t K | . t B . | t B . K | . B t . (swing 0.12)
 *   backing: vee +0, pip +2, tabby +4, gruff +2
 *   finale: "Home" on 7
 *   stage: band, tabby, pip                           optional: who's on stage (band: the band too)
 *
 *   tune hook = 7/1.5 4/.5 4 5 4 2 4/2 | I 4, VI 4      a named tune, reusable by name
 *
 *   [verse]                                            a section; [chorus, choir]: the choir pads
 *   pip: "Good morning how are" = 4 4 5 4 2 | I 4      who: "words" = notes | chords
 *   "pancakes made" = 7 6 4/2 | V 4 ; react gasp       no who: the lead; gestures after ;
 *   + tabby @6: "doo wah" = 4/.5 2/1.5                 an answer sung with the line, 6 beats in
 *   rest 2                                             a stop: the band too
 *   [repeat chorus]                                    the [chorus] section again
 *
 * Notes are scale degrees (0 = the tonic, 7 = an octave up, negative below), each `degree/beats`
 * (a bare degree is one beat). Chords are roman numerals of the scale with their beats.
 *
 * Engine-free: the build and the tools read it in plain bun.
 */
import type { GestureName } from "./gestures.ts";
import type { KeyName, ScaleMode } from "./music.ts";
import type { Line, Rest, Section, Song, Sung } from "./songbook.ts";
import type { Skit, SkitLine } from "./skits.ts";
import type { RoundLyrics } from "./music.ts";

export type SongFile =
  | { kind: "song"; id: string; tab: string; song: Song }
  | { kind: "skit"; id: string; skit: Skit }
  | { kind: "round"; id: string; sets: RoundLyrics[] };

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/**
 * Words as a lead sheet can hold them: a straight double quote would end the quoted words, so it
 * becomes a curly one (the editor applies this as you type).
 */
export const sheetWords = (w: string) => w.replace(/"([^"]*)"/g, "“$1”").replace(/"/g, "”");

/** A line without its comment: `#` starts one only outside quotes ("Track #1" keeps its #). */
function stripComment(raw: string): string {
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') quoted = !quoted;
    else if (raw[i] === "#" && !quoted && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i);
  }
  return raw;
}

export class SongFileError extends Error {
  constructor(
    readonly file: string,
    readonly line: number,
    message: string,
  ) {
    super(`${file}:${line}: ${message}`);
  }
}

// ------------------------------------------------------------------------------------- parse

const num = (s: string) => {
  const n = Number(s.startsWith(".") ? `0${s}` : s.startsWith("-.") ? `-0${s.slice(1)}` : s);
  if (!Number.isFinite(n)) throw new Error(`"${s}" is not a number`);
  return n;
};

function parseNotes(text: string): { degrees: number[]; rhythm: number[] } {
  const degrees: number[] = [], rhythm: number[] = [];
  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    const [d, b] = tok.split("/");
    degrees.push(num(d));
    rhythm.push(b === undefined ? 1 : num(b));
  }
  if (!degrees.length) throw new Error("no notes");
  return { degrees, rhythm };
}

function parseChords(text: string): [number, number][] {
  return text.split(",").map((c) => {
    const [r, b] = c.trim().split(/\s+/);
    const deg = ROMAN.indexOf(r.toUpperCase());
    if (deg < 0) throw new Error(`"${r}" is not a chord (I to VII)`);
    return [deg, num(b)];
  });
}

/** `"words" = notes | chords` or `"words" = tune`, then `; do x ; react y`. */
function parsePhrase(text: string, tunes: Map<string, { degrees: number[]; rhythm: number[]; chords?: [number, number][] }>): { words: string; degrees: number[]; rhythm: number[]; chords?: [number, number][]; do?: GestureName; react?: GestureName } {
  const m = /^"([^"]*)"\s*=\s*([^;]*)(.*)$/.exec(text.trim());
  if (!m) throw new Error(`expected "words" = notes`);
  const [, words, music, rest] = m;
  const out: ReturnType<typeof parsePhrase> = { words, degrees: [], rhythm: [] };
  const tune = tunes.get(music.trim());
  if (tune) Object.assign(out, structuredClone(tune));
  else {
    const [notes, chords] = music.split("|");
    Object.assign(out, parseNotes(notes));
    if (chords !== undefined) out.chords = parseChords(chords);
  }
  for (const part of rest.split(";").map((p) => p.trim()).filter(Boolean)) {
    const [k, v] = part.split(/\s+/);
    if (k === "do" || k === "react") out[k] = v as GestureName;
    else throw new Error(`unknown "${k}" (do or react)`);
  }
  return out;
}

export function parseSongFile(text: string, file = "song"): SongFile {
  const meta = new Map<string, string>();
  const tunes = new Map<string, { degrees: number[]; rhythm: number[]; chords?: [number, number][] }>();
  const figures: NonNullable<Song["figures"]> = {};
  const named = new Map<string, Section>();
  const sections: Section[] = [];
  const scenes: SkitLine[][] = [];
  const sets: RoundLyrics[] = [];
  let section: Section | null = null;
  let lastLine: Line | null = null;
  let set: { id: string; title: string; lines: string[]; last: string } | null = null;
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const at = i + 1;
    try {
      const line = stripComment(raw).trimEnd();
      if (!line.trim()) return;
      const t = line.trim();
      const kind = meta.get("kind") ?? "song";
      // a section, scene or word set header
      const head = /^\[(.+)\]$/.exec(t);
      if (head) {
        const [name, ...flags] = head[1].split(",").map((s) => s.trim());
        if (kind === "skit") {
          scenes.push([]);
          return;
        }
        if (kind === "round") {
          const m = /^words\s+(\S+)$/.exec(name);
          if (!m) throw new Error(`expected [words <id>]`);
          set = { id: m[1], title: "", lines: [], last: "" };
          sets.push(set as RoundLyrics & typeof set);
          return;
        }
        const repeat = /^repeat\s+(.+)$/.exec(name);
        if (repeat) {
          const s = named.get(repeat[1]);
          if (!s) throw new Error(`no section [${repeat[1]}] before this`);
          sections.push(s);
          section = null;
          return;
        }
        section = { name, lines: [], ...(flags.includes("choir") ? { choir: true } : {}) };
        named.set(name, section);
        sections.push(section);
        lastLine = null;
        return;
      }
      // key: value
      const kv = /^([a-z]+):\s*(.*)$/.exec(t);
      if (kv && !section && !scenes.length && !set) {
        meta.set(kv[1], kv[2]);
        return;
      }
      if (kind === "round") {
        if (!set) throw new Error("a line before any [words <id>]");
        const field = /^(title|last):\s*"(.*)"$/.exec(t);
        if (field) set[field[1] as "title" | "last"] = field[2];
        else {
          const q = /^"(.*)"$/.exec(t);
          if (!q) throw new Error(`expected "a line of words", title: "…" or last: "…"`);
          set.lines.push(q[1]);
        }
        return;
      }
      if (kind === "skit") {
        if (!scenes.length) throw new Error("a line before any [scene]");
        const m = /^([a-z]+):\s*"([^"]*)"(.*)$/.exec(t);
        if (!m) throw new Error(`expected who: "line"`);
        const l: SkitLine = { who: m[1], say: m[2] };
        for (const part of m[3].split(";").map((p) => p.trim()).filter(Boolean)) {
          const [k, v] = part.split(/\s+/);
          if (k === "do" || k === "react") l[k] = v as GestureName;
          else throw new Error(`unknown "${k}" (do or react)`);
        }
        scenes[scenes.length - 1].push(l);
        return;
      }
      const figure = /^figure (\w+) = (.+)$/.exec(t);
      if (figure) {
        figures[figure[1]] = parseNotes(figure[2]);
        return;
      }
      const tune = /^tune\s+(\S+)\s*=\s*(.*)$/.exec(t);
      if (tune) {
        const [notes, chords] = tune[2].split("|");
        tunes.set(tune[1], { ...parseNotes(notes), ...(chords !== undefined ? { chords: parseChords(chords) } : {}) });
        return;
      }
      if (!section) throw new Error("a line before any [section]");
      const turnaround = /^turnaround (.+)$/.exec(t);
      if (turnaround) {
        const chords = parseChords(turnaround[1]);
        section.lines.push({rest: chords.reduce((n, chord) => n + chord[1], 0), chords});
        return;
      }
      const rest = /^rest\s+(\S+)$/.exec(t);
      if (rest) {
        section.lines.push({ rest: num(rest[1]) } satisfies Rest);
        lastLine = null;
        return;
      }
      // an answer, sung with the line above: + [who] [@offset]: "words" = notes
      const answer = /^\+\s*([a-z]+)?\s*(?:@(\S+))?\s*:\s*(.*)$/.exec(t);
      if (answer) {
        if (!lastLine) throw new Error("an answer (+) needs a line above it");
        const p = parsePhrase(answer[3], tunes);
        const w: Sung = { ...(answer[1] ? { who: answer[1] } : {}), words: p.words, degrees: p.degrees, rhythm: p.rhythm, ...(answer[2] !== undefined ? { offset: num(answer[2]) } : {}), ...(p.do ? { do: p.do } : {}), ...(p.react ? { react: p.react } : {}) };
        (lastLine.with ??= []).push(w);
        return;
      }
      const sung = /^(?:([a-z]+):\s*)?(".*)$/.exec(t);
      if (!sung) throw new Error(`expected [who:] "words" = notes | chords`);
      const p = parsePhrase(sung[2], tunes);
      if (!p.chords) throw new Error("a line needs its chords (| I 4, …) or a tune that has them");
      const l: Line = { ...(sung[1] ? { who: sung[1] } : {}), words: p.words, ...(p.do ? { do: p.do } : {}), ...(p.react ? { react: p.react } : {}), degrees: p.degrees, rhythm: p.rhythm, chords: p.chords };
      section.lines.push(l);
      lastLine = l;
    } catch (e) {
      throw e instanceof SongFileError ? e : new SongFileError(file, at, e instanceof Error ? e.message : String(e));
    }
  });
  const need = (k: string) => {
    const v = meta.get(k);
    if (v === undefined) throw new SongFileError(file, 1, `missing "${k}:"`);
    return v;
  };
  const id = need("id");
  const kind = meta.get("kind") ?? "song";
  if (kind === "skit") return { kind, id, skit: { id, title: need("title"), description: meta.get("about") ?? "", scenes } };
  if (kind === "round") return { kind, id, sets };
  const [key, mode] = need("key").split(/\s+/);
  const beat = meta.get("beat");
  const bm = beat ? /^(.*?)\s*\(swing\s+([\d.]+)\)$/.exec(beat) : null;
  const fin = /^"([^"]*)"\s+(?:on\s+(-?\d+)|=\s*(.+))$/.exec(meta.get("finale") ?? "");
  if (!fin && meta.get("arrangement") !== "introduction") throw new SongFileError(file, 1, `finale: "Word" on <degree>`);
  const finaleNotes = fin?.[3] ? parseNotes(fin[3]) : undefined;
  const meter = meta.get("meter");
  if (meter !== undefined && !/^(?:[1-9]|[1-9]\d)\/(1|2|4|8|16|32)$/.test(meter)) throw new SongFileError(file,1,"Invalid meter; use a time signature such as 3/4 or 6/8");
  const song: Song = {
    ...(meter ? {meter} : {}),
    lead: need("lead"),
    title: need("title"),
    description: meta.get("about") ?? "",
    key: key as KeyName,
    ...(mode ? { mode: mode as ScaleMode } : {}),
    bpm: num(need("bpm")),
    sections,
    seats: (meta.get("backing") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const [who, off] = s.split(/\s+/);
      return [who, num(off.replace(/^\+/, ""))] as [string, number];
    }),
    ...(meta.has("bass") ? { bass: meta.get("bass")! } : {}),
    ...(meta.has("stage") ? { stage: meta.get("stage")!.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
    ...(beat ? { beat: { text: bm ? bm[1] : beat, swing: bm ? num(bm[2]) : 0 } } : {}),
    ...(fin ? { finale: { word: fin[1], degree: finaleNotes?.degrees.at(-1) ?? num(fin[2]), ...(finaleNotes ? { notes: finaleNotes } : {}) } } : {}),
    ...(meta.get("arrangement") === "introduction" ? {arrangement: "introduction"} : {}),
    ...(meta.has("breath") ? {breath: num(need("breath"))} : {}),
    ...(meta.has("tracks") ? {trackOrder: need("tracks").split(/\s+/)} : {}),
    ...(meta.has("registers") ? {registers: Object.fromEntries(need("registers").split(",").map(v => {
      const [id, shift] = v.trim().split(/\s+/);
      return [id, num(shift)];
    }))} : {}),
    ...(meta.has("double") ? {double: (() => {
      const [id, steps, shift] = need("double").split(/\s+/);
      return {id, steps: num(steps), shift: num(shift)};
    })()} : {}),
    ...(Object.keys(figures).length ? {figures} : {}),
  };
  return { kind: "song", id, tab: meta.get("tab") ?? song.title, song };
}

// ------------------------------------------------------------------------------------- print

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace(/^0\./, ".").replace(/^-0\./, "-."));
const notes = (s: { degrees: number[]; rhythm: number[] }) => s.degrees.map((d, i) => (s.rhythm[i] === 1 ? fmt(d) : `${fmt(d)}/${fmt(s.rhythm[i])}`)).join(" ");
const chords = (c: [number, number][]) => c.map(([d, b]) => `${ROMAN[d]} ${fmt(b)}`).join(", ");
const gestures = (s: { do?: string; react?: string }) => `${s.do ? ` ; do ${s.do}` : ""}${s.react ? ` ; react ${s.react}` : ""}`;

export function printSongFile(f: SongFile): string {
  if (f.kind === "skit") {
    const head = [`kind: skit`, `id: ${f.id}`, `title: ${f.skit.title}`, `about: ${f.skit.description}`];
    return [...head, ...f.skit.scenes.flatMap((sc, i) => ["", `[scene ${i + 1}]`, ...sc.map((l) => `${l.who}: "${l.say}"${gestures(l)}`)])].join("\n") + "\n";
  }
  if (f.kind === "round") {
    return [`kind: round`, `id: ${f.id}`, ...f.sets.flatMap((s) => ["", `[words ${s.id}]`, `title: "${s.title}"`, ...s.lines.map((l) => `"${l}"`), `last: "${s.last}"`])].join("\n") + "\n";
  }
  const s = f.song;
  const out = [
    `title: ${s.title}`,
    `id: ${f.id}`,
    `tab: ${f.tab}`,
    `about: ${s.description}`,
    `lead: ${s.lead}`,
    `key: ${s.key}${s.mode ? ` ${s.mode}` : ""}`,
    `bpm: ${fmt(s.bpm)}`,
    ...(s.meter ? [`meter: ${s.meter}`] : []),
    ...(s.beat ? [`beat: ${s.beat.text} (swing ${fmt(s.beat.swing)})`] : []),
    `backing: ${s.seats.map(([w, o]) => `${w} +${fmt(o)}`).join(", ")}`,
    ...(s.bass ? [`bass: ${s.bass}`] : []),
    ...(s.stage ? [`stage: ${s.stage.join(", ")}`] : []),
    ...(s.arrangement ? [`arrangement: ${s.arrangement}`] : []),
    ...(s.breath ? [`breath: ${fmt(s.breath)}`] : []),
    ...(s.trackOrder ? [`tracks: ${s.trackOrder.join(" ")}`] : []),
    ...(s.registers ? [`registers: ${Object.entries(s.registers).map(([id, shift]) => `${id} ${shift}`).join(", ")}`] : []),
    ...(s.double ? [`double: ${s.double.id} ${s.double.steps} ${s.double.shift}`] : []),
    ...Object.entries(s.figures ?? {}).map(([id, figure]) => `figure ${id} = ${notes(figure)}`),
    ...(s.finale ? [`finale: "${s.finale.word}" ${s.finale.notes ? `= ${notes(s.finale.notes)}` : `on ${fmt(s.finale.degree)}`}`] : []),
  ];
  // a line's music used three or more times becomes a named tune
  const key = (l: { degrees: number[]; rhythm: number[]; chords?: [number, number][] }) => `${notes(l)} | ${l.chords ? chords(l.chords) : ""}`;
  const uses = new Map<string, number>();
  for (const sec of new Set(s.sections)) for (const l of sec.lines) if (!("rest" in l)) uses.set(key(l), (uses.get(key(l)) ?? 0) + 1);
  const tuneName = new Map<string, string>();
  for (const [k, n] of uses) if (n >= 3) tuneName.set(k, String.fromCharCode(97 + tuneName.size)); // a, b, c…
  if (tuneName.size) out.push("", ...[...tuneName].map(([k, name]) => `tune ${name} = ${k.replace(/ \| $/, "")}`));
  const music = (l: Line) => tuneName.get(key(l)) ?? `${notes(l)} | ${chords(l.chords)}`;
  // a section object used again is printed once and repeated by name
  const names = new Map<Section, string>();
  let verse = 0;
  for (const sec of s.sections) {
    out.push("");
    const seen = names.get(sec);
    if (seen) {
      out.push(`[repeat ${seen}]`);
      continue;
    }
    const repeated = s.sections.filter((x) => x === sec).length > 1;
    const name = sec.name ?? (repeated ? (names.size && [...names.values()].includes("chorus") ? `chorus ${names.size}` : "chorus") : `verse ${++verse}`);
    names.set(sec, name);
    out.push(`[${name}${sec.choir ? ", choir" : ""}]`);
    for (const l of sec.lines) {
      if ("rest" in l) {
        out.push(l.chords ? `turnaround ${chords(l.chords)}` : `rest ${fmt(l.rest)}`);
        continue;
      }
      out.push(`${l.who ? `${l.who}: ` : ""}"${l.words}" = ${music(l)}${gestures(l)}`);
      for (const w of l.with ?? []) out.push(`  + ${w.who ?? ""}${w.offset !== undefined ? ` @${fmt(w.offset)}` : ""}: "${w.words}" = ${notes(w)}${gestures(w)}`);
    }
  }
  return out.join("\n") + "\n";
}
