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
  // Skit line durations use the same syllable dictionary as the published recordings.
  if (import.meta.env.PROD) {
    const { g2p } = await import("./audio/g2p.ts");
    await g2p.load().catch(() => undefined);
  }
  const { mount } = await import("./ui/mount.tsx");
  mount(root);
}

void boot();
