import { exposureCatalog } from "../rehearsal/CastExposure";
import { useEffect, useState } from "react";

export const compositions = [
  "MoppetVideo",
  "Cue-Bench-Pack",
  "Neon-Actions",
  ...exposureCatalog.map((s) => s.id),
] as const;
export type StudioComposition = (typeof compositions)[number];

export function RemotionDock({
  composition,
  setComposition,
}: {
  composition: StudioComposition;
  setComposition: (id: StudioComposition) => void;
}) {
  const [origin, setOrigin] = useState("");
  const [search, setSearch] = useState("");
  const matches = (name: string) => name.toLowerCase().includes(search.toLowerCase());

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let mounted = true;
    fetch("/__rehearsal/studio", { method: "POST" })
      .then(async (response) => {
        if (!response.ok) return;
        const { port } = (await response.json()) as { port: number };
        if (mounted) setOrigin(`${location.protocol}//${location.hostname}:${port}`);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section className="studio-dock" aria-label="Remotion Studio">
      <aside className="studio-compositions" aria-label="Composition library">
        <input
          type="search"
          aria-label="Search compositions"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="studio-library-list">
          {compositions
            .filter((id) => matches(id.replaceAll("-", " ")))
            .map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={id === composition}
                onClick={() => {
                  if (id !== composition) setComposition(id);
                }}
              >
                {id.replaceAll("-", " ")}
              </button>
            ))}
        </div>
      </aside>
      {origin ? (
        <iframe
          key={composition}
          title="Remotion Studio"
          referrerPolicy="origin"
          src={`${origin}/${composition}`}
        />
      ) : (
        <p className="vs-meta">
          Run <code>bunx remotion studio src/remotion/index.ts</code> to inspect compositions in Remotion Studio.
        </p>
      )}
    </section>
  );
}
