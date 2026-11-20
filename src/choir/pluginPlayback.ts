import { instrumentPart, partKey, scoredStemPath, type InstrumentPart } from "./pluginScore.ts";
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

export async function pluginStems(piece: Piece, voices: MoppetVoice[], ctx: AudioContext) {
  const frames = Math.ceil(pieceSeconds(piece)*ctx.sampleRate);
  return Promise.all(piece.tracks.map(async track=>{
    const pcm=new Float32Array(frames);
    if (!track.events.length) return pcm;
    if (piece.title === "Found Things") {
      const voice = voices.find(v => v.id === track.id)!;
      const response = await fetch(await scoredStemPath(piece, track, voice));
      if (response.status === 404 || response.headers.get("content-type")?.includes("text/html")) return null;
      if (!response.ok) throw new Error("Could not load the scored vocal for " + voice.name);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      pcm.set(buffer.getChannelData(0).subarray(0, frames));
      return pcm;
    }
    const voice=(import.meta.env.DEV?voices:CAST).find(v=>v.id===track.id)!;
    const buf=await pluginRecording(ctx,instrumentPart(piece,track,voice));
    pcm.set(buf.getChannelData(0).subarray(0,frames));
    return pcm;
  }));
}
