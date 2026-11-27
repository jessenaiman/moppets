import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { engine } from "../audio/AudioEngine.ts";
import { inPlugin } from "../audio/pluginBridge.ts";

const ChimeraApp = lazy(() => import("./App.tsx").then((m) => ({ default: m.App })));
const MoppetStudioApp = lazy(() =>
  import("../moppets/MoppetStudioApp.tsx").then((m) => ({ default: m.MoppetStudioApp })),
);

function useClassicChimera(): boolean {
  if (inPlugin) return true;
  const q = new URLSearchParams(window.location.search);
  return q.get("view") === "chimera" || q.has("show");
}

export async function mount(root: HTMLElement): Promise<void> {
  // the stores start from the plugin's state, or a first render would show (and a control could send) defaults
  if (inPlugin) await (await import("./pluginState.ts")).attachToPlugin();
  // console/debug handle (used by the browser smoke test)
  (window as unknown as { __chimeraEngine: typeof engine }).__chimeraEngine = engine;
  const classic = useClassicChimera();
  root.replaceChildren();
  createRoot(root).render(
    <StrictMode>
      <Suspense fallback={null}>{classic ? <ChimeraApp /> : <MoppetStudioApp />}</Suspense>
    </StrictMode>,
  );
}
