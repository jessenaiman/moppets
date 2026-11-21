import { AbsoluteFill, useVideoConfig } from "remotion";

export function StageFit({children}:{children:React.ReactNode}){
  const {width,height}=useVideoConfig();
  return <AbsoluteFill style={{background:"#160e0c",alignItems:"center",justifyContent:"center"}}>
    <div style={{width:1280,height:720,flexShrink:0,position:"relative",transform:`scale(${Math.min(width/1280,height/720)})`}}>{children}</div>
  </AbsoluteFill>;
}
