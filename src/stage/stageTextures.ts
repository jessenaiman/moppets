/**
 * Procedural PBR textures, GLSL shaders, and shared texture cache for the Three.js Studio 404 stage.
 *
 * Follows `threejs-procedural-materials` & Studio 404 Location Bible v3:
 *  - Bare scuffed dark-walnut / broadcast concrete floor with gaffer spike marks (Zero Persian Rug Lock)
 *  - Beveled oak riser deck planks
 *  - Ribbed acoustic charcoal studio wall & pleated velvet specular variation
 *  - Live CRT rack monitor oscilloscope phosphor texture
 *  - Sunlit birch floorboards & pastel pegboard for Playroom world
 *  - Procedural FBM GLSL Nebula Dome for Cosmic Observatory world
 */
import * as THREE from "three";

const texCache = new Map<string, THREE.Texture>();
const texPending = new Map<string, Promise<THREE.Texture | null>>();
const sharedTexLoader = new THREE.TextureLoader();

export function getCachedStageTexture(url: string): THREE.Texture | undefined {
  return texCache.get(url);
}

export function loadStageTexture(url: string, onLoaded?: () => void): THREE.Texture | undefined {
  const hit = texCache.get(url);
  if (hit) return hit;
  if (!texPending.has(url)) {
    const p = new Promise<THREE.Texture | null>((resolve) => {
      sharedTexLoader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.generateMipmaps = false;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.needsUpdate = true;
          texCache.set(url, tex);
          texPending.delete(url);
          onLoaded?.();
          resolve(tex);
        },
        undefined,
        () => {
          texPending.delete(url);
          resolve(null);
        },
      );
    });
    texPending.set(url, p);
  } else if (onLoaded) {
    void texPending.get(url)?.then(() => onLoaded());
  }
  return undefined;
}

