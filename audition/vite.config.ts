import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;
const repo = resolve(root, "..");

export default defineConfig({
  root,
  publicDir: resolve(repo, "out/audition-public"),
  resolve: { alias: { "@chimera": resolve(repo, "chimera/src") } },
  plugins: [tailwindcss(), {
    name: "moppet-song-text",
    load(id) {
      if (id.endsWith(".song")) return `export default ${JSON.stringify(readFileSync(id, "utf8"))}`;
    },
  }],
  build: { target: "es2022", outDir: resolve(repo, "out/audition-site"), emptyOutDir: true },
  worker: { format: "es" },
});
