import type {MeterChange} from "./meter";
/** Multitrack standard MIDI export of a choir score (ported from Studio 404's school.js). */
import type { Piece } from "./music.ts";
import { BAND_SETUP, bandFor, type BandId, type BandPart } from "./band.ts";

export const PPQ = 480;

function variable(n: number): number[] {
  const bytes = [n & 127];
  while ((n >>= 7)) bytes.unshift((n & 127) | 128);
  return bytes;
}

/** Format 1: a tempo track, then one track per singer (one channel each). */
export function midiBytes(piece: Piece): Uint8Array {
  const encoder = new TextEncoder();
  const chunk = (tag: string, b: number[]) => [...encoder.encode(tag), (b.length >>> 24) & 255, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255, ...b];
  const tempo = Math.round(60000000 / piece.bpm);
  const conductor=[0,255,81,3,(tempo>>16)&255,(tempo>>8)&255,tempo&255];
  let lastTick=0;
  for(const change of [{beat:0,signature:piece.meter??"4/4"},...(piece.meterChanges??[])]){
    const [count,unit]=change.signature.split("/").map(Number),tick=Math.round(change.beat*PPQ);
    conductor.push(...variable(tick-lastTick),255,88,4,count,Math.log2(unit),unit===8 && count>=6 && count%3===0 ? 36 : 24,8);
    lastTick=tick;
  }
  const tracks=[chunk("MTrk",[...conductor,0,255,47,0])];
  // the singers on channels 1.., then the band's parts on their General MIDI channels and programs
  const parts: { name: string; channel: number; program?: number; notes: { beat: number; beats: number; midi: number; vel: number }[] }[] = [
    ...piece.tracks.map((t, i) => ({ name: t.id, channel: t.channel ?? i, program: t.program, notes: t.events.map((e) => ({ ...e, vel: e.vel ?? 85 })) })),
    ...[...new Set(piece.beat?.notes?.map(n=>n.id))].map(id=>({name:"beatbox "+id,channel:9,notes:piece.beat!.notes!.filter(n=>n.id===id)})),
    ...bandFor(piece).map((b) => ({ name: `band ${b.id}`, channel: b.channel, program: b.id === "drums" ? undefined : b.program, notes: b.notes })),
  ];
  parts.forEach((track) => {
    const i = track.channel;
    const events: { tick: number; data: number[] }[] = [];
    for (const e of track.notes) {
      events.push({ tick: Math.round(e.beat * PPQ), data: [0x90 + i, e.midi, e.vel] }, { tick: Math.round((e.beat + e.beats) * PPQ), data: [0x80 + i, e.midi, 0] });
    }
    // note-offs (0x80) sort before note-ons (0x90) at the same tick, so repeated pitches re-strike
    events.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
    let tick = 0;
    const name = encoder.encode(track.name);
    const body = [0, 255, 3, name.length, ...name, ...(track.program !== undefined ? [0, 0xc0 + i, track.program] : [])];
    for (const e of events) {
      body.push(...variable(e.tick - tick), ...e.data);
      tick = e.tick;
    }
    body.push(0, 255, 47, 0);
    tracks.push(chunk("MTrk", body));
  });
  return new Uint8Array([...encoder.encode("MThd"), 0, 0, 0, 6, 0, 1, 0, tracks.length, 1, 224, ...tracks.flat()]);
}

/** One track of a standard MIDI file: its name and its notes, in beats. */
export interface MidiTrackIn {
  name: string;
  channel?: number;
  program?: number;
  notes: { beat: number; beats: number; midi: number; vel?: number }[];
}

