/**
 * The band on stage (issue #9): three devices that became puppets, playing the band's own notes
 * (`bandFor` in src/choir/band.ts), upstage behind the singers. Shown in pieces whose `stage`
 * includes "band" (a song file's `stage: band, …`).
 *
 *  - Thrum, the bass: a coiled orange extension cord with a power-strip body. He plucks his own cord,
 *    and it shivers on every bass note, harder for louder ones.
 *  - Clacker, the keys: an old computer keyboard that plays itself like a piano; its keys light on
 *    the notes it plays.
 *  - Rattle, the drums: a coffee-tin drummer with pencil sticks and jar-lid cymbals: the tin bounces
 *    on the kick, a stick strikes on the snare, a lid flashes on the hats and crash.
 *
 * Drawn stand-ins until their sprite sheets exist (image prompts in docs/briefs/new-cast.md).
 */
import type { BandPart } from "../choir/band.ts";
import { CRASH, HAT, KICK, OPEN_HAT, SNARE } from "../choir/band.ts";

export const BAND_MEMBERS = [
  { id: "bass", name: "Thrum", role: "The extension-cord bassist" },
  { id: "keys", name: "Clacker", role: "The keyboard that plays itself" },
  { id: "drums", name: "Rattle", role: "The coffee-tin drummer" },
] as const;

export function BandStage() {
  return (
    <div className="band-row" data-layout="overlay" aria-label="The band: Thrum on bass, Clacker on keys, Rattle on drums">
      <svg className="band-member thrum" viewBox="0 0 100 110" aria-hidden="true">
        <path className="cord" d="M50 8 C20 10 18 40 50 40 C82 40 80 70 50 70 C25 70 22 92 40 100" fill="none" stroke="#e8792c" strokeWidth="6" strokeLinecap="round" />
        <rect x="28" y="44" width="44" height="58" rx="8" fill="#f1ede4" stroke="#8d8576" strokeWidth="2" />
        <circle cx="41" cy="60" r="5" fill="#2b2622" />
        <circle cx="59" cy="60" r="5" fill="#2b2622" />
        <rect className="mouth" x="40" y="78" width="20" height="7" rx="3" fill="#2b2622" />
        <circle className="light" cx="50" cy="94" r="3" fill="#5a1d14" />
      </svg>
      <svg className="band-member clacker" viewBox="0 0 140 90" aria-hidden="true">
        <rect x="6" y="30" width="128" height="52" rx="6" fill="#d9d4c7" stroke="#8d8576" strokeWidth="2" />
        {Array.from({ length: 12 }, (_, i) => <rect key={i} className="key" x={12 + i * 10} y="56" width="8" height="20" rx="1.5" fill="#fbf8f1" stroke="#a49c8c" />)}
        <circle cx="52" cy="44" r="5" fill="#2b2622" />
        <circle cx="88" cy="44" r="5" fill="#2b2622" />
      </svg>
      <svg className="band-member rattle" viewBox="0 0 110 110" aria-hidden="true">
        <ellipse className="lid" cx="20" cy="30" rx="16" ry="5" fill="#c9b989" stroke="#7d6f48" strokeWidth="2" />
        <ellipse className="lid crash" cx="90" cy="24" rx="16" ry="5" fill="#c9b989" stroke="#7d6f48" strokeWidth="2" />
        <g className="tin">
          <rect x="33" y="42" width="44" height="58" rx="4" fill="#b8503a" stroke="#6e2b1f" strokeWidth="2" />
          <ellipse cx="55" cy="42" rx="22" ry="6" fill="#d9a07f" stroke="#6e2b1f" strokeWidth="2" />
          <circle cx="47" cy="62" r="4.5" fill="#2b2622" />
          <circle cx="63" cy="62" r="4.5" fill="#2b2622" />
        </g>
        <line className="stick" x1="78" y1="70" x2="100" y2="48" stroke="#e7c76a" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span className="band-names">{BAND_MEMBERS.map((m) => m.name).join(" · ")}</span>
    </div>
  );
}

/** Notes starting within this many beats of now count as being struck. */
const STRIKE = 0.18;

/** One frame of the band: which members strike now (the parts' notes at `beat`; resting when not playing). */
export function updateBand(row: HTMLElement | null, parts: readonly BandPart[], beat: number, playing: boolean): void {
  if (!row) return;
  const struck = (id: string, keys?: number[]) => {
    if (!playing) return 0;
    const n = parts.find((p) => p.id === id)?.notes.filter((x) => beat >= x.beat && beat < x.beat + STRIKE && (!keys || keys.includes(x.midi)));
    return n?.length ? Math.max(...n.map((x) => x.vel)) / 127 : 0;
  };
  const set = (sel: string, on: number) => row.querySelector(sel)?.classList.toggle("hit", on > 0);
  set(".thrum", struck("bass"));
  set(".rattle .tin", struck("drums", [KICK]));
  set(".rattle .stick", struck("drums", [SNARE]));
  set(".rattle .lid:not(.crash)", struck("drums", [HAT, OPEN_HAT]));
  set(".rattle .crash", struck("drums", [CRASH]));
  // the keys light by pitch: each sounding note picks a key
  const keys = row.querySelectorAll(".clacker .key");
  const sounding = playing ? (parts.find((p) => p.id === "keys")?.notes.filter((x) => beat >= x.beat && beat < x.beat + x.beats) ?? []) : [];
  const lit = new Set(sounding.map((x) => ((x.midi % 12) + 12) % 12));
  keys.forEach((k, i) => k.classList.toggle("lit", lit.has(i)));
}
