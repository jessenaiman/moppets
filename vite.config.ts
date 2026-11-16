import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { soundcraftBridge } from "./tools/soundcraft-bridge.ts";
import { claudeWriter } from "./tools/claude-writer.ts";
import { readFileSync } from "node:fs";

/** songs/*.song lead sheets import as their text (as bunfig.toml's loader does for bun). */
const songText = { name: "song-text", load: (id: string) => (id.endsWith(".song") ? `export default ${JSON.stringify(readFileSync(id, "utf8"))};` : null) };

export default defineConfig({
  plugins: [songText, react(), soundcraftBridge(), claudeWriter()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: { host: "127.0.0.1", port: 5317, strictPort: true, allowedHosts: true },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true, allowedHosts: true },
});
