import {Player,type PlayerRef} from '@remotion/player';
import {useEffect,useRef} from 'react';
import {MoppetComposition} from '../remotion/MoppetComposition';
import {totalDurationFrames,type MoppetVideoProps} from '../choir/videoProject';
import {useEnsemble} from '../choir/ensemble';

// The main transport owns the audio clock on hosts without a writable Studio.
export function PortableStage({project}:{project:MoppetVideoProps}){
  const player=useRef<PlayerRef>(null);
  useEffect(()=>{
    const update=()=>player.current?.seekTo(Math.min(totalDurationFrames(project)-1,Math.max(0,Math.round(useEnsemble.getState().time*24))));
    update();return useEnsemble.subscribe(update);
  },[project]);
  return <Player className="portable-rehearsal" ref={player} component={MoppetComposition} inputProps={project} durationInFrames={Math.max(1,totalDurationFrames(project))} fps={24} compositionWidth={1280} compositionHeight={720} style={{width:'100%'}}/>;
}
