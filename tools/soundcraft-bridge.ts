/**
 * Dev-server bridge to SoundCraft, so the Moppet score can be edited there (a browser page can't
 * start an app, and SoundCraft's control channel is raw TCP, not HTTP):
 *
 *  POST /__soundcraft/open?name=x.mid  (body: the MIDI)  writes out/soundcraft/x.mid and opens it in a
 *                                      new SoundCraft window with a control port
 *  POST /__soundcraft/pull             exports that window's MIDI (all tracks) and returns it
 *  GET  /__soundcraft/ping             204 when SoundCraft is installed
 *
 * Only `vite` dev serves these; a build has no bridge and the page falls back to a file picker.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const DIR = resolve("out/soundcraft");
const which = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;

export function soundcraftBridge(): Plugin {
  let port: number | null = null, name = "moppet-song";
  return {
    name: "soundcraft-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__soundcraft", (req, res) => {
        const fail = (code: number, msg: string) => ((res.statusCode = code), res.setHeader("content-type", "text/plain"), res.end(msg));
        const url = new URL(req.url ?? "/", "http://x");
        if (url.pathname === "/ping") return fail(which("soundcraft") && which("soundcraft-cli") ? 204 : 404, "");
        if (req.method !== "POST") return fail(405, "POST only");
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", async () => {
          try {
            mkdirSync(DIR, { recursive: true });
            if (url.pathname === "/open") {
              name = (url.searchParams.get("name") ?? "moppet-song").replace(/[^a-z0-9-]/gi, "-").replace(/\.mid$/, "") || "moppet-song";
              const file = `${DIR}/${name}.mid`;
              await writeFile(file, Buffer.concat(chunks));
              port = await launch(file);
              return fail(200, `Opened ${name}.mid in SoundCraft`);
            }
            if (url.pathname === "/pull") {
              if (!port) return fail(409, "Open the song in SoundCraft first.");
              const file = `${DIR}/${name}-edited.mid`;
              const r = spawnSync("soundcraft-cli", ["app", "--port", String(port), "--compact", "file.export_midi", JSON.stringify({ path: file })], { encoding: "utf8", timeout: 10000 });
              if (r.status !== 0) return fail(502, port && /refused|connect/i.test(r.stderr) ? "That SoundCraft window is closed. Open the song again." : r.stderr || "SoundCraft didn't answer");
              res.setHeader("content-type", "audio/midi");
              return res.end(readFileSync(file));
            }
            fail(404, "no such bridge call");
          } catch (e) {
            fail(500, String(e instanceof Error ? e.message : e));
          }
        });
      });
    },
  };
}

/** Start SoundCraft on the file and resolve with the control port it prints. */
function launch(file: string): Promise<number> {
  return new Promise((ok, no) => {
    const app = spawn("soundcraft", ["--control", "0", "--", file], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => no(new Error("SoundCraft didn't start in 15 s")), 15000);
    const read = (b: Buffer) => {
      out += b;
      const m = /SOUNDCRAFT_CONTROL_PORT=(\d+)/.exec(out);
      if (!m) return;
      clearTimeout(timer);
      app.stdout.destroy();
      app.stderr.destroy();
      app.unref();
      ok(Number(m[1]));
    };
    app.stdout.on("data", read);
    app.stderr.on("data", read);
    app.on("error", (e) => (clearTimeout(timer), no(e)));
    app.on("exit", (code) => (clearTimeout(timer), no(new Error(`SoundCraft exited (${code})`))));
  });
}
