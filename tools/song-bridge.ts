/**
 * Dev-server bridge for the words editor: POST /__songs/save {file, text} writes a lead sheet into
 * songs/ (an existing file only, and only text that parses as one), so a good edit is a commit away.
 * The app already shows what it saved, so Vite's reload for that write is skipped (it would reset
 * the page); a change made in an editor outside the app still reloads as usual.
 * Only `vite` dev serves this; a build downloads the file instead.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { parseSongFile } from "../src/choir/songFile.ts";

const DIR = resolve("songs");

export function songBridge(): Plugin {
  const ours = new Map<string, string>(); // path → the text we just wrote
  return {
    name: "song-bridge",
    apply: "serve",
    handleHotUpdate(ctx) {
      const text = ours.get(ctx.file);
      if (text !== undefined && readFileSync(ctx.file, "utf8") === text) {
        ours.delete(ctx.file);
        return [];
      }
    },
    configureServer(server) {
      server.middlewares.use("/__songs/save", (req, res) => {
        const reply = (code: number, msg: string) => ((res.statusCode = code), res.setHeader("content-type", "text/plain"), res.end(msg));
        if (req.method !== "POST") return reply(405, "POST only");
        let body = "";
        req.on("data", (c: Buffer) => (body += c));
        req.on("end", () => {
          try {
            const { file, text } = JSON.parse(body) as { file: string; text: string };
            if (!/^[a-z0-9-]+\.song$/.test(file)) return reply(400, `"${file}" is not a song file name`);
            const path = `${DIR}/${file}`;
            if (!existsSync(path)) return reply(404, `songs/${file} doesn't exist (a new song is added by hand, see docs/writing-songs.md)`);
            parseSongFile(text, `songs/${file}`); // never write a file the app can't read back
            ours.set(path, text);
            writeFileSync(path, text);
            reply(200, `saved songs/${file}`);
          } catch (e) {
            reply(400, e instanceof Error ? e.message : String(e));
          }
        });
      });
    },
  };
}
