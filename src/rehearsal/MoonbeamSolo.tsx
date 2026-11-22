import {AbsoluteFill, interpolate, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {MoppetVideoProps} from '../choir/videoProject';
import {moonbeamBand} from '../choir/moonbeamBand';
import mouthRegistration from './moonbeam-mouths.json';
import {useMemo} from 'react';
import {beatSeconds, LEAD_IN} from '../choir/timeline';
import {vocalLevelAt, type VocalTiming} from '../choir/vocalTiming';

const blocking = ['walk-left','walk-right','point','aside','reach','cue','jump','land','question','answer','glow'] as const;
type Action = typeof blocking[number] | 'listen' | 'idle' | 'react';
type Note = {beat:number;beats:number};
type Phrase = {text:string; notes:Note[]; start:number; beatSec:number};

function Actor({action,duration,from,restingX=680,phrase,vocalTiming}: {
  action:Action;duration:number;from:number;restingX?:number;phrase?:Phrase;vocalTiming?:VocalTiming;
}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = Math.min(1, frame / Math.max(1, duration - 1));
  const travel = 345 * progress * progress * (3 - 2 * progress);
  const travelX = action === 'walk-left' ? 680 - travel : action === 'walk-right' ? 335 + travel : restingX;
  const native = action === 'jump' || action === 'land';
  // Each half of the Flow take has 48 exposures. The stage floor stays fixed
  // within the crop, including through the apex and contact compression.
  const exposure = native
    ? Math.round(progress * 47) + (action === 'land' ? 48 : 0)
    : Math.floor(frame * 8 / fps) % 8;
  const facePoses:Partial<Record<Action,number[]>>={
    listen:[0,1,7,1],point:[1,7,7,0],aside:[5,5,2,6],cue:[1,3,6,2],
    question:[5,1,7,3],answer:[1,6,2,0],glow:[2,6,2,0]
  };
  const faces=facePoses[action];
  const cell=native ? exposure%24 : faces ? faces[Math.min(3,Math.floor(progress*4))]
    : action==='react'||action==='reach' ? Math.min(7,Math.floor(progress*8)) : exposure;
  const x = travelX - (native ? 48 - 45 * exposure / 95 : 0);
  const sheet = native ? 'leap-' + Math.floor(exposure / 24) : faces ? 'expressions' : action;
  const beat=phrase ? phrase.start+frame/fps/phrase.beatSec : 0;
  const notes=phrase?.notes??[];
  const ni=notes.findIndex(n=>beat>=n.beat && beat<n.beat+n.beats);
  const attack=ni<0?0:(beat-notes[ni].beat)/notes[ni].beats;
  const words=phrase?.text.split(/\s+/)??[];
  // “Little” takes two notes. Both syllables illuminate the same printed word.
  const wordAt=(n:number)=>words.includes('little')&&words.length+1===notes.length&&n>=2?n-1:Math.min(n,words.length-1);
  const wi=wordAt(ni),word=words[wi]??'';
  const map=mouthRegistration[sheet as keyof typeof mouthRegistration]?.[cell];
  const rounded=/oo|ow|who|go|my|light|no/i.test(word);
  const pulse=Math.sin(Math.PI*Math.min(1,attack/.12))*Number(attack<.12);
  const scoreOpening=ni<0?0:Math.min(1,attack*12,(1-attack)*9)*(.74+.14*Math.sin(attack*Math.PI*4));
  const opening=vocalLevelAt(vocalTiming,'vee',(from+frame)/fps)??scoreOpening;
  const lean=action==='point'?-13*Math.sin(progress*Math.PI):action==='aside'?12*Math.sin(progress*Math.PI):action==='cue'? -9*Math.sin(progress*2*Math.PI):0;
  const step=Math.sin(progress*Math.PI*8)*Number(action==='walk-left'||action==='walk-right');
  const columns = native ? 6 : 4;
  const width = native ? 396 : 344;
  const height = native ? 400 : 384;
  const airborne = native ? Math.max(0, Math.sin(Math.PI * (exposure - 18) / 36)) * Number(exposure > 18 && exposure < 54) : 0;

  return <>
    {(action === 'answer' || action === 'glow') &&
      <div style={{position:'absolute',left:x-180,top:415,width:360,height:235,
        background:'radial-gradient(ellipse at 50% 78%,rgba(137,222,210,.55),transparent 65%)',
        opacity:action==='answer'?progress:.7+.3*Math.sin(Math.PI*progress)}}/>}
    <div style={{position:'absolute', left:x-75, top:605, width:150, height:18, borderRadius:'50%',
      background:'radial-gradient(ellipse,#3723189c,transparent 72%)', opacity:1-airborne*.62}}/>
    <div style={{position:'absolute', left:x-width/2, top:native?226:248, width, height, overflow:'hidden',transformOrigin:'50% 93%',transform:`rotate(${lean+step*3}deg) scale(${1-pulse*.035},${1+pulse*.04})`}}>
      <Img src={staticFile('rehearsal/moonbeam/'+sheet+'.webp')} style={{position:'absolute',width:columns*width,maxWidth:'none',
        left:-(cell%columns)*width,top:-Math.floor(cell/columns)*height}}/>
      {(ni>=0 || opening>0) && map && <svg width={width} height={height} style={{position:'absolute',inset:0}} viewBox={`0 0 ${width} ${height}`}>
        <rect x={Number(map[0])-2} y={Number(map[1])-2} width={Number(map[2])+4} height={Number(map[3])+4} rx="3" fill={String(map[4])}/>
        <g transform={`translate(${Number(map[0])+Number(map[2])/2} ${Number(map[1])+Number(map[3])/2}) scale(${(rounded?.72:1)*Number(map[2])/32} ${.14+opening*(rounded?1.05:.8)})`}>
          <path d="M-16 -3 Q-2 -7 16 -4 Q13 13 2 13 Q-10 13 -16 -3Z" fill="#243746"/>
          {opening>.38 && <path d="M-8 7 Q0 2 8 7 Q2 14 -8 7" fill="#dd8a82"/>}
        </g>
      </svg>}
    </div>
    {phrase && <div style={{position:'absolute',top:68,left:50,right:50,display:'flex',justifyContent:'center',gap:16,fontFamily:'Georgia,serif',fontWeight:700,fontSize:66,lineHeight:1.1,textShadow:'0 3px 5px #1c100e,0 0 14px #190d0f'}}>
      {words.map((w,i)=><span key={i} style={{color:i===wi?'#ffe09a':'#fff5e1',transform:i===wi?`translateY(${-8-9*Math.sin(Math.PI*attack)}px) rotate(${3*Math.sin(2*Math.PI*attack)}deg)`:'none'}}>{w}</span>)}
    </div>}
  </>;
}

function Followspot({project}:{project:MoppetVideoProps}) {
  const frame=useCurrentFrame(), {fps}=useVideoConfig();
  const piece=project.piece;
  const bass=useMemo(()=>piece ? moonbeamBand(piece)[0].notes : [],[piece]);
  if(!piece)return null;
  const beat=(frame/fps-LEAD_IN)/beatSeconds(piece);
  const cue=(name:string)=>piece.sections?.find(s=>s.name===name)?.beat;
  const entrance=cue("bass steals the light"), dark=cue("blackout");
  if(entrance===undefined || dark===undefined)return null;
  const glide=(a:number,b:number)=>interpolate(beat,[a,b],[0,1],{extrapolateLeft:"clamp",extrapolateRight:"clamp"});
  const reply=cue("the bargain")??entrance+6, leap=cue("the leap")??reply+9;
  const x=680-345*glide(2,5)+345*glide(8,11)+340*glide(entrance-.4,entrance+.4)-340*glide(reply,reply+2)-95*glide(leap,leap+1)+95*glide(leap+4,leap+6);
  const note=bass.find(n=>beat>=n.beat && beat<n.beat+Math.min(.45,n.beats));
  const glow=glide(dark+7.5,dark+9);
  return <>
    <AbsoluteFill style={{background:"rgb(12,10,20)",opacity:.22+.57*glide(dark-.15,dark)-.2*glow}}/>
    <AbsoluteFill style={{clipPath:`polygon(53% 0,55% 0,${x+150}px 598px,${x-150}px 598px)`, background:"linear-gradient(180deg,#ffefc506,#ffe1a34d)",opacity:1-glide(dark-.15,dark)}}/>
    <div style={{position:"absolute",left:x-165,top:569,width:330,height:62,borderRadius:"50%",background:"radial-gradient(ellipse,#fff1b5bb,transparent 70%)",opacity:1-glide(dark-.15,dark)}}/>
    <div style={{position:"absolute",left:890+400*(1-glide(entrance-2,entrance)),top:330,width:300,height:300,opacity:1-.6*glide(dark-.15,dark),transform:"rotate("+ (note ? -2 : 0)+"deg)",transformOrigin:"50% 94%"}}>
      <Img src={staticFile("moppets/band/thrum-"+(note?"play":"rest")+".webp")} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
    </div>
  </>;
}

export function MoonbeamSolo({project}:{project:MoppetVideoProps}) {
  const {fps, width, height, durationInFrames: total} = useVideoConfig();
  const piece = project.piece;
  const track = piece?.tracks.find(t=>t.id === 'vee');
  const scale = Math.min(width / 1280, height / 720);
  const shots: {from:number; duration:number; name:string; action:Action; restingX:number; phrase?:Phrase}[] = [];
  let cursor = 0, restingX = 680;
  if (piece && track) {
    const frameAt = (beat:number) => Math.round((LEAD_IN + beat * beatSeconds(piece))*fps);
    for (const [i, phrase] of (track.phrases ?? []).entries()) {
      const notes = track.events.filter(note=>note.line === i);
      if (!notes.length) continue;
      const from = Math.max(cursor, frameAt(notes[0].beat));
      const last = notes[notes.length-1];
      const end = Math.min(total,frameAt(last.beat+last.beats));
      if (from>cursor) shots.push({from:cursor,duration:from-cursor,name:'Rest',action:i===2?'react':i===8?'listen':'idle',restingX});
      const action = blocking[i] ?? 'idle';
      if (end>from) shots.push({from,duration:end-from,name:phrase,action,restingX,phrase:{text:phrase,notes,start:notes[0].beat,beatSec:beatSeconds(piece)}});
      cursor = end;
      if (action==='walk-left') restingX=335;
      if (action==='walk-right') restingX=680;
    }
  }
  if (cursor<total) shots.push({from:cursor,duration:total-cursor,name:'Rest',action:'idle',restingX});
  return <AbsoluteFill style={{background:'#160e0c',alignItems:'center',justifyContent:'center'}}>
    <div style={{position:'relative',flexShrink:0,width:1280,height:720,transform:`scale(${scale})`}}>
      <Img src={staticFile('rehearsal/cue-stage/stage.png')} style={{width:'100%',height:'100%'}}/>
      <Followspot project={project}/>
      {shots.map(shot=><Sequence key={shot.from} name={shot.name} from={shot.from} durationInFrames={shot.duration}>
        <Actor action={shot.action} duration={shot.duration} from={shot.from} restingX={shot.restingX} phrase={shot.phrase} vocalTiming={project.vocalTiming}/>
      </Sequence>)}
    </div>
  </AbsoluteFill>;
}
