/** Render the keyed Found Things stems with each Moppet's native tract and planned consonants. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { initEngine, wasmModule } from "./wasm-harness.ts";
import { scoredBeatPath, scoredStemPath } from "../src/choir/pluginScore";
await initEngine();
const { beatReady, EnglishG2P, parseBeat } = await import("@chimera/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync("public/data/cmudict.txt.gz")).toString());
const { SONGBOOK } = await import("../src/choir/songbook");
const { CAST } = await import("../src/choir/voices");
const { planTrack, pieceSeconds, LEAD_IN } = await import("../src/choir/plan");
const { CueCore, SingerCore, midiToHz, hopFor } = await import("../src/choir/singerCore");
const piece = SONGBOOK.find(s => s.id === "found")!.make();
const sampleRate = 48000;
const frames = Math.ceil(pieceSeconds(piece) * sampleRate);
mkdirSync("public/scored-vocals", {recursive:true});

function writeStem(file: string, samples: Float32Array) {
  execFileSync("ffmpeg", ["-v","error","-y","-f","f32le","-ar",String(sampleRate),"-ac","1","-i","pipe:0","-c:a","libopus","-b:a","64k",file+".partial.ogg"], {input:Buffer.from(samples.buffer as ArrayBuffer)});
  renameSync(file+".partial.ogg", file);
}

const beatPath = await scoredBeatPath(piece);
if ((!process.argv[2] || process.argv[2] === "beat") && piece.beat && beatPath && !existsSync("public" + beatPath)) {
  const beat = new CueCore(new WebAssembly.Instance(wasmModule).exports as never, {
    sampleRate, frames, hop: hopFor(sampleRate),
    beat: { steps: parseBeat(piece.beat.text), bpm: piece.bpm, swing: piece.beat.swing, startSeconds: LEAD_IN, ready: { ...beatReady({ female: 0, child: 0 }) } },
  });
  try {
    while (beat.rendered < frames) beat.step();
    writeStem("public" + beatPath, beat.stem);
  } finally { beat.dispose(); }
}
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
    writeStem(file, core.stem);
    console.log(voice.name, file);
  } finally { core.dispose(); }
}
