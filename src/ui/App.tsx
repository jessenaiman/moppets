/**
 * The Moppets app: the stage, the score and the workbench, on CHIMERA's engine
 * with Tailwind CSS v4 responsive layout and clear direct volume control.
 */
import { useRef } from "react";
import { useAudio } from "../audio/audio.ts";
import { MoppetRight } from "./MoppetPanel.tsx";

import { CastGallery } from "./CastGallery";
import { ScreeningRoom } from "./ScreeningRoom";
import { useMoppet } from "../choir/store";

function TopBar() {
  const lesson = useMoppet(s => s.lesson);
  const volume = useAudio((s) => s.volume);
  const setVolume = useAudio((s) => s.setVolume);
  const lastAudible = useRef(1);
  const muted = volume <= 0.001;
  const toggleMute = () => {
    if (muted) {
      setVolume(lastAudible.current > 0.05 ? lastAudible.current : 1);
    } else {
      lastAudible.current = volume;
      setVolume(0);
    }
  };
  return (
    <header className="topbar organ-nameplate">
      <div className="brand organ-plaque">
        <span className="wordmark">Moppets</span>
        <span className="tagline">CHIMERA Physical Choir · Interactive Worlds</span>
      </div>
      <div className="topbar-right">
        <a href="?cast" className="px-2 py-2 text-sm underline">Cast</a>
        <a href={'?watch='+encodeURIComponent(lesson)} className="rounded-md border border-[#62ceac] bg-[#204638] px-3 py-2 text-sm font-bold text-white">Watch performances</a>
        <div className="topbar-volume" aria-label="Master audio volume">
          <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute master volume" : "Mute master volume"} title={muted ? "Unmute" : "Mute"}>
            {muted ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
          </button>
          <label className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#f8efe2]">
            <span>Volume</span>
            <input
              aria-label="Master volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
          <output>{Math.round(volume * 100)}%</output>
        </div>
      </div>
    </header>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("cast")) return <CastGallery/>;
  const watch = params.get("watch");
  if (watch !== null) return <ScreeningRoom id={watch}/>;
  return (
    <div className="app text-colors mode-moppet">
      <TopBar />
      <main className="wall wall-moppet view-stage"><MoppetRight /></main>
    </div>
  );
}
