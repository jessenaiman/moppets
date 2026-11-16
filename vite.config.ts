import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { soundcraftBridge } from "./tools/soundcraft-bridge.ts";
import { roundWriter } from "./tools/round-writer.ts";

export default defineConfig({
  plugins: [react(), soundcraftBridge(), roundWriter()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: { host: "127.0.0.1", port: 5317, strictPort: true, allowedHosts: true },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true, allowedHosts: true },
});
