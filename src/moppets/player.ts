/**
 * Direct CHIMERA MIDI-only vocal playback, seeking, live keyboard singing, and 60 Hz frame telemetry.
 * Zero extra gain/compressor wrappers: audio flows straight through CHIMERA's AudioEngine -> master -> speakers/recorder.
 */
import { engine } from "../audio/AudioEngine.ts";
import { planMelisma, planNoteOff, planNoteOn, planSong, type Gesture, type HumanArtic } from "../wasm/engine.ts";
import { useStore } from "../ui/store.ts";
import { VoiceModel } from "../ui/analysis.ts";
import { g2p } from "../ui/speech.ts";
import type { TelemetryMessage } from "../worklet/protocol.ts";
import { tabbyCharacterGesture, TABBY_VOICE } from "./tabby.ts";
import type { CameraPreset, MopAction, ParsedMopSong } from "./midiSong.ts";

export interface MopFrameState {
  playing: boolean;
  songSec: number;
  durationSec: number;
  beat: number;
  beatStep: number;
  phraseIndex: number;
  phraseText: string;
  wordText: string;
  cueAction: MopAction;
  camPreset: CameraPreset;
  moveTarget: string | null;
  jumpProgress: number;
  tele: TelemetryMessage | null;
  artic: HumanArtic | null;
  rms: number;
  f0: number;
}

interface ScheduledNoteMeta {
  t0: number;
  t1: number;
  phraseIndex: number;
  word: string;
  midi: number;
}

interface ActiveRun {
  planId: number;
  offset: number | null;
  seekOffsetSec: number;
  endPlanSec: number;
  notes: ScheduledNoteMeta[];
  song: ParsedMopSong;
}

let activeRun: ActiveRun | null = null;
let runToken = 0;
let lastSongSec = 0;
let currentSong: ParsedMopSong | null = null;
let onEndCallback: (() => void) | null = null;

// Live playable keyboard state
let liveKeys: number[] = [];
let liveSounding: { midi: number; syl: ParsedMopSong["phrases"][0]["notes"][0]["syl"]; tag: number } | null = null;
let liveSyllableCursor = 0;
let liveNextTag = 40;
let liveCharScheduled = false;

const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

