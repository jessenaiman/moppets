/**
 * OO Moppet Character Base (`MoppetCharacter`):
 * Every character inherits CHIMERA's calibrated `DEFAULT_SOURCE`, neutral airway posture,
 * safe anatomical scale floor (`>= 0.75`), canonical 6-clip 3D stage actions, and CHIMERA's
 * damped-spring `Expression` solver (`@chimera/ui/render/expression.ts`), overriding only
 * what makes that character distinct.
 */
import type { BodyMix } from "@chimera/wasm/types.ts";
import { Expression } from "@chimera/ui/render/expression.ts";

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
  size?: number;
  artic: MoppetArtic;
  source: MoppetSource;
  vibrato: number;
  register: [number, number];
  octave: number;
  level: number;
  lyrics: string[];
}

export type PropEffect = "reels" | "typewriter" | "lamps" | "sac" | "dial" | "scope" | "led";

export const MOPPET_STAGE_ACTIONS = ["idle", "sing", "walk", "jump", "spin", "bow"] as const;
export type MoppetActionId = (typeof MOPPET_STAGE_ACTIONS)[number];

export interface Moppet {
  readonly voice: MoppetVoice;
  readonly art: "cels" | "solo";
  readonly prop: PropEffect;
  readonly pad: string;
  readonly seat?: number;
}

/** Calibrated CHIMERA `DEFAULT_SOURCE` baseline shared by all Moppets. */
export const BASE_MOPPET_SOURCE: Readonly<MoppetSource> = {
  tension: 0.5,
  breathiness: 0.15,
  roughness: 0.1,
  brightness: 0.25,
  pressure: 7.2,
  glide: 0.06,
  drift: 4.0,
  vibratoRate: 6.0,
};

/** Neutral CHIMERA character posture leaving consonant closures to the planner. */
export const BASE_MOPPET_ARTIC: Readonly<MoppetArtic> = {
  larynx: 0,
  velum: 0.04,
  root: 0,
  epilarynx: 0.12,
  ventricular: 0,
};

export interface MoppetCharacterSpec {
  id: string;
  name: string;
  role: string;
  color: string;
  body?: Partial<BodyMix>;
  size?: number;
  artic?: Partial<MoppetArtic>;
  source?: Partial<MoppetSource>;
  vibrato?: number;
  register?: [number, number];
  octave?: number;
  level?: number;
  lyrics?: string[];
  art?: "cels" | "solo";
  prop?: PropEffect;
  pad?: string;
  seat?: number;
}

/** Clamp `size` so `effectiveBodyScale * size >= 0.75` (well above CHIMERA's 0.65 phonation floor). */
export function safeMoppetSize(body: BodyMix, requestedSize = 1): number {
  const child = Math.max(0, Math.min(1, body.child));
  const female = Math.max(0, Math.min(1, body.female));
  const approxBodyScale = child * 0.74 + (1 - child) * (female * 0.87 + (1 - female) * 1.0);
  const minSize = 0.75 / Math.max(0.65, approxBodyScale);
  return Number(Math.max(minSize, Math.min(1.6, requestedSize)).toFixed(3));
}

export class MoppetCharacter implements Moppet {
  readonly voice: MoppetVoice;
  readonly art: "cels" | "solo";
  readonly prop: PropEffect;
  readonly pad: string;
  readonly seat?: number;
  readonly actions: readonly MoppetActionId[] = MOPPET_STAGE_ACTIONS;

  constructor(spec: MoppetCharacterSpec) {
    const body: BodyMix = {
      female: spec.body?.female ?? 0,
      child: spec.body?.child ?? 0,
    };
    const size = safeMoppetSize(body, spec.size ?? 1);
    this.voice = {
      id: spec.id,
      name: spec.name,
      role: spec.role,
      color: spec.color,
      body,
      size,
      artic: { ...BASE_MOPPET_ARTIC, ...spec.artic },
      source: { ...BASE_MOPPET_SOURCE, ...spec.source },
      vibrato: spec.vibrato ?? 28,
      register: spec.register ?? [60, 76],
      octave: spec.octave ?? 0,
      level: spec.level ?? 1,
      lyrics: spec.lyrics ?? [],
    };
    this.art = spec.art ?? "cels";
    this.prop = spec.prop ?? "led";
    this.pad = spec.pad ?? "oo";
    this.seat = spec.seat;
  }

  get id(): string {
    return this.voice.id;
  }

  /** Create a fresh CHIMERA spring-driven facial `Expression` instance for this character. */
  createExpression(): Expression {
    return new Expression();
  }

  /** Wrap an existing `Moppet` literal into a `MoppetCharacter` instance with enforced base invariants. */
  static from(raw: Moppet): MoppetCharacter {
    if (raw instanceof MoppetCharacter) return raw;
    return new MoppetCharacter({
      ...raw.voice,
      art: raw.art,
      prop: raw.prop,
      pad: raw.pad,
      seat: raw.seat,
    });
  }
}
