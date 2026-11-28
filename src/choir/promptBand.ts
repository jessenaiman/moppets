import type { BandNote, BandPart } from "./band.ts";
import type { Piece } from "./music.ts";

/** Cue taps the downbeat with his pencil; Neon's offbeat answer enters in the duet. */
export function promptBand(piece: Piece): BandPart[] {
  const bass: BandNote[] = [], keys: BandNote[] = [], drums: BandNote[] = [];
  const duet = piece.stage?.includes("neon");
  for (const c of piece.chords) {
    const section = piece.sections?.filter(s => s.beat <= c.beat).at(-1)?.name;
    if (section === "blank card") continue;
    const answer = duet && section === "right on cue";
    const [root, third, fifth] = c.tones;
    bass.push({ beat:c.beat, beats:answer ? .85 : .38, midi:36+root, vel:answer ? 82 : 66 });
    if (section === "Finale") {
      keys.push({beat:c.beat,midi:60+third,beats:3.5,vel:55});
      continue;
    }
    for (const pc of [third,fifth]) {
      keys.push({beat:c.beat + (answer ? .67 : .5), beats:answer ? .65 : .18,midi:60+pc,vel:57});
    }
    if (answer && c.beats>=4) bass.push({beat:c.beat+2,beats:.8,midi:36+fifth,vel:74});
    for(let b=0;b<c.beats;b+=2) drums.push({beat:c.beat+b,beats:.1,midi:75,vel:b===0?48:33});
  }
  return [{id:"bass",channel:10,program:33,notes:bass},{id:"keys",channel:11,program:4,notes:keys},{id:"drums",channel:9,program:0,notes:drums}];
}
