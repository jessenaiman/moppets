import {BAND_SETUP, type BandNote, type BandPart} from "./band.ts";
import type {Piece} from "./music.ts";

/** The bass player's six-beat interruption is also the cue for the followspot. */
export function moonbeamBand(piece:Piece):BandPart[] {
  const keys:BandNote[]=[], bass:BandNote[]=[], knocks:BandNote[]=[];
  const at=(name:string)=>piece.sections?.find(s=>s.name===name)?.beat;
  const steal=at("bass steals the light"), cutoff=at("blackout");
  for(const c of piece.chords){
    const root=c.tones[0];
    if(cutoff!==undefined && c.beat>=cutoff && c.beat<piece.beats-3)continue;
    // Close upper voices and a common D across Gm9, F6, and Cadd9.
    const voicings:Record<number,number[]>={7:[58,62,69],5:[57,62,65],0:[55,62,64],2:[57,60,65],9:[55,60,64],10:[57,62,65]};
    const tones=voicings[root]??c.tones.map(pc=>60+pc);
    const finale=c.beat===piece.beats-3;
    const pulse=c.beat<(at("the leap")??Infinity) ? [0,1.5] : [0,1,2];
    for(const [i,offset] of pulse.entries()){
      if(offset>=c.beats || (finale && i>0))continue;
      for(const [j,midi] of tones.entries()){
        keys.push({beat:c.beat+offset+j*.035,beats:finale?2.6:i===0?.58:.26,midi,vel:finale?66:61-i*6+j*2});
      }
      if(!finale)knocks.push({beat:c.beat+offset,beats:.12,midi:i===0?36:75,vel:i===0?57:78});
    }
    if(!finale && c.beats>=3){
      knocks.push({beat:c.beat+2.5,beats:.1,midi:42,vel:46});
      keys.push({beat:c.beat+2.5,beats:.32,midi:tones.at(-1)!+5,vel:57});
    }
    if(steal!==undefined && c.beat>=steal+6){
      bass.push({beat:c.beat,beats:finale?2.4:.67,midi:36+root,vel:98});
      if(!finale && c.beats>=3)bass.push({beat:c.beat+2,beats:.37,midi:43+root,vel:76});
    }
  }
  if(steal!==undefined){
    for(const [offset,midi,duration,vel] of [[0,43,.8,99],[1,41,.35,77],[1.5,40,1.2,91],[3,38,.55,98],[4,45,.35,73],[4.5,50,.95,88]]){
      bass.push({beat:steal+offset,midi,beats:duration,vel});
    }
  }
  bass.sort((a,b)=>a.beat-b.beat);
  return ([["bass",bass],["keys",keys],["drums",knocks]] as const).map(([id,notes])=>({id,channel:BAND_SETUP[id].channel,program:BAND_SETUP[id].program,notes}));
}
