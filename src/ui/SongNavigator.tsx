/**
 * Interactive Vinyl Crates Coverflow + Expandable Poster Deck (`S-30` · `D-65`).
 * Replaces the boring `<select>` Song/Skit dropdown with tactile visual cards showing
 * each performance's real cast portraits, accent palette, BPM/key, and category filters.
 */
import { useMemo, useRef, useState } from "react";
import { play, useEnsemble } from "../choir/ensemble.ts";
import { useAudio } from "../audio/audio.ts";
import { SONGBOOK } from "../choir/songbook.ts";
import { SKITS } from "../choir/skits.ts";
import { CAST } from "../choir/voices.ts";
import { resolvePerformerIdentity } from "../choir/performer.ts";
import { useMoppet, type Lesson } from "../choir/store.ts";

type CategoryFilter = "all" | "solo" | "choir" | "skit";

interface CatalogEntry {
  id: Lesson;
  title: string;
  label: string;
  category: "solo" | "choir" | "skit";
  bpm: number;
  keyLabel: string;
  cast: { id: string; artKey: string; name: string; color: string }[];
  leadColor: string;
  accentB: string;
}

function portrait(artKey: string) {
  if (artKey === "latch") return "/rehearsal/cast/latch/staged-front.png";
  return ["moonbeam","amplifier","click","thrum","clacker"].includes(artKey) ? `/rehearsal/cast/${artKey}/staged-front.webp` : `/rehearsal/img/${artKey}-rest.webp`;
}

export function buildCatalog(studio404: boolean, freshSkitTitle?: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  const resolveCastFromIds = (ids: readonly string[], title: string) => {
    const unique = [...new Set(ids)].filter((id) => id !== "band");
    const list = (unique.length ? unique : ["vee"]).slice(0, 4).map((id) => {
      const voice = CAST.find((v) => v.id === id) ?? CAST[0];
      const ident = resolvePerformerIdentity(voice, studio404, title);
      return { id: ident.id, artKey: ident.artKey, name: ident.name, color: ident.color, accentB: ident.accentB };
    });
    return list;
  };

  for (const song of SONGBOOK) {
    if (song.id === "intro") continue;
    const p = song.make();
    const stageIds = p.stage?.filter((id) => id !== "band");
    const castIds = stageIds && stageIds.length > 0 ? stageIds : p.tracks.map((t) => t.id);
    const cast = resolveCastFromIds(castIds, p.title);
    const isSolo = castIds.length <= 2 || /solo|take two|line\?|every button|ribbon/i.test(song.tab + " " + p.title);
    entries.push({
      id: song.id,
      title: p.title,
      label: song.tab,
      category: isSolo ? "solo" : "choir",
      bpm: p.bpm,
      keyLabel: `${p.key} ${p.mode}`,
      cast,
      leadColor: cast[0]?.color ?? "#57d3e8",
      accentB: cast[1]?.color ?? cast[0]?.accentB ?? "#e3bd7f",
    });
  }

  entries.push({
    id: "intro",
    title: "The First Hello",
    label: "Start · The First Hello",
    category: "choir",
    bpm: 112,
    keyLabel: "D major",
    cast: resolveCastFromIds(["vee", "scribe", "tabby", "gruff"], "The First Hello"),
    leadColor: "#57d3e8",
    accentB: "#e3bd7f",
  });

  entries.push({
    id: "round",
    title: "The Jam Round",
    label: "Start · The Jam Round",
    category: "choir",
    bpm: 108,
    keyLabel: "D major",
    cast: resolveCastFromIds(["vee", "clank", "scribe", "gruff"], "The Jam Round"),
    leadColor: "#50cfad",
    accentB: "#e3bd7f",
  });

  for (const skit of SKITS) {
    const castIds = skit.scenes.flatMap((sc) => sc.map((l) => l.who));
    const cast = resolveCastFromIds(castIds, skit.title);
    entries.push({
      id: skit.id,
      title: skit.title,
      label: skit.title,
      category: "skit",
      bpm: 0,
      keyLabel: "Spoken Skit",
      cast,
      leadColor: cast[0]?.color ?? "#e3bd7f",
      accentB: cast[1]?.color ?? "#e06a4f",
    });
  }

  if (freshSkitTitle) {
    entries.push({
      id: "newskit",
      title: freshSkitTitle,
      label: `New · ${freshSkitTitle}`,
      category: "skit",
      bpm: 0,
      keyLabel: "Fresh Skit",
      cast: resolveCastFromIds(["vee", "scribe"], freshSkitTitle),
      leadColor: "#57d3e8",
      accentB: "#e06a4f",
    });
  }

  return entries;
}

