import {useEffect,useMemo,useRef,useState} from 'react';
import {PortableStage} from './PortableStage';
import {useMoppet} from '../choir/store';
import {buildVideoProject} from '../choir/videoProject';
import {pause,play,seek,useEnsemble} from '../choir/ensemble';
import {useAudio} from '../audio/audio';

export function RehearsalStage({cameraFollow}:{cameraFollow:boolean}){
  const piece=useMoppet(s=>s.piece), voices=useMoppet(s=>s.voices), studio404=useMoppet(s=>s.studio404);
  const project=useMemo(()=>{
    const p=buildVideoProject(piece,voices,studio404);
    return {...p,fps:24,cameraAutoFollow:cameraFollow,intro:{...p.intro,enabled:false},outro:{...p.outro,enabled:false}};
  },[piece,voices,studio404,cameraFollow]);
  const iframe=useRef<HTMLIFrameElement>(null);
  const [origin,setOrigin]=useState(''),[available,setAvailable]=useState(true);
  const frame=useRef(0),rolling=useRef(false);
  useEffect(()=>{
    if(!import.meta.env.DEV){setAvailable(false);return}
    let mounted=true;
    fetch('/__rehearsal/studio',{method:'POST'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(({port})=>{
      if(mounted)setOrigin(location.protocol+'//'+location.hostname+':'+port);
    }).catch(()=>{if(mounted)setAvailable(false)});
    return ()=>{mounted=false};
  },[]);
  useEffect(()=>{
    if(!origin)return;
    const send=(msg:Record<string,unknown>)=>iframe.current?.contentWindow?.postMessage(msg,origin);
    const update=()=>send({type:'rehearsal-piece',project});
    update();
    function receive(e:MessageEvent){
      if(e.source!==iframe.current?.contentWindow||e.origin!==origin)return;
      if(e.data?.type==='rehearsal-ready'){update();return}
      if(e.data?.type!=='rehearsal-clock')return;
      const st=useEnsemble.getState();
      if(e.data.playing!==rolling.current){
        rolling.current=e.data.playing;
        if(rolling.current && ['idle','paused'].includes(st.status))void play(useAudio.getState().start,e.data.frame/24);
        if(!rolling.current && ['playing','buffering'].includes(st.status))pause();
      } else if(Math.abs(frame.current-e.data.frame)>2 && Math.abs(st.time*24-e.data.frame)>3)seek(e.data.frame/24);
      frame.current=e.data.frame;
    }
    window.addEventListener('message',receive);
    const unsub=useEnsemble.subscribe((st,prev)=>{
      if(st.status=== 'playing' && prev.status!=='playing'&&!rolling.current)send({type:'rehearsal-play'});
      if(['paused','idle','preparing','rendering'].includes(st.status)&&prev.status!==st.status&&rolling.current)send({type:'rehearsal-pause'});
      const next=Math.round(st.time*24);
      if(st.time!==prev.time&&Math.abs(next-frame.current)>3)send({type:'rehearsal-seek',frame:next});
    });
    return ()=>{unsub();window.removeEventListener('message',receive)};
  },[origin,project]);
  if(!available)return <PortableStage project={project}/>;
  return <div className="rehearsal-editor">{origin?<iframe title="Remotion rehearsal editor" ref={iframe} src={origin+'/Rehearsal'} allow="autoplay; clipboard-write" referrerPolicy="origin"/>:<p>Opening rehearsal stage…</p>}</div>;
}
