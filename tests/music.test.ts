/** Ported from Studio 404's music.test.mjs: the score rules that make the choir musical. */
import { expect, test } from "bun:test";
import { bandFor } from "../src/choir/band.ts";
import { compose, invent, makeIntroduction, makeChipSong, makeRound, KEYS, RANGES, ROUND_GROUPS, ROUND_LINES, SCALES, type KeyName, type Piece, type ScaleMode } from "../src/choir/music.ts";
import { midiBytes, PPQ } from "../src/choir/midi.ts";
import { findMode, GROOVES, MODES, PROGRESSIONS, PALETTES } from "../src/choir/theory.ts";

const keys = Object.keys(KEYS) as KeyName[];
const modes = Object.keys(SCALES) as ScaleMode[];

test("generated scores: scale membership, strong-beat chord tones, register limits, cadence", () => {
  const sampleSeeds = [0, 7, 42, 404];
  let pieces = 0;
  for (const key of keys)
    for (const mode of modes)
      for (const seed of sampleSeeds) {
        const p = compose({ seed, key, mode });
        expect(p.tracks.length).toBe(6);
        expect(p.beats).toBe(32);
        for (const track of p.tracks) {
          let end = 0;
          for (const e of track.events) {
            expect(e.beat).toBe(end);
            end = e.beat + e.beats;
            if (e.midi < RANGES[track.id][0] || e.midi > RANGES[track.id][1]) throw Error(`range ${track.id} ${e.midi}`);
            if (!SCALES[mode].includes((e.midi - KEYS[key] + 120) % 12)) throw Error(`out of scale ${e.midi}`);
            const chord = p.chords[Math.floor(e.beat / 4)];
            if ((track.id !== "scribe" || e.strong) && !chord.tones.includes(e.midi % 12)) throw Error(`chord ${track.id} beat ${e.beat}`);
            if (!(e.beats > 0)) throw Error("zero length");
          }
          expect(end).toBe(32);
        }
        const lead = p.tracks.find((t) => t.id === "scribe")!;
        expect(lead.events[lead.events.length - 1].midi % 12).toBe(KEYS[key]);
        expect(p.chords[p.chords.length - 2].degree).toBe(4);
        expect(p.chords[p.chords.length - 1].degree).toBe(0);
        pieces++;
      }
  expect(pieces).toBe(keys.length * modes.length * sampleSeeds.length);
});

test("the round is three parts, each a pair singing together, entering eight beats apart with consonant overlaps", () => {
  for (const key of keys)
    for (const repeats of [1, 2, 3]) {
      const p = makeRound({ key, repeats });
      expect(p.tracks.length).toBe(6);
      const original = p.tracks[0].events.slice(0, -1);
      const parts = new Set(p.tracks.map((t) => t.entrance));
      expect([...parts].sort((a, b) => a! - b!)).toEqual([0, 8, 16]);
      ROUND_GROUPS.forEach((group, g) => {
        expect(group.length).toBe(2);
        for (const id of group) {
          const t = p.tracks.find((x) => x.id === id)!;
          expect(t.entrance).toBe(8 * g);
          expect(t.events.length).toBe(32 * repeats + 1);
          const copy = t.events.slice(0, -1);
          const delta = copy[0].midi - original[0].midi;
          expect(Math.abs(delta % 12)).toBe(0); // the same tune, in this Moppet's octave
          copy.forEach((e, j) => {
            expect(e.beat - original[j].beat).toBe(8 * g);
            expect(e.midi - original[j].midi).toBe(delta);
            expect(e.text).toBe(original[j].text);
          });
        }
      });
      for (let b = 0; b < 2 * 8 + 32 * repeats; b += 0.5) {
        const chord = p.chords.find((c) => b >= c.beat && b < c.beat + c.beats)!;
        for (const t of p.tracks) for (const e of t.events) if (b >= e.beat && b < e.beat + e.beats && !chord.tones.includes(e.midi % 12)) throw Error(`canon collision ${key} ${b}`);
      }
      // everyone meets on the shared final "Jam!", on the tonic chord
      const finals = p.tracks.map((t) => t.events[t.events.length - 1]);
      expect(new Set(finals.map((e) => e.beat)).size).toBe(1);
      for (const e of finals) {
        expect(e.text).toBe("Jam");
        expect(p.chords[p.chords.length - 1].tones.includes(e.midi % 12)).toBe(true);
      }
    }
  expect(ROUND_LINES.every((l) => l.split(" ").length === 8)).toBe(true);
});

