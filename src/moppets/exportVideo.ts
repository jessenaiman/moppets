/**
 * 16:9 1280x720 MP4/WebM video exporter capturing the Three.js stage canvas + live caption overlay +
 * CHIMERA AudioEngine master stream (`engine.recordStream()`). Modeled on `src/song/record.ts`.
 */
import { engine } from "../audio/AudioEngine.ts";

const EXPORT_W = 1280;
const EXPORT_H = 720;
const MIME_TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickExportMime(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined") return null;
  if (!("captureStream" in HTMLCanvasElement.prototype)) return null;
  return MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export const canExportVideo = (): boolean => pickExportMime() !== null;

export class StageVideoExporter {
  private readonly compCanvas = document.createElement("canvas");
  private readonly rec: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly videoTracks: MediaStreamTrack[];
  private readonly mimeType: string;
  private readonly ended: Promise<void>;
  private raf = 0;
  private failed = false;

  constructor(
    getStageCanvas: () => HTMLCanvasElement | null,
    getCaption: () => string,
    audioStream: MediaStream,
  ) {
    const mime = pickExportMime();
    if (!mime) throw new Error("Browser does not support MediaRecorder video export");
    this.mimeType = mime;

    this.compCanvas.width = EXPORT_W;
    this.compCanvas.height = EXPORT_H;
    const ctx = this.compCanvas.getContext("2d")!;

    const drawFrame = () => {
      ctx.fillStyle = "#111014";
      ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
      const src = getStageCanvas();
      if (src && src.width > 0 && src.height > 0) {
        ctx.drawImage(src, 0, 0, EXPORT_W, EXPORT_H);
      }
      const caption = getCaption().trim();
      if (caption) {
        ctx.save();
        ctx.font = '600 26px "Space Grotesk", system-ui, sans-serif';
        const padX = 24;
        const textW = ctx.measureText(caption).width;
        const boxW = Math.min(EXPORT_W - 80, textW + padX * 2);
        const boxH = 48;
        const bx = (EXPORT_W - boxW) / 2;
        const by = EXPORT_H - 72;
        ctx.fillStyle = "rgba(17, 16, 20, 0.78)";
        ctx.beginPath();
        ctx.roundRect(bx, by, boxW, boxH, 10);
        ctx.fill();
        ctx.strokeStyle = "rgba(47, 191, 160, 0.55)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#f4f2ee";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(caption, EXPORT_W / 2, by + boxH / 2 + 1, boxW - 24);
        ctx.restore();
      }
      this.raf = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    this.videoTracks = this.compCanvas.captureStream(30).getVideoTracks();
    const combined = new MediaStream([...this.videoTracks, ...audioStream.getAudioTracks()]);
    this.rec = new MediaRecorder(combined, { mimeType: this.mimeType, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.onerror = () => {
      this.failed = true;
    };
    this.ended = new Promise((resolve) => {
      this.rec.onstop = () => {
        this.cleanup();
        resolve();
      };
    });
    this.rec.start(250);
  }

  async stopAndDownload(filenameBase: string): Promise<{ filename: string; sizeBytes: number; mimeType: string }> {
    cancelAnimationFrame(this.raf);
    if (this.rec.state !== "inactive") this.rec.stop();
    await this.ended;
    if (this.failed || !this.chunks.length) throw new Error("Video recording produced no frames");
    const cleanMime = this.mimeType.split(";")[0];
    const ext = cleanMime === "video/mp4" ? "mp4" : "webm";
    const filename = `${filenameBase}.${ext}`;
    const blob = new Blob(this.chunks, { type: cleanMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { filename, sizeBytes: blob.size, mimeType: cleanMime };
  }

  cancel(): void {
    if (this.rec.state !== "inactive") this.rec.stop();
    this.cleanup();
  }

  private cleanup(): void {
    cancelAnimationFrame(this.raf);
    for (const t of this.videoTracks) t.stop();
  }
}

export function getMasterRecordStream(): MediaStream {
  const stream = engine.recordStream();
  if (!stream) throw new Error("CHIMERA AudioEngine is not started yet");
  return stream;
}
