/**
 * Editable projects from tools/moppet-video.ts's exports, ready to change and post:
 *
 *   out/video/<slug>/<slug>.fcproj   FilmCraft, two sequences of the performance:
 *                                      "Vertical 9:16" (1080×1920, Reels / Shorts / TikTok) and
 *                                      "Landscape 16:9" (1920×1080), each the stage in a band over a
 *                                      blurred, zoomed copy of itself, with the words as an editable
 *                                      caption track (from captions.srt) below it. Captions are a
 *                                      track, not pixels: tick "Burn captions" when exporting.
 *   out/video/<slug>/<slug>.ecproj   EffectCraft, the stage footage (picture and sound) in a comp, and
 *                                    its "Audio Amplitude" keyframes (Convert Audio to Keyframes)
 *
 * The sequences use FilmCraft's audio sync: the picture merged with the lossless mix.wav by waveform
 * (Merge Clips, method audio). The measured lag must be under 1 ms, or the export stops.
 *
 * FilmCraft's headless CLI forgets everything between runs, so each step opens the project, runs one
 * command and saves it back, and ids (the clip a step made) are read from each result.
 *
 * Usage: bun tools/moppet-edit.ts [slug ...]   (default: every folder in out/video)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("out/video");
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(root).filter((d) => existsSync(`${root}/${d}/stage.mp4`));

function fc(project: string, id: string, params: object, first = false): Record<string, unknown> {
  const r = spawnSync("filmcraft-cli", ["--compact", ...(first ? ["--save-as", project] : ["--project", project, "--save"]), "exec", id, JSON.stringify(params)], { encoding: "utf8" });
  const out = (r.stdout || "").trim().split("\n").pop() ?? "";
  if (r.status !== 0) throw new Error(`filmcraft ${id}: ${r.stderr || out}`);
  const j = JSON.parse(out);
  return (j?.result ?? j ?? {}) as Record<string, unknown>; // some commands print a bare null
}

function size(file: string): { w: number; h: number; seconds: number } {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(r.stdout);
  return { w: j.streams[0].width, h: j.streams[0].height, seconds: Number(j.format.duration) };
}

for (const slug of slugs) {
  const dir = `${root}/${slug}`, mp4 = `${dir}/stage.mp4`, srt = `${dir}/captions.srt`;
  const v = size(mp4);
  const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // ---------------------------------------------------------------- FilmCraft
  const project = `${dir}/${slug}.fcproj`;
  rmSync(project, { force: true });
  // the project is born and saved by one command; every later one reopens it
  const imported = spawnSync("filmcraft-cli", ["--compact", "--save-as", project, "run", "-"], { input: [JSON.stringify({ id: "file.newProject", params: { name: title } }), JSON.stringify({ id: "file.import", params: { paths: [mp4, `${dir}/mix.wav`] } })].join("\n"), encoding: "utf8" });
  if (imported.status !== 0) throw new Error(`filmcraft import: ${imported.stderr || imported.stdout}`);
  const [video, wav] = JSON.parse(imported.stdout.trim().split("\n").pop()!).result.items as number[];
  // FilmCraft's audio sync: merge the picture with the lossless mix, lined up by waveform (the MP4's
  // own AAC goes); its measured lag is a check that the capture really is frame-exact
  const merged = fc(project, "clip.mergeClips", { items: [video, wav], method: "audio", name: `${title} (stage + mix)`, removeVideoAudio: true });
  const sync = (merged.clips as { item: number; audio: { lagSamples: number; reliable: boolean } | null }[]).find((c) => c.item === wav)?.audio;
  if (!sync?.reliable || Math.abs(sync.lagSamples) > 48) throw new Error(`${slug}: the mix and the picture don't line up (${JSON.stringify(sync)})`);
  const item = merged.item as number;

  const layouts = [
    // vertical: the stage across the frame a little above centre, words below it
    // (captions: size in FilmCraft's caption units; margin a fraction of the frame height from the anchor)
    { name: "Vertical 9:16", w: 1080, h: 1920, y: 720, captions: { anchor: "top", margin: 0.49, size: 30 } },
    { name: "Landscape 16:9", w: 1920, h: 1080, y: 440, captions: { anchor: "bottom", margin: 0.05, size: 24 } },
  ];
  for (const L of layouts) {
    fc(project, "file.newSequence", { name: L.name, width: L.w, height: L.h, fps: 30 });
    // behind: the same footage zoomed to fill the frame, blurred and dimmed (picture only)
    const back = (fc(project, "timeline.place", { item, track: "V1", seconds: 0, insert: false, audio: false }).clips as number[])[0];
    fc(project, "effects.setParam", { clip: back, effect: "motion", param: "scale", value: +((Math.max(L.w / v.w, L.h / v.h) * 100) * 1.05).toFixed(1) });
    fc(project, "effects.apply", { clips: [back], effect: "gaussian_blur" });
    fc(project, "effects.setParam", { clip: back, effect: "gaussian_blur", param: "blurriness", value: 60 });
    fc(project, "effects.setParam", { clip: back, effect: "opacity", param: "opacity", value: 45 });
    // in front: the stage across the full width, with the sound
    const front = (fc(project, "timeline.place", { item, track: "V2", audioTrack: "A1", seconds: 0, insert: false }).clips as number[])[0];
    fc(project, "effects.setParam", { clip: front, effect: "motion", param: "scale", value: +((L.w / v.w) * 100).toFixed(2) });
    fc(project, "effects.setParam", { clip: front, effect: "motion", param: "position", value: [L.w / 2, L.y] });
    const track = fc(project, "captions.import", { path: srt, name: "Words" }).track as number;
    fc(project, "captions.setStyle", { track, font: "DM Sans", fontStyle: "Bold", size: L.captions.size, color: "#fff2c4", background: true, backgroundColor: "#1e1a16cc", align: "center", anchor: L.captions.anchor, margin: L.captions.margin, outline: 0 });
  }
  rmSync(`${dir}/.${slug}.fcproj.lock`, { force: true }); // the headless runs leave it behind
  console.log(`${slug}: FilmCraft → ${project}`);

  // ---------------------------------------------------------------- EffectCraft
  const ec = `${dir}/${slug}.ecproj`;
  rmSync(ec, { force: true });
  const steps = [
    { command: "file.import", params: { paths: [mp4], newComp: true } },
    // EffectCraft's audio sync: the soundtrack as amplitude keyframes on a layer of their own, to
    // pick-whip a glow, a scale pulse or a flicker to the music
    { command: "keys.audioToKeyframes", params: {} },
    { command: "file.saveAs", params: { path: ec } },
  ];
  const r = spawnSync("effectcraft-cli", ["run", "--commands", "-", "--json"], { input: JSON.stringify(steps), encoding: "utf8" });
  if (r.status !== 0 || !existsSync(ec)) throw new Error(`effectcraft: ${r.stderr || r.stdout}`);
  console.log(`${slug}: EffectCraft → ${ec}`);
}
