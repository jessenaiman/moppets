/**
 * Pure Web-Audio Farm Band & Sing-Along Music Player (`farmMusicPlayer.ts`).
 *
 * Uses the single shared `AudioContext` & master node from `src/audio/audio.ts`
 * (`useAudio.getState().start()`, `audio.ctx`, `audio.connect`) — zero duplicate
 * `AudioContext`, zero audio samples, 100% pure acoustic-modeled synthesis:
 *   - Acoustic dreadnought guitar boom-chuck chords
 *   - Warm bowed/plucked country fiddle lead melody
 *   - Walking upright bass
 *   - Soft woodblock / brushed handclap percussion
 *   - Cheerful character chime cues on friend spotlight
 */
type SharedAudioModule = typeof import("../audio/audio.ts");

export type FarmTuneId = "old-macdonald" | "barn-dance" | "starry-lullaby";

export interface FarmLyricBar {
  readonly lyric: string;
  readonly soloFriendId: string | null;
}

export interface FarmTuneSpec {
  readonly id: FarmTuneId;
  readonly title: string;
  readonly subtitle: string;
  readonly baseBpm: number;
  /** Melody notes `[midi, startBeat, durBeats]`; `midi = 0` is a rest. */
  readonly melody: readonly (readonly [number, number, number])[];
  /** Chord progression `[rootMidi, chordQuality, startBeat, durBeats]`. */
  readonly chords: readonly (readonly [number, "maj" | "min" | "dom7", number, number])[];
  readonly loopBeats: number;
  readonly bars: readonly FarmLyricBar[];
}