test("the introduction is a score on one beat grid, in D, with whole-octave registers", () => {
  const p = makeIntroduction();
  for (const t of p.tracks) {
    const lowest = Math.min(...t.events.map((e) => e.midi));
    for (const e of t.events) expect(SCALES.major.includes((e.midi - KEYS.D + 120) % 12)).toBe(true);
    expect(lowest % 12).toBe(2); // every part's lowest note is a D: octave displacement, never a transposition
    expect(t.events.length).toBe(32);
  }
  // verses take turns: at most one singer before the chorus
  const chorus = p.tracks.length * 20;
  for (let b = 0; b < chorus; b += 0.5) expect(p.tracks.filter((t) => t.events.some((e) => e.beat <= b && b < e.beat + e.beats)).length).toBeLessThanOrEqual(1);
  expect(p.pluck!.length).toBe(p.beats);
});

function readMidi(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const dec = new TextDecoder();
  expect(dec.decode(bytes.slice(0, 4))).toBe("MThd");
  expect(view.getUint16(8)).toBe(1);
  expect(view.getUint16(12)).toBe(PPQ);
  const n = view.getUint16(10);
  let pos = 14;
  const tracks: { midi: number; beat: number; beats: number }[][] = [];
  for (let ti = 0; ti < n; ti++) {
    expect(dec.decode(bytes.slice(pos, pos + 4))).toBe("MTrk");
    const end = pos + 8 + view.getUint32(pos + 4);
    pos += 8;
    let tick = 0;
    const found: { midi: number; beat: number; beats: number }[] = [];
    const held = new Map<number, number>();
    const vl = () => {
      let v = 0, b;
      do {
        b = bytes[pos++];
        v = (v << 7) | (b & 127);
      } while (b & 128);
      return v;
    };
    while (pos < end) {
      tick += vl();
      const status = bytes[pos++];
      if (status === 255) {
        pos++;
        const len = vl();
        pos += len;
        continue;
      }
      if ((status & 240) === 192) {
        pos++; // a program change: the band's General MIDI instrument
        continue;
      }
      const note = bytes[pos++], velocity = bytes[pos++];
      if ((status & 240) === 144 && velocity) held.set(note, tick);
      else if ((status & 240) === 128) {
        if (!held.has(note)) throw Error("note-off without note-on");
        found.push({ midi: note, beat: held.get(note)! / PPQ, beats: (tick - held.get(note)!) / PPQ });
        held.delete(note);
      } else throw Error("unexpected MIDI message");
    }
    expect(held.size).toBe(0);
    tracks.push(found);
    pos = end;
  }
  expect(pos).toBe(bytes.length);
  return tracks;
}

test("exported MIDI reproduces every score pitch, start time and duration", () => {
  const pieces: Piece[] = [compose(), compose({ seed: 12, mode: "minor", key: "E" }), makeRound(), makeRound({ repeats: 2 }), makeIntroduction()];
  for (const piece of pieces) {
    const tracks = readMidi(midiBytes(piece));
    const band = bandFor(piece);
    expect(band.length).toBeGreaterThan(0);
    expect(tracks.length).toBe(1 + piece.tracks.length + band.length);
    piece.tracks.forEach((t, i) => expect(tracks[i + 1]).toEqual(t.events.map(({ midi, beat, beats }) => ({ midi, beat, beats }))));
    // the band's parts follow, in time order (notes sharing a tick sort by their off/on order)
    band.forEach((b, i) => {
      const ticks = (n: { midi: number; beat: number; beats: number }[]) => n.map((x) => [Math.round(x.beat * PPQ), Math.round((x.beat + x.beats) * PPQ), x.midi]).sort((x, y) => x[0] - y[0] || x[2] - y[2]);
      expect(ticks(tracks[1 + piece.tracks.length + i])).toEqual(ticks(b.notes));
    });
  }
});

