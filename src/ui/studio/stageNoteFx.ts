/**
 * Rising eighth-note vector FX helper for the live 3D Stage overlay canvas.
 */
import type { Pose } from "../../choir/pose.ts";
import type { Piece } from "../../choir/music.ts";
import { STUDIO_404_CAST } from "../../choir/studio404.ts";
import type { MoppetVoice } from "../../choir/voices.ts";

export interface FloatingNote {
  x: number;
  y: number;
  age: number;
  life: number;
  seed: number;
  color: string;
  double: boolean;
}

function fitCanvas(c: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (c.width !== pw || c.height !== ph) {
    c.width = pw;
    c.height = ph;
  }
  const g = c.getContext("2d");
  g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  g?.clearRect(0, 0, w, h);
  return g;
}

function drawNote(g: CanvasRenderingContext2D, x: number, y: number, double: boolean): void {
  const head = (hx: number, hy: number) => {
    g.beginPath();
    g.ellipse(hx, hy, 4.2, 3.1, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillRect(hx + 3, hy - 14, 1.6, 14);
  };
  head(x, y);
  if (double) {
    head(x + 10, y - 3);
    g.fillRect(x + 3, y - 15, 11.6, 3);
  } else {
    g.beginPath();
    g.moveTo(x + 4.6, y - 14);
    g.quadraticCurveTo(x + 12, y - 9, x + 9, y - 3);
    g.quadraticCurveTo(x + 10, y - 9, x + 4.6, y - 10);
    g.fill();
  }
}

function hash(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function renderStageNotes(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  dt: number,
  now: number,
  still: boolean,
  piece: Piece,
  voices: readonly MoppetVoice[],
  poses: readonly Pose[],
  studio404: boolean,
  notes: FloatingNote[],
  tickRef: { count: number },
): void {
  if (w <= 2 || h <= 2) return;
  const g = fitCanvas(canvas, w, h);
  if (!g) return;
  const stepDt = Math.min(dt, 0.05);
  if (!still && piece.kind !== "skit") {
    const stageCast = voices.filter((x) => !piece.stage || piece.stage.includes(x.id));
    const soloStage = stageCast.length <= 1 || (piece.stage?.length ?? 0) === 1;
    voices.forEach((v, i) => {
      if (piece.stage && !piece.stage.includes(v.id)) return;
      const p = poses[i];
      if (!p?.singing) return;
      tickRef.count += 1;
      if (hash(tickRef.count + now * 13) > stepDt * (1.1 + 4.2 * p.level)) return;
      const si = stageCast.indexOf(v);
      const u = stageCast.length > 1 && si >= 0 ? si / (stageCast.length - 1) : 0.5;
      const ax = soloStage ? 0.5 : studio404 ? 0.16 + u * 0.68 : 0.12 + u * 0.76;
      const color = studio404 ? (STUDIO_404_CAST[v.id]?.color ?? v.color) : v.color;
      notes.push({
        x: ax * w + (hash(tickRef.count + 5) - 0.5) * w * 0.04,
        y: h * 0.56,
        age: 0,
        life: 1.5 + hash(tickRef.count + 11) * 0.7,
        seed: hash(tickRef.count + 19) * 6 + i,
        color,
        double: hash(tickRef.count + 29) < 0.35,
      });
    });
  }
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.age += stepDt;
    n.y -= stepDt * 44;
    if (n.age > n.life || n.y < 20) notes.splice(i, 1);
  }
  for (const n of notes) {
    const t = n.age / n.life;
    g.globalAlpha = Math.min(1, n.age * 5) * (1 - t * t);
    g.fillStyle = n.color;
    drawNote(g, n.x + Math.sin(n.age * 3 + n.seed) * 8, n.y, n.double);
  }
  g.globalAlpha = 1;
}
