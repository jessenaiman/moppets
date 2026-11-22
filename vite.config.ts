import { rehearsalStudio } from "./tools/rehearsal-studio";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { soundcraftBridge } from "./tools/soundcraft-bridge.ts";
import { claudeWriter } from "./tools/claude-writer.ts";
import { songBridge } from "./tools/song-bridge.ts";
import { videoBridge } from "./tools/video-bridge.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** CHIMERA, pinned in chimera/ (a git submodule, never edited): its TypeScript is imported as @chimera/… */
const chimera = fileURLToPath(new URL("./chimera/src", import.meta.url));

/** songs/*.song lead sheets import as their text (as bunfig.toml's loader does for bun). */
const songText = { name: "song-text", load: (id: string) => (id.endsWith(".song") ? `export default ${JSON.stringify(readFileSync(id, "utf8"))};` : null) };

export default defineConfig({
  plugins: [tailwindcss(), rehearsalStudio(), songText, react(), soundcraftBridge(), claudeWriter(), songBridge(), videoBridge()],
  resolve: {
    alias: [
      { find: /^@chimera\//, replacement: `${chimera}/` },
    ],
  },
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: { host: "127.0.0.1", port: 5417, strictPort: true, allowedHosts: true },
  preview: { host: "127.0.0.1", port: 5418, strictPort: true, allowedHosts: true },
});