export const FARM_TUNES: readonly FarmTuneSpec[] = [
  {
    id: "old-macdonald",
    title: "Old MacDonald’s Sing-Along",
    subtitle: "G Major · 108 BPM · Acoustic Guitar, Fiddle & Barnyard Callouts",
    baseBpm: 108,
    loopBeats: 32,
    melody: [
      // Bar 1-2: Old MacDonald had a farm, E-I-E-I-O!
      [67, 0, 1], [67, 1, 1], [67, 2, 1], [62, 3, 1],
      [64, 4, 1], [64, 5, 1], [62, 6, 2],
      [71, 8, 1], [71, 9, 1], [69, 10, 1], [69, 11, 1],
      [67, 12, 3], [0, 15, 1],
      // Bar 5-6: And on his farm he had some friends, E-I-E-I-O!
      [62, 15.5, 0.5], [67, 16, 1], [67, 17, 1], [67, 18, 1], [62, 19, 1],
      [64, 20, 1], [64, 21, 1], [62, 22, 2],
      // Bar 7-8: With a Moo-Moo / Quack-Quack / E-I-E-I-O!
      [71, 24, 1], [71, 25, 1], [69, 26, 1], [69, 27, 1],
      [67, 28, 3], [0, 31, 1],
    ],
    chords: [
      [43, "maj", 0, 4],
      [48, "maj", 4, 2], [43, "maj", 6, 2],
      [43, "maj", 8, 2], [50, "dom7", 10, 2],
      [43, "maj", 12, 4],
      [43, "maj", 16, 4],
      [48, "maj", 20, 2], [43, "maj", 22, 2],
      [43, "maj", 24, 2], [50, "dom7", 26, 2],
      [43, "maj", 28, 4],
    ],
    bars: [
      { lyric: "🎵 Old MacDonald had a farm —", soloFriendId: "old-macdonald" },
      { lyric: "🎶 E - I - E - I - O!", soloFriendId: "miss-hayley" },
      { lyric: "🐮 Maisy Cow says “Moo-moo here!”", soloFriendId: "maisy-cow" },
      { lyric: "🦆 Puddles Duck says “Quack-quack there!”", soloFriendId: "puddles-duck" },
      { lyric: "🐷 Sam Pig claps an “Oink-oink here!”", soloFriendId: "sam-pig" },
      { lyric: "🐴 Mr. Rusty taps “Neigh-neigh there!”", soloFriendId: "rusty-horse" },
      { lyric: "🎻 Everywhere a barnyard song —", soloFriendId: "miss-hayley" },
      { lyric: "🌟 E - I - E - I - O!", soloFriendId: null },
    ],
  },
  {
    id: "barn-dance",
    title: "Sunny Meadow Barn Dance",
    subtitle: "D Major · 124 BPM · Upbeat Porch Fiddle Hoedown",
    baseBpm: 124,
    loopBeats: 16,
    melody: [
      [62, 0, 0.5], [66, 0.5, 0.5], [69, 1, 0.5], [71, 1.5, 0.5],
      [74, 2, 1], [71, 3, 1],
      [69, 4, 0.5], [66, 4.5, 0.5], [64, 5, 1], [66, 6, 2],
      [62, 8, 0.5], [66, 8.5, 0.5], [69, 9, 0.5], [71, 9.5, 0.5],
      [74, 10, 1], [76, 11, 1],
      [74, 12, 1], [73, 13, 0.5], [71, 13.5, 0.5], [74, 14, 2],
    ],
    chords: [
      [38, "maj", 0, 4],
      [43, "maj", 4, 2], [38, "maj", 6, 2],
      [38, "maj", 8, 4],
      [45, "dom7", 12, 2], [38, "maj", 14, 2],
    ],
    bars: [
      { lyric: "💃 Clap your hands & tap your boots on the cedar porch!", soloFriendId: "old-macdonald" },
      { lyric: "🎻 Miss Hayley spins a lively fiddle reel!", soloFriendId: "miss-hayley" },
      { lyric: "🐴 Mr. Rusty & Maisy Cow step to the beat!", soloFriendId: "rusty-horse" },
      { lyric: "🎉 Everybody turn & cheer together!", soloFriendId: "puddles-duck" },
    ],
  },
  {
    id: "starry-lullaby",
    title: "Starry Barn Twinkle Lullaby",
    subtitle: "F Major · 72 BPM · Gentle Music-Box & Fingerpicked Guitar",
    baseBpm: 72,
    loopBeats: 16,
    melody: [
      [65, 0, 1], [65, 1, 1], [72, 2, 1], [72, 3, 1],
      [74, 4, 1], [74, 5, 1], [72, 6, 2],
      [70, 8, 1], [70, 9, 1], [69, 10, 1], [69, 11, 1],
      [67, 12, 1], [67, 13, 1], [65, 14, 2],
    ],
    chords: [
      [41, "maj", 0, 4],
      [46, "maj", 4, 2], [41, "maj", 6, 2],
      [46, "maj", 8, 2], [41, "maj", 10, 2],
      [48, "dom7", 12, 2], [41, "maj", 14, 2],
    ],
    bars: [
      { lyric: "🌙 Twinkle, twinkle, golden fireflies round the barn…", soloFriendId: "old-macdonald" },
      { lyric: "✨ Warm porch lantern glowing soft and bright…", soloFriendId: "miss-hayley" },
      { lyric: "🐑 Cozy yawns across the quiet meadow…", soloFriendId: "sam-pig" },
      { lyric: "💤 Sweet farm dreams till sunny morning light.", soloFriendId: null },
    ],
  },
];

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface FarmBeatState {
  readonly playing: boolean;
  readonly tuneId: FarmTuneId;
  readonly bpm: number;
  readonly beat: number;
  readonly beatPhase: number;
  readonly barIndex: number;
  readonly lyric: string;
  readonly soloFriendId: string | null;
}

class FarmMusicEngine {
  private audioMod: SharedAudioModule | null = null;
  private bus: GainNode | null = null;
  private playing = false;
  private tuneId: FarmTuneId = "old-macdonald";
  private tempoScale = 1.0;
  private volume = 0.65;
  private startAudioTime = 0;
  private scheduledThroughBeat = 0;
  private schedulerId: number | null = null;

  private async loadAudioMod(): Promise<SharedAudioModule> {
    if (!this.audioMod) {
      this.audioMod = await import("../audio/audio.ts");
    }
    return this.audioMod;
  }

