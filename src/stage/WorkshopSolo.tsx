import type { CSSProperties } from "react";
import type { Track } from "../choir/music.ts";

export const workshopSongs = {
  tabby: "One Tape",
  chip: "One More Thing",
  watt: "Every Socket",
  clank: "The Late Answer",
} as const;
export type WorkshopSinger = keyof typeof workshopSongs;
type Cue = [action: number, syllable: number, attack: number, hold: number];

// The syllable starts the movement. Attack and hold are in beats, so a tempo
// change or scrub stays in step with the score in both stage renderers.
const cues: Record<WorkshopSinger, Cue[]> = {
  tabby: [[0,2,.8,1],[0,1,1.1,1],[1,3,1.7,0],[0,3,.7,1],[3,1,.9,1],[3,2,.7,1.2],[0,1,1,1],[2,4,1.1,1.3],[3,0,.8,2]],
  chip: [[0,1,.6,1],[1,3,.4,3],[0,4,.65,2],[1,4,.9,2],[2,2,.4,1],[3,1,.75,.3],
    [2,4,.45,1.5],[3,3,1.1,2],[2,0,.8,2]],
  watt: [[0,2,.7,1.2],[1,4,.45,1.4],[2,5,.6,2],[1,1,.5,2],[0,0,.5,.6],
    [2,3,.45,1.4],[2,4,.6,2],[3,3,1.15,2],[2,0,.45,2.5]],
  clank: [[0,3,1.25,1.4],[0,2,1.5,2],[1,4,1.1,2],[1,2,.9,2.2],[0,2,.75,3],
    [1,1,1.1,1.8],[0,4,1.25,1.5],[3,3,1.2,1.5],[2,0,.5,3]],
};

export function workshopTake(actor: WorkshopSinger, track: Track | undefined, beat: number, still: boolean) {
  const events = track?.events ?? [];
  const last = events.filter(e=>e.line !== undefined && e.beat <= beat).at(-1);
  const line = last?.line ?? -1;
  const notes = events.filter(e=>e.line === line);
  const [action, syllable, attack, hold] = cues[actor][line] ?? [0,0,1,0];
  const start = notes[Math.min(syllable, notes.length-1)]?.beat ?? beat;
  const t = beat - start;
  const release = Math.max(0, t - attack - hold);
  const progress = Math.max(0, Math.min(t / attack, 1, 1 - release / .9));
  let cel = action * 12 + Math.round(progress * 10);
  if (actor === "chip" && line === 5 && t > 1.6) {
    // He finishes the bow before his opposite wing waves.
    cel = 24 + Math.round(5 + 5 * Math.sin((t - 1.6) * 5));
  }
  if (actor === "tabby" && line === 2) {
    const steps = notes[3]?.beat ?? start, bow = notes[7]?.beat ?? steps+3;
    cel = beat < steps ? 0 : beat < bow ? 12 + Math.min(11,Math.floor(12*(beat-steps)/Math.max(.25,bow-steps)))
      : 24 + Math.round(10*Math.max(0, Math.min(1,(beat-bow)/.8, (bow+3.5-beat)/.8)));
  }
  const spin = actor === "chip" && [1,3,4,7].includes(line) && t >= 0;
  const light = actor === "watt" && line >= 0;
  const answer = actor === "clank" && line >= 8;
  const propFrame = spin ? Math.floor(Math.max(0,t)*12) % 16 : light
    ? Math.min(15,Math.max(0,Math.round((t + (line>=4 ? 1 : 0))*7))) : Math.round(Math.min(1,Math.max(0,t/.9))*15);
  return { cel: still ? 0 : cel, prop: spin || light || answer, propFrame: still ? 0 : propFrame,
    toss: spin && !still ? Math.min(1, t/.95) : 1 };
}

export function atlasStyle(url: string, frame: number, cols: number, rows: number): CSSProperties {
  return {backgroundImage:`url("${url}")`, backgroundSize:`${cols*100}% ${rows*100}%`,
    backgroundPosition:`${frame%cols*100/(cols-1)}% ${Math.floor(frame/cols)*100/(rows-1)}%`};
}

export function WorkshopSolo({actor, take, open, resolveAsset}: {
  actor: WorkshopSinger; take: ReturnType<typeof workshopTake>; open: boolean; resolveAsset: (path:string)=>string;
}) {
  const base = `/rehearsal/rigs/${actor}/solo`;
  return <span className="workshop-solo" data-act={actor} data-cel={take.cel} aria-hidden="true"
    style={atlasStyle(resolveAsset(`${base}/${open?"open":"closed"}.webp`),take.cel,8,6)}>
    {take.prop && <span className="workshop-prop" style={{
      ...atlasStyle(resolveAsset(base+"/prop.webp"),take.propFrame,4,4),
      ...(actor==="chip" ? {left:`${82+take.toss*22}%`,bottom:`${2+36*(1-take.toss)+Math.sin(take.toss*Math.PI)*16}%`} : {}),
    }}/>}
  </span>;
}
