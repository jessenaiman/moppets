/**
 * Zero-dependency live stage clip recorder modeled directly on CHIMERA's `src/song/record.ts`:
 * Captures the live 16:9 stage `<canvas>` (`captureStream(30)`) + Web Audio master stream
 * (`audio.recordStream()`) through the browser's `MediaRecorder` into MP4 where supported
 * (Safari, modern Chromium), else WebM.
 */

const W = 1280;
const H = 720;
const TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickMimeType(): string | null {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof HTMLCanvasElement === "undefined" ||
    !("captureStream" in HTMLCanvasElement.prototype)
  ) {
    return null;
  }
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** Shared pointer to the currently mounted live stage `<canvas>` element. */
export const stageCanvasRegistry = {
  current: null as HTMLCanvasElement | null,
};

/** Owned by the active `StageClip` so the live stage canvas knows to stamp clean captions/wordmark. */
export const recordingStageClip = {
  owner: null as StageClip | null,
  get on(): boolean {
    return this.owner !== null;
  },
};

export const canRecordClip = (): boolean => pickMimeType() !== null;

export class StageClip {
  private readonly frame = document.createElement("canvas");
  private rec!: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private raf = 0;
  private readonly type: string;
  private videoTracks: MediaStreamTrack[] = [];
  private ended!: Promise<void>;
  private failed = false;

  constructor(source: () => HTMLCanvasElement | null, audioStream: MediaStream) {
    const chosen = pickMimeType();
    if (!chosen) throw new Error("MediaRecorder clip capture is not supported in this browser.");
    this.type = chosen;
    recordingStageClip.owner = this;
    try {
      this.begin(source, audioStream);
    } catch (err) {
      this.release();
      throw err;
    }
  }

  private begin(source: () => HTMLCanvasElement | null, audioStream: MediaStream): void {
    this.frame.width = W;
    this.frame.height = H;
    const ctx = this.frame.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable for clip capture.");

    const draw = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#080507";
      ctx.fillRect(0, 0, W, H);
      const src = source();
      const sw = src?.width ?? 0;
      const sh = src?.height ?? 0;
      if (src && sw > 0 && sh > 0) {
        const k = Math.min(W / sw, H / sh);
        ctx.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
      }
      // Subtle corner wordmark matching CHIMERA's `record.ts` stamp
      ctx.font = '700 13px "JetBrains Mono", ui-monospace, monospace';
      ctx.letterSpacing = "0.22em";
      ctx.fillStyle = "rgba(216, 255, 243, 0.72)";
      ctx.textAlign = "right";
      ctx.fillText("STUDIO 404 · CHIMERA", W - 22, H - 18);
      this.raf = requestAnimationFrame(draw);
    };
    draw();

    this.videoTracks = this.frame.captureStream(30).getVideoTracks();
    const combined = new MediaStream([...this.videoTracks, ...audioStream.getAudioTracks()]);
    this.rec = new MediaRecorder(combined, {
      mimeType: this.type,
      videoBitsPerSecond: 6_000_000,
    });
    this.rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) this.chunks.push(ev.data);
    };
    this.rec.onerror = () => {
      this.failed = true;
    };
    this.ended = new Promise((resolve) => {
      this.rec.onstop = () => {
        this.release();
        resolve();
      };
    });
    this.rec.start(400);
  }

  async stop(name: string): Promise<File> {
    cancelAnimationFrame(this.raf);
    if (recordingStageClip.owner === this) recordingStageClip.owner = null;
    if (this.rec.state !== "inactive") this.rec.stop();
    await this.ended;
    if (this.failed || this.chunks.length === 0) {
      throw new Error("Clip recording ended without media chunks.");
    }
    const baseType = this.type.split(";")[0];
    const ext = baseType === "video/mp4" ? "mp4" : "webm";
    return new File(this.chunks, `${name}.${ext}`, { type: baseType });
  }

  cancel(): void {
    if (this.rec.state !== "inactive") this.rec.stop();
    this.release();
  }

  private release(): void {
    if (recordingStageClip.owner === this) recordingStageClip.owner = null;
    cancelAnimationFrame(this.raf);
    for (const t of this.videoTracks) t.stop();
  }
}
