/**
 * Vee's full performance in EffectCraft: the real engine rendering of the solo gives the audio and
 * mouth-shape track; the dance body and viseme head are replacement cels on that timeline.
 * Usage: bun tools/moppets/solo-scene.ts   (after tools/moppets/solo.py), then open the printed .ecproj
 */
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initEngine, wasmModule } from "../../tests/harness.ts";

await initEngine();
const { hopFor, midiToHz, SingerCore } = await import("../../src/choir/singerCore.ts");
const { makeSolo } = await import("../../src/choir/music.ts");
const { beatSeconds, LEAD_IN, pieceSeconds, planTrack } = await import("../../src/choir/plan.ts");
const { voices } = await import("../../src/choir/voices.ts");
const { poseFromRecord } = await import("../../src/choir/pose.ts");
const { wavBytes } = await import("../../src/choir/mix.ts");
const { EnglishG2P } = await import("../../src/wasm/engine.ts");
new EnglishG2P().setDictionaryText(gunzipSync(readFileSync(new URL("../../public/data/cmudict.txt.gz", import.meta.url))).toString());

const OUT = resolve("out/effectcraft");
const CELS = `${OUT}/solo-cels`;
mkdirSync(CELS, { recursive: true });
const FS = 48000, FPS = 30;
const v = voices.find((x) => x.id === "vee")!;
const piece = makeSolo(v);
const plan = planTrack(piece.tracks[0], piece, v);
const frames = Math.ceil(pieceSeconds(piece) * FS);
const core = new SingerCore(new WebAssembly.Instance(wasmModule, {}).exports as never, { sampleRate: FS, frames, hop: hopFor(FS), voice: v, gestures: plan.gestures, firstF0: midiToHz(plan.firstMidi) });
while (core.rendered < frames) core.step();
let peak = 0;
for (const s of core.stem) peak = Math.max(peak, Math.abs(s));
const wav = Float32Array.from(core.stem, (s) => (s * 0.85) / peak);
writeFileSync(`${OUT}/vee-solo.wav`, Buffer.from(wavBytes(wav, FS)));
const hop = hopFor(FS), seconds = frames / FS, beat = beatSeconds(piece);
const track = Array.from({ length: Math.floor(seconds * FPS) }, (_, i) => {
  const t = i / FPS, rec = Math.min(Math.floor((t * FS) / hop), Math.floor(core.rendered / hop) - 1);
  return poseFromRecord(core.tele!, rec * core.recordSize);
});
const solo = JSON.parse(readFileSync("src/choir/vee-solo.json", "utf8"));
// the solo sheet's assets, cropped into per-cel PNGs with ffmpeg-free Bun-side: done by solo-cels.py
const BPS = 1 / beat;
const FX = 0;
void FX;
const CW = 384, CH = 512, SCALE = 1.25, baseX = 500, baseY = 760;
const vis = JSON.stringify(track.map((p) => p.viseme));
const bodyIdx = (t: string) => `Math.floor(Math.max(0, ${t} - ${LEAD_IN}) * ${BPS * 2}) % 8`;
let jsx = `var c = app.project.items.addComp("Vee sings", 1000, 900, 1, ${seconds.toFixed(2)}, ${FPS}); c.bgColor = [0.17,0.13,0.1];\nvar VIS = ${vis};\n`;
for (let f = 0; f < 8; f++) {
  jsx += `var it = app.project.importFile(new ImportOptions(new File("${CELS}/body-${f}.png"))); var l = c.layers.add(it); l.name = "body ${f}"; l.property("Transform").property("Anchor Point").setValue([${CW / 2}, 490]); l.property("Transform").property("Position").setValue([${baseX}, ${baseY}]); l.property("Transform").property("Scale").setValue([${SCALE * 100}, ${SCALE * 100}]); l.property("Transform").property("Opacity").expression = "${bodyIdx("time")} === ${f} ? 100 : 0";\n`;
}
const headX = JSON.stringify(solo.neck.map(([x]: number[]) => (x - 0.5) * CW * SCALE)), headY = JSON.stringify(solo.neck.map(([, y]: number[]) => (y * CH - 490) * SCALE));
for (let h = 0; h < 8; h++) {
  jsx += `var ih = app.project.importFile(new ImportOptions(new File("${CELS}/head-${h}.png"))); var hl = c.layers.add(ih); hl.name = "mouth ${h}"; var tr = hl.property("Transform"); tr.property("Anchor Point").setValue([${CW / 2}, ${solo.headNeckY * CH}]); tr.property("Scale").setValue([${SCALE * solo.headScale * 100}, ${SCALE * solo.headScale * 100}]);\n`;
  jsx += `tr.property("Position").expression = "var X = ${headX}, Y = ${headY}; var f = ${bodyIdx("time")}; [${baseX} + X[f], ${baseY} + Y[f]]";\n`;
  jsx += `tr.property("Rotation").expression = "Math.sin((time - ${LEAD_IN}) * ${Math.PI * BPS * 0.5}) * 5";\n`;
  jsx += `tr.property("Opacity").expression = "var V = ${vis}; V[Math.min(V.length - 1, Math.floor(time * ${FPS}))] === ${h} ? 100 : 0";\n`;
}
jsx += `var w = app.project.importFile(new ImportOptions(new File("${OUT}/vee-solo.wav"))); c.layers.add(w);\nwriteLn(c.numLayers);\n`;
writeFileSync(`${OUT}/vee-solo.jsx`, jsx);
const counts = track.reduce<Record<number, number>>((a, p) => ((a[p.viseme] = (a[p.viseme] ?? 0) + 1), a), {});
console.log("viseme frames", JSON.stringify(counts));
