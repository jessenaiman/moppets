/**
 * Dev-server bridge for the Remotion Video Studio: serves `out/video/<slug>/*` with HTTP Range
 * support, accepts synthesized CHIMERA WAV uploads, and runs local Remotion MP4 exports
 * (`remotion render`). Dev server only (`apply: "serve"`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import type { MoppetVideoProps } from "../src/choir/videoProject.ts";

const VIDEO_DIR = resolve("out/video");
const REMOTION_BIN = resolve("node_modules/.bin/remotion");

interface JobState {
  id: number;
  kind: "render" | null;
  status: "idle" | "running" | "done" | "error";
  progress: number;
  message: string;
  outputUrl: string | null;
  error: string | null;
}

const SLUG_RE = /^[a-z0-9-]+$/;
const MEDIA_RE = /^([a-z0-9-]+)\/([a-z0-9._-]+\.(?:mp4|wav))$/;

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

function sendText(res: ServerResponse, code: number, msg: string): void {
  res.statusCode = code;
  res.setHeader("content-type", "text/plain");
  res.end(msg);
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((ok, fail) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      try {
        ok(JSON.parse(body || "{}") as T);
      } catch (e) {
        fail(e);
      }
    });
    req.on("error", fail);
  });
}

function originFrom(req: IncomingMessage, fallbackOrigin: string): string {
  const host = req.headers.host;
  return host ? `http://${host}` : fallbackOrigin;
}

function absolutizeProps(props: MoppetVideoProps, origin: string): MoppetVideoProps {
  const abs = (u: string | null) => (u && u.startsWith("/") ? `${origin}${u}` : u);
  return {
    ...props,
    audioUrl: abs(props.audioUrl),
  };
}

function serveMediaFile(req: IncomingMessage, res: ServerResponse, filePath: string, name: string): void {
  if (!existsSync(filePath)) return sendText(res, 404, "Media not found");
  const stat = statSync(filePath);
  const type = name.endsWith(".mp4") ? "video/mp4" : "audio/wav";
  const range = req.headers.range;
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("content-type", type);
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(stat.size - 1, Number(m[2])) : stat.size - 1;
      if (start <= end && end < stat.size) {
        res.statusCode = 206;
        res.setHeader("content-range", `bytes ${start}-${end}/${stat.size}`);
        res.setHeader("content-length", String(end - start + 1));
        const s = createReadStream(filePath, { start, end });
        res.on("close", () => s.destroy());
        s.pipe(res);
        return;
      }
    }
  }
  res.statusCode = 200;
  res.setHeader("content-length", String(stat.size));
  const s = createReadStream(filePath);
  res.on("close", () => s.destroy());
  s.pipe(res);
}

export function videoBridge(): Plugin {
  let jobCounter = 0;
  let activeProc: ChildProcess | null = null;
  let job: JobState = { id: 0, kind: null, status: "idle", progress: 0, message: "", outputUrl: null, error: null };

  return {
    name: "video-bridge",
    apply: "serve",
    configureServer(server) {
      const serverOrigin = `http://127.0.0.1:${server.config.server.port ?? 5417}`;

      server.middlewares.use("/__video/ping", (_req, res) => {
        res.statusCode = 204;
        res.end();
      });

      server.middlewares.use("/__video/job", (_req, res) => {
        sendJson(res, 200, job);
      });

      server.middlewares.use("/__video/assets", (req, res) => {
        const u = new URL(req.url || "", serverOrigin);
        const slug = u.searchParams.get("slug") ?? "";
        if (!SLUG_RE.test(slug)) return sendText(res, 400, "Invalid slug");
        const dir = `${VIDEO_DIR}/${slug}`;
        const files = existsSync(dir) ? readdirSync(dir) : [];
        const audio = files
          .filter(file => /^mix(?:-[0-9a-f]{64})?\.wav$/.test(file))
          .map(file => ({ file, changed: statSync(`${dir}/${file}`).mtimeMs }))
          .sort((a, b) => b.changed - a.changed)[0];
        const exports = files
          .filter(file => /^edit-.*\.mp4$/.test(file))
          .sort()
          .map(file => ({ file, url: `/__video/media/${slug}/${file}` }));
        sendJson(res, 200, {
          slug,
          hasAudio: Boolean(audio),
          audioUrl: audio ? `/__video/media/${slug}/${audio.file}` : null,
          exports,
        });
      });

      server.middlewares.use("/__video/audio", async (req, res) => {
        if (req.method !== "POST") return sendText(res, 405, "POST only");
        const url = new URL(req.url || "", "http://127.0.0.1");
        const slug = url.searchParams.get("slug") || "";
        if (!slug || !SLUG_RE.test(slug)) return sendText(res, 400, "Invalid slug");
        const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
        try {
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of req) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buf.length;
            if (total > MAX_AUDIO_BYTES) return sendText(res, 413, "Audio payload exceeds 128 MiB limit");
            chunks.push(buf);
          }
          if (total === 0) return sendText(res, 400, "Empty WAV payload");
          const dir = `${VIDEO_DIR}/${slug}`;
          mkdirSync(dir, { recursive: true });
          const wav = Buffer.concat(chunks, total);
          const revision = createHash("sha256").update(wav).digest("hex");
          const file = `mix-${revision}.wav`;
          const path = `${dir}/${file}`;
          // A running export can still be reading an earlier score's mix.
          if (!existsSync(path)) writeFileSync(path, wav);
          sendJson(res, 200, { audioUrl: `/__video/media/${slug}/${file}` });
        } catch (e) {
          sendText(res, 400, e instanceof Error ? e.message : String(e));
        }
      });

      server.middlewares.use("/__video/media/", (req, res) => {
        const rel = decodeURIComponent((req.url || "").replace(/^\/+/, "").split("?")[0]);
        const m = MEDIA_RE.exec(rel);
        if (!m) return sendText(res, 400, "Invalid media path");
        serveMediaFile(req, res, `${VIDEO_DIR}/${m[1]}/${m[2]}`, m[2]);
      });

      server.middlewares.use("/__video/render", async (req, res) => {
        if (req.method !== "POST") return sendText(res, 405, "POST only");
        if (activeProc) return sendText(res, 409, "Another video job is already running");
        if (!existsSync(REMOTION_BIN)) return sendText(res, 500, "Remotion CLI binary not found");
        try {
          const { slug, props } = await readJsonBody<{ slug: string; props: MoppetVideoProps }>(req);
          if (activeProc) return sendText(res, 409, "Another video job is already running");
          if (!slug || !SLUG_RE.test(slug) || !props) return sendText(res, 400, "Invalid render payload");
          if (props.audioUrl?.startsWith("blob:")) {
            return sendText(res, 400, "audioUrl cannot be a blob: URL; upload WAV via POST /__video/audio first");
          }
          const dir = `${VIDEO_DIR}/${slug}`;
          mkdirSync(dir, { recursive: true });
          const origin = originFrom(req, serverOrigin);
          const resolved = absolutizeProps(props, origin);
          const propsPath = `${dir}/remotion-props.json`;
          writeFileSync(propsPath, JSON.stringify(resolved, null, 2));
          const outFile = `edit-${props.aspect === "9:16" ? "9x16" : "16x9"}.mp4`;
          const outPath = `${dir}/${outFile}`;
          const id = ++jobCounter;
          job = { id, kind: "render", status: "running", progress: 0.02, message: `Bundling Remotion composition…`, outputUrl: null, error: null };
          const proc = spawn(
            REMOTION_BIN,
            [
              "render",
              "src/remotion/index.ts",
              "MoppetVideo",
              outPath,
              `--props=${propsPath}`,
              "--public-dir=public",
              "--browser-executable=/usr/bin/chromium",
              "--codec=h264",
              "--overwrite",
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          activeProc = proc;
          let tail = "";
          const onData = (buf: Buffer) => {
            const text = buf.toString();
            tail = (tail + text).slice(-600);
            const m = /(?:Rendered|Encoded)\s+(\d+)\/(\d+)/i.exec(text);
            if (m) {
              const cur = Number(m[1]), total = Math.max(1, Number(m[2]));
              job = { ...job, progress: Math.min(0.99, cur / total), message: `${m[0]} (${Math.round((cur / total) * 100)}%)` };
            } else {
              const last = text.trim().split(/[\r\n]+/).filter(Boolean).pop();
              if (last) job = { ...job, message: last.slice(0, 140) };
            }
          };
          proc.stdout.on("data", onData);
          proc.stderr.on("data", onData);
          proc.on("close", (code) => {
            if (activeProc === proc) activeProc = null;
            if (job.id !== id) return;
            job = code === 0
              ? { ...job, status: "done", progress: 1, outputUrl: `/__video/media/${slug}/${outFile}`, message: `Rendered ${outFile}` }
              : { ...job, status: "error", error: tail || `Render exited ${code}`, message: "Remotion render failed." };
          });
          sendJson(res, 202, job);
        } catch (e) {
          sendText(res, 400, e instanceof Error ? e.message : String(e));
        }
      });

      server.middlewares.use("/__video/cancel", (req, res) => {
        if (req.method !== "POST") return sendText(res, 405, "POST only");
        if (activeProc) {
          activeProc.kill("SIGTERM");
          activeProc = null;
          job = { ...job, status: "idle", progress: 0, message: "Cancelled." };
        }
        sendJson(res, 200, job);
      });
    },
  };
}
