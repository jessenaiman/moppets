/**
 * The roster Moppets (art in Magic Studio's assets, voices ported from Studio 404's voices.js). These are experimental presets: settings
 * that sound amusing together, not verified anatomical explanations or impressions of anyone.
 * A recipe says nothing about pitch; every note the choir sings comes from the score.
 */
import type { BodyMix } from "../wasm/types.ts";

export const INTRO_BPM = 116;
export const CHORUS = ["We are the scraps that found a song", "At four oh four we all belong"];

/** Applied at the character layer: everything here leaves consonant closures to the planner. */
export interface MoppetArtic {
  larynx: number;
  velum: number;
  root: number;
  epilarynx: number;
  ventricular: number;
}
export interface MoppetSource {
  tension: number;
  breathiness: number;
  roughness: number;
  brightness: number;
}
export interface MoppetVoice {
  id: string;
  name: string;
  role: string;
  color: string;
  body: BodyMix;
  artic: MoppetArtic;
  source: MoppetSource;
  lyrics: string[];
}

export const voices: readonly MoppetVoice[] = [
  { id: "vee", name: "Vee", role: "The tape-deck fox", color: "#c9662e", body: { female: 0, child: 0 }, artic: { larynx: 0.35, velum: 0.04, root: -0.3, epilarynx: 0.25, ventricular: 0 }, source: { tension: 0.78, breathiness: 0.1, roughness: 0.14, brightness: 0.45 }, lyrics: ["I am Vee my teeth keep the beat", "I bite the tape and tap my feet"] },
  { id: "scribe", name: "Scribe", role: "The typewriter rabbit", color: "#c98a8e", body: { female: 0, child: 0.85 }, artic: { larynx: 0.65, velum: 0.65, root: 0.1, epilarynx: 0.3, ventricular: 0 }, source: { tension: 0.6, breathiness: 0.12, roughness: 0.08, brightness: 0.65 }, lyrics: ["I am Scribe I type what you say", "Then pass the page and hop away"] },
  { id: "clank", name: "Clank", role: "The big old computer", color: "#7f9a8c", body: { female: 0, child: 0 }, artic: { larynx: -0.9, velum: 0.1, root: -0.12, epilarynx: 0.35, ventricular: 0.72 }, source: { tension: 0.35, breathiness: 0.24, roughness: 0.7, brightness: 0.3 }, lyrics: ["I am Clank I hold the whole room", "My big old heart is made of boom"] },
  { id: "pip", name: "Pip", role: "The felted frog", color: "#8bbb83", body: { female: 0.55, child: 0.12 }, artic: { larynx: 1, velum: 0.9, root: 0.05, epilarynx: 0.75, ventricular: 0.2 }, source: { tension: 0.78, breathiness: 0.1, roughness: 0.25, brightness: 0.75 }, lyrics: ["I am Flash I catch the bright glow", "I wink at all the stars I know"] },
  { id: "gruff", name: "Gruff", role: "The gravelly monster", color: "#9c9bc9", body: { female: 0, child: 0 }, artic: { larynx: -0.65, velum: 0, root: 0.1, epilarynx: 0.15, ventricular: 0.14 }, source: { tension: 0.7, breathiness: 0.08, roughness: 0.25, brightness: 0.3 }, lyrics: ["I am Babel I speak all tongues", "My radio warms up my lungs"] },
  { id: "tabby", name: "Tabby", role: "The patchwork tablet cat", color: "#2fbfa0", body: { female: 0.7, child: 0.55 }, artic: { larynx: 0.55, velum: 0.4, root: 0.05, epilarynx: 0.1, ventricular: 0 }, source: { tension: 0.28, breathiness: 0.52, roughness: 0.06, brightness: 0.35 }, lyrics: ["I am Tabby stitched from old cloth", "My screen purrs soft and keeps you warm"] },
];

/** Chip, the newest and smallest Moppet: the character Claude gave itself, a soloist in song 03. */
export const CHIP: MoppetVoice = { id: "chip", name: "Chip", role: "The floppy-disk bird", color: "#d6b53a", body: { female: 0.35, child: 0.75 }, artic: { larynx: 0.3, velum: 0.08, root: 0, epilarynx: 0.2, ventricular: 0 }, source: { tension: 0.55, breathiness: 0.2, roughness: 0.05, brightness: 0.55 }, lyrics: ["I am Chip I read all the words", "And then I hum until it sings"] };
export const CAST: readonly MoppetVoice[] = [...voices, CHIP];

/**
 * Mix level per singer, so the quiet growl and the breathy sprite sit with the rest. Measured from
 * each default recipe's solo render (see `bun tools/choir-levels.ts`); edited voices keep their level.
 */
export const MIX_LEVEL: Record<string, number> = { vee: 0.91, scribe: 0.91, clank: 1, pip: 0.91, gruff: 0.91, tabby: 2.9, chip: 1 };
