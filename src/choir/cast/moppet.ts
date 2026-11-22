/**
 * A Moppet: everything about one character, in one place. Add a Moppet by writing its file in
 * this folder (copy one), giving it art in public/moppets/<id>/ (closed.webp and open.webp: 4×2
 * cels of 384×512), anchors for its object (tools/gen-prop-anchors.py), and adding it to
 * index.ts. Engine-free: plain data, safe in workers.
 *
 * The voice is a recipe for CHIMERA (an experimental preset: settings that sound amusing
 * together, not an impression of anyone). It says nothing about pitch; every note comes from the
 * score. It is the part people edit (the workbench knobs) and that is saved and sent to workers.
 */
import type { BodyMix } from "@chimera/wasm/types.ts";

/** Applied at the character layer: everything here leaves consonant closures to the planner. */
export interface MoppetArtic {
  larynx: number;
  velum: number;
  root: number;
  epilarynx: number;
  ventricular: number;
}
/** Fry is left out of sung recipes: the engine's fry pulls the folds toward 45 Hz (creaky speech), so
 * every 0.1 of it sings about 1.6 semitones flat (measured on Pip, Vee and Tabby). Croak comes from
 * roughness and the false folds, which leave the pitch alone. */
export interface MoppetSource {
  tension: number;
  breathiness: number;
  roughness: number;
  brightness: number;
  /** breath pressure (cmH2O) */
  pressure: number;
  /** how quickly pitch slides between notes (s) */
  glide: number;
  /** slow wander of pitch (cents) */
  drift: number;
  fry?: number;
  vibratoRate?: number;
}
export interface MoppetVoice {
  id: string;
  name: string;
  role: string;
  color: string;
  body: BodyMix;
  /** the whole airway's size against its body (0.5 tiny … 1 human … 1.6 giant); pitch stays the score's */
  size?: number;
  artic: MoppetArtic;
  source: MoppetSource;
  /** vibrato depth on held notes (cents) */
  vibrato: number;
  /** the part's written range, MIDI */
  register: [number, number];
  /** octave of this singer's part in the round and the introduction */
  octave: number;
  /** level in the mix */
  level: number;
  lyrics: string[];
}

/** The effect on a Moppet's found object that shows its voice (src/ui/props.tsx). */
export type PropEffect = "reels" | "typewriter" | "lamps" | "sac" | "dial" | "scope" | "led";

export interface Moppet {
  voice: MoppetVoice;
  /**
   * How its sprite is drawn: "cels", a dance sheet with the mouth closed and open; "solo", a
   * dance body with a separate head of mouth shapes (public/moppets/<id>/body.webp, head.webp;
   * where the head sits on each frame's neck is src/choir/vee-solo.json, so only Vee can be one today).
   */
  art: "cels" | "solo";
  /** what its object does as it sings */
  prop: PropEffect;
  /** what it sings when it backs a song: "oo", or "bom" for a bass */
  pad: string;
  /** its note in everyone's last chord, in scale steps above home; none: it doesn't join in */
  seat?: number;
}