export function subscribePlayer(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

engine.onPlanned((m) => {
  if (!activeRun || m.id !== activeRun.planId) return;
  activeRun.offset = m.t0;
  notify();
});

export function setCurrentSong(song: ParsedMopSong): void {
  currentSong = song;
  notify();
}

export async function ensureTabbyReady(): Promise<void> {
  await useStore.getState().start();
  engine.setMic(false);
  useStore.getState().setBody(TABBY_VOICE.body);
  useStore.getState().setSource({
    tension: TABBY_VOICE.source.tension,
    breathiness: TABBY_VOICE.source.breathiness,
    roughness: TABBY_VOICE.source.roughness,
    brightness: TABBY_VOICE.source.brightness,
    pressure: TABBY_VOICE.source.pressure,
    glide: TABBY_VOICE.source.glide,
    drift: TABBY_VOICE.source.drift,
    fry: 0,
    vibratoRate: TABBY_VOICE.source.vibratoRate,
  });
  await g2p.load().catch(() => {});
}

export function resetTabbyVoice(): void {
  useStore.getState().setBody(TABBY_VOICE.body);
  useStore.getState().setSource({
    tension: TABBY_VOICE.source.tension,
    breathiness: TABBY_VOICE.source.breathiness,
    roughness: TABBY_VOICE.source.roughness,
    brightness: TABBY_VOICE.source.brightness,
    pressure: TABBY_VOICE.source.pressure,
    glide: TABBY_VOICE.source.glide,
    drift: TABBY_VOICE.source.drift,
    fry: 0,
    vibratoRate: TABBY_VOICE.source.vibratoRate,
  });
}

export function stopSong(): void {
  runToken++;
  if (activeRun) {
    activeRun = null;
    engine.stopSpeech();
    notify();
  }
}

export async function playSong(
  song: ParsedMopSong,
  opts: { startSec?: number; onEnd?: () => void } = {},
): Promise<boolean> {
  stopSong();
  stopLiveKeys();
  currentSong = song;
  onEndCallback = opts.onEnd ?? null;
  const token = runToken;
  await ensureTabbyReady();
  if (token !== runToken) return false;

  const beatSec = 60 / song.bpm;
  const startSec = Math.max(0, Math.min(opts.startSec ?? 0, song.durationSec - 0.5));
  const startBeat = startSec / beatSec;

  const flatNotes: { beat: number; beats: number; midi: number; syl: ParsedMopSong["phrases"][0]["notes"][0]["syl"]; phraseIndex: number }[] = [];
  for (const ph of song.phrases) {
    for (const n of ph.notes) {
      if (n.beat + n.beats <= startBeat + 0.02) continue;
      flatNotes.push({ ...n, phraseIndex: ph.index });
    }
  }
  if (!flatNotes.length) return false;

  // Group contiguous notes (gaps > 0.15 beats start a fresh breath phrase)
  const gestures: Gesture[] = [];
  const segments: ReturnType<typeof planSong>["segments"] = [];
  const metas: ScheduledNoteMeta[] = [];
  let maxEnd = 0.5;
  const lead = 0.28;

  let group: typeof flatNotes = [];
  const flush = () => {
    if (!group.length) return;
    const t0 = lead + Math.max(0, group[0].beat - startBeat) * beatSec;
    const plan = planSong(
      group.map((g) => ({ midi: g.midi, beats: g.beats, syl: g.syl })),
      { body: TABBY_VOICE.body, bpm: song.bpm, t0, vibrato: TABBY_VOICE.vibrato },
    );
    gestures.push(...plan.gestures);
    segments.push(...plan.segments);
    maxEnd = Math.max(maxEnd, plan.end + 0.3);

    let cursor = t0;
    for (const g of group) {
      const dur = g.beats * beatSec;
      metas.push({
        t0: cursor,
        t1: cursor + dur,
        phraseIndex: g.phraseIndex,
        word: g.syl.text,
        midi: g.midi,
      });
      cursor += dur;
    }
    group = [];
  };

  for (const n of flatNotes) {
    const prev = group[group.length - 1];
    if (prev && (n.beat - (prev.beat + prev.beats) > 0.18 || n.phraseIndex !== prev.phraseIndex)) {
      flush();
    }
    group.push(n);
  }
  flush();

  const charG = tabbyCharacterGesture(0, maxEnd);
  const planId = engine.schedule({ gestures: [charG, ...gestures], segments, end: maxEnd }, true);
  lastSongSec = startSec;
  activeRun = {
    planId,
    offset: null,
    seekOffsetSec: startSec - lead,
    endPlanSec: maxEnd,
    notes: metas,
    song,
  };
  notify();
  return true;
}

export function isPlayingSong(): boolean {
  return activeRun !== null;
}

export function getLastSongSec(): number {
  return lastSongSec;
}

function allSongSyllables(): ParsedMopSong["phrases"][0]["notes"][0]["syl"][] {
  if (!currentSong) return [];
  return currentSong.phrases.flatMap((p) => p.notes.map((n) => n.syl));
}

export async function playLiveNoteOn(midi: number, velocity = 96): Promise<void> {
  stopSong();
  await ensureTabbyReady();
  liveKeys = liveKeys.filter((k) => k !== midi).concat(midi);
  const syls = allSongSyllables();
  const syl = syls.length
    ? syls[liveSyllableCursor % syls.length]
    : { text: "la", onset: [], nucleus: { ipa: "ɑ", stress: 1 }, coda: [], wordEnd: true, phraseEnd: false };

  const clock = engine.voiceClock() ?? 0;
  if (!liveCharScheduled) {
    engine.scheduleGestures([tabbyCharacterGesture(clock, clock + 3600)]);
    liveCharScheduled = true;
  }

  if (syl.melisma && liveSounding) {
    engine.release(liveSounding.tag + 1);
    engine.scheduleGestures(planMelisma(midi, { vibrato: TABBY_VOICE.vibrato, tag: liveSounding.tag }));
    liveSounding.midi = midi;
  } else {
    if (liveSounding) {
      engine.release(liveSounding.tag);
      engine.release(liveSounding.tag + 1);
    }
    const tag = liveNextTag;
    liveNextTag += 2;
    const gs = planNoteOn(syl, midi, {
      body: TABBY_VOICE.body,
      vibrato: TABBY_VOICE.vibrato,
      tag,
      legatoFrom: liveSounding ? { syl: liveSounding.syl, midi: liveSounding.midi } : undefined,
    });
    const breathScale = 0.68 + 0.35 * Math.min(1, Math.max(0, velocity / 96));
    engine.scheduleGestures(
      gs.map((g) => (g.targets.breath !== undefined ? { ...g, targets: { ...g.targets, breath: g.targets.breath * breathScale } } : g)),
    );
    liveSounding = { midi, syl, tag };
  }
  liveSyllableCursor++;
  notify();
}

export function playLiveNoteOff(midi: number): void {
  liveKeys = liveKeys.filter((k) => k !== midi);
  if (!liveSounding || liveSounding.midi !== midi) return;
  if (liveKeys.length) {
    const nextMidi = liveKeys[liveKeys.length - 1];
    engine.release(liveSounding.tag + 1);
    engine.scheduleGestures(planMelisma(nextMidi, { vibrato: TABBY_VOICE.vibrato, tag: liveSounding.tag }));
    liveSounding.midi = nextMidi;
    return;
  }
  engine.release(liveSounding.tag);
  engine.release(liveSounding.tag + 1);
  const gs = planNoteOff(liveSounding.syl, midi, TABBY_VOICE.body);
  if (gs.length) engine.scheduleGestures(gs);
  liveSounding = null;
  notify();
}

export function stopLiveKeys(): void {
  if (liveSounding) {
    engine.release(liveSounding.tag);
    engine.release(liveSounding.tag + 1);
    liveSounding = null;
  }
  liveKeys = [];
  liveCharScheduled = false;
}

export function getFrameState(song: ParsedMopSong | null): MopFrameState {
  const teleRaw = engine.latest;
  const artic = teleRaw ? VoiceModel.articFromArray(teleRaw.t.artic) : null;
  const rms = teleRaw?.t.outRms ?? 0;
  const f0 = teleRaw?.t.f0 ?? 0;

  if (!activeRun || !song) {
    const liveSinging = liveSounding !== null && rms > 0.008;
    const liveBelt = liveSinging && f0 > 320;
    return {
      playing: false,
      songSec: lastSongSec,
      durationSec: song?.durationSec ?? 34,
      beat: song ? (lastSongSec * song.bpm) / 60 : 0,
      beatStep: -1,
      phraseIndex: -1,
      phraseText: "",
      wordText: liveSounding?.syl.text ?? "",
      cueAction: liveBelt ? "belt" : liveSinging ? "sing" : "idle",
      camPreset: "wide",
      moveTarget: null,
      jumpProgress: 0,
      tele: teleRaw,
      artic,
      rms,
      f0,
    };
  }

  let planSec = 0;
  if (activeRun.offset !== null) {
    const vc = engine.voiceClock() ?? activeRun.offset;
    planSec = Math.max(0, vc - activeRun.offset);
    if (planSec > activeRun.endPlanSec + 0.35) {
      const cb = onEndCallback;
      activeRun = null;
      lastSongSec = 0;
      notify();
      cb?.();
      return getFrameState(song);
    }
  }

  const songSec = Math.max(0, Math.min(song.durationSec, activeRun.seekOffsetSec + planSec));
  lastSongSec = songSec;
  const beat = (songSec * song.bpm) / 60;
  const beatStep = Math.floor(Math.max(0, beat * 4)) % 16;

  // Match active note and phrase
  let activeNote: ScheduledNoteMeta | null = null;
  for (const n of activeRun.notes) {
    if (planSec >= n.t0 - 0.04 && planSec <= n.t1 + 0.05) {
      activeNote = n;
      break;
    }
  }

  const phrase =
    (activeNote ? song.phrases[activeNote.phraseIndex] : undefined) ??
    song.phrases.find((p) => beat >= p.startBeat && beat < p.startBeat + p.beats) ??
    null;

  let cueAction: MopAction = "idle";
  let jumpProgress = 0;
  if (phrase) {
    const localBeat = beat - phrase.startBeat;
    if (phrase.doGesture === "bow" || phrase.celebrate) {
      cueAction = "bow";
    } else if (phrase.moveTarget && phrase.moveTarget !== "center") {
      cueAction = "walk";
    } else if (phrase.doGesture === "laugh" || phrase.doGesture === "cheer" || phrase.take === "toast") {
      cueAction = "chuckle";
    } else if (phrase.section.includes("Sustained") || (f0 > 330 && rms > 0.015)) {
      cueAction = "belt";
    } else if (activeNote || rms > 0.012) {
      cueAction = "sing";
    }
    if (phrase.jump && localBeat >= 0 && localBeat <= 1.6) {
      jumpProgress = localBeat / 1.6;
    }
  } else if (rms > 0.012) {
    cueAction = "sing";
  }

  const teleWithBeat: TelemetryMessage | null = teleRaw ? { ...teleRaw, beatStep } : null;

  return {
    playing: true,
    songSec,
    durationSec: song.durationSec,
    beat,
    beatStep,
    phraseIndex: phrase?.index ?? -1,
    phraseText: phrase?.words.replace(/_/g, "") ?? "",
    wordText: activeNote?.word ?? "",
    cueAction,
    camPreset: phrase?.cam ?? "wide",
    moveTarget: phrase?.moveTarget ?? null,
    jumpProgress,
    tele: teleWithBeat,
    artic,
    rms,
    f0,
  };
}
