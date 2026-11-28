/**
 * Pure 2D Canvas painters for Tier 2 Multiplane performer overlays:
 *  - Ozzi procedural emerald phosphor CRT + purple polarizer specs
 *  - Generic `MultiplaneCrtFaceSpec` phosphor display
 *  - Tally mechanical speaker-beak mouth
 *  - Fuzz overdrive rock EQ & LED face display
 *  - Hertz CH 04 / VIDEO 1 CRT phosphor screen
 */
import type { MultiplaneCrtFaceSpec } from "../../choir/castManifest.ts";
import { naturalBlinkAmountAt } from "../visemeMapper.ts";
import { clamp01 } from "./actorShared.ts";

export function paintOzziCrtCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  params: {
    qTime: number;
    singing: boolean;
    open: number;
    round: number;
    width: number;
    clip: string;
    gagActive: boolean;
  },
): void {
  const { qTime, singing, open, round, width, clip, gagActive } = params;
  const cx = W * 0.5;
  const cy = H * 0.5;
  const rScreen = W * 0.48;
  const blink = clamp01(naturalBlinkAmountAt(qTime, singing));
  const isProbeArc = clip === "probe-arc";
  const isSpecsGag = gagActive && !isProbeArc;
  const happyEyes = clip === "clap" || clip === "cheer" || clip === "jump" || clip === "bow";

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rScreen, 0, Math.PI * 2);
  ctx.clip();

  const bg = ctx.createRadialGradient(cx, cy - 10, 10, cx, cy, rScreen);
  bg.addColorStop(0, "#19633c");
  bg.addColorStop(0.62, "#0c3a21");
  bg.addColorStop(1, "#04160c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(92, 247, 178, 0.22)";
  ctx.lineWidth = 1.5;
  const step = 28;
  for (let x = cx % step; x < W; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = cy % step; y < H; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const lensOffsetY = isSpecsGag ? -7 : 0;
  const specsTilt = isSpecsGag ? -0.11 : 0;
  ctx.save();
  ctx.translate(cx, cy - 22 + lensOffsetY);
  ctx.rotate(specsTilt);
  for (const lx of [-37, 37]) {
    const lg = ctx.createRadialGradient(lx - 8, -8, 4, lx, 0, 34);
    lg.addColorStop(0, "rgba(154, 72, 240, 0.44)");
    lg.addColorStop(1, "rgba(86, 26, 152, 0.52)");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(lx, 0, 32, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(232, 200, 255, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(lx, 0, 24, Math.PI * 1.15, Math.PI * 1.55);
    ctx.stroke();

    ctx.strokeStyle = "#d1a85e";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(lx, 0, 32, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "#d1a85e";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.arc(0, 3, 7, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = "#a4ffdc";
  ctx.fillStyle = "#9effd8";
  ctx.shadowColor = isSpecsGag ? "#74ffe4" : "#2ef2a4";
  ctx.shadowBlur = isSpecsGag ? 20 : 14;
  ctx.lineWidth = 5.5;
  for (const ex of [cx - 37, cx + 37]) {
    const ey = cy - 22;
    if (happyEyes && (!singing || open <= 0.04)) {
      ctx.beginPath();
      ctx.arc(ex, ey + 5, 13, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (blink > 0.55) {
      ctx.beginPath();
      ctx.roundRect(ex - 13, ey - 2.5, 26, 5, 2.5);
      ctx.fill();
    } else {
      const eh = Math.max(6, 30 * (1 - blink * 0.85));
      ctx.beginPath();
      ctx.roundRect(ex - 9.5, ey - eh * 0.5, 19, eh, 9.5);
      ctx.fill();
    }
  }

  const mouthY = cy + 44;
  const amp = isProbeArc ? 26 + 12 * Math.abs(Math.sin(qTime * 11)) : singing ? 9 + open * 30 : 5.5;
  const freq = isProbeArc ? 20 : singing ? 12 + width * 6 - round * 3 : 12.5;
  const phaseScroll = singing || isProbeArc ? qTime * 9.5 : 0;
  ctx.strokeStyle = "#96ffd4";
  ctx.shadowColor = "#24f0a0";
  ctx.shadowBlur = 14;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  const x0 = cx - 74;
  const spanW = 148;
  for (let dx = 0; dx <= spanW; dx += 3) {
    const u = dx / spanW;
    const env = Math.sin(u * Math.PI);
    const harm = isProbeArc ? Math.sin(u * freq * 1.9 + phaseScroll * 1.6) * 0.35 : 0;
    const y = mouthY + env * amp * (Math.sin(u * freq + phaseScroll) + harm);
    if (dx === 0) ctx.moveTo(x0 + dx, y);
    else ctx.lineTo(x0 + dx, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

export function paintGenericCrtFaceCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  cf: MultiplaneCrtFaceSpec,
  params: { qTime: number; singing: boolean; open: number; round: number; width: number; clip: string },
): void {
  const { qTime, singing, open, round, width, clip } = params;
  const sx = W / Math.max(1, cf.screenSize[0]);
  const sy = H / Math.max(1, cf.screenSize[1]);
  const blink = clamp01(naturalBlinkAmountAt(qTime, singing));
  const happyEyes = clip === "clap" || clip === "bow" || clip === "jump";

  const drawEye = (ox: number, oy: number, size: number) => {
    const ex = W * 0.5 + ox * sx;
    const ey = H * 0.5 + oy * sy;
    const ew = Math.max(18, size * sx * 0.72);
    const eh = Math.max(4, size * sy * 0.72 * (1 - blink * 0.85));
    ctx.strokeStyle = "#62ff9b";
    ctx.fillStyle = "#48f288";
    ctx.shadowColor = "#25e090";
    ctx.shadowBlur = 14;
    ctx.lineWidth = 5;
    if (happyEyes && (!singing || open <= 0.04)) {
      ctx.beginPath();
      ctx.arc(ex, ey + eh * 0.25, ew * 0.42, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (blink > 0.55) {
      ctx.fillRect(ex - ew * 0.5, ey - 3, ew, 6);
    } else {
      ctx.strokeRect(ex - ew * 0.5, ey - eh * 0.5, ew, eh);
      ctx.globalAlpha = 0.26;
      ctx.fillRect(ex - ew * 0.5, ey - eh * 0.5, ew, eh);
      ctx.globalAlpha = 1;
    }
  };

  drawEye(cf.leftEye[0], cf.leftEye[1], cf.leftEye[2]);
  drawEye(cf.rightEye[0], cf.rightEye[1], cf.rightEye[2]);

  const mx = W * 0.5 + cf.mouth[0] * sx;
  const my = H * 0.5 + cf.mouth[1] * sy;
  ctx.fillStyle = "#ffc864";
  ctx.strokeStyle = "#ffc864";
  ctx.shadowColor = "#ff9d2e";
  ctx.shadowBlur = 14;
  ctx.lineWidth = 5;
  if (!singing || open <= 0.04) {
    if (happyEyes) {
      ctx.beginPath();
      ctx.arc(mx, my - 6, 26, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else {
      ctx.fillRect(mx - 28, my - 4, 56, 8);
    }
  } else if (round >= 0.5) {
    const rx = 14 + (1 - round * 0.35) * 10;
    const ry = 10 + open * 18;
    ctx.beginPath();
    ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const mw = Math.round(32 + width * 30 + open * 14);
    const mh = Math.round(8 + open * 28);
    ctx.beginPath();
    ctx.roundRect(mx - mw * 0.5, my - mh * 0.5, mw, mh, 6);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

export function paintTallyMouthCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  params: { isSingMouth: boolean; isTickerCue: boolean; isHappySmile: boolean; open: number; round: number; width: number },
): void {
  const { isSingMouth, isTickerCue, isHappySmile, open, round, width } = params;
  const cx = W * 0.5;
  const cy = H * 0.5 + (isSingMouth ? open * 4 : 0);

  if (isSingMouth) {
    const rx = clamp01((24 + width * 22 - round * 12 + open * 8) / 56) * 52;
    const ry = Math.max(10, Math.min(38, 10 + open * 25 + round * 5));

    ctx.fillStyle = "#16110d";
    ctx.strokeStyle = "#dfd0aa";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 4, ry + 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(8, rx), Math.max(6, ry), 0, 0, Math.PI * 2);
    ctx.clip();

    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, Math.max(rx, ry));
    glow.addColorStop(0, "#fff0ba");
    glow.addColorStop(0.42, "#ffa838");
    glow.addColorStop(0.85, "#b8441c");
    glow.addColorStop(1, "#2a120a");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

    ctx.strokeStyle = "rgba(255, 245, 205, 0.88)";
    ctx.lineWidth = 3;
    const bars = open > 0.45 ? 3 : 2;
    for (let b = 0; b < bars; b++) {
      const yOff = (b - (bars - 1) * 0.5) * (ry * 0.62);
      const halfSpan = Math.max(10, rx * (1 - 0.18 * Math.abs(b - (bars - 1) * 0.5)));
      ctx.beginPath();
      ctx.moveTo(cx - halfSpan, cy + yOff);
      ctx.lineTo(cx + halfSpan, cy + yOff);
      ctx.stroke();
    }
    ctx.restore();
  } else if (isTickerCue) {
    ctx.fillStyle = "#17110d";
    ctx.strokeStyle = "#f2c66d";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 22, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#ff7c3a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 13, 16, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isHappySmile) {
    ctx.fillStyle = "#17110d";
    ctx.strokeStyle = "#dfd0aa";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1, 36, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 5.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy - 9, 25, 0.14 * Math.PI, 0.86 * Math.PI);
    ctx.stroke();
  }
}

export function paintFuzzFaceCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  params: {
    qTime: number;
    isSingMode: boolean;
    isShred: boolean;
    isHappy: boolean;
    open: number;
    round: number;
    width: number;
    blink: number;
  },
): void {
  const { qTime, isSingMode, isShred, isHappy, open, round, width, blink } = params;

  ctx.fillStyle = "#060907";
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 10);
  ctx.fill();

  ctx.fillStyle = "rgba(80, 255, 130, 0.06)";
  for (let y = 8; y < H; y += 8) {
    ctx.fillRect(6, y, W - 12, 2);
  }

  const eyeColor = isShred ? "#ffb23f" : "#6aff8e";
  const eyeGlow = isShred ? "#ff7c1a" : "#32e868";
  ctx.strokeStyle = eyeColor;
  ctx.fillStyle = eyeColor;
  ctx.shadowColor = eyeGlow;
  ctx.shadowBlur = isShred ? 16 : 12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const drawFuzzEye = (ex: number, isRight: boolean) => {
    const ey = 52;
    if (isShred) {
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      if (!isRight) {
        ctx.moveTo(ex - 16, ey - 14);
        ctx.lineTo(ex + 14, ey);
        ctx.lineTo(ex - 16, ey + 14);
      } else {
        ctx.moveTo(ex + 16, ey - 14);
        ctx.lineTo(ex - 14, ey);
        ctx.lineTo(ex + 16, ey + 14);
      }
      ctx.stroke();
    } else if (isHappy && (!isSingMode || open <= 0.04)) {
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(ex, ey + 7, 17, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (blink > 0.55) {
      ctx.fillRect(ex - 16, ey - 3, 32, 6);
    } else {
      const eh = Math.max(8, Math.round(32 * (1 - blink * 0.85)));
      ctx.beginPath();
      ctx.roundRect(ex - 14, ey - eh * 0.5, 28, eh, 5);
      ctx.fill();
    }
  };
  drawFuzzEye(48, false);
  drawFuzzEye(W - 48, true);

  const mx = W * 0.5;
  const my = H * 0.52;
  if (isShred) {
    const bands = 7;
    const bw = 12;
    const gap = 5;
    const startX = mx - (bands * bw + (bands - 1) * gap) * 0.5;
    for (let b = 0; b < bands; b++) {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(qTime * 19 + b * 1.15));
      const bh = Math.round(24 + pulse * 54);
      const bx = startX + b * (bw + gap);
      ctx.fillStyle = b % 2 === 0 ? "#ffb840" : "#ff6b35";
      ctx.shadowColor = "#ff8224";
      ctx.beginPath();
      ctx.roundRect(bx, my - bh * 0.5, bw, bh, 3);
      ctx.fill();
    }
  } else if (isSingMode && open > 0.03) {
    if (round >= 0.5) {
      const rx = 18 + (1 - round * 0.35) * 14;
      const ry = 12 + open * 22;
      ctx.strokeStyle = "#8cff9e";
      ctx.shadowColor = "#42f575";
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const bands = 7;
      const spanW = 72 + width * 46;
      const gap = 4;
      const bw = (spanW - (bands - 1) * gap) / bands;
      const startX = mx - spanW * 0.5;
      for (let b = 0; b < bands; b++) {
        const arch = 1 - (0.38 * Math.abs(b - (bands - 1) * 0.5)) / 3;
        const shimmer = 0.85 + 0.15 * Math.sin(qTime * 16 + b * 0.9);
        const bh = Math.max(10, Math.round((12 + open * 58) * arch * shimmer));
        const bx = startX + b * (bw + gap);
        ctx.fillStyle = bh > 46 ? "#ffd35c" : "#6aff8e";
        ctx.shadowColor = bh > 46 ? "#ffaa33" : "#2be866";
        ctx.beginPath();
        ctx.roundRect(bx, my - bh * 0.5, bw, bh, 3);
        ctx.fill();
      }
    }
  } else if (isHappy) {
    ctx.strokeStyle = "#8cff9e";
    ctx.shadowColor = "#34e86a";
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.arc(mx, my - 12, 34, 0.14 * Math.PI, 0.86 * Math.PI);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#6aff8e";
    ctx.fillRect(mx - 38, my - 3.5, 76, 7);
  }
  ctx.shadowBlur = 0;
}

export function paintHertzScreenCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  params: { isSingMode: boolean; isHappy: boolean; open: number; round: number; width: number; blink: number },
): void {
  const { isSingMode, isHappy, open, round, width, blink } = params;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(2, 2, W - 4, H - 4, 22);
  ctx.clip();

  const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 16, W * 0.5, H * 0.5, W * 0.62);
  bg.addColorStop(0, "#152324");
  bg.addColorStop(0.65, "#091112");
  bg.addColorStop(1, "#030607");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(108, 255, 226, 0.05)";
  for (let y = 4; y < H; y += 5) {
    ctx.fillRect(0, y, W, 2);
  }

  ctx.fillStyle = "rgba(210, 245, 245, 0.06)";
  ctx.beginPath();
  ctx.ellipse(W * 0.36, 18, 92, 22, -0.06, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "bold 20px ui-monospace, 'Courier New', monospace";
  ctx.textBaseline = "top";
  ctx.shadowBlur = 10;

  ctx.textAlign = "left";
  ctx.fillStyle = "#5cffc4";
  ctx.shadowColor = "#24e89c";
  ctx.fillText("CH 04", 22, 18);

  ctx.textAlign = "right";
  ctx.fillStyle = "#ffb842";
  ctx.shadowColor = "#f08a18";
  ctx.fillText("VIDEO 1", W - 22, 18);

  const browLift = isHappy || (isSingMode && open > 0.35) ? -6 : 0;
  const eyeXs = [98, W - 98];
  const ey = 118;

  for (const ex of eyeXs) {
    ctx.fillStyle = "#ffb43e";
    ctx.shadowColor = "#ff8c1a";
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.roundRect(ex - 20, 66 + browLift, 40, 8, 4);
    ctx.fill();

    ctx.strokeStyle = "#69fff0";
    ctx.fillStyle = "#69fff0";
    ctx.shadowColor = "#2be6d4";
    ctx.shadowBlur = 16;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (isHappy && (!isSingMode || open <= 0.04)) {
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(ex - 22, ey + 12);
      ctx.lineTo(ex, ey - 14);
      ctx.lineTo(ex + 22, ey + 12);
      ctx.stroke();
    } else if (blink > 0.55) {
      ctx.beginPath();
      ctx.roundRect(ex - 22, ey - 4, 44, 8, 4);
      ctx.fill();
    } else {
      const eh = Math.max(10, Math.round(62 * (1 - blink * 0.85)));
      const ew = 42;
      ctx.beginPath();
      ctx.roundRect(ex - ew * 0.5, ey - eh * 0.5, ew, eh, 16);
      ctx.fill();

      if (eh > 26) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#102828";
        ctx.beginPath();
        ctx.roundRect(ex - 6, ey - eh * 0.19, 12, eh * 0.38, 4);
        ctx.fill();

        ctx.fillStyle = "#e6ffff";
        ctx.fillRect(ex - 13, ey - eh * 0.3, 8, 8);
      }
    }
  }

  const mx = W * 0.5;
  const my = 204;
  ctx.strokeStyle = "#ffc046";
  ctx.fillStyle = "#ffc046";
  ctx.shadowColor = "#ff8c18";
  ctx.shadowBlur = 14;
  ctx.lineCap = "round";

  if (isSingMode && open > 0.04) {
    if (round >= 0.5) {
      const rx = 18 + (1 - round * 0.32) * 10;
      const ry = 12 + open * 18;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const mw = Math.round(46 + width * 42 + open * 14);
      const mh = Math.round(14 + open * 36);
      ctx.beginPath();
      ctx.roundRect(mx - mw * 0.5, my - mh * 0.5, mw, mh, 10);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#481c06";
      ctx.beginPath();
      ctx.roundRect(mx - mw * 0.5 + 6, my - mh * 0.5 + 6, Math.max(8, mw - 12), Math.max(4, mh - 12), 6);
      ctx.fill();
    }
  } else {
    const smileSpan = isHappy ? 42 : 34;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(mx, my - 16, smileSpan, 0.16 * Math.PI, 0.84 * Math.PI);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}