export function createSoftGlowTexture(
  inner: string,
  mid: string,
  outer = "rgba(0,0,0,0)",
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 126);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, mid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createFresnelConeTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, 256, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "rgba(255, 224, 162, 0.28)");
  grad.addColorStop(0.42, "rgba(255, 206, 138, 0.11)");
  grad.addColorStop(1, "rgba(255, 190, 120, 0.0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(106, 0);
  ctx.lineTo(150, 0);
  ctx.lineTo(250, 256);
  ctx.lineTo(6, 256);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface StudioFloorTextures {
  readonly map: THREE.CanvasTexture;
  readonly roughnessMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly dispose: () => void;
}

/**
 * Bare scuffed Studio 404 hardwood/broadcast concrete floor (Zero Persian Rug Lock):
 * Rich dark-walnut studio plank deck with subtle sheen variation, cable-scuff patina, and gaffer spike marks.
 */
export function createStudio404FloorTextures(): StudioFloorTextures | null {
  if (typeof document === "undefined") return null;
  const S = 1024;
  const cMap = document.createElement("canvas");
  const cRough = document.createElement("canvas");
  const cBump = document.createElement("canvas");
  cMap.width = cRough.width = cBump.width = S;
  cMap.height = cRough.height = cBump.height = S;

  const gMap = cMap.getContext("2d");
  const gRough = cRough.getContext("2d");
  const gBump = cBump.getContext("2d");
  if (!gMap || !gRough || !gBump) return null;

  gMap.fillStyle = "#1b1411";
  gMap.fillRect(0, 0, S, S);
  gRough.fillStyle = "#a8a8a8";
  gRough.fillRect(0, 0, S, S);
  gBump.fillStyle = "#808080";
  gBump.fillRect(0, 0, S, S);

  const planks = 16;
  const ph = S / planks;
  let seed = 4041;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < planks; i++) {
    const y = i * ph;
    const tone = Math.round(24 + rand() * 14);
    const r = Math.round(tone * 1.38);
    const g = Math.round(tone * 0.98);
    const b = Math.round(tone * 0.78);
    gMap.fillStyle = `rgb(${r},${g},${b})`;
    gMap.fillRect(0, y + 1, S, ph - 2);

    const roughVal = Math.round(132 + rand() * 48);
    gRough.fillStyle = `rgb(${roughVal},${roughVal},${roughVal})`;
    gRough.fillRect(0, y + 1, S, ph - 2);

    // Subtle wood-grain fibers
    for (let s = 0; s < 5; s++) {
      const gy = y + 6 + s * ((ph - 12) / 5);
      const alpha = 0.04 + rand() * 0.06;
      gMap.strokeStyle = rand() > 0.5 ? `rgba(255,214,165,${alpha})` : `rgba(8,5,4,${alpha * 1.4})`;
      gMap.lineWidth = 1 + rand() * 1.5;
      gMap.beginPath();
      gMap.moveTo(0, gy);
      gMap.bezierCurveTo(S * 0.33, gy + (rand() - 0.5) * 6, S * 0.66, gy + (rand() - 0.5) * 6, S, gy);
      gMap.stroke();

      gBump.strokeStyle = `rgba(160,160,160,${alpha * 1.8})`;
      gBump.lineWidth = 1;
      gBump.beginPath();
      gBump.moveTo(0, gy);
      gBump.lineTo(S, gy);
      gBump.stroke();
    }

    // Plank butt joints
    const jx = Math.floor((0.18 + rand() * 0.64) * S);
    gMap.fillStyle = "rgba(6, 4, 3, 0.75)";
    gMap.fillRect(jx, y, 2, ph);
    gBump.fillStyle = "#222222";
    gBump.fillRect(jx, y, 2, ph);

    // Dark recessed plank groove
    gMap.fillStyle = "#0a0706";
    gMap.fillRect(0, y, S, 2);
    gRough.fillStyle = "#e6e6e6";
    gRough.fillRect(0, y, S, 2);
    gBump.fillStyle = "#181818";
    gBump.fillRect(0, y, S, 2);
  }

  // Subtle stage-scuff sheen patches (high-traffic performance zone)
  for (let k = 0; k < 28; k++) {
    const sx = rand() * S;
    const sy = rand() * S;
    const sr = 24 + rand() * 72;
    const rg = gRough.createRadialGradient(sx, sy, 2, sx, sy, sr);
    rg.addColorStop(0, "rgba(88,88,88,0.22)");
    rg.addColorStop(1, "rgba(88,88,88,0)");
    gRough.fillStyle = rg;
    gRough.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }

  const map = new THREE.CanvasTexture(cMap);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3.2, 2.2);
  map.anisotropy = 4;

  const roughnessMap = new THREE.CanvasTexture(cRough);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(3.2, 2.2);
  roughnessMap.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(cBump);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(3.2, 2.2);
  bumpMap.anisotropy = 4;

  return {
    map,
    roughnessMap,
    bumpMap,
    dispose: () => {
      map.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
    },
  };
}

/** Warm oak plank deck texture for the Studio 404 beveled solo/ensemble riser. */
export function createRiserOakTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const planks = 10;
  const ph = 512 / planks;
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#69452d" : "#5c3b25";
    ctx.fillRect(0, i * ph, 512, ph - 2);
    ctx.fillStyle = "#2b190f";
    ctx.fillRect(0, (i + 1) * ph - 2, 512, 2);
    ctx.strokeStyle = "rgba(240, 190, 130, 0.08)";
    ctx.lineWidth = 1.5;
    for (let g = 0; g < 3; g++) {
      ctx.beginPath();
      ctx.moveTo(0, i * ph + 10 + g * 14);
      ctx.bezierCurveTo(170, i * ph + 7 + g * 14, 340, i * ph + 13 + g * 14, 512, i * ph + 10 + g * 14);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.anisotropy = 4;
  return tex;
}

/** Ribbed acoustic studio baffle wall texture for the Studio 404 rear bay. */
export function createAcousticWallTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#141016";
  ctx.fillRect(0, 0, 512, 512);
  // Vertical acoustic wood/felt slat ribs
  const slats = 32;
  const sw = 512 / slats;
  for (let i = 0; i < slats; i++) {
    const x = i * sw;
    const grad = ctx.createLinearGradient(x, 0, x + sw, 0);
    grad.addColorStop(0, "#0b080d");
    grad.addColorStop(0.22, "#241b22");
    grad.addColorStop(0.55, "#1b141a");
    grad.addColorStop(0.88, "#120d12");
    grad.addColorStop(1, "#09060a");
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, sw, 512);
  }
  // Subtle horizontal acoustic seam rails
  ctx.fillStyle = "rgba(8, 5, 8, 0.55)";
  ctx.fillRect(0, 170, 512, 4);
  ctx.fillRect(0, 342, 512, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1.5);
  return tex;
}

