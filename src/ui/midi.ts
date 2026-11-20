/**
 * Web MIDI keyboards: note on/off (with velocity) from every connected input, including ones
 * plugged in later; knobs and pads go to control listeners (the Moppet workbench). The voice hears one note per pitch: a pitch held on several keyboards or
 * channels sounds until the last of them lets go. All-notes-off and unplugging release what
 * that input (channel) was holding.
 */
import { midiSupported, type MidiHandlers, type MidiStatus } from "@chimera/ui/midi.ts";
export { midiSupported, type MidiHandlers, type MidiStatus };

/** A knob or fader (control change), or a note offered to the controller before it plays. */
export interface MidiControl {
  kind: "cc" | "note";
  /** 0-based channel (a Launchkey's pads arrive on 9, MIDI channel 10) */
  channel: number;
  /** controller number, or note number */
  number: number;
  /** 0..127: the controller's value, or the note's velocity (0 for a release) */
  value: number;
}
/** Listeners see every control change, and every note first: returning true claims the note, so it doesn't play. */
const controlListeners = new Set<(c: MidiControl) => boolean | void>();
/** notes a listener claimed, by "owner \0 note", so their release is claimed too */
const claimed = new Set<string>();

export function onMidiControl(fn: (c: MidiControl) => boolean | void): () => void {
  controlListeners.add(fn);
  return () => void controlListeners.delete(fn);
}

function offer(c: MidiControl): boolean {
  let taken = false;
  for (const fn of controlListeners) if (fn(c)) taken = true;
  return taken;
}

let handlers: MidiHandlers | null = null;
let access: MIDIAccess | null = null;
let pending: Promise<void> | null = null;
/** bumped by disconnect: a connection still waiting for permission then gives up */
let generation = 0;
/** who holds each pitch, as "input id \0 channel" */
const owners = new Map<number, Set<string>>();
const SEP = "\u0000";

function press(owner: string, note: number, velocity: number): void {
  let set = owners.get(note);
  if (!set) owners.set(note, (set = new Set()));
  const first = set.size === 0;
  set.add(owner);
  if (first) handlers?.noteOn(note, velocity);
}

function lift(owner: string, note: number): void {
  const set = owners.get(note);
  if (!set || !set.delete(owner)) return;
  if (set.size > 0) return;
  owners.delete(note);
  handlers?.noteOff(note);
}

/** Release every note whose owner matches. */
function liftWhere(match: (owner: string) => boolean): void {
  for (const [note, set] of [...owners]) for (const o of [...set]) if (match(o)) lift(o, note);
}

function attach(a: MIDIAccess): void {
  const names: string[] = [];
  const live = new Set<string>();
  a.inputs.forEach((input) => {
    if (input.state === "disconnected") return;
    live.add(input.id);
    names.push(input.name || "MIDI keyboard");
    input.onmidimessage = (e: MIDIMessageEvent) => {
      const d = e.data;
      if (!d || d.length < 2) return;
      const kind = d[0] & 0xf0;
      const owner = input.id + SEP + (d[0] & 0x0f);
      const channel = d[0] & 0x0f;
      if (kind === 0x90 && d.length > 2 && d[2] > 0) {
        if (offer({ kind: "note", channel, number: d[1], value: d[2] })) claimed.add(owner + SEP + d[1]);
        else press(owner, d[1], d[2]);
      } else if (kind === 0x80 || kind === 0x90) {
        if (claimed.delete(owner + SEP + d[1])) offer({ kind: "note", channel, number: d[1], value: 0 });
        else lift(owner, d[1]);
      } else if (kind === 0xb0 && (d[1] === 123 || d[1] === 120)) liftWhere((o) => o === owner); // all notes / sound off
      else if (kind === 0xb0 && d.length > 2) offer({ kind: "cc", channel, number: d[1], value: d[2] });
    };
  });
  // unplugged inputs release what they held
  liftWhere((o) => !live.has(o.slice(0, o.indexOf(SEP))));
  handlers?.inputs(names);
}

/** Ask for MIDI access and listen (one request at a time; resolves when connected). */
export function connectMidi(h: MidiHandlers): Promise<void> {
  handlers = h;
  if (access) return Promise.resolve();
  if (pending) return pending;
  const gen = generation;
  const p = navigator.requestMIDIAccess({ sysex: false }).then(
    (a) => {
      if (gen !== generation) return; // disconnected while the browser was asking
      access = a;
      a.onstatechange = () => attach(a);
      attach(a);
    },
  );
  pending = p;
  const clear = () => {
    if (pending === p) pending = null;
  };
  p.then(clear, clear);
  return p;
}

export function disconnectMidi(): void {
  generation++;
  pending = null;
  if (access) {
    access.inputs.forEach((input) => (input.onmidimessage = null));
    access.onstatechange = null;
    access = null;
  }
  liftWhere(() => true);
  claimed.clear();
}
