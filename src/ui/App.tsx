/**
 * The Moppets app: the stage, the score and the workbench, on CHIMERA's vector-display look
 * (its stylesheet and Screen, imported from the pinned chimera/).
 */
import { useAudio } from "../audio/audio.ts";
import { MoppetRight } from "./MoppetPanel.tsx";

function TopBar() {
  const volume = useAudio((s) => s.volume);
  const setVolume = useAudio((s) => s.setVolume);
  return (
    <header className="topbar organ-nameplate">
      <div className="brand organ-plaque">
        <span className="wordmark">Moppets</span>
        <span className="tagline">Studio 404 · Song and skit rehearsal</span>
      </div>
      <div className="topbar-right">
        <label className="volume organ-swell">
          <span>Swell</span>
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ "--pos": `${volume * 100}%` } as React.CSSProperties} />
        </label>
      </div>
    </header>
  );
}

export function App() {
  return (
    <div className="app text-colors mode-moppet">
      <TopBar/>
      <main className="wall wall-moppet view-stage"><MoppetRight/></main>
    </div>
  );
}