/** Vintage Studio 404 rack CRT monitor phosphor texture (animated via canvas update). */
export interface RackCrtScreenTexture {
  readonly texture: THREE.CanvasTexture;
  readonly update: (timeSec: number, voiceEnergy: number) => void;
  readonly dispose: () => void;
}

export function createRackCrtScreenTexture(mode: "scope" | "bars"): RackCrtScreenTexture | null {
  if (typeof document === "undefined") return null;
  const W = 256;
  const H = 192;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  let lastBucket = -1;

  const update = (timeSec: number, voiceEnergy: number) => {
    const bucket = Math.floor(timeSec * 12);
    if (bucket === lastBucket && mode === "bars") return;
    if (bucket === lastBucket && voiceEnergy < 0.05) return;
    lastBucket = bucket;

    ctx.fillStyle = "#041112";
    ctx.fillRect(0, 0, W, H);

    if (mode === "bars") {
      const bars = ["#b8b8b8", "#c4a82a", "#26a6b8", "#2bb058", "#a83cb0", "#b83038", "#2e52b8"];
      const bw = W / bars.length;
      bars.forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.72;
        ctx.fillRect(i * bw, 12, bw, H * 0.62);
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#081418";
      ctx.fillRect(0, H * 0.72, W, H * 0.28);
      ctx.fillStyle = "#5cf2d6";
      ctx.font = "bold 18px monospace";
      ctx.fillText("STUDIO 404 · CHIMERA", 18, H - 18);
    } else {
      // Graticule grid
      ctx.strokeStyle = "rgba(62, 232, 188, 0.16)";
      ctx.lineWidth = 1;
      for (let x = 32; x < W; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 32; y < H; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      // Phosphor vocal waveform trace
      const amp = 14 + voiceEnergy * 52;
      ctx.strokeStyle = "#5ef7d8";
      ctx.shadowColor = "#20e0b8";
      ctx.shadowBlur = 10;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const u = x / W;
        const env = Math.sin(u * Math.PI);
        const y =
          H * 0.5 +
          env *
            amp *
            (Math.sin(u * 18 + timeSec * 7.5) * 0.68 +
              Math.sin(u * 39 - timeSec * 12) * 0.32);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Scanlines
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

    texture.needsUpdate = true;
  };

  update(0, 0.2);
  return { texture, update, dispose: () => texture.dispose() };
}

/** Studio 404 glowing proscenium sign texture. */
export function createStudio404SignTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0e080c";
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = "#c8964e";
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 496, 112);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '700 48px "JetBrains Mono", ui-monospace, monospace';
  ctx.shadowColor = "#ffaa44";
  ctx.shadowBlur = 22;
  ctx.fillStyle = "#ffe2a8";
  ctx.fillText("STUDIO 404", 256, 54);
  ctx.shadowColor = "#42f5d8";
  ctx.shadowBlur = 12;
  ctx.font = '600 16px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = "#7cf7e4";
  ctx.fillText("ON AIR  ·  CHIMERA LIVE STAGE", 256, 98);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createBirchFloorTexture(): THREE.CanvasTexture | null {
  return createBirchFloorTextures()?.map ?? null;
}

/** Sunlit birch plank floor textures (color map + roughness + bump) for the Playroom soundstage. */
export function createBirchFloorTextures(): StudioFloorTextures | null {
  if (typeof document === "undefined") return null;
  const S = 512;
  const cMap = document.createElement("canvas");
  const cRough = document.createElement("canvas");
  const cBump = document.createElement("canvas");
  cMap.width = cRough.width = cBump.width = S;
  cMap.height = cRough.height = cBump.height = S;

  const ctx = cMap.getContext("2d");
  const gRough = cRough.getContext("2d");
  const gBump = cBump.getContext("2d");
  if (!ctx || !gRough || !gBump) return null;

  gRough.fillStyle = "#949494";
  gRough.fillRect(0, 0, S, S);
  gBump.fillStyle = "#808080";
  gBump.fillRect(0, 0, S, S);

  const planks = 8;
  const ph = S / planks;
  let seed = 7711;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < planks; i++) {
    const y = i * ph;
    ctx.fillStyle = i % 2 === 0 ? "#dfb98a" : "#cfa676";
    ctx.fillRect(0, y, S, ph - 2);
    const rv = Math.round(115 + rand() * 36);
    gRough.fillStyle = `rgb(${rv},${rv},${rv})`;
    gRough.fillRect(0, y, S, ph - 2);

    ctx.fillStyle = "rgba(116, 78, 44, 0.24)";
    ctx.fillRect(0, (i + 1) * ph - 2, S, 2);
    gRough.fillStyle = "#dcdcdc";
    gRough.fillRect(0, (i + 1) * ph - 2, S, 2);
    gBump.fillStyle = "#242424";
    gBump.fillRect(0, (i + 1) * ph - 2, S, 2);

    ctx.strokeStyle = "rgba(148, 102, 58, 0.14)";
    ctx.lineWidth = 1.5;
    for (let g = 0; g < 4; g++) {
      const gy = y + 10 + g * 14;
      const w1 = (rand() - 0.5) * 6;
      const w2 = (rand() - 0.5) * 6;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + w1, 340, gy + w2, S, gy);
      ctx.stroke();

      gBump.strokeStyle = "rgba(154,154,154,0.22)";
      gBump.lineWidth = 1;
      gBump.beginPath();
      gBump.moveTo(0, gy);
      gBump.bezierCurveTo(170, gy + w1, 340, gy + w2, S, gy);
      gBump.stroke();
    }

    const jx = Math.floor((0.15 + rand() * 0.7) * S);
    ctx.fillStyle = "rgba(116, 78, 44, 0.28)";
    ctx.fillRect(jx, y, 2, ph);
    gBump.fillStyle = "#2c2c2c";
    gBump.fillRect(jx, y, 2, ph);
  }

  const map = new THREE.CanvasTexture(cMap);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(5, 2.5);
  map.anisotropy = 4;

  const roughnessMap = new THREE.CanvasTexture(cRough);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(5, 2.5);
  roughnessMap.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(cBump);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(5, 2.5);
  bumpMap.anisotropy = 4;

  return {
    map,
    roughnessMap,
    bumpMap,
    dispose: () => {
      map.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
    },
  };
}

