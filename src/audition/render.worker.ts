import { chimeraModule, initChimera, type ChimeraExports } from "@chimera/wasm/chimera.ts";
import wasmUrl from "@chimera/wasm/chimera.wasm?url";
import { CONTROL_KEYS, writeGestures, writeSteps } from "@chimera/wasm/wire.ts";
import type { Gesture } from "@chimera/wasm/types.ts";
import type { MoppetVoice } from "../choir/cast/moppet.ts";
import type { AuditionNote, AuditionScore } from "./score.ts";

type Engine = ChimeraExports & Record<string, (...args: number[]) => number>;
type Planner = typeof import("@chimera/wasm/engine.ts");
type Voice = { part: AuditionScore["parts"][number]; voice: MoppetVoice };

export type RenderRequest = { score: AuditionScore; voices: Voice[] };
export type RenderResult = { pcm: Float32Array<ArrayBuffer>; sampleRate: number; scoreZero: number } | { error: string };

const SAMPLE_RATE = 32000;
const LEAD_IN = 0.35;
const TAIL = 0.4;
const MIX_HEADROOM = 0.5;
const SOURCE_KEYS = ["f0", "glide", "pressure", "breathiness", "tension", "fry", "roughness", "vibratoDepth", "vibratoRate", "drift", "voiced", "brightness"];
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResult, transfer?: Transferable[]): void;
};

let planner: Promise<Planner> | undefined;
async function loadPlanner(): Promise<Planner> {
  await initChimera(wasmUrl);
  const api = await import("@chimera/wasm/engine.ts");
  await new api.EnglishG2P().load(`${import.meta.env.BASE_URL}data/cmudict.txt.gz`);
  return api;
}

function planPart(api: Planner, score: AuditionScore, { part, voice }: Voice, scoreZero: number) {
  const secondsPerBeat = 60 / score.bpm;
  const gestures: Gesture[] = [];
  let end = 0;
  let phrase: AuditionNote[] = [];

  function flush() {
    if (!phrase.length) return;
    const first = phrase[0];
    const syllables = first.line === undefined
      ? phrase.flatMap((note) => api.lyricsToSyllables(note.text))
      : api.lyricsToSyllables(score.lyrics[first.line].text);
    if (syllables.length !== phrase.length) {
      throw new Error(`${part.label} has ${phrase.length} notes for ${syllables.length} syllables near beat ${first.beat + 1}.`);
    }
    const notes = phrase.map(({ midi, beats }, index) => ({ midi, beats, syl: syllables[index] }));
    const plan = api.planSong(notes, {
      body: voice.body, bpm: score.bpm, t0: scoreZero + first.beat * secondsPerBeat, vibrato: voice.vibrato,
    });
    gestures.push(...plan.gestures);
    end = Math.max(end, plan.end);
    phrase = [];
  }

  for (const note of part.notes) {
    const last = phrase.at(-1);
    if (last && (note.line !== last.line || Math.abs(note.beat - last.beat - last.beats) > 1e-6)) flush();
    phrase.push(note);
  }
  flush();
  return { gestures, end };
}

function renderPart(api: Planner, x: Engine, score: AuditionScore, entry: Voice, scoreZero: number, pcm: Float32Array) {
  const { part, voice } = entry;
  const beat = part.beatbox;
  const beatSeconds = 60 / score.bpm;
  const plan = beat ? null : planPart(api, score, entry, scoreZero);
  const start = beat ? Math.round((scoreZero + part.entranceBeats * beatSeconds) * SAMPLE_RATE) : 0;
  const beatEnd = start + Math.round(score.writtenBeats * beatSeconds * SAMPLE_RATE);
  const tailFrames = Math.ceil(TAIL * SAMPLE_RATE);
  const end = Math.min(pcm.length, (plan ? Math.ceil(plan.end * SAMPLE_RATE) : beatEnd) + tailFrames);
  const level = voice.level * MIX_HEADROOM;

  const handle = x.engine_new(SAMPLE_RATE);
  try {
    const setValues = (keys: readonly string[], values: object) => {
      const params = new Float64Array(x.memory.buffer, x.engine_values(handle), 32).fill(NaN);
      for (const [key, value] of Object.entries(values)) {
        const index = keys.indexOf(key);
        if (index >= 0) params[index] = value;
      }
    };
    x.engine_set_body(handle, voice.body.female, voice.body.child);
    setValues(CONTROL_KEYS, beat ? api.beatReady(voice.body) : voice.artic);
    x.engine_set_artic(handle, 2);
    setValues(SOURCE_KEYS, voice.source);
    x.engine_set_source(handle);
    if (beat) {
      const steps = api.parseBeat(beat.text).map((step) => {
        if (!step || !part.pitchSemitones) return step;
        const note = step.note ?? (api.BEAT_SOUNDS.some((sound) => sound.id === step.id && sound.role === "bass")
          ? api.BASS_NOTE
          : undefined);
        return note === undefined ? step : { ...step, note: note + part.pitchSemitones };
      });
      const count = writeSteps(x.memory.buffer, x.engine_records(handle), steps);
      x.engine_set_beat(handle, 1, count, score.bpm, beat.swing, 1);
    } else if (plan?.gestures.length) {
      const count = writeGestures(x.memory.buffer, x.engine_records(handle), plan.gestures, 4000);
      if (count !== plan.gestures.length) throw new Error(`${part.label}'s CHIMERA plan exceeds the gesture buffer.`);
      x.engine_schedule(handle, count, 0, 1);
    }

    for (let frame = start; frame < end;) {
      if (beat && frame === beatEnd) x.engine_set_beat(handle, 0, 0, NaN, NaN, 0);
      const next = Math.min(end, frame + 128, beat && frame < beatEnd ? beatEnd : end);
      const n = next - frame;
      const ptr = x.engine_render(handle, n);
      const samples = new Float32Array(x.memory.buffer, ptr, n);
      for (let i = 0; i < n; i++) pcm[frame + i] += samples[i] * level;
      frame = next;
    }
  } finally {
    x.engine_free(handle);
  }
}

scope.onmessage = async ({ data: { score, voices } }) => {
  try {
    const api = await (planner ??= loadPlanner().catch((err) => {
      planner = undefined;
      throw err;
    }));
    const scoreZero = LEAD_IN - score.startBeat * 60 / score.bpm;
    const pcm = new Float32Array(Math.ceil((scoreZero + score.beats * 60 / score.bpm + TAIL) * SAMPLE_RATE));
    const engine = new WebAssembly.Instance(chimeraModule(), {}).exports as unknown as Engine;
    for (const entry of voices) renderPart(api, engine, score, entry, scoreZero, pcm);
    scope.postMessage({ pcm, sampleRate: SAMPLE_RATE, scoreZero }, [pcm.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
