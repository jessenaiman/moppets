/**
 * The Moppets app: the stage, the score and the workbench, on CHIMERA's vector-display look
 * (its stylesheet and Screen, imported from the pinned chimera/).
 */
import { lazy, Suspense, useState } from "react";
import { useAudio } from "../audio/audio.ts";
import { stop } from "../choir/ensemble.ts";
import { MoppetRight } from "./MoppetPanel.tsx";

const VideoStudio = lazy(() => import("./VideoStudio.tsx"));

type WorkspaceTab = "booth" | "video";

function TopBar({ tab, setTab }: { tab: WorkspaceTab; setTab: (t: WorkspaceTab) => void }) {
  const volume = useAudio((s) => s.volume);
  const setVolume = useAudio((s) => s.setVolume);
  return (
    <header className="topbar organ-nameplate">
      <div className="brand organ-plaque">
        <span className="wordmark">Moppets</span>
        <span className="tagline">Grandfather’s Walnut Organ · Found-object voices by CHIMERA</span>
      </div>
      <div className="topbar-right">
        <nav className="app-tabs organ-rockers" aria-label="Workspace mode">
          <button
            type="button"
            className={tab === "booth" ? "on" : ""}
            aria-pressed={tab === "booth"}
            onClick={() => setTab("booth")}
          >
            Organ &amp; Stage
          </button>
          <button
            type="button"
            className={tab === "video" ? "on" : ""}
            aria-pressed={tab === "video"}
            onClick={() => {
              stop();
              setTab("video");
            }}
          >
            Video Studio
          </button>
        </nav>
        <label className="volume organ-swell">
          <span>Swell</span>
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ "--pos": `${volume * 100}%` } as React.CSSProperties} />
        </label>
      </div>
    </header>
  );
}

export function App() {
  const [tab, setTab] = useState<WorkspaceTab>("booth");
  return (
    <div className="app text-colors mode-moppet">
      <TopBar tab={tab} setTab={setTab} />
      <main className="wall wall-moppet view-stage">
        {tab === "booth" ? (
          <MoppetRight onOpenVideo={() => { stop(); setTab("video"); }} />
        ) : (
          <div className="right right-moppet right-stage">
            <Suspense fallback={<p className="moppet-status">Loading Remotion Video Studio…</p>}>
              <VideoStudio onBack={() => setTab("booth")} />
            </Suspense>
          </div>
        )}
      </main>
    </div>
  );
}