export function createPegboardTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 288;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const bg = ctx.createLinearGradient(0, 0, 0, 288);
  bg.addColorStop(0, "#f5e6cc");
  bg.addColorStop(0.65, "#ecd4b0");
  bg.addColorStop(1, "#d8b489");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 288);
  ctx.fillStyle = "rgba(130, 88, 52, 0.24)";
  for (let y = 16; y < 276; y += 20) {
    for (let x = 16; x < 500; x += 20) {
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const sun = ctx.createRadialGradient(130, 50, 12, 130, 50, 320);
  sun.addColorStop(0, "rgba(255, 248, 220, 0.42)");
  sun.addColorStop(1, "rgba(255, 240, 200, 0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, 512, 288);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.needsUpdate = true;
  return tex;
}

const COSMIC_NEBULA_VERT = /* glsl */ `
  varying vec3 vLocalDir;
  void main() {
    vLocalDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const COSMIC_NEBULA_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vLocalDir;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uLit;
  uniform vec3 uMoodTint;

  float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.52;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.04 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vLocalDir);
    float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 deep = mix(vec3(0.018, 0.024, 0.075), vec3(0.055, 0.045, 0.14), up);
    if (uLit < 0.5) {
      gl_FragColor = vec4(deep * 1.15, 1.0);
      return;
    }
    float t = uTime * 0.045;
    // Seam-free 3D projection across spherical sky dome
    vec2 p1 = dir.xy * 2.6 + dir.zy * 1.4 + vec2(t, -t * 0.4);
    vec2 p2 = dir.xz * 2.4 - dir.xy * 1.8 - vec2(t * 0.6, t * 0.35);
    float n1 = fbm(p1);
    float n2 = fbm(p2 + n1 * 0.72);
    vec3 teal = vec3(0.10, 0.54, 0.68) * smoothstep(0.36, 0.84, n1);
    vec3 violet = vec3(0.44, 0.16, 0.60) * smoothstep(0.40, 0.86, n2);
    vec3 goldCore = vec3(0.95, 0.70, 0.36) * pow(smoothstep(0.56, 0.94, n1 * n2 * 1.65), 2.0) * (0.35 + uEnergy * 0.45);
    float horizonGlow = exp(-pow((dir.y - 0.05) * 4.2, 2.0)) * 0.30;
    // Crisp procedural twinkle stars
    vec3 starCell = floor(dir * 92.0);
    float starRnd = hash3(starCell);
    float starMask = step(0.992, starRnd);
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.4 + starRnd * 50.0);
    vec3 stars = vec3(0.85, 0.94, 1.0) * starMask * twinkle * smoothstep(-0.2, 0.5, dir.y);
    vec3 col = (deep + teal * 0.56 + violet * 0.54 + goldCore + vec3(0.15, 0.36, 0.56) * horizonGlow) * uMoodTint + stars;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createCosmicNebulaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: COSMIC_NEBULA_VERT,
    fragmentShader: COSMIC_NEBULA_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uLit: { value: 1 },
      uMoodTint: { value: new THREE.Vector3(1, 1, 1) },
    },
  });
}

/** Corrugated kraft cardboard texture (fluted paper grain + masking-tape seams + parcel stencil). */
export function createKraftCardboardTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#c89b66";
  ctx.fillRect(0, 0, S, S);

  // Corrugated vertical fluting ribs
  for (let x = 0; x < S; x += 6) {
    ctx.fillStyle = x % 12 === 0 ? "rgba(92, 56, 24, 0.10)" : "rgba(255, 232, 192, 0.08)";
    ctx.fillRect(x, 0, 3, S);
  }

  // Subtle paper fibers
  let seed = 3044;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = rand() > 0.5 ? "rgba(86, 52, 22, 0.08)" : "rgba(248, 222, 182, 0.08)";
    ctx.fillRect(rand() * S, rand() * S, 1 + rand() * 3, 1 + rand() * 2);
  }

  // Masking-tape packing seams
  ctx.fillStyle = "rgba(232, 212, 170, 0.72)";
  ctx.fillRect(0, 12, S, 18);
  ctx.fillRect(0, S - 30, S, 18);
  ctx.fillStyle = "rgba(176, 146, 98, 0.45)";
  ctx.fillRect(246, 0, 20, S);

  // Subtle parcel stencil ("404 EXPRESS")
  ctx.save();
  ctx.strokeStyle = "rgba(84, 48, 24, 0.34)";
  ctx.fillStyle = "rgba(84, 48, 24, 0.36)";
  ctx.lineWidth = 3;
  ctx.strokeRect(160, 205, 192, 92);
  ctx.font = 'bold 26px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("404 EXPRESS", 256, 242);
  ctx.font = '600 14px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText("CARAVAN POST", 256, 272);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const SUNSET_DOME_VERT = /* glsl */ `
  varying vec3 vLocalDir;
  void main() {
    vLocalDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SUNSET_DOME_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vLocalDir;
  uniform float uEnergy;
  uniform float uDarkness;
  uniform float uLit;
  uniform vec3 uSunDir;
  uniform vec3 uMoodTint;

  void main() {
    vec3 dir = normalize(vLocalDir);
    float h = clamp(dir.y, -0.25, 1.0);
    vec3 zenith = mix(vec3(0.11, 0.14, 0.34), vec3(0.03, 0.04, 0.12), uDarkness);
    vec3 midSky = mix(vec3(0.68, 0.30, 0.36), vec3(0.16, 0.14, 0.28), uDarkness);
    vec3 horizon = mix(vec3(0.96, 0.64, 0.30), vec3(0.28, 0.22, 0.30), uDarkness);

    vec3 col = mix(horizon, midSky, smoothstep(-0.02, 0.24, h));
    col = mix(col, zenith, smoothstep(0.18, 0.72, h));

    if (uLit > 0.5) {
      float sunDot = max(0.0, dot(dir, normalize(uSunDir)));
      float halo = pow(sunDot, 6.0) * (0.48 + uEnergy * 0.25) * (1.0 - uDarkness * 0.65);
      float core = pow(sunDot, 42.0) * 0.55 * (1.0 - uDarkness * 0.7);
      col += vec3(1.0, 0.72, 0.34) * halo + vec3(1.0, 0.90, 0.65) * core;
    }
    col *= uMoodTint;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSunsetDomeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SUNSET_DOME_VERT,
    fragmentShader: SUNSET_DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uEnergy: { value: 0 },
      uDarkness: { value: 0 },
      uLit: { value: 1 },
      uSunDir: { value: new THREE.Vector3(-0.34, 0.24, -0.91).normalize() },
      uMoodTint: { value: new THREE.Vector3(1, 1, 1) },
    },
  });
}

