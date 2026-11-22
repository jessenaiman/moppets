import type React from 'react';
import {Img, staticFile} from 'remotion';

function Part({name,x,y,w,style}: {name:string;x:number;y:number;w:number;style?:React.CSSProperties}){
  return <Img src={staticFile('rehearsal/cue-stage/'+name+'.png')} style={{position:'absolute',left:x,top:y,width:w,maxWidth:"none",...style}}/>;
}

export function Cue({arm,head,mouth=0}:{arm:number;head:number;mouth?:number}){
  return <>
    <Part name="wooden-peg" x={894} y={442} w={50}/>
    <Part name="leather-boot" x={824} y={449} w={62}/>
    <div style={{position:'absolute',left:840,top:360,transformOrigin:'0 0',transform:'rotate('+arm+'deg)'}}>
      <Part name="casting-arm" x={-23} y={-6} w={59}/>
      <Part name="casting-mitt" x={-23} y={86} w={42}/>
    </div>
    <Part name="grip-arm" x={928} y={356} w={53} style={{transform:'rotate(-12deg)'}}/>
    <Part name="grip-mitt" x={951} y={443} w={36}/>
    <Part name="chest-crt" x={826} y={352} w={119}/>
    <div style={{position:"absolute",left:783,top:187,width:201,height:174,transformOrigin:'50% 90%',transform:'rotate('+head+'deg)'}}>
      <Part name="housing" x={0} y={0} w={201}/>
      <svg viewBox="0 0 236 204" width="201" height="174" style={{position:'absolute',inset:0}}><path d={`M 98 162 Q 117 179 138 162 Q 119 ${176+20*mouth} 98 162`} fill="#563118" opacity={mouth}/></svg>
    </div>
  </>;
}