/** Read a standard MIDI file (format 0 or 1): each track's notes, and the first tempo. */
export function parseMidi(bytes: Uint8Array): { bpm: number | null; tracks: MidiTrackIn[]; meters?:MeterChange[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "MThd") throw new Error("Not a MIDI file");
  const division = v.getUint16(12);
  if (!division) throw new Error("MIDI file has no ticks per beat");
  if (division & 0x8000) throw new Error("MIDI timed in SMPTE frames isn't supported; export it in beats");
  let at = 8 + v.getUint32(4), bpm: number | null = null;
  const tracks: MidiTrackIn[] = [];
  const signatures = new Map<number,string>();
  while (at + 8 <= bytes.length) {
    const len = v.getUint32(at + 4), end = at + 8 + len;
    if (end > bytes.length) throw new Error("Truncated MIDI track");
    if (tag(at) !== "MTrk") {
      at = end;
      continue;
    }
    let p = at + 8, tick = 0, status = 0, name = "";
    let channel: number | undefined, program: number | undefined;
    const open = new Map<number, number[]>(), notes: MidiTrackIn["notes"] = [];
    const varlen = () => {
      let n = 0, b: number;
      do (b = bytes[p++]), (n = (n << 7) | (b & 127));
      while (b & 128);
      return n;
    };
    while (p < end) {
      tick += varlen();
      let s = bytes[p];
      if (s & 128) p++;
      else s = status; // running status
      if (s === 0xff) {
        const type = bytes[p++], n = varlen();
        if(type===0x58 && n===4 && bytes[p]>0 && bytes[p+1]<=5)signatures.set(tick/division,bytes[p]+"/"+(2**bytes[p+1]));
        if (type === 3 && !name) name = new TextDecoder().decode(bytes.subarray(p, p + n));
        if (type === 0x51 && n === 3) {
          const micros = (bytes[p] << 16) | (bytes[p+1] << 8) | bytes[p+2];
          if (!micros) throw new Error("Invalid MIDI tempo");
          const next=60000000/micros;
          if (tick && next !== (bpm ?? 120)) throw new Error("This rehearsal supports one conductor tempo per song. Export a constant-tempo MIDI file.");
          bpm=next;
        }
        p += n;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) {
        const size=varlen(); p += size;
        continue;
      }
      status = s;
      const kind = s & 0xf0, a = bytes[p++], b = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[p++];
      if (kind === 0xc0 && program === undefined) program = a;
      if (kind === 0x90 && b > 0 && channel === undefined) channel = s & 15;
      const key = ((s & 15) << 8) | a;
      if (kind === 0x90 && b > 0) open.set(key, [...(open.get(key) ?? []), tick * 128 + b]);
      else if (kind === 0x80 || kind === 0x90) {
        const starts = open.get(key);
        const on = starts?.shift();
        if (on !== undefined) {
          const start = Math.floor(on / 128);
          notes.push({ beat: start / division, beats: (tick - start) / division, midi: a, vel: on % 128 });
        }
      }
    }
    notes.sort((x, y) => x.beat - y.beat || y.midi - x.midi);
    tracks.push({ name, channel, program, notes });
    at = end;
  }
  return { bpm, tracks, meters:[...signatures].sort((a,b)=>a[0]-b[0]).map(([beat,signature])=>({beat,signature})) };
}

/**
 * The piece, sung on a MIDI file's notes: each part takes the notes of the track named after it
 * (the names `midiBytes` writes and SoundCraft keeps), or, when no name matches, the tracks in order.
 * The words stay the piece's: a part's syllables go onto its new notes in time order, so a part
 * keeps its notes only when it has one per syllable. Moving, stretching and transposing notes all
 * keep the count; a part with notes added or deleted keeps its old notes and is reported.
 */