const STUDY_DOME_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vLocalDir;
  uniform float uEnergy;
  uniform float uDarkness;
  uniform float uLit;
  uniform vec3 uMoodTint;

  void main() {
    vec3 dir = normalize(vLocalDir);
    float h = clamp(dir.y, -0.3, 1.0);
    vec3 top = mix(vec3(0.12, 0.08, 0.06), vec3(0.04, 0.03, 0.05), uDarkness);
    vec3 horizon = mix(vec3(0.28, 0.18, 0.11), vec3(0.08, 0.07, 0.11), uDarkness);
    vec3 col = mix(horizon, top, smoothstep(-0.05, 0.65, h));

    if (uLit > 0.5) {
      vec3 lampDir = normalize(vec3(-0.22, 0.32, -0.92));
      float halo = pow(max(0.0, dot(dir, lampDir)), 4.0) * (0.42 + uEnergy * 0.22) * (1.0 - uDarkness * 0.55);
      col += vec3(0.95, 0.68, 0.34) * halo;
    }
    col *= uMoodTint;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createStorybookStudyDomeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SUNSET_DOME_VERT,
    fragmentShader: STUDY_DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uEnergy: { value: 0 },
      uDarkness: { value: 0 },
      uLit: { value: 1 },
      uMoodTint: { value: new THREE.Vector3(1, 1, 1) },
    },
  });
}

