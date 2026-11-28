/**
 * Thin MPE / CC / Pad extension on top of CHIMERA's official `@chimera/ui/midi.ts`.
 * Zero duplicated note-ownership or hot-plug state: `@chimera/ui/midi.ts` owns polyphonic
 * key tracking and All-Notes-Off (`CC 120`/`123`), while this module taps channel metadata,
 * MPE pitch bend (`0xe0`), channel/poly pressure (`0xd0`/`0xa0`), and CCs (`CC 74` slide, `CC 21–28`).
 */
import {
  connectMidi as connectChimeraMidi,
  disconnectMidi as disconnectChimeraMidi,
  midiSupported,
  type MidiHandlers,
  type MidiStatus,
} from "@chimera/ui/midi.ts";

export { midiSupported, type MidiHandlers, type MidiStatus };

export interface MidiControl {
  kind: "cc" | "note" | "bend" | "pressure" | "keyPressure";
  /** 0-based MIDI channel (0 = Ch 1 master, 1..15 = MPE note channels, 9 = Ch 10 pads) */
  channel: number;
  /** CC number, MIDI note (for note / keyPressure), or 0 (channel bend / channel pressure) */
  number: number;
  /** 0..127 (or -1..1 for pitch bend) */
  value: number;
}

export interface ExtendedMidiHandlers extends MidiHandlers {
  noteOnWithChannel?: (note: number, velocity: number, channel: number) => void;
}

const controlListeners = new Set<(c: MidiControl) => boolean | void>();
let lastNoteChannel = 0;
let tapAccess: MIDIAccess | null = null;
const wrappedInputs = new WeakSet<MIDIInput>();

export function onMidiControl(fn: (c: MidiControl) => boolean | void): () => void {
  controlListeners.add(fn);
  return () => void controlListeners.delete(fn);
}

function offer(c: MidiControl): boolean {
  let claimed = false;
  for (const fn of controlListeners) {
    if (fn(c)) claimed = true;
  }
  return claimed;
}

function installChannelTap(access: MIDIAccess): void {
  access.inputs.forEach((input) => {
    if (input.state === "disconnected" || wrappedInputs.has(input)) return;
    const baseHandler = input.onmidimessage;
    if (!baseHandler) return;
    wrappedInputs.add(input);
    input.onmidimessage = (e: MIDIMessageEvent) => {
      const d = e.data;
      if (!d || d.length < 2) return;
      const kind = d[0] & 0xf0;
      const channel = d[0] & 0x0f;
      if (kind === 0x90 && d.length > 2 && d[2] > 0) {
        if (offer({ kind: "note", channel, number: d[1], value: d[2] })) return;
        lastNoteChannel = channel;
      } else if (kind === 0x80 || kind === 0x90) {
        if (offer({ kind: "note", channel, number: d[1], value: 0 })) return;
      } else if (kind === 0xe0 && d.length > 2) {
        offer({ kind: "bend", channel, number: 0, value: ((d[2] << 7) + d[1] - 8192) / 8192 });
        return;
      } else if (kind === 0xd0) {
        offer({ kind: "pressure", channel, number: 0, value: d[1] });
        return;
      } else if (kind === 0xa0 && d.length > 2) {
        offer({ kind: "keyPressure", channel, number: d[1], value: d[2] });
        return;
      } else if (kind === 0xb0 && d.length > 2 && d[1] !== 120 && d[1] !== 123) {
        offer({ kind: "cc", channel, number: d[1], value: d[2] });
        return;
      }
      baseHandler.call(input, e);
    };
  });
}

export async function connectMidi(h: ExtendedMidiHandlers): Promise<void> {
  await connectChimeraMidi({
    noteOn: (note, velocity) => {
      if (h.noteOnWithChannel) h.noteOnWithChannel(note, velocity, lastNoteChannel);
      else h.noteOn(note, velocity);
    },
    noteOff: h.noteOff,
    inputs: h.inputs,
  });
  if (!tapAccess && typeof navigator.requestMIDIAccess === "function") {
    tapAccess = await navigator.requestMIDIAccess({ sysex: false });
    const prevState = tapAccess.onstatechange;
    tapAccess.onstatechange = (ev) => {
      prevState?.call(tapAccess!, ev);
      if (tapAccess) installChannelTap(tapAccess);
    };
  }
  if (tapAccess) installChannelTap(tapAccess);
}

export function disconnectMidi(): void {
  tapAccess = null;
  disconnectChimeraMidi();
}
