import type { Chord, Piece } from "./music.ts";
import { BAND_SETUP, BRUSH, KICK, SIDE_STICK, type BandNote, type BandPart } from "./band.ts";

/** Place pitch class `pc` closest to `centre`. */
const near = (pc: number, centre: number): number => {
  const base = centre - ((((centre - pc) % 12) + 12) % 12);
  return centre - base > 6 ? base + 12 : base;
};

/** 4-note color voicing around `centre`: add9 on major triads, min7 on minor triads. */
function warmVoicing(chord: Pick<Chord, "tones">, centre = 60): number[] {
  const [root, third, fifth] = chord.tones;
  const isMinor = ((third - root + 12) % 12) === 3;
  const color = (root + (isMinor ? 10 : 2)) % 12;
  return [third, fifth, color, root]
    .map((pc) => near(pc, centre))
    .sort((a, b) => a - b);
}

/** Gently roll a Rhodes chord upward in PPQ-exact `step` beat increments. */
function pushRolledKeys(
  keys: BandNote[],
  notes: readonly number[],
  beat: number,
  beats: number,
  baseVel: number,
  step = 0.05,
): void {
  notes.forEach((midi, idx) => {
    const offset = idx * step;
    if (offset >= beats - 0.05) return;
    keys.push({
      beat: beat + offset,
      beats: Math.max(0.25, beats - offset),
      midi,
      vel: Math.min(127, baseVel + idx * 2),
    });
  });
}

/** Count which occurrence of a section name (`verse`, `chorus`) covers `beat`. */
function sectionContext(piece: Piece, beat: number): { name: string; startBeat: number; occurrence: number } {
  const sections = piece.sections ?? [];
  let active = { name: "", beat: 0 };
  const counts = new Map<string, number>();
  let occurrence = 1;
  for (const s of sections) {
    const count = (counts.get(s.name) ?? 0) + 1;
    counts.set(s.name, count);
    if (s.beat <= beat + 1e-6) {
      active = s;
      occurrence = count;
    }
  }
  return { name: active.name.toLowerCase(), startBeat: active.beat, occurrence };
}

/**
 * Bespoke accompaniment for the Studio 404 finale `"Found Things"`:
 * - Bars 1–3: solo finger-bass motif quoting the verse melody over cushioned Rhodes, zero percussion.
 * - Solo verses: warm rolled Rhodes, sustained bass roots, whisper-quiet felt taps & breath chimes.
 * - Choruses: understated heartbeat sway (soft kick + brush + felt rim), arpeggiated Rhodes & upper sparkles.
 * - Bridge: intimate drop-back with long bass roots, spacious rolled Rhodes & gentle chime echoes.
 * - Final Chorus & Finale ("Belong"): radiant dynamic bloom settling into a Dmaj9 shimmer.
 */
