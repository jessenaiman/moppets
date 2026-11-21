import {StageFit} from "./StageFit";
import {AbsoluteFill,Img,Sequence,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import type {MoppetVideoProps} from '../choir/videoProject';
import {vocalLevelAt} from '../choir/vocalTiming';
import {Cue,Duet} from './Duet';
import {NeonMesh,pose,type Action} from './NeonActions';


const plate=(file:string)=> <Img src={staticFile('rehearsal/sets/'+file+'.webp')} style={{width:'100%',height:'100%',objectFit:'cover'}}/>;
function performance(props:MoppetVideoProps,seconds:number){
  const line=props.bubbles.find(b=>seconds>=b.startSec&&seconds<b.startSec+b.durationSec);
  const word=line?.words?.find(w=>seconds>=w.startSec&&seconds<w.endSec);
  const mouth=word?Math.max(0,Math.min(1,(seconds-word.startSec)/.055,(word.endSec-seconds)/.075)):0;
  const progress=line?(seconds-line.startSec)/line.durationSec:0;
  return {line,mouth,progress};
}
export function Audition({project,neon}:{project:MoppetVideoProps;neon:boolean}){
  const f=useCurrentFrame(),s=f/useVideoConfig().fps,{line,mouth: scoreMouth,progress}=performance(project,s);
  const mouth=vocalLevelAt(project.vocalTiming,neon?'vee':'scribe',s)??scoreMouth;
  const word=line?.text.toLowerCase()??'',strength=Math.sin(Math.PI*progress);
  if(neon){
    const action:Action=word.includes('dark')?'bow':word.includes('hear')?'listen':word.includes('saved')||word.includes('with me')?'offer':word.includes('late')?'nod':word?'sing':'idle';
    const p=pose(action,line?progress:(f%96)/95);
    p.rose=mouth*(word.includes('left')?.12:1);p.cyan=mouth*(word.includes('right')?.12:1);
    const dark=project.bubbles.find(b=>b.text.toLowerCase().includes('goes dark'));
    const invite=project.bubbles.find(b=>b.text.toLowerCase().includes('sing with me'));
    const dim=dark&&invite?Math.max(0,Math.min(1,s-dark.startSec,invite.startSec+1-s)):0;
    return <AbsoluteFill style={{background:'#1b1719'}}><Sequence name="Repair bay">{plate('neon-repair')}</Sequence>
      <AbsoluteFill style={{background:`rgba(9,11,20,${dim*.50})`}}/>
      <Sequence name="Answering light"><AbsoluteFill style={{background:`radial-gradient(ellipse 16% 5% at 70% 89%,rgba(241,126,161,${invite&&s>invite.startSec?.48:0}), transparent)`}}/></Sequence>
      <Sequence name="Neon · two voices"><NeonMesh p={p} left={315} top={65} width={422}/></Sequence>
    </AbsoluteFill>;
  }
  const blank=project.bubbles.find(b=>b.text==='Now for my part'),inv=project.bubbles.find(b=>b.text==='Stand here with me');
  const turn=blank?Math.max(0,Math.min(1,(s-blank.startSec-blank.durationSec+.24)*2.5)):0;
  const returned=inv?Math.max(0,Math.min(1,(s-inv.startSec+.55)*2)):0;
  const cardAngle=180*(turn-returned);
  const reach=word.includes('roll')||word.includes('step')||word.includes('stand')?60:word.includes('hat')?-20:22;
  return <AbsoluteFill style={{background:'#2b201d'}}><Sequence name="Script desk">{plate('cue')}</Sequence>
    <Sequence name="Prompt card"><div style={{position:'absolute',left:212,top:428,width:274,height:136,perspective:800}}>
      <div style={{position:'absolute',left:133,top:80,width:9,height:103,background:'#83694c'}}/>
      <div style={{position:'absolute',inset:0,transform:`rotateY(${cardAngle}deg)`,background:'#dfc79c',boxShadow:'0 5px 16px #26190c66',borderRadius:5,display:'grid',placeItems:'center',font:'italic 30px Georgia',color:'#462e1b'}}>
        {cardAngle<90?(returned>.5?'Places for two':'Places, please'):''}
      </div></div></Sequence>
    <Sequence name="Cue · prompt and recover"><div style={{position:'absolute',inset:0,transform:'translateX(-85px)'}}>
      <Cue arm={15+reach*strength} head={word.includes('who')?12*strength:word.includes('oh')?-9*strength:turn*(1-returned)*8+3*strength} mouth={mouth}/>
    </div></Sequence>
  </AbsoluteFill>;
}
export function CastMoment({project}:{project:MoppetVideoProps}){
  const frame=useCurrentFrame(),{fps}=useVideoConfig();
  const cast=project.bubbles.find(b=>b.speakerId==='scribe'&&b.text==='I lay the loop');
  if(!cast)return null;
  const v=performance(project,frame/fps);
  const mouth=vocalLevelAt(project.vocalTiming,'scribe',frame/fps)??(v.line?.speakerId==='scribe'?v.mouth:0);
  const neonMouth=vocalLevelAt(project.vocalTiming,'vee',frame/fps)??0;
  return <Sequence name="Cord cast and caster catch" from={Math.max(0,Math.round((cast.startSec-.61)*fps))} durationInFrames={Math.round(6.25*fps)}>
    <StageFit><Duet mouth={mouth} neonMouth={neonMouth}/></StageFit>
  </Sequence>;
}
