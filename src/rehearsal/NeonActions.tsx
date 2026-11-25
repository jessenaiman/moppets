import React, { useEffect, useMemo, useState } from "react";
import { ThreeCanvas } from "@remotion/three";
import {
  ClampToEdgeWrapping,
  LinearFilter,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector4,
} from "three";
import { AbsoluteFill, staticFile, useCurrentFrame, useDelayRender } from "remotion";

export const actions = [
  "idle",
  "listen",
  "look-down",
  "nod",
  "sing",
  "offer",
  "wave",
  "bow",
  "walk-left",
  "walk-right",
  "jump",
  "step-over",
  "caster-snag",
  "release",
  "scarf-adjust",
] as const;
export type Action = (typeof actions)[number];

const smooth = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c * c * (3 - 2 * c);
};
const pulse = (t: number) => Math.sin(Math.PI * smooth(t));

export function pose(action: Action, t: number) {
  const weight = pulse(t);
  const cycle = Math.sin(t * Math.PI * 4) * weight;
  const p = { source: 0, tilt: 0, arm: 0, boot: 0, wheel: 0, lift: 0, squash: 0, shift: 0, cyan: 0, rose: 0 };
  switch (action) {
    case "idle":
      p.squash = 1.6 * weight;
      break;
    case "listen":
      p.tilt = -0.12 * weight;
      p.arm = 0.1 * weight;
      break;
    case "look-down":
      p.source = Math.round(24 * weight);
      break;
    case "nod":
      p.tilt = 0.12 * Math.sin(2 * Math.PI * t) * weight;
      p.squash = 3 * weight;
      break;
    case "sing":
      p.arm = 0.32 * weight;
      p.tilt = -0.07 * weight;
      p.cyan = 0.8 * weight;
      p.rose = 0.6 * weight;
      break;
    case "offer":
      p.arm = 0.95 * weight;
      p.tilt = -0.08 * weight;
      break;
    case "wave":
      p.arm = (1.5 + 0.2 * Math.sin(6 * Math.PI * t)) * weight;
      break;
    case "bow":
      p.tilt = 0.26 * weight;
      p.squash = 21 * weight;
      p.arm = -0.16 * weight;
      break;
    case "walk-left":
    case "walk-right": {
      const direction = action === "walk-left" ? -1 : 1;
      p.boot = direction * cycle * 20;
      p.wheel = -direction * cycle * 15;
      p.lift = 5 * Math.abs(cycle);
      p.tilt = 0.04 * cycle;
      p.arm = -0.15 * cycle;
      break;
    }
    case "jump": {
      const flight = pulse(Math.max(0, Math.min(1, (t - 0.25) / 0.5)));
      p.lift = 70 * flight;
      p.squash = 15 * (pulse(Math.min(1, t / 0.25)) + pulse(Math.max(0, (t - 0.75) / 0.25)));
      p.arm = 0.7 * flight;
      p.boot = 10 * flight;
      break;
    }
    case "step-over":
      p.source = Math.round(60 * smooth(t));
      if (t > 0.7) p.source = Math.round(60 * (1 - smooth((t - 0.7) / 0.3)));
      break;
    case "caster-snag":
      p.wheel = 16 * pulse(t);
      p.tilt = -0.13 * weight;
      p.source = Math.round(36 * weight);
      break;
    case "release":
      p.wheel = -16 * weight;
      p.tilt = 0.09 * weight;
      p.boot = 7 * weight;
      break;
    case "scarf-adjust":
      p.source = Math.round(60 + 35 * smooth(t));
      if (t < 0.25) p.source = Math.round(60 * smooth(t / 0.25));
      if (t > 0.76) p.source = Math.round(95 * (1 - smooth((t - 0.76) / 0.24)));
      break;
  }
  return p;
}
export type NeonPose = ReturnType<typeof pose>;

const vertex = `
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

const fragment = `
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

const neonSheetCache = new Map<string, Texture>();
const neonLoader = new TextureLoader();

function useNeonSheets(): readonly (Texture | undefined)[] {
  const { delayRender, continueRender } = useDelayRender();
  const urls = useMemo(() => [0, 1, 2, 3].map((i) => staticFile(`rehearsal/actions/neon/neon-${i}.webp`)), []);
  const [, setReady] = useState(0);

  useEffect(() => {
    const missing = urls.filter((u) => !neonSheetCache.has(u));
    if (missing.length === 0) return;
    let alive = true;
    const handle = delayRender("Loading Neon action sheets");
    void Promise.all(
      missing.map(
        (u) =>
          new Promise<void>((resolve) => {
            neonLoader.load(
              u,
              (tx) => {
                tx.colorSpace = SRGBColorSpace;
                tx.generateMipmaps = false;
                tx.minFilter = LinearFilter;
                tx.magFilter = LinearFilter;
                tx.wrapS = ClampToEdgeWrapping;
                tx.wrapT = ClampToEdgeWrapping;
                tx.needsUpdate = true;
                neonSheetCache.set(u, tx);
                resolve();
              },
              undefined,
              () => resolve(),
            );
          }),
      ),
    ).finally(() => {
      if (alive) setReady((v) => v + 1);
      continueRender(handle);
    });
    return () => {
      alive = false;
      continueRender(handle);
    };
  }, [urls, delayRender, continueRender]);

  return urls.map((u) => neonSheetCache.get(u));
}

function NeonRigPlane({ p, sheets }: { p: NeonPose; sheets: readonly (Texture | undefined)[] }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          sheet: { value: null as Texture | null },
          cell: { value: new Vector2() },
          controls: { value: new Vector4() },
          feet: { value: new Vector4() },
          light: { value: new Vector2() },
        },
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);

  const n = Math.max(0, Math.min(95, Math.round(p.source)));
  const sheetTex = sheets[Math.floor(n / 24)];
  if (!sheetTex) return null;

  const cell = n % 24;
  material.uniforms.sheet.value = sheetTex;
  material.uniforms.cell.value.set(cell % 6, Math.floor(cell / 6));
  material.uniforms.controls.value.set(p.tilt, p.arm, p.squash, 0);
  material.uniforms.feet.value.set(p.wheel, p.boot, p.lift, 0);
  material.uniforms.light.value.set(p.cyan, p.rose);

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[400, 600, 48, 72]} />
    </mesh>
  );
}

export function NeonMesh({ p, left, top, width }: { p: NeonPose; left: number; top: number; width: number }) {
  const sheets = useNeonSheets();
  const scale = width / 400;
  return (
    <div style={{ position: "absolute", left: left - 35 * scale, top: top - 40 * scale, width: 470 * scale, height: 680 * scale }}>
      <ThreeCanvas
        width={470}
        height={680}
        orthographic
        camera={{ position: [0, 0, 10], zoom: 1, near: 0.1, far: 100 }}
        style={{ width: "100%", height: "100%" }}
      >
        <NeonRigPlane p={p} sheets={sheets} />
      </ThreeCanvas>
    </div>
  );
}

export function ActionStrip({ review = false }: { review?: boolean }) {
  const f = useCurrentFrame();
  const i = Math.min(actions.length - 1, Math.floor(f / 48));
  const t = (f % 48) / 47;
  return (
    <AbsoluteFill style={{ background: review ? "#202324" : "transparent" }}>
      <NeonMesh p={pose(actions[i], t)} left={210} top={46} width={400} />
      {review && (
        <div style={{ position: "absolute", bottom: 24, width: "100%", textAlign: "center", font: "25px Georgia", color: "#ecdfc2" }}>
          {actions[i].replaceAll("-", " ")}
        </div>
      )}
    </AbsoluteFill>
  );
}