/** Warm walnut workbench plank texture for Pop-Up Storybook 3D. */
export function createWalnutWorkbenchTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#4b2e1e";
  ctx.fillRect(0, 0, S, S);
  const planks = 6;
  const ph = S / planks;
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#573623" : "#4b2d1d";
    ctx.fillRect(0, i * ph, S, ph - 2);
    ctx.fillStyle = "rgba(22, 12, 7, 0.45)";
    ctx.fillRect(0, (i + 1) * ph - 2, S, 2);
    ctx.strokeStyle = "rgba(182, 126, 78, 0.11)";
    ctx.lineWidth = 1.6;
    for (let g = 0; g < 4; g++) {
      const gy = i * ph + 14 + g * 18;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + (g % 2 === 0 ? 5 : -5), 340, gy + (g % 2 === 0 ? -4 : 4), S, gy);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const VOL_BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const VOL_BEAM_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float edgeSoft = pow(clamp(ndv, 0.0, 1.0), 1.65);
    float topFade = smoothstep(1.0, 0.78, vUv.y);
    float bottomFade = smoothstep(0.0, 0.55, vUv.y);
    float alpha = edgeSoft * topFade * bottomFade * uOpacity;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** True 3D ConeGeometry volumetric shaft material with Fresnel silhouette attenuation. */
export function createVolumetricBeamMaterial(colorHex: string, opacity = 0.24): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VOL_BEAM_VERT,
    fragmentShader: VOL_BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: opacity },
    },
  });
}

/** Etched glowing cyan/gold zodiac dial ring texture for the Cosmic Observatory terrace. */
export function createZodiacDeckTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, S, S);
  const cx = S * 0.5;
  const cy = S * 0.5;

  // Outer cyan/gold concentric astrolabe rings
  ctx.strokeStyle = "rgba(102, 240, 224, 0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 232, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(230, 190, 118, 0.52)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 206, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(155, 124, 255, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 152, 0, Math.PI * 2);
  ctx.stroke();

  // Radial degree ticks & 12 zodiac sectors
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const major = i % 6 === 0;
    const r0 = major ? 196 : 212;
    const r1 = 230;
    ctx.strokeStyle = major ? "rgba(255, 220, 148, 0.72)" : "rgba(102, 240, 224, 0.35)";
    ctx.lineWidth = major ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = "rgba(116, 246, 226, 0.78)";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 174, cy + Math.sin(a) * 174, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
