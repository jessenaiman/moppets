import type { Piece, Track } from "./music.ts";
import type { MoppetVoice } from "./voices.ts";
import { LEAD_IN, pieceSeconds } from "./timeline.ts";

export function instrumentPart(piece: Piece, track: Track, voice: MoppetVoice) {
  const lines: string[] = [];
  let previous: number | undefined;
  for (const e of track.events) {
    if (e.line === undefined || previous !== e.line) {
      lines.push((e.line === undefined ? undefined : (track.phrases ?? track.lines)?.[e.line]) || e.text || "oo");
    } else if (!track.phrases && !track.lines) lines.push(e.text || "oo");
    previous = e.line;
  }
  return { version: 1, voice: voice.id, mode: piece.kind === "skit" ? "speak" : "sing",
    bpm: piece.bpm, lead: LEAD_IN, duration: pieceSeconds(piece),
    lyrics: lines.join(piece.kind === "skit" ? "\n" : " ").replaceAll("_"," - "),
    body: voice.body, source: { pressed:voice.source.tension, breath:voice.source.pressure, bright:voice.source.brightness,
      breathy:voice.source.breathiness, rough:voice.source.roughness },
    notes: track.events.map(e=>[e.beat,e.beats,e.midi]) };
}
export type InstrumentPart = ReturnType<typeof instrumentPart> & {artic?: Record<string,number>};
export async function partKey(part: InstrumentPart) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(part)));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}

export function instrumentNote(voice: MoppetVoice, midi:number, lyric:string) : InstrumentPart {
  return {version:1,voice:voice.id,mode:"sing",bpm:120,lead:0,duration:1.8,lyrics:lyric||"la",body:voice.body,
    source:{pressed:voice.source.tension,breath:voice.source.pressure,bright:voice.source.brightness,breathy:voice.source.breathiness,rough:voice.source.roughness},
    notes:[[0,3.2,midi]]};
}


/** The scored renderer uses the full cast recipe and the lyric assigned to each note. */
export async function scoredStemPath(piece: Piece, track: Track, voice: MoppetVoice) {
  // Clank’s second render restores the recorded lead-in.
  const version = track.id === "clank" ? 2 : 1;
  const data = JSON.stringify([version, piece.bpm, piece.beats, track, voice.body, voice.size, voice.artic, voice.source, voice.vibrato]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return "/scored-vocals/" + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("") + ".ogg";
}


export async function scoredBeatPath(piece: Piece): Promise<string | undefined> {
  if (piece.title !== "Found Things" || !piece.beat) return;
  const data = JSON.stringify([1, piece.bpm, pieceSeconds(piece), piece.beat]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return "/scored-vocals/beat-" + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("") + ".ogg";
}
