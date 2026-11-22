import React,{useLayoutEffect,useRef} from 'react';
import {AbsoluteFill,Img,staticFile,useCurrentFrame} from 'remotion';
import * as THREE from 'three';

export const actions=['idle','listen','look-down','nod','sing','offer','wave','bow','walk-left','walk-right','jump','step-over','caster-snag','release','scarf-adjust'] as const;
export type Action=typeof actions[number];
const smooth=(v:number)=>{v=Math.min(1,Math.max(0,v));return v*v*(3-2*v)};
const pulse=(t:number)=>Math.sin(Math.PI*smooth(t));
export function pose(action:Action,t:number){
  const weight=pulse(t),cycle=Math.sin(t*Math.PI*4)*weight;
  const p={source:0,tilt:0,arm:0,boot:0,wheel:0,lift:0,squash:0,shift:0,cyan:0,rose:0};
  switch(action){
    case 'idle':p.squash=1.6*weight;break;
    case 'listen':p.tilt=-.12*weight;p.arm=.10*weight;break;
    case 'look-down':p.source=Math.round(24*weight);break;
    case 'nod':p.tilt=.12*Math.sin(2*Math.PI*t)*weight;p.squash=3*weight;break;
    case 'sing':p.arm=.32*weight;p.tilt=-.07*weight;p.cyan=.8*weight;p.rose=.6*weight;break;
    case 'offer':p.arm=.95*weight;p.tilt=-.08*weight;break;
    case 'wave':p.arm=(1.5+.20*Math.sin(6*Math.PI*t))*weight;break;
    case 'bow':p.tilt=.26*weight;p.squash=21*weight;p.arm=-.16*weight;break;
    case 'walk-left':case 'walk-right':{
      const direction=action==='walk-left'?-1:1;
      p.boot=direction*cycle*20;p.wheel=-direction*cycle*15;p.lift=5*Math.abs(cycle);p.tilt=.04*cycle;p.arm=-.15*cycle;break;
    }
    case 'jump':{
      const flight=pulse(Math.max(0,Math.min(1,(t-.25)/.5)));
      p.lift=70*flight;p.squash=15*(pulse(Math.min(1,t/.25))+pulse(Math.max(0,(t-.75)/.25)));
      p.arm=.7*flight;p.boot=10*flight;break;
    }
    case 'step-over':p.source=Math.round(60*smooth(t));if(t>.7)p.source=Math.round(60*(1-smooth((t-.7)/.3)));break;
    case 'caster-snag':p.wheel=16*pulse(t);p.tilt=-.13*weight;p.source=Math.round(36*weight);break;
    case 'release':p.wheel=-16*weight;p.tilt=.09*weight;p.boot=7*weight;break;
    case 'scarf-adjust':p.source=Math.round(60+35*smooth(t));if(t<.25)p.source=Math.round(60*smooth(t/.25));if(t>.76)p.source=Math.round(95*(1-smooth((t-.76)/.24)));break;
  }
  return p;
}
export type NeonPose=ReturnType<typeof pose>;

