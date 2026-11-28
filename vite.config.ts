import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { soundcraftBridge } from "./tools/soundcraft-bridge.ts";
import { claudeWriter } from "./tools/claude-writer.ts";
import { songBridge } from "./tools/song-bridge.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL("./src", import.meta.url));
const chimeraSrc = fileURLToPath(new URL("./src/chimera", import.meta.url));
/** Local CHIMERA + Moppet sized-airway WASM built from crates/moppet-wasm + crates/chimera */
const moppetWasm = fileURLToPath(new URL("./src/audio/moppet.wasm", import.meta.url));

/** songs/*.song lead sheets import as their text (matching bunfig.toml's loader). */
const songText = {
  name: "song-text",
  load: (id: string) => (id.endsWith(".song") ? `export default ${JSON.stringify(readFileSync(id, "utf8"))};` : null),
};

export default defineConfig({
  plugins: [tailwindcss(), songText, react(), soundcraftBridge(), claudeWriter(), songBridge()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${srcRoot}/` },
      { find: /^@chimera\//, replacement: `${chimeraSrc}/` },
      { find: /^\.\/chimera\.wasm\?url$/, replacement: `${moppetWasm}?url` },
    ],
  },
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        rig: fileURLToPath(new URL("./rig.html", import.meta.url)),
      },
    },
  },
  server: { host: "127.0.0.1", port: 5317, strictPort: true, allowedHosts: true },
  preview: { host: "127.0.0.1", port: 5418, strictPort: true, allowedHosts: true },
});
