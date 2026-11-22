import {NeonMesh,pose} from './NeonActions';
import React, {useLayoutEffect, useRef} from 'react';
import {AbsoluteFill,  Img, Sequence, interpolate,  staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import * as THREE from 'three';

const W = 1280, H = 720;
const track = (frame: number, keys: number[], values: number[]) =>
  interpolate(frame, keys, values, {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
const ease = (v: number) => v*v*(3-2*v);
const blend = (a: number,b: number,t: number) => a+(b-a)*t;

function useActingFrame(){
  const frame=useCurrentFrame();
  return frame*24/useVideoConfig().fps;
}

function motion(frame: number) {
  const angle = track(frame,[0,20,40,51,59,66,84,112,149],[12,18,-12,-19,57,76,66,52,46]);
  const rad = angle*Math.PI/180;
  const hand = {x:840-137*Math.sin(rad), y:360+137*Math.cos(rad)};
  const release = ease(track(frame,[53,78],[0,1]));
  const snag = track(frame,[80,87,92,101,112],[0,1,.68,.18,0]);
  const end = {x:blend(hand.x-22,230,release), y:blend(hand.y+63,610,release)-48*Math.sin(Math.PI*release)};
  return {angle,hand,end,release,snag};
}

function Cable() {
  const frame = useActingFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<THREE.WebGLRenderer|null>(null);
  useLayoutEffect(() => {
    const renderer = new THREE.WebGLRenderer({canvas:canvas.current!,alpha:true,antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(W,H,false);
    renderer.setClearColor(0,0);
    engine.current = renderer;
    return () => {engine.current=null; renderer.dispose();};
  },[]);
  useLayoutEffect(() => {
    const {hand,end,release,snag} = motion(frame);
    const camera = new THREE.OrthographicCamera(0,W,H,0,.1,1000);
    camera.position.z=300;
    const scene = new THREE.Scene();
    const points: THREE.Vector3[] = [];
    for(let i=0;i<=96;i++){
      const u=i/96, loop=2*Math.PI*u;
      const coil=1-release;
      // Localize the last paid-out loop at the wheel. Its ends stay on the rope.
      const around = Math.min(1,Math.max(0,(u-.73)/.24));
      const wheelLoop = around*Math.PI*2;
      const x=blend(hand.x,end.x,u)-48*Math.sin(loop)*coil
        -release*(32+snag*6)*Math.sin(wheelLoop);
      const slack=75*release*Math.sin(Math.PI*u);
      const y=Math.min(610,blend(hand.y,end.y,u)+slack+39*(1-Math.cos(loop))*coil)
        +release*(9+snag*4)*(1-Math.cos(wheelLoop))
        -snag*14*Math.exp(-Math.pow((x-290)/25,2));
      points.push(new THREE.Vector3(x,H-y,0));
    }
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),160,4.5,10,false);
    const colors:number[]=[];
    const green=new THREE.Color('#264b42'), gold=new THREE.Color('#bd9458');
    for(let i=0;i<=160;i++) for(let j=0;j<=10;j++){
      const stripe=Math.sin((i/160*(14+42*release)+j/10)*Math.PI*2);
      const c=green.clone().lerp(gold,ease(Math.max(0,stripe)));
      colors.push(c.r,c.g,c.b);
    }
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8});
    scene.add(new THREE.Mesh(geometry,material),new THREE.AmbientLight(0xffffff,1.25));
    const light=new THREE.DirectionalLight(0xffedd2,2.1);
    light.position.set(-250,600,450); scene.add(light);
    engine.current!.render(scene,camera);
    geometry.dispose(); material.dispose();
  },[frame]);
  return <canvas ref={canvas} width={W} height={H} style={{position:'absolute',inset:0}}/>;
}

function Part({name,x,y,w,style}: {name:string;x:number;y:number;w:number;style?:React.CSSProperties}){
  return <Img src={staticFile('rehearsal/cue-stage/'+name+'.png')} style={{position:'absolute',left:x,top:y,width:w,...style}}/>;
}

export function Cue({arm,head,mouth=0}:{arm?:number;head?:number;mouth?:number}){
  const frame=useActingFrame();
  const angle=arm??motion(frame).angle;
  const nod=head??track(frame,[0,24,48,60,82,107,149],[0,3,7,-6,-3,2,0]);
  return <>
    <Part name="wooden-peg" x={894} y={442} w={50}/>
    <Part name="leather-boot" x={824} y={449} w={62}/>
    <div style={{position:'absolute',left:840,top:360,transformOrigin:'0 0',transform:'rotate('+angle+'deg)'}}>
      <Part name="casting-arm" x={-23} y={-6} w={59}/>
      <Part name="casting-mitt" x={-23} y={86} w={42}/>
    </div>
    <Part name="grip-arm" x={928} y={356} w={53} style={{transform:'rotate(-12deg)'}}/>
    <Part name="grip-mitt" x={951} y={443} w={36}/>
    <Part name="chest-crt" x={826} y={352} w={119}/>
    <div style={{position:"absolute",left:783,top:187,width:201,height:174,transformOrigin:'50% 90%',transform:'rotate('+nod+'deg)'}}>
      <Part name="housing" x={0} y={0} w={201}/>
      <svg viewBox="0 0 236 204" width="201" height="174" style={{position:'absolute',inset:0}}><path d={`M 98 162 Q 117 179 138 162 Q 119 ${176+20*mouth} 98 162`} fill="#563118" opacity={mouth}/></svg>
    </div>
  </>;
}

function Neon({mouth}: {mouth:number}){
  const frame=useActingFrame();
  const source=Math.round(Math.min(95,Math.max(0,frame-54)));
  const {snag}=motion(frame);
  const p=pose('idle',0);p.source=source;p.wheel=15*snag;p.tilt=-.08*snag;
  p.rose=mouth;p.cyan=mouth;
  return <NeonMesh p={p} left={168} top={120} width={352}/>;
}

function Plug(){
  const {end,release}=motion(useActingFrame());
  return <Part name="plug" x={end.x-13} y={end.y-2} w={26} style={{transformOrigin:'50% 2%',transform:'rotate('+95*release+'deg)'}}/>;
}
export function Duet({mouth=0,neonMouth=0}:{mouth?:number;neonMouth?:number}){
  return <AbsoluteFill style={{background:'#25180f'}}>
    <Img src={staticFile('rehearsal/cue-stage/stage.png')} style={{position:'absolute',inset:0,width:'100%'}}/>
    {[{left:232,width:148},{left:800,width:174}].map(({left,width})=>
      <div key={left} style={{position:'absolute',left,top:594,width,height:25,borderRadius:'50%',background:'radial-gradient(ellipse,rgba(49,19,5,.48),transparent 70%)'}}/>
    )}
    <Sequence name="Neon · step and recover"><Neon mouth={neonMouth}/></Sequence>
    <Sequence name="Cue · gather and cast"><Cue mouth={mouth}/></Sequence>
    <Sequence name="Braided cord · WebGL"><Cable/></Sequence>
    <Sequence name="Plug · floor contact"><Plug/></Sequence>

  </AbsoluteFill>;
}
