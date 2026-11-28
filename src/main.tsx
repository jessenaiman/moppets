/**
 * Entry: load the engine first (our wasm: CHIMERA's C ABI plus the Moppet voices, built from
 * crates/moppet-wasm), since CHIMERA's TypeScript calls it as its modules load; then import and
 * render the app. A failed load can be retried.
 */
import "@chimera/ui/styles.css";
import "./ui/tailwind.css";
import { initChimera } from "@chimera/wasm/chimera.ts";
import moppetWasm from "./audio/moppet.wasm?url";

const root = document.getElementById("root")!;

async function boot(): Promise<void> {
  try {
    await initChimera(moppetWasm);
  } catch (err) {
    root.replaceChildren();
    const box = document.createElement("div");
    box.className = "boot-error";
    const msg = document.createElement("p");
    msg.textContent = `The voice engine could not load: ${err instanceof Error ? err.message : String(err)}`;
    const retry = document.createElement("button");
    retry.className = "primary";
    retry.textContent = "Try again";
    retry.onclick = () => void boot();
    box.append(msg, retry);
    root.append(box);
    return;
  }
  // Skit line durations and live CHIMERA lyric planning use CMUdict; warm it immediately in both dev & prod.
  const g2pPromise = import("./audio/g2p.ts").then(({ g2p }) => g2p.load()).catch(() => undefined);
  if (import.meta.env.PROD) {
    await g2pPromise;
  }
  const { mount } = await import("./ui/mount.tsx");
  mount(root);
}

void boot();