test("inventions from named ideas: in mode, chord tones on strong beats, in register, resolved", () => {
  const sampleKeys: KeyName[] = ["C", "E♭", "F♯", "A", "B♭"];
  const cases: { key: KeyName; mode: ScaleMode; progression: string; groove: string; soul: boolean }[] = [];
  let idx = 0;
  for (const { id: mode } of MODES)
    for (const progression of PROGRESSIONS)
      for (const soul of [false, true]) {
        cases.push({
          key: sampleKeys[idx % sampleKeys.length],
          mode,
          progression: progression.id,
          groove: GROOVES[idx % GROOVES.length].id,
          soul,
        });
        idx++;
      }
  for (const key of sampleKeys)
    for (const groove of GROOVES)
      cases.push({ key, mode: "dorian", progression: PROGRESSIONS[0].id, groove: groove.id, soul: true });

  for (const cSpec of cases) {
    const p = invent({ seed: 19, ...cSpec, palette: "beatband" });
    for (const t of p.tracks) {
      let prev = -1;
      for (const e of t.events) {
        if (e.beat < prev - 1e-9) throw Error("overlap");
        prev = e.beat + e.beats;
        if (e.midi < RANGES[t.id][0] || e.midi > RANGES[t.id][1]) throw Error(`range ${t.id}`);
        if (!SCALES[cSpec.mode].includes((e.midi - KEYS[cSpec.key] + 120) % 12)) throw Error(`scale ${cSpec.mode} ${e.midi}`);
        const c = p.chords.find((x) => e.beat >= x.beat && e.beat < x.beat + x.beats)!;
        const strongLead = t.id === "scribe" || t.id === "pip" || t.id === "tabby" ? e.strong : true;
        if (strongLead !== false && strongLead !== undefined && !c.tones.includes(e.midi % 12)) throw Error(`chord ${t.id} ${e.beat}`);
      }
    }
    // every invention ends on the mode's approach chord, then home
    const last = p.chords[p.chords.length - 1], prev = p.chords[p.chords.length - 2];
    expect(last.degree).toBe(0);
    expect(prev.degree).toBe(findMode(cSpec.mode).approach);
  }
  expect(invent({ seed: 88, mode: "dorian" })).toEqual(invent({ seed: 88, mode: "dorian" }));
  expect(invent({ seed: 88 })).not.toEqual(invent({ seed: 89 }));
  expect(PALETTES.length).toBeGreaterThan(1);
  for (const pal of PALETTES) expect(() => midiBytes(invent({ palette: pal.id }))).not.toThrow();
});

test("Chip's song stays on its key and its syllable counts", () => {
  const p = makeChipSong();
  expect(p.kind).toBe("motesong");
  const chip = p.tracks[0];
  expect(chip.id).toBe("chip");
  for (const e of chip.events) expect(SCALES.major.includes((e.midi - KEYS.C + 120) % 12)).toBe(true);
  for (const [line, phrase] of chip.phrases!.entries()) {
    const n = chip.events.filter((e) => e.line === line).length / (line < 8 ? 2 : 1);
    if (phrase === "Hum") continue;
    expect(n).toBe(8);
  }
});

test("Chip's song: syllables land on chord tones, every line breathes, the end comes home", () => {
  const p = makeChipSong();
  const chip = p.tracks[0];
  expect(chip.events[0].beat).toBe(4); // a bar of groove first
  for (const e of chip.events) {
    if (e.beat % 2 === 0) {
      const c = p.chords.find((x) => e.beat >= x.beat && e.beat < x.beat + x.beats)!;
      if (!c.tones.includes(e.midi % 12)) throw Error(`beat ${e.beat} midi ${e.midi} off ${c.name}`);
    }
  }
  chip.events.forEach((e, i) => {
    const next = chip.events[i + 1];
    if (next && next.line !== e.line) expect(next.beat - (e.beat + e.beats)).toBeGreaterThanOrEqual(0.2); // a breath before the next line
  });
  expect(p.chords[p.chords.length - 1].degree).toBe(0);
  expect(chip.events[chip.events.length - 1].midi % 12).toBe(0);
});
