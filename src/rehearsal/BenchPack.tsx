import rig from './cue-bench-rig.json';
import {AbsoluteFill,Img,Sequence,staticFile,useCurrentFrame} from 'remotion';
const base='rehearsal/cast/cue/';
const framesPerCel=24/rig.deliverables.acting_cycle.fps;
export const cycleLength=rig.deliverables.acting_cycle.grid.totalFrames*framesPerCel;
export function SheetCel({sheet,cell,width}:{sheet:'acting'|'singing';cell:number;width:number}){
  return <div style={{width,height:width*384/344,position:'relative',overflow:'hidden'}}>
    <Img src={staticFile(base+sheet+'-rgba.webp')} style={{position:'absolute',width:width*4,maxWidth:'none',left:-(cell%4)*width,top:-Math.floor(cell/4)*width*384/344}}/>
  </div>;
}
function Cycle({singing=false}:{singing?:boolean}){
  const frame=useCurrentFrame(),cell=Math.min(7,Math.floor(frame/framesPerCel));
  return <div style={{position:'absolute',left:singing?430:390,bottom:singing?0:720*(1-rig.environment.baselineYNormalized)-20}}>
    <SheetCel sheet={singing?'singing':'acting'} cell={cell} width={singing?420:490}/>
  </div>;
}
export function BenchPack(){
 return <AbsoluteFill><Img src={staticFile(base+'stage.webp')} style={{width:'100%',height:'100%'}}/>
   <Sequence name="Eight acting poses · floor mark" durationInFrames={cycleLength}><Cycle/></Sequence>
   <Sequence name="Eight singing expressions" from={cycleLength} durationInFrames={cycleLength}><Cycle singing/></Sequence>
 </AbsoluteFill>;
}