export function scoreFromMidi(piece: Piece, file: ReturnType<typeof parseMidi>): { piece: Piece; changed: string[]; kept: string[] } {
  const bandName = /^band (bass|guitar|keys|arp|drums|xylophone)$/;
  const drums = file.tracks.filter(t=>t.name.trim().startsWith("beatbox "));
  const hits = drums.flatMap(t=>t.notes.map(n=>({...n,id:t.name.trim().slice(8),vel:n.vel??96}))).sort((a,b)=>a.beat-b.beat);
  const withNotes = file.tracks.filter((t) => t.notes.length && !bandName.test(t.name.trim()) && !drums.includes(t));
  // band parts come back by name; a file without them leaves the band as it was
  const band: BandPart[] = file.tracks.flatMap((t) => {
    const id = bandName.exec(t.name.trim())?.[1] as BandId | undefined;
    return id && Object.hasOwn(BAND_SETUP,id) ? [{ id, program: t.program ?? BAND_SETUP[id].program, channel: t.channel ?? BAND_SETUP[id].channel, notes: t.notes.map((n) => ({ ...n, vel: n.vel ?? 80 })) }] : [];
  });
  const LEGACY_TRACK_ID: Readonly<Record<string, string>> = {
    vee: "neon",
    scribe: "cue",
    pip: "watt",
    tracking: "tracker",
  };
  const normName = (raw: string) => {
    const clean = raw.trim();
    return LEGACY_TRACK_ID[clean] ?? clean;
  };
  const named = piece.tracks.some((t) => withNotes.some((m) => normName(m.name) === t.id));
  const changed: string[] = [], kept: string[] = [];
  const tracks = piece.tracks.map((t, i) => {
    const m = named ? withNotes.find((x) => normName(x.name) === t.id) : withNotes[i];
    if (!m) return t;
    if (m.notes.length !== t.events.length) {
      kept.push(`${t.id} (${m.notes.length} notes for ${t.events.length} syllables)`);
      return t;
    }
    const same = m.notes.every((n, k) => n.midi === t.events[k].midi && Math.abs(n.beat - t.events[k].beat) < 1e-3 && Math.abs(n.beats - t.events[k].beats) < 1e-3 && (n.vel ?? 85) === (t.events[k].vel ?? 85));
    const routingChanged = (m.channel ?? i) !== (t.channel ?? i) || m.program !== t.program;
    if (same && !routingChanged) return t;
    changed.push(t.id);
    return { ...t, channel:m.channel, program:m.program, events: m.notes.map((n, k) => ({ ...t.events[k], beat: n.beat, beats: n.beats, midi: n.midi, vel: n.vel, src: undefined })) };
  });
  const end = Math.max(piece.beats, ...tracks.flatMap(t=>t.events.map(n=>n.beat+n.beats)), ...band.flatMap(t=>t.notes.map(n=>n.beat+n.beats)), ...hits.map(n=>n.beat+n.beats));
  if(drums.length && JSON.stringify(piece.beat?.notes)!==JSON.stringify(hits)) changed.push("beatbox");
  // compared at MIDI resolution and in time order, so an untouched round trip reads as unchanged
  const key = (parts: BandPart[]) => JSON.stringify(parts.map((b) => [b.id, b.channel, b.program, b.notes.map((n) => [Math.round(n.beat * PPQ), Math.round((n.beat + n.beats) * PPQ), n.midi, n.vel]).sort((x, y) => x[0] - y[0] || x[2] - y[2])]).sort());
  if (band.length && key(band) !== key(bandFor(piece))) changed.push("band");
  const bpm = file.bpm && Math.round(60000000/file.bpm)!==Math.round(60000000/piece.bpm) ? file.bpm : piece.bpm;
  if (bpm !== piece.bpm) changed.push("tempo");
  const meter=file.meters?.length ? file.meters.find(m=>m.beat===0)?.signature??"4/4" : piece.meter;
  const meterChanges=file.meters?.length ? file.meters.filter(m=>m.beat>0) : piece.meterChanges;
  if((meter??"4/4")!==(piece.meter??"4/4") || JSON.stringify(meterChanges??[])!==JSON.stringify(piece.meterChanges??[]))changed.push("meter");
  return { piece: { ...piece, ...(changed.includes("meter") ? { meter, meterChanges } : {}), tracks, ...(drums.length?{beat:{text:piece.beat?.text??"",swing:piece.beat?.swing??0,notes:hits}}:{}), beats: end, bpm, ...(band.length ? { band } : {}) }, changed, kept };
}
