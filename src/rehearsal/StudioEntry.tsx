import {CastExposure,exposureCatalog,type ExposureStudy} from './CastExposure';
import {BenchPack,cycleLength} from "./BenchPack";
import React,{useEffect,useState} from 'react';
import {AbsoluteFill,Composition,Internals,Sequence,getStaticFiles,registerRoot,useCurrentFrame} from 'remotion';
import {seek,play,pause} from '@remotion/studio';
import {compositionDimensions} from "../choir/videoProject";
import "./studio-skin.css";
import {MoppetComposition} from '../remotion/MoppetComposition';
import {DEFAULT_VIDEO_PROPS,totalDurationFrames,type MoppetVideoProps} from '../choir/videoProject';
import {ActionStrip} from './NeonActions';

const appOrigin = location.ancestorOrigins?.[0] || (document.referrer ? new URL(document.referrer).origin : '');
const embedded=window.parent!==window && Boolean(appOrigin);
const send=(message:Record<string,unknown>)=>{if(embedded)window.parent.postMessage(message,appOrigin)};
const CurrentProject=React.createContext<MoppetVideoProps>(DEFAULT_VIDEO_PROPS);
function Stage(){
  const props=React.useContext(CurrentProject);
  const frame=useCurrentFrame(),playing=Internals.usePlaying();
  useEffect(()=>{send({type:'rehearsal-clock',frame,playing})},[frame,playing]);
  useEffect(()=>{
    function control(e:MessageEvent){
      if(e.source!==window.parent || e.origin!==appOrigin)return;
      if(e.data?.type==='rehearsal-seek')seek(e.data.frame);
      if(e.data?.type==='rehearsal-play')play();
      if(e.data?.type==='rehearsal-pause')pause();
    }
    window.addEventListener('message',control);return ()=>window.removeEventListener('message',control);
  },[]);
  return <AbsoluteFill>{docked&&<DockClock/>}<Sequence name="Cast and script"><MoppetComposition {...props}/></Sequence></AbsoluteFill>;
}
const docked = embedded && new URLSearchParams(location.search).get('panel') === 'timeline';
if(docked)document.documentElement.classList.add('studio404-timeline');

function DockClock(){
  const frame=useCurrentFrame();
  const userSeeking=React.useRef(false);
  useEffect(()=>{
    const input=()=>{userSeeking.current=true};
    const drag=(e:PointerEvent)=>{if(e.buttons===1)input()};
    const key=(e:KeyboardEvent)=>{
      if(e.code==='Space'&&!(e.target instanceof HTMLInputElement)){e.preventDefault();e.stopImmediatePropagation();send({type:'dock-toggle'});return}
      input();
    };
    const receive=(e:MessageEvent)=>{
      if(e.source!==window.parent||e.origin!==appOrigin)return;
      if(e.data?.type==='dock-list-assets'){send({type:'dock-assets',names:getStaticFiles().map(file=>file.name)});return}
      if(e.data?.type!=='dock-frame')return;
      userSeeking.current=false;
      if(Number.isInteger(e.data.frame))seek(e.data.frame);
    };
    window.addEventListener('pointerdown',input,true);
    window.addEventListener('pointermove',drag,true);
    window.addEventListener('keydown',key,true);
    window.addEventListener('message',receive);
    send({type:'dock-ready'});
    return ()=>{window.removeEventListener('pointerdown',input,true);window.removeEventListener('pointermove',drag,true);window.removeEventListener('keydown',key,true);window.removeEventListener('message',receive)};
  },[]);
  useEffect(()=>{if(userSeeking.current)send({type:'dock-scrub',frame})},[frame]);
  return null;
}
function PackView(){return <>{docked&&<DockClock/>}<BenchPack/></>}
function ActionsView({review}:{review:boolean}){return <>{docked&&<DockClock/>}<ActionStrip review={review}/></>}
function ExposureView({study}:{study:ExposureStudy}){return <>{docked&&<DockClock/>}<CastExposure study={study}/></>}
function Root(){
  const [project,setProject]=useState(DEFAULT_VIDEO_PROPS);
  useEffect(()=>{
    function receive(e:MessageEvent){if(e.source===window.parent&&e.origin===appOrigin&&['rehearsal-piece','dock-project'].includes(e.data?.type))setProject(e.data.project)}
    window.addEventListener('message',receive);send({type:docked?'dock-ready':'rehearsal-ready'});
    return ()=>window.removeEventListener('message',receive);
  },[]);
  return <CurrentProject.Provider value={project}>
    <Composition id="Rehearsal" component={Stage} width={compositionDimensions(project.aspect).width} height={compositionDimensions(project.aspect).height} fps={project.fps} durationInFrames={Math.max(1,totalDurationFrames(project))} defaultProps={{}}/>
    <Composition id="Cue-Bench-Pack" component={PackView} width={1280} height={720} fps={24} durationInFrames={2*cycleLength}/>
    {exposureCatalog.map(study=><Composition key={study.id} id={study.id} component={ExposureView} width={960} height={720} fps={24} durationInFrames={study.count*study.hold} defaultProps={{study}}/>)}
    <Composition id="Neon-Actions" component={ActionsView} width={820} height={680} fps={24} durationInFrames={720} defaultProps={{review:true}}/>
  </CurrentProject.Provider>;
}
registerRoot(Root);
