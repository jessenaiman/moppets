import type { Piece } from "../choir/music.ts";
import { atlasStyle } from "./WorkshopSolo.tsx";

export const puppetActions = {
  cue: ["listen","offer","cast","bow","recover"],
  neon: ["listen","answer","snag","step","acknowledge"],
} as const;
type Performer = keyof typeof puppetActions;
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const cel=(phase:number)=>Math.round(47*clamp(phase));

export function cordExposure(piece: Piece, beat: number) {
  const pair=piece.title==="Right on Cue", start=piece.sections?.find(s=>s.name===(pair?"step inside":"prompt"))?.beat;
  if(start===undefined || (!pair && piece.title!=="Line?"))return null;
  const from=start+(pair?0:8);
  if(beat<from)return null;
  const end=piece.sections?.find(s=>s.name===(pair?"missed entrance":"blank card"))?.beat ?? piece.beats;
  if(beat>=end)return null;
  return cel(Math.min((beat-from)/3.6,(end-beat)/2));
}

export function StageCord({frame,front,solo,resolveAsset}: {
  frame:number;front:boolean;solo:boolean;resolveAsset:(p:string)=>string;
}) {
  const side=front?"front":"back";
  return <span aria-hidden="true" data-side={side} data-solo={solo||undefined} data-cel={frame} className="stage-cord"
    style={atlasStyle(resolveAsset(`/rehearsal/pins/cord/${side}.webp`),frame,8,6)}/>;
}

export function PinnedBow({phase,resolveAsset}:{phase:number;resolveAsset:(p:string)=>string}) {
  return <span className="rehearsal-actor" data-action="bow" data-frame={cel(phase)} aria-hidden="true"
    style={atlasStyle(resolveAsset("/rehearsal/pins/tabby/bow.webp"),cel(phase),8,6)}/>;
}

export function RehearsalActor({actor,piece,beat,still,rollingFrame,resolveAsset}: {
  actor:Performer; piece:Piece; beat:number; still:boolean; rollingFrame?:number;resolveAsset:(p:string)=>string;
}) {
  const section=piece.sections?.filter(s=>s.beat<=beat).at(-1);
  const t=Math.max(0,beat-(section?.beat??0)),phrase=Math.floor(t/4);
  let action:string="listen", phase=(t%4)/4;
  if(actor==="cue") {
    if(section?.name==="missed entrance" && t<8) {
      action="bow";phase=t<2 ? .17*t/2 : t<4 ? .17+.31*(t-2)/2 : t<6 ? .48+.12*(t-4)/2 : .6+.4*(t-6)/2;
    }else if(section?.name==="step inside" || (section?.name==="prompt" && phrase>=2)){
      action="cast";phase=clamp((t-(section.name==="prompt"?8:0))/4);
    }else if(section?.name==="blank card"){action="recover";phase=t<4?t/8:t<8?.5:.5+.5*clamp((t-8)/4);}
    else if(section?.name==="invitation" || section?.name==="Finale" || phrase%2===0)action="offer";
  }else{
    action=section?.name==="the dark"?"listen":phrase%2?"answer":"acknowledge";
    if(rollingFrame!==undefined){action="snag";phase=rollingFrame/47;}
    else if(section?.name==="step inside"){action=t<4?"listen":"step";phase=t<4?t/4:clamp((t-4)/4);}
    else if(section?.name==="missed entrance"){action="acknowledge";phase=clamp((t-5)/4);}
  }
  const frame=still?0:cel(phase);
  return <span className="rehearsal-actor" data-action={action} data-frame={frame} aria-hidden="true"
    style={atlasStyle(resolveAsset(`/rehearsal/pins/${actor}/${action}.webp`),frame,8,6)}/>;
}
