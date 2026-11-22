import { createAuditionTransport } from "../src/audition/engine.ts";
import {
  buildAuditionScore,
  type AuditionEdits,
  type AuditionPartId,
  type AuditionScore,
} from "../src/audition/score.ts";
import "./style.css";

const transport = createAuditionTransport();
type Mode = Parameters<typeof transport.start>[0];

const portraits = document.querySelector<HTMLElement>("#portraits")!;
const bar = document.querySelector<HTMLElement>("#bar")!;
const lyric = document.querySelector<HTMLElement>("#lyric")!;
const status = document.querySelector<HTMLElement>("#status")!;
const modes = document.querySelectorAll<HTMLButtonElement>("button[data-mode]");
const replay = document.querySelector<HTMLButtonElement>("#replay")!;
const stop = document.querySelector<HTMLButtonElement>("#stop")!;
const form = document.querySelector<HTMLFormElement>("#edits")!;
const part = document.querySelector<HTMLSelectElement>("#part")!;
const pitch = document.querySelector<HTMLInputElement>("#pitch")!;
const entrance = document.querySelector<HTMLInputElement>("#entrance")!;
const conflicts = document.querySelector<HTMLDetailsElement>("#conflicts")!;
const conflictList = document.querySelector<HTMLUListElement>("#conflict-list")!;

const edits: AuditionEdits = {};
const originalScore = buildAuditionScore();
let selectedMode: Mode = "gruff";
let playRequest = 0;
let frame = 0;

function selectMode(mode: Mode) {
  selectedMode = mode;
  portraits.dataset.mode = mode;
  for (const button of modes) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
}

function showCue(score: AuditionScore, seconds: number) {
  const beat = Math.max(score.startBeat, Math.min(seconds * score.bpm / 60, score.beats - 0.0001));
  const barLabel = beat < 0
    ? "Before bar 1"
    : `Bar ${Math.floor(beat / score.beatsPerBar) + 1} of ${Math.ceil(score.beats / score.beatsPerBar)}`;
  const line = score.lyrics.find(({ beat: start, beats }) => beat >= start && beat < start + beats);
  if (bar.textContent !== barLabel) bar.textContent = barLabel;
  const words = line?.text ?? "—";
  if (lyric.textContent !== words) lyric.textContent = words;
}

function showConflicts(score: AuditionScore) {
  conflicts.hidden = score.conflicts.length === 0;
  conflictList.replaceChildren(...score.conflicts.map((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    return item;
  }));
}

function stopPlayback(message: string) {
  playRequest++;
  cancelAnimationFrame(frame);
  transport.stop();
  stop.disabled = true;
  status.textContent = message;
}

function readEdits() {
  edits[part.value as AuditionPartId] = {
    pitchSemitones: pitch.valueAsNumber || 0,
    entranceBeats: entrance.valueAsNumber || 0,
  };
}

async function play(mode: Mode) {
  if (!form.reportValidity()) return;
  readEdits();
  stopPlayback("Preparing audio…");
  selectMode(mode);
  const request = playRequest;
  stop.disabled = false;

  try {
    const score = buildAuditionScore(edits);
    showCue(score, score.startBeat * 60 / score.bpm);
    showConflicts(score);
    await transport.start(mode, score, () => {
      if (request !== playRequest) return;
      stopPlayback("Finished");
    });
    if (request !== playRequest) return;
    status.textContent = "Playing";
    const updateCue = () => {
      showCue(score, transport.position());
      frame = requestAnimationFrame(updateCue);
    };
    updateCue();
  } catch (error) {
    if (request !== playRequest) return;
    stopPlayback(error instanceof Error ? error.message : "Audio could not play. Try replaying.");
  }
}

for (const { id, label } of originalScore.parts) {
  part.add(new Option(label, id));
}

function showPartEdits() {
  const edit = edits[part.value as AuditionPartId];
  const notes = originalScore.parts.find((entry) => entry.id === part.value)?.notes ?? [];
  pitch.disabled = notes.length === 0;
  if (notes.length) {
    pitch.min = String(-Math.min(...notes.map((note) => note.midi)));
    pitch.max = String(127 - Math.max(...notes.map((note) => note.midi)));
  }
  entrance.min = String(-originalScore.writtenBeats);
  entrance.max = String(originalScore.writtenBeats);
  pitch.value = String(edit?.pitchSemitones ?? 0);
  entrance.value = String(edit?.entranceBeats ?? 0);
}

part.value = "gruff";
part.addEventListener("change", showPartEdits);
for (const input of [pitch, entrance]) {
  input.addEventListener("input", () => {
    if (form.checkValidity()) readEdits();
  });
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void play(selectedMode);
});
for (const button of modes) {
  button.addEventListener("click", () => void play(button.dataset.mode as Mode));
}
replay.addEventListener("click", () => void play(selectedMode));
stop.addEventListener("click", () => stopPlayback("Stopped"));
window.addEventListener("pagehide", () => stopPlayback("Stopped"));
selectMode(selectedMode);
showPartEdits();
showCue(originalScore, 0);
showConflicts(originalScore);
