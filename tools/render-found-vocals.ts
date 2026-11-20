/** Render the keyed Found Things stems with each Moppet's native tract and planned consonants. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { initEngine, wasmModule } from "../tests/harness";
import { scoredStemPath } from "../src/choir/pluginScore";
await initEngine();
const { EnglishG2P } = await import("@chimera/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync("public/data/cmudict.txt.gz")).toString());
const { SONGBOOK } = await import("../src/choir/songbook");
const { CAST } = await import("../src/choir/voices");
const { planTrack, pieceSeconds, LEAD_IN, beatSeconds } = await import("../src/choir/plan");
const { SingerCore, midiToHz, hopFor } = await import("../src/choir/singerCore");
const piece = SONGBOOK.find(s => s.id === "found")!.make();
const sampleRate = 48000;
const frames = Math.ceil(pieceSeconds(piece) * sampleRate);
mkdirSync("public/scored-vocals", {recursive:true});
for (const track of piece.tracks) {
  if (process.argv[2] && track.id !== process.argv[2]) continue;
  const voice = CAST.find(v => v.id === track.id)!;
  const file = "public" + await scoredStemPath(piece, track, voice);
  if (existsSync(file)) continue;
  const plan = planTrack(track, piece, voice);
  const core = new SingerCore(new WebAssembly.Instance(wasmModule).exports as never, {
    voice, frames, sampleRate, hop: hopFor(sampleRate), nasal:plan.nasal,
    gestures:plan.gestures, firstF0:midiToHz(plan.firstMidi),
  });
  try {
    while (core.rendered < frames) core.step();
    if (track.id === "clank") {
      // Preserve the recorded bass entrance through the first bar of the arrangement.
      const end = LEAD_IN + (piece.sections?.[1]?.beat ?? 4) * beatSeconds(piece);
      const fade = 0.025;
      const source = "public/plugin-vocals/bcc55d54f88ea7a56609d5d986d174192ad9796f1ca8d022f41487a33a5aa71d.ogg";
      const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", source, "-t", String(end + fade),
        "-ar", String(sampleRate), "-ac", "1", "-f", "f32le", "pipe:1"]);
      const preserved = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
      for (let i = 0; i < preserved.length; i++) {
        const blend = Math.min(1, (preserved.length - i) / (fade * sampleRate));
        core.stem[i] = preserved[i] * blend + core.stem[i] * (1 - blend);
      }
    }
    execFileSync("ffmpeg", ["-v","error","-y","-f","f32le","-ar","48000","-ac","1","-i","pipe:0","-c:a","libopus","-b:a","64k",file+".partial.ogg"], {input:Buffer.from(core.stem.buffer as ArrayBuffer)});
    renameSync(file+".partial.ogg", file);
    console.log(voice.name, file);
  } finally { core.dispose(); }
}
