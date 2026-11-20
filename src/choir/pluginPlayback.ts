import { partKey, scoredBeatPath, scoredStemPath, type InstrumentPart } from "./pluginScore.ts";
import type { Piece } from "./music.ts";
import { pieceSeconds } from "./timeline.ts";
import { CAST, type MoppetVoice } from "./voices.ts";

const notes = new Map<string, Promise<AudioBuffer>>();
export async function pluginRecording(ctx: AudioContext, part: InstrumentPart) {
  const key = await partKey(part);
  if (part.duration > 2) return loadRecording(ctx, key, part);
  const cacheKey = ctx.sampleRate + "-" + key;
  const existing = notes.get(cacheKey);
  if (existing) return existing;
  const pending = loadRecording(ctx, key, part).catch(error => {
    notes.delete(cacheKey);
    throw error;
  });
  if (notes.size >= 48) notes.delete(notes.keys().next().value!);
  notes.set(cacheKey, pending);
  return pending;
}

async function loadRecording(ctx: AudioContext, key: string, part: InstrumentPart) {
  let res = await fetch(`/plugin-vocals/${key}.ogg`);
  if (!res.ok || res.headers.get("content-type")?.includes("text/html")) {
    if (!import.meta.env.DEV) throw new Error("This performance needs the local CHIMERA plug-in host. Open the local stage for custom voices or edited notes.");
    res = await fetch("/__plugin-vocal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(part)});
    if (!res.ok) throw new Error("The local CHIMERA plug-in could not render this part: "+(await res.text()).slice(0,180));
  }
  return ctx.decodeAudioData(await res.arrayBuffer());
}

// Found Things has an approved score-specific recording. Other songs use the singer workers.
export async function foundThingsStems(piece: Piece, voices: MoppetVoice[], ctx: AudioContext) {
  if (piece.title !== "Found Things") return;
  const frames = Math.ceil(pieceSeconds(piece) * ctx.sampleRate);
  const cast = import.meta.env.DEV ? voices : CAST;
  const decode = async (path: string | undefined) => {
    if (!path) return null;
    try {
      const response = await fetch(path);
      if (!response.ok || response.headers.get("content-type")?.includes("text/html")) return null;
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      const pcm = new Float32Array(frames);
      pcm.set(buffer.getChannelData(0).subarray(0, frames));
      return pcm;
    } catch {
      // A missing or unsupported recording can still be sung by the native score renderer.
      return null;
    }
  };
  const [vocals, beat] = await Promise.all([
    Promise.all(piece.tracks.map(async track => {
      if (!track.events.length) return null;
      return decode(await scoredStemPath(piece, track, cast.find(voice => voice.id === track.id)!));
    })),
    scoredBeatPath(piece).then(decode),
  ]);
  return { vocals, beat };
}