  private ensureBus(): GainNode | null {
    const shared = this.audioMod?.audio;
    const ctx = shared?.ctx ?? null;
    if (!shared || !ctx) return null;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = this.volume;
      shared.connect(this.bus);
    }
    return this.bus;
  }

  async start(tuneId?: FarmTuneId): Promise<void> {
    if (tuneId) this.tuneId = tuneId;
    const { audio, useAudio } = await this.loadAudioMod();
    await useAudio.getState().start();
    const ctx = audio.ctx;
    const bus = this.ensureBus();
    if (!ctx || !bus) return;

    this.stop();
    this.playing = true;
    this.startAudioTime = ctx.currentTime + 0.05;
    this.scheduledThroughBeat = 0;
    bus.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.03);

    const lookahead = () => {
      const liveCtx = this.audioMod?.audio.ctx;
      if (!this.playing || !liveCtx) return;
      this.scheduleWindow(liveCtx);
    };
    lookahead();
    this.schedulerId = window.setInterval(lookahead, 90);
  }

  stop(): void {
    this.playing = false;
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    const ctx = this.audioMod?.audio.ctx;
    if (this.bus && ctx) {
      this.bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.04);
    }
  }

  setTune(tuneId: FarmTuneId): void {
    if (this.tuneId === tuneId) return;
    this.tuneId = tuneId;
    if (this.playing) {
      void this.start(tuneId);
    }
  }

  setTempoScale(scale: number): void {
    const clamped = Math.max(0.65, Math.min(1.35, scale));
    if (Math.abs(clamped - this.tempoScale) < 0.001) return;
    this.tempoScale = clamped;
    if (this.playing) {
      void this.start(this.tuneId);
    }
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    const ctx = this.audioMod?.audio.ctx;
    if (this.bus && ctx && this.playing) {
      this.bus.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.03);
    }
  }

  /** Play a cheerful musical triad arpeggio when spotlighting a Farm School friend! */
  async playFriendChime(index: number): Promise<void> {
    let mod: SharedAudioModule;
    try {
      mod = await this.loadAudioMod();
      await mod.useAudio.getState().start();
    } catch {
      return;
    }
    const ctx = mod.audio.ctx;
    const bus = this.ensureBus();
    if (!ctx || !bus) return;
    if (!this.playing) {
      bus.gain.setValueAtTime(Math.max(0.35, this.volume), ctx.currentTime);
    }
    const base = 60 + ((index * 2) % 9);
    const notes = [base, base + 4, base + 7, base + 12];
    notes.forEach((m, i) => {
      this.scheduleBellPluck(ctx, bus, midiToHz(m), ctx.currentTime + i * 0.075, 0.28, 0.14);
    });
  }

  getBeatState(): FarmBeatState {
    const spec = FARM_TUNES.find((t) => t.id === this.tuneId) ?? FARM_TUNES[0]!;
    const bpm = Math.round(spec.baseBpm * this.tempoScale);
    const ctx = this.audioMod?.audio.ctx;
    if (!this.playing || !ctx) {
      return {
        playing: false,
        tuneId: this.tuneId,
        bpm,
        beat: 0,
        beatPhase: 0,
        barIndex: 0,
        lyric: spec.bars[0]?.lyric ?? "",
        soloFriendId: null,
      };
    }
    const elapsedSec = Math.max(0, ctx.currentTime - this.startAudioTime);
    const totalBeats = (elapsedSec * bpm) / 60;
    const loopBeat = ((totalBeats % spec.loopBeats) + spec.loopBeats) % spec.loopBeats;
    const barIndex = Math.floor(loopBeat / 4) % spec.bars.length;
    const bar = spec.bars[barIndex] ?? spec.bars[0]!;
    return {
      playing: true,
      tuneId: this.tuneId,
      bpm,
      beat: totalBeats,
      beatPhase: totalBeats % 1,
      barIndex,
      lyric: bar.lyric,
      soloFriendId: bar.soloFriendId,
    };
  }

  private scheduleWindow(ctx: AudioContext): void {
    const bus = this.ensureBus();
    if (!bus) return;
    const spec = FARM_TUNES.find((t) => t.id === this.tuneId) ?? FARM_TUNES[0]!;
    const bpm = spec.baseBpm * this.tempoScale;
    const secPerBeat = 60 / bpm;
    const nowBeat = (ctx.currentTime - this.startAudioTime) / secPerBeat;
    const targetBeat = nowBeat + 1.5;

    while (this.scheduledThroughBeat < targetBeat) {
      const cycle = Math.floor(this.scheduledThroughBeat / spec.loopBeats);
      const localStart = this.scheduledThroughBeat - cycle * spec.loopBeats;
      const localEnd = Math.min(spec.loopBeats, localStart + 0.5);
      const cycleBaseSec = this.startAudioTime + cycle * spec.loopBeats * secPerBeat;

      // Schedule melody notes starting inside [localStart, localEnd)
      for (const [midi, bStart, bDur] of spec.melody) {
        if (midi > 0 && bStart >= localStart && bStart < localEnd) {
          const t0 = cycleBaseSec + bStart * secPerBeat;
          const dur = Math.max(0.1, bDur * secPerBeat * 0.92);
          if (this.tuneId === "starry-lullaby") {
            this.scheduleBellPluck(ctx, bus, midiToHz(midi), t0, dur * 1.25, 0.22);
          } else {
            this.scheduleFiddleLead(ctx, bus, midiToHz(midi), t0, dur, 0.19);
          }
        }
      }

      // Schedule boom-chuck bass + acoustic guitar strums on integer half/quarter beats
      for (const [rootMidi, qual, cStart, cDur] of spec.chords) {
        for (let b = Math.ceil(localStart); b < localEnd; b++) {
          if (b >= cStart && b < cStart + cDur) {
            const tBeat = cycleBaseSec + b * secPerBeat;
            const isEven = b % 2 === 0;
            const bassMidi = isEven ? rootMidi : rootMidi + 7;
            this.scheduleBassPluck(ctx, bus, midiToHz(bassMidi), tBeat, secPerBeat * 0.85, 0.24);

            // Off-beat acoustic guitar strum (or soft arpeggio in lullaby)
            const third = qual === "min" ? 3 : 4;
            const triad = [rootMidi + 12, rootMidi + 12 + third, rootMidi + 19];
            const tStrum = this.tuneId === "starry-lullaby" ? tBeat + secPerBeat * 0.5 : tBeat + secPerBeat * 0.5;
            triad.forEach((m, idx) => {
              this.scheduleGuitarString(
                ctx,
                bus,
                midiToHz(m),
                tStrum + idx * 0.014,
                secPerBeat * 0.45,
                this.tuneId === "starry-lullaby" ? 0.07 : 0.095,
              );
            });

            if (!isEven && this.tuneId !== "starry-lullaby") {
              this.scheduleWoodblockClap(ctx, bus, tBeat, 0.085);
            }
          }
        }
      }

      this.scheduledThroughBeat = cycle * spec.loopBeats + localEnd;
      if (localEnd >= spec.loopBeats) {
        this.scheduledThroughBeat = (cycle + 1) * spec.loopBeats;
      }
    }
  }

  private scheduleFiddleLead(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    t0: number,
    dur: number,
    gainPeak: number,
  ): void {
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, t0);
    sub.type = "triangle";
    sub.frequency.setValueAtTime(freq, t0);

    vib.frequency.setValueAtTime(5.4, t0);
    vibGain.gain.setValueAtTime(freq * 0.006, t0);
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2100, t0);
    filter.Q.setValueAtTime(1.2, t0);

    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(gainPeak, t0 + Math.min(0.045, dur * 0.3));
    amp.gain.setTargetAtTime(gainPeak * 0.72, t0 + 0.05, 0.08);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(amp);
    amp.connect(dest);

    osc.start(t0);
    sub.start(t0);
    vib.start(t0);
    osc.stop(t0 + dur + 0.03);
    sub.stop(t0 + dur + 0.03);
    vib.stop(t0 + dur + 0.03);
  }

  private scheduleBellPluck(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    t0: number,
    dur: number,
    gainPeak: number,
  ): void {
    const osc = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t0);
    overtone.type = "triangle";
    overtone.frequency.setValueAtTime(freq * 2, t0);

    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(gainPeak, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const ovGain = ctx.createGain();
    ovGain.gain.setValueAtTime(0.25, t0);
    overtone.connect(ovGain);
    ovGain.connect(amp);
    osc.connect(amp);
    amp.connect(dest);

    osc.start(t0);
    overtone.start(t0);
    osc.stop(t0 + dur + 0.03);
    overtone.stop(t0 + dur + 0.03);
  }

  private scheduleGuitarString(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    t0: number,
    dur: number,
    gainPeak: number,
  ): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t0);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, t0);
    filter.frequency.exponentialRampToValueAtTime(900, t0 + dur);

    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(gainPeak, t0 + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private scheduleBassPluck(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    t0: number,
    dur: number,
    gainPeak: number,
  ): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t0);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(420, t0);

    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(gainPeak, t0 + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private scheduleWoodblockClap(ctx: AudioContext, dest: AudioNode, t0: number, gainPeak: number): void {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(790, t0);
    osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.045);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(gainPeak, t0 + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.065);
  }
}

export const farmMusic = new FarmMusicEngine();
