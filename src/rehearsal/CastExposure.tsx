import {AbsoluteFill,Img,Sequence,staticFile} from 'remotion';
import catalog from './exposure-catalog.json';

export const exposureCatalog=catalog;
export type ExposureStudy=typeof catalog[number];

export function CastExposure({study}:{study:ExposureStudy}){
  const {count,hold,width,height,slug}=study;
  const scale=Math.min(520/width,620/height);
  return <AbsoluteFill style={{background:'#292521',alignItems:'center',justifyContent:'center'}}>
    <div style={{position:'relative',width:width*scale,height:height*scale,overflow:'hidden'}}>
      {Array.from({length:count},(_,cell)=><Sequence key={cell} from={cell*hold} durationInFrames={hold} name={slug+' · pose '+(cell+1)}>
        <Img src={staticFile('rehearsal/exposure-keys/'+slug+'.webp')} style={{position:'absolute',maxWidth:'none',width:8*width*scale,left:-(cell%8)*width*scale,top:-Math.floor(cell/8)*height*scale}}/>
      </Sequence>)}
    </div>
  </AbsoluteFill>;
}