// A continuous image mesh keeps fabric joined at the cuffs and knees. The caster
// has its own local travel around the axle, independent of the planted boot.
const vertex=`
uniform vec4 controls; uniform vec4 feet; varying vec2 uvLocal;
vec2 rotatePoint(vec2 p,vec2 pivot,float a){
  vec2 d=p-pivot;return pivot+vec2(cos(a)*d.x-sin(a)*d.y,sin(a)*d.x+cos(a)*d.y);
}
void main(){
 uvLocal=vec2(uv.x,1.-uv.y);
 vec2 p=uvLocal*vec2(400.,600.);vec2 base=p;
 float head=1.-smoothstep(185.,265.,base.y);
 p=mix(p,rotatePoint(p,vec2(181.,229.),controls.x),head);
 float arm=smoothstep(205.,260.,base.x)*smoothstep(248.,310.,base.y)*(1.-smoothstep(405.,431.,base.y));
 p=mix(p,rotatePoint(p,vec2(232.,266.),-controls.y),arm);
 float low=smoothstep(396.,512.,base.y);
 float right=smoothstep(161.,184.,base.x);
 p.x+=low*mix(feet.x,feet.y,right);p.y-=low*right*abs(feet.y)*.60;
 p.y+=controls.z*(1.-smoothstep(225.,545.,base.y))-feet.z;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p.x-200.,300.-p.y,0.,1.);
}`;
const fragment=`
uniform sampler2D sheet;uniform vec2 cell;uniform vec2 light;varying vec2 uvLocal;
void main(){
 if(uvLocal.y>.930) discard;
 vec2 uv=(cell+clamp(uvLocal,vec2(.001),vec2(.999)))/vec2(6.,4.);
 vec4 c=texture2D(sheet,vec2(uv.x,1.-uv.y));
 float cyan=smoothstep(.13,.50,c.g-c.r)*smoothstep(.22,.55,c.b);
 float rose=smoothstep(.15,.50,c.r-c.g)*smoothstep(.14,.50,c.b);
 c.rgb+=vec3(.04,.38,.40)*cyan*light.x+vec3(.42,.05,.18)*rose*light.y;
 gl_FragColor=c;
 #include <colorspace_fragment>
}`;
export function NeonMesh({p,left,top,width}:{p:NeonPose;left:number;top:number;width:number}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const renderer=useRef<THREE.WebGLRenderer|null>(null);
  const scene=useRef(new THREE.Scene()).current;
  const camera=useRef(new THREE.OrthographicCamera(-235,235,340,-340,0.1,100)).current;
  const images=useRef<(HTMLImageElement|null)[]>([]);
  const textures=useRef<(THREE.Texture|null)[]>([]);
  const material=React.useMemo(()=>new THREE.ShaderMaterial({transparent:true,vertexShader:vertex,fragmentShader:fragment,uniforms:{
    sheet:{value:null},cell:{value:new THREE.Vector2()},controls:{value:new THREE.Vector4()},feet:{value:new THREE.Vector4()},light:{value:new THREE.Vector2()}
  }}),[]);
  const draw=()=>{
    const n=Math.round(p.source),sheet=Math.floor(n/24),cell=n%24;
    const img=images.current[sheet];if(!renderer.current||!img?.complete||!img.naturalWidth)return;
    if(!textures.current[sheet]){const tx=new THREE.Texture(img);tx.colorSpace=THREE.SRGBColorSpace;tx.needsUpdate=true;textures.current[sheet]=tx}
    const u=material.uniforms;
    u.sheet.value=textures.current[sheet];u.cell.value.set(cell%6,Math.floor(cell/6));
    u.controls.value.set(p.tilt,p.arm,p.squash,0);u.feet.value.set(p.wheel,p.boot,p.lift,0);u.light.value.set(p.cyan,p.rose);
    renderer.current.render(scene,camera);
  };
  useLayoutEffect(()=>{
    const r=new THREE.WebGLRenderer({canvas:canvas.current!,alpha:true,antialias:true,preserveDrawingBuffer:true});
    r.setSize(470,680,false);r.setClearColor(0,0);renderer.current=r;camera.position.z=10;
    const g=new THREE.PlaneGeometry(400,600,48,72);const mesh=new THREE.Mesh(g,material);mesh.frustumCulled=false;scene.add(mesh);
    return ()=>{scene.remove(mesh);g.dispose();material.dispose();textures.current.forEach(tx=>tx?.dispose());textures.current=[];r.dispose();renderer.current=null;};
  },[scene,camera,material]);
  useLayoutEffect(draw);
  const scale=width/400;
  return <>
    {[0,1,2,3].map(i=><Img key={i} ref={el=>{images.current[i]=el}} onLoad={draw} src={staticFile('rehearsal/actions/neon/neon-'+i+'.webp')} style={{display:'none'}}/>)}
    <canvas ref={canvas} style={{position:'absolute',left:left-35*scale,top:top-40*scale,width:470*scale,height:680*scale}}/>
  </>;
}
export function ActionStrip({review=false}:{review?:boolean}){
  const f=useCurrentFrame(),i=Math.min(actions.length-1,Math.floor(f/48)),t=(f%48)/47;
  return <AbsoluteFill style={{background:review?'#202324':'transparent'}}>
    <NeonMesh p={pose(actions[i],t)} left={210} top={46} width={400}/>
    {review&&<div style={{position:'absolute',bottom:24,width:'100%',textAlign:'center',font:'25px Georgia',color:'#ecdfc2'}}>{actions[i].replaceAll('-',' ')}</div>}
  </AbsoluteFill>;
}
