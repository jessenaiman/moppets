import {exposureCatalog} from '../rehearsal/CastExposure';
import {useEffect, useRef, useState, type RefObject} from 'react';
import type {PlayerRef} from '@remotion/player';
import type {MoppetVideoProps} from '../choir/videoProject';

export const compositions = ['Rehearsal', 'Cue-Bench-Pack', 'Neon-Actions', ...exposureCatalog.map(s=>s.id)] as const;
export type StudioComposition = typeof compositions[number];

export function RemotionDock({project, playerRef, composition, setComposition, onSeek, onToggle}:{
  project:MoppetVideoProps; playerRef:RefObject<PlayerRef|null>; composition:StudioComposition;
  setComposition:(id:StudioComposition)=>void;
  onSeek?: (frame: number) => void;
  onToggle?: () => void;
}){
  const frame = useRef<HTMLIFrameElement>(null);
  const [origin,setOrigin] = useState('');
  const [library,setLibrary] = useState<'compositions'|'assets'>('compositions');
  const [search,setSearch] = useState('');
  const [files,setFiles] = useState<string[]>([]);
  const matches = (name:string)=>name.toLowerCase().includes(search.toLowerCase());
  const latest = useRef({project,onSeek,onToggle});
  latest.current = {project,onSeek,onToggle};
  useEffect(()=>{
    if(!import.meta.env.DEV)return;
    let mounted=true;
    fetch('/__rehearsal/studio',{method:'POST'}).then(async response=>{
      if(!response.ok)return;
      const {port}=await response.json();
      if(mounted)setOrigin(location.protocol+'//'+location.hostname+':'+port);
    }).catch(()=>{});
    return ()=>{mounted=false};
  },[]);
  useEffect(()=>{
    if(!origin)return;
    const send=(message:object)=>frame.current?.contentWindow?.postMessage(message,origin);
    const syncProject=()=>send({type:'dock-project',project:latest.current.project});
    const player=playerRef.current;
    const syncFrame=()=>send({type:'dock-frame',frame:player?.getCurrentFrame()??0});
    function receive(event:MessageEvent){
      if(event.origin!==origin||event.source!==frame.current?.contentWindow)return;
      if(event.data?.type==='dock-ready'){syncProject();syncFrame();send({type:'dock-list-assets'})}
      if(event.data?.type==='dock-assets' && Array.isArray(event.data.names))setFiles(event.data.names);
      if(event.data?.type==='dock-scrub'&&Number.isInteger(event.data.frame)){
        if(latest.current.onSeek)latest.current.onSeek(event.data.frame);
        else player?.seekTo(event.data.frame);
      }
      if(event.data?.type==='dock-toggle'){
        if(latest.current.onToggle)latest.current.onToggle();
        else player?.toggle();
      }
    }
    window.addEventListener('message',receive);
    player?.addEventListener('frameupdate',syncFrame);
    syncProject();
    return ()=>{window.removeEventListener('message',receive);player?.removeEventListener('frameupdate',syncFrame)};
  },[origin,playerRef,composition]);
  useEffect(()=>{
    if(origin)frame.current?.contentWindow?.postMessage({type:'dock-project',project},origin);
  },[project,origin]);
  return <section className="studio-dock" aria-label="Remotion editor">
    <aside className="studio-compositions" aria-label="Editor library">
      <div className="studio-library-tabs" role="group" aria-label="Library category">
        <button aria-pressed={library==='compositions'} onClick={()=>{setLibrary('compositions');setSearch('')}}>Compositions</button>
        {origin&&<button aria-pressed={library==='assets'} onClick={()=>{setLibrary('assets');setSearch('')}}>Assets</button>}
      </div>
      <input type="search" aria-label={'Search '+library} placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="studio-library-list">
      {library==='assets' ? files.filter(matches).map(name=><a key={name} title={'Download '+name} href={'/'+name.split('/').map(encodeURIComponent).join('/')} download>{name}</a>) : compositions.filter(id=>matches(id.replaceAll('-',' '))).map(id=><button key={id} type="button" aria-pressed={id===composition}
        onClick={()=>{if(id!==composition)setComposition(id)}}>{id.replaceAll('-',' ')}</button>)}
      </div>
    </aside>
    {origin?<iframe key={composition} ref={frame} title="Remotion timeline" referrerPolicy="origin"
      src={origin+'/'+composition+'?panel=timeline'}/>:<p className="vs-meta">Use the time ruler and clip tracks below to edit this composition.</p>}
  </section>;
}