export function SongNavigator({ live = false }: { live?: boolean } = {}) {
  const lesson = useMoppet((s) => s.lesson);
  const setLesson = useMoppet((s) => s.setLesson);
  const studio404 = useMoppet((s) => s.studio404);
  const freshSkit = useMoppet((s) => s.freshSkit);

  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [posterOpen, setPosterOpen] = useState(false);
  const crateRef = useRef<HTMLDivElement>(null);

  const catalog = useMemo(() => buildCatalog(studio404, freshSkit?.title), [studio404, freshSkit?.title]);
  const selectAct = (id: Lesson) => {
    if (id === lesson) return;
    const status = useEnsemble.getState().status;
    setLesson(id);
    if (live && (status === "playing" || status === "buffering" || status === "preparing")) {
      void play(useAudio.getState().start);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("act", id);
    window.history.replaceState(window.history.state, "", url);
  };
  const filtered = useMemo(
    () => (filter === "all" ? catalog : catalog.filter((item) => item.category === filter)),
    [catalog, filter],
  );

  const activeIdx = Math.max(0, filtered.findIndex((c) => c.id === lesson));
  const stepSong = (delta: number) => {
    if (!filtered.length) return;
    const next = filtered[(activeIdx + delta + filtered.length) % filtered.length];
    if (next) selectAct(next.id);
  };

  return (
    <section className="mb-3 rounded-xl border border-[#745438]/60 bg-[#1a120d]/92 p-2.5 shadow-lg" aria-label="Interactive song and skit navigator">
      {/* Top Row: Category Pills + Prev/Next + Poster Wall Toggle */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter songs by category">
          <span className="mr-1 text-[11px] font-bold tracking-widest uppercase text-[#e3bd7f]">Vinyl Crates</span>
          {(
            [
              ["all", `All (${catalog.length})`],
              ["solo", "Solos"],
              ["choir", "Choir"],
              ["skit", "Skits"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                filter === key
                  ? "border-[#50cfad] bg-[#50cfad]/25 text-white"
                  : "border-[#745438]/60 bg-[#261a12] text-[#d6c2a5] hover:border-[#e3bd7f]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous song"
            onClick={() => stepSong(-1)}
            className="rounded-md border border-[#745438]/70 bg-[#261a12] px-2 py-1 text-xs font-bold text-[#f8efe2] hover:border-[#50cfad]"
          >
            ← Prev
          </button>
          <button
            type="button"
            aria-label="Next song"
            onClick={() => stepSong(1)}
            className="rounded-md border border-[#745438]/70 bg-[#261a12] px-2 py-1 text-xs font-bold text-[#f8efe2] hover:border-[#50cfad]"
          >
            Next →
          </button>
          <button
            type="button"
            aria-expanded={posterOpen}
            onClick={() => setPosterOpen((v) => !v)}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
              posterOpen
                ? "border-[#50cfad] bg-[#50cfad]/25 text-white"
                : "border-[#946738]/70 bg-[#2c1f16] text-[#f8efe2] hover:border-[#50cfad]"
            }`}
          >
            {posterOpen ? "Close Poster Wall" : "▦ Poster Wall"}
          </button>
        </div>
      </div>

      {/* Vinyl Crates Horizontal Coverflow Strip */}
      <div
        ref={crateRef}
        className="flex gap-2.5 overflow-x-auto pb-1.5"
        role="listbox"
        aria-label="Song and skit crates"
      >
        {filtered.map((item) => {
          const active = item.id === lesson;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              data-song-id={item.id}
              onClick={() => selectAct(item.id)}
              style={{
                borderColor: active ? "#50cfad" : `${item.leadColor}55`,
                background: active
                  ? `linear-gradient(135deg, rgba(24,38,34,0.96), ${item.leadColor}28)`
                  : `linear-gradient(135deg, rgba(32,22,16,0.94), ${item.leadColor}14)`,
              }}
              className={`group relative flex w-[212px] shrink-0 items-center gap-2.5 rounded-lg border p-2 text-left cursor-pointer ${
                active ? "ring-1 ring-[#50cfad] shadow-md" : "opacity-85 hover:opacity-100"
              }`}
            >
              {/* Overlapping real cast portrait sleeve */}
              <div className="relative flex h-12 w-12 shrink-0 items-end justify-center overflow-hidden rounded-md border border-white/15 bg-[#120c09]">
                <img
                  src={portrait(item.cast[0]?.artKey ?? "neon")}
                  alt=""
                  className="h-11 w-11 object-contain"
                  loading="lazy"
                />
                {active && (
                  <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-[#50cfad] shadow-[0_0_8px_#50cfad]" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                    style={{ background: `${item.leadColor}26`, color: item.leadColor }}
                  >
                    {item.category}
                  </span>
                  <span className="truncate text-[10px] text-[#c7b194]">
                    {item.bpm > 0 ? `${item.bpm} BPM` : "Skit"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs font-bold text-[#f8efe2]">{item.title}</div>
                <div className="truncate text-[10px] text-[#c7b194]">
                  {item.cast.map((c) => c.name).join(" · ")}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Expandable Poster Wall Drawer */}
      {posterOpen && (
        <div
          className="mt-2.5 grid grid-cols-2 gap-2.5 border-t border-[#745438]/50 pt-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          aria-label="Full show poster wall"
        >
          {filtered.map((item) => {
            const active = item.id === lesson;
            return (
              <button
                key={`poster-${item.id}`}
                type="button"
                onClick={() => {
                  selectAct(item.id);
                  setPosterOpen(false);
                }}
                style={{
                  borderColor: active ? "#50cfad" : `${item.leadColor}55`,
                  background: `linear-gradient(160deg, rgba(26,18,13,0.96) 0%, ${item.leadColor}22 100%)`,
                }}
                className="flex flex-col justify-between rounded-xl border p-2.5 text-left cursor-pointer hover:brightness-110"
              >
                <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                  <span style={{ color: item.leadColor }}>{item.category}</span>
                  <span className="text-[#c7b194]">{item.keyLabel}</span>
                </div>
                <div className="mb-2 flex h-20 items-end justify-center gap-1 overflow-hidden rounded-lg bg-black/30 px-2 pt-2">
                  {item.cast.slice(0, 3).map((c) => (
                    <img
                      key={c.id}
                      src={portrait(c.artKey)}
                      alt={c.name}
                      className="h-16 w-auto object-contain"
                      loading="lazy"
                    />
                  ))}
                </div>
                <div className="truncate text-sm font-bold text-[#f8efe2]">{item.title}</div>
                <div className="truncate text-[11px] text-[#c7b194]">
                  {item.cast.map((c) => c.name).join(", ")}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
