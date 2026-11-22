import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {beatSeconds, LEAD_IN} from "../choir/timeline";
import type {MoppetVideoProps} from "../choir/videoProject";
import {atlasStyle} from "../stage/WorkshopSolo";
import {StageFit} from "./StageFit";

const band = [
  {id:"click",voice:"pip",x:234, size:265, section:"the extra tick", file:"exposure-keys/click",cols:8,rows:1},
  {id:"thrum",voice:"gruff",x:482, size:286, section:"the long return",file:"band/thrum-action",cols:8,rows:2},
  {id:"amplifier",voice:"scribe",x:760, size:286, section:"the held chord",file:"cast/amplifier/guitar-valve-atlas",cols:4,rows:1},
  {id:"clacker",voice:"vee",x:1025,size:268, section:"the last key",file:"band/clacker-action",cols:8,rows:2},
] as const;
const clamp = (n:number) => Math.min(1,Math.max(0,n));
const ease = (n:number) => {const t=clamp(n); return t*t*(3-2*t);};

export function QuietBar({project}: {project:MoppetVideoProps}) {
  const frame = useCurrentFrame(), {fps}=useVideoConfig();
  const piece = project.piece!;
  const beat = (frame/fps-LEAD_IN)/beatSeconds(piece);
  const sections = piece.sections ?? [];
  const section = sections.filter(s=>s.beat<=beat).at(-1);
  const offset = beat-(section?.beat ?? 0);
  const next = sections.find(s=>s.beat>beat)?.beat ?? piece.beats;
  const feature = band.find(m=>m.section===section?.name);
  const push = feature && project.cameraAutoFollow ? ease(offset/2)*ease((next-beat)/2) : 0;

  return <StageFit><AbsoluteFill style={{overflow:"hidden",background:"#281d1a"}}>
    <AbsoluteFill style={{transformOrigin:`${(feature?.x ?? 640)/12.8}% 69%`,transform:`scale(${1+.58*push})`}}>
      <Img src={staticFile("rehearsal/band/studio-404-empty-stage.webp")} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
      {band.map(member=>{
        const note = piece.tracks.find(t=>t.id===member.voice)?.events.find(e=>beat>=e.beat && beat<e.beat+e.beats);
        const age=note ? beat-note.beat : 0, left=note ? note.beats-age : 0;
        const pressure=note ? ease(age/.15)*ease(left/.22) : 0;
        const phrase=Boolean(note);
        let cel=0;
        if (member.id==="amplifier" && phrase) cel = age<.14 ? 1 : left<.22 ? 3 : 2;
        if (member.id==="click" && phrase) cel=(Math.floor(note!.beat)%4)*2 + (pressure>.2 ? 1 : 0);
        if ((member.id==="thrum" || member.id==="clacker") && note) {
          const peak=member.id==="thrum" ? 6 : 5;
          cel=age<.20 ? Math.round(peak*ease(age/.20)) : Math.round(peak*(2-ease(left/.34)));
        }
        // Hold each mistake long enough for the other players to hear it.
        if (member.id === "amplifier" && section?.name === "the held chord" && offset >= 12) {
          cel = offset < 16 ? 2 : offset < 17 ? 3 : 0;
        }
        if (member.id === "click" && section?.name === "the extra tick" && offset >= 12 && offset < 17) {
          cel = offset < 15.5 ? 6 : offset < 16 ? 7 : 0;
        }
        if (member.id === "clacker" && section?.name === "the last key" && offset >= 8 && offset < 17) {
          cel = offset < 15.5 ? 2 : offset < 16 ? 5 : 10;
        }
        const width=member.id==="amplifier" ? member.size*.654 : member.size;
        return <div key={member.id} style={{position:"absolute",left:member.x-width/2,bottom:116,width,height:member.size}}>
          <div style={{position:"absolute",bottom:-5,left:"15%",width:"70%",height:13,borderRadius:"50%",background:"radial-gradient(ellipse,#24150cc9,transparent 72%)"}}/>
          <div data-band-actor={member.id} data-cel={cel} style={{width:"100%",height:"100%",backgroundRepeat:"no-repeat",
            ...atlasStyle(staticFile("rehearsal/"+member.file+".webp"),cel,member.cols,member.rows)}}/>
        </div>;
      })}
    </AbsoluteFill>
  </AbsoluteFill></StageFit>;
}
