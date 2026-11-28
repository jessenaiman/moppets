import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { initEngine } from "./wasm-harness.ts";

await initEngine();

const [{ midiBytes }, { makeSkit }, { buildSong }, { parseSongFile }] = await Promise.all([
  import("../src/choir/midi.ts"),
  import("../src/choir/skits.ts"),
  import("../src/choir/songbook.ts"),
  import("../src/choir/songFile.ts"),
]);

const ids = process.argv.slice(2).map((s) => s.replace(/^songs\//, "").replace(/\.(song|mid)$/, ""));
if (!ids.length) {
  console.error("Usage: bun tools/sync-song-midi.ts <id-or-path> [...]");
  process.exit(1);
}

for (const id of ids) {
  const songPath = path.resolve("songs", `${id}.song`);
  const midPath = path.resolve("songs", `${id}.mid`);
  const parsed = parseSongFile(readFileSync(songPath, "utf8"), `songs/${id}.song`);
  if (parsed.kind === "round") {
    console.log(`skip round: ${id}`);
    continue;
  }
  const piece = parsed.kind === "skit" ? makeSkit(parsed.skit) : buildSong(parsed.song);
  const bytes = midiBytes(piece);
  writeFileSync(midPath, bytes);
  console.log(`wrote ${path.relative(process.cwd(), midPath)} (${bytes.byteLength} bytes, ${piece.beats} beats @ ${piece.bpm} BPM)`);
}