export function foundThingsBand(piece: Piece): BandPart[] {
  const chords = piece.chords;
  if (!chords.length) return [];

  const bass: BandNote[] = [];
  const keys: BandNote[] = [];
  const drums: BandNote[] = [];
  const xylophone: BandNote[] = [];

  const hasIntroMotif = chords[0].beat === 0 && chords[1]?.beat === 12;

  for (let idx = 0; idx < chords.length; idx++) {
    const c = chords[idx];
    const next = chords[idx + 1];
    const ctx = sectionContext(piece, c.beat);
    const root = near(c.tones[0], 40);
    const fifth = near(c.tones[2], root + 7);
    const voicing = warmVoicing(c, 60);
    const topSparkle = near(c.tones[2], 82);
    const highThird = near(c.tones[1], 78);

    // 1. Intro Bar 1 (beats 0..4) + Opening Solo Finger-Bass Motif (beats 4..12)
    if (hasIntroMotif && c.beat === 0) {
      bass.push({ beat: 0, beats: 3.75, midi: near(c.tones[0], 38), vel: 80 });
      pushRolledKeys(keys, voicing, 0, 3.85, 42, 0.05);

      // Warm Rhodes cushion under the 8-beat solo bass motif (Dadd9 -> Bm7), zero percussion.
      const tonic = near(c.tones[0], 38);
      const bar2Voicing = warmVoicing(c, 60);
      const bmRoot = (c.tones[0] + 9) % 12;
      const bar3Voicing = warmVoicing({ tones: [bmRoot, (bmRoot + 3) % 12, (bmRoot + 7) % 12] }, 60);
      pushRolledKeys(keys, bar2Voicing, 4, 3.85, 36, 0.05);
      pushRolledKeys(keys, bar3Voicing, 8, 3.85, 38, 0.05);

      const motif: readonly [number, number, number][] = [
        [0, 0.5, 86],
        [4, 0.5, 88],
        [7, 1, 90],
        [7, 1, 92],
        [9, 1, 96],
        [7, 1, 90],
        [4, 1, 86],
        [7, 1.9, 92],
      ];
      let beat = 4;
      for (const [interval, dur, vel] of motif) {
        bass.push({ beat, beats: Math.max(0.4, dur * 0.9), midi: tonic + interval, vel });
        beat += dur;
      }
      continue;
    }

    // 2. Finale ("Belong"): pure warm Dmaj9 bloom + tender ascending chime, zero drums.
    if (ctx.name === "finale") {
      bass.push({ beat: c.beat, beats: Math.max(2, c.beats - 0.1), midi: near(c.tones[0], 38), vel: 86 });
      const finaleKeys = [
        voicing[0],
        voicing[1],
        voicing[2],
        voicing[3],
        near((c.tones[0] + 11) % 12, 73),
        near((c.tones[0] + 2) % 12, 76),
      ];
      pushRolledKeys(keys, finaleKeys, c.beat, Math.max(2.5, c.beats - 0.1), 48, 0.075);

      const chimeNotes = [
        near(c.tones[2], 81),
        near(c.tones[0], 86),
        near(c.tones[1], 90),
        near(c.tones[2], 93),
      ];
      chimeNotes.forEach((midi, j) => {
        const at = c.beat + 1.0 + j * 0.5;
        if (at < c.beat + c.beats - 0.1) {
          xylophone.push({ beat: at, beats: 0.45, midi, vel: 42 - j * 2 });
        }
      });
      continue;
    }

    // 3. Bridge: drop back to intimate stillness (sustained roots, wide Rhodes, whisper chimes).
    if (ctx.name === "bridge") {
      const inBridge = c.beat - ctx.startBeat;
      const swell = inBridge >= 24 ? 6 : 0;
      bass.push({ beat: c.beat, beats: Math.max(1.5, c.beats - 0.15), midi: root, vel: 70 + swell });
      if (inBridge >= 28 && c.beats >= 4) {
        bass.push({ beat: c.beat + 2.5, beats: 1.35, midi: fifth, vel: 66 });
      }
      pushRolledKeys(keys, voicing, c.beat, c.beats - 0.15, 42 + swell, 0.075);

      // Tender 2-note chime echo in the breath at the end of lines 1, 2, 3 (inBridge 4, 12, 20).
      if (inBridge === 4 || inBridge === 12 || inBridge === 20) {
        xylophone.push({ beat: c.beat + 2.5, beats: 0.4, midi: highThird, vel: 36 });
        xylophone.push({ beat: c.beat + 3.25, beats: 0.45, midi: near(c.tones[0], 86), vel: 34 });
      }
      // Subtle felt countdown pulse only on bars 7–8 (inBridge 24..32) leading back to the chorus.
      if (inBridge >= 24) {
        for (let b = 1; b < c.beats - 1e-6; b += 2) {
          drums.push({ beat: c.beat + b, beats: 0.125, midi: SIDE_STICK, vel: 22 + Math.floor((inBridge - 24 + b) * 1.5) });
        }
        if (inBridge === 28) {
          drums.push({ beat: c.beat + 3.5, beats: 0.25, midi: BRUSH, vel: 26 });
        }
      }
      continue;
    }

    // 4. Choruses 1–4: understated heartbeat sway, gentle Rhodes arpeggio, upper bell sparkles.
    if (ctx.name === "chorus") {
      const chorusNum = ctx.occurrence; // 1..4
      const inChorus = c.beat - ctx.startBeat;
      const lift = chorusNum === 1 ? 0 : chorusNum === 2 ? 3 : chorusNum === 3 ? 5 : 8;
      const isLastCadence = inChorus >= 28;
      const isFinalChorus = chorusNum >= 4;

      // Singing finger bass: warm half-bar pulse with gentle fifth/root anchor.
      if (c.beats >= 4) {
        bass.push({ beat: c.beat, beats: 1.85, midi: root, vel: 82 + lift });
        bass.push({ beat: c.beat + 2, beats: 1.75, midi: inChorus === 24 ? near(c.tones[2], root) : fifth, vel: 68 + lift });
      } else {
        bass.push({ beat: c.beat, beats: Math.max(0.8, c.beats - 0.15), midi: root, vel: 82 + lift });
      }

      // Gentle Rhodes arpeggio: soft rolled chord + delicate upper movement.
      pushRolledKeys(keys, voicing, c.beat, Math.min(c.beats - 0.1, 2.75), 45 + lift, 0.05);
      if (c.beats >= 4) {
        keys.push({ beat: c.beat + 1.5, beats: 1.0, midi: voicing[2] + 12, vel: 36 + lift });
        keys.push({ beat: c.beat + 2.5, beats: 1.1, midi: voicing[1] + 12, vel: 38 + lift });
        keys.push({ beat: c.beat + 3.5, beats: 0.45, midi: voicing[3], vel: 34 + lift });
      } else {
        keys.push({ beat: c.beat + 1, beats: 0.85, midi: voicing[2] + 12, vel: 40 + lift });
      }

      // Delicate upper xylophone sparkles on phrase crests and warm transitions.
      if (inChorus === 16 || inChorus === 20 || (isFinalChorus && (inChorus === 0 || inChorus === 8))) {
        xylophone.push({ beat: c.beat + 1.5, beats: 0.35, midi: topSparkle, vel: 36 + lift });
        xylophone.push({ beat: c.beat + 3.0, beats: 0.4, midi: near(c.tones[0], 86), vel: 34 + lift });
      } else if (inChorus === 28) {
        xylophone.push({ beat: c.beat + 2.5, beats: 0.35, midi: highThird, vel: 36 + lift });
        xylophone.push({ beat: c.beat + 3.5, beats: 0.35, midi: topSparkle, vel: 38 + lift });
      }

      // Warm, understated heartbeat sway (no harsh snare or 8th-hat stomp).
      for (let b = 0; b < c.beats - 1e-6; b++) {
        const absBeat = c.beat + b;
        const inBar = ((absBeat % 4) + 4) % 4;
        const dropLastTwoBeats = isLastCadence && absBeat >= ctx.startBeat + 30.5;
        if (dropLastTwoBeats) continue;

        if (inBar === 0) {
          drums.push({ beat: absBeat, beats: 0.25, midi: KICK, vel: 44 + lift });
        } else if (inBar === 1) {
          drums.push({ beat: absBeat, beats: 0.25, midi: BRUSH, vel: 24 + Math.floor(lift * 0.8) });
          drums.push({ beat: absBeat, beats: 0.125, midi: SIDE_STICK, vel: 24 + Math.floor(lift * 0.8) });
        } else if (inBar === 2) {
          drums.push({ beat: absBeat, beats: 0.25, midi: KICK, vel: 34 + lift });
          if (c.beats >= 4) {
            drums.push({ beat: absBeat + 0.5, beats: 0.2, midi: BRUSH, vel: 18 + Math.floor(lift * 0.5) });
          }
        } else if (inBar === 3) {
          drums.push({ beat: absBeat, beats: 0.25, midi: BRUSH, vel: 26 + Math.floor(lift * 0.8) });
          drums.push({ beat: absBeat, beats: 0.125, midi: SIDE_STICK, vel: 26 + Math.floor(lift * 0.8) });
          if (isFinalChorus && next && next.beat === c.beat + c.beats) {
            drums.push({ beat: absBeat + 0.5, beats: 0.2, midi: KICK, vel: 26 });
          }
        }
      }
      continue;
    }

    // 5. Verses 1, 2, 3: intimate rolled Rhodes, sustained bass roots, whisper felt taps & breath chimes.
    const verseNum = ctx.name === "verse 1" ? 1 : ctx.name === "verse 2" ? 2 : 3;
    const verseStart = verseNum === 1 ? 12 : ctx.startBeat;
    const inVerse = c.beat - verseStart;

    bass.push({ beat: c.beat, beats: Math.max(1.5, c.beats - 0.15), midi: root, vel: 74 + verseNum * 3 });
    if (c.beats >= 4 && (verseNum >= 2 || inVerse >= 24)) {
      bass.push({ beat: c.beat + 3, beats: 0.85, midi: fifth, vel: 56 + verseNum * 2 });
    }

    pushRolledKeys(keys, voicing, c.beat, c.beats - 0.15, 42 + verseNum * 2, 0.05);
    keys.push({ beat: c.beat + 2.5, beats: 1.25, midi: voicing[2] + 12, vel: 34 + verseNum * 2 });

    // Whisper-quiet felt/brush pulse enters gently from the second half of Verse 1 onward.
    if (verseNum > 1 || inVerse >= 16) {
      for (let b = 1; b < c.beats - 1e-6; b += 2) {
        drums.push({ beat: c.beat + b, beats: 0.125, midi: SIDE_STICK, vel: 20 + verseNum * 3 });
        if (verseNum === 3) {
          drums.push({ beat: c.beat + b, beats: 0.2, midi: BRUSH, vel: 20 });
        }
      }
      if (inVerse === 28 && verseNum === 3) {
        drums.push({ beat: c.beat + 3.5, beats: 0.2, midi: BRUSH, vel: 24 });
      }
    }

    // Delicate high xylophone breath echo at the end of alternate 2-bar solo lines.
    if (inVerse === 12 || inVerse === 28) {
      xylophone.push({ beat: c.beat + 2.5, beats: 0.35, midi: highThird, vel: 32 + verseNum * 2 });
      xylophone.push({ beat: c.beat + 3.25, beats: 0.4, midi: topSparkle, vel: 34 + verseNum * 2 });
    }
  }

  return [
    { id: "bass", channel: BAND_SETUP.bass.channel, program: BAND_SETUP.bass.program, notes: bass },
    { id: "keys", channel: BAND_SETUP.keys.channel, program: BAND_SETUP.keys.program, notes: keys },
    { id: "drums", channel: BAND_SETUP.drums.channel, program: BAND_SETUP.drums.program, notes: drums },
    { id: "xylophone", channel: BAND_SETUP.xylophone.channel, program: BAND_SETUP.xylophone.program, notes: xylophone },
  ];
}
