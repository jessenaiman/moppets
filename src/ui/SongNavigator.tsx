/**
 * Interactive Vinyl Crates Coverflow + Expandable Poster Deck (`S-30` · `D-65`).
 * Styled in Dark Phosphor Studio (`#11161C`, `#182028`, `#283542`, `#34D399`, `#F5B851`).
 */
import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Disc3, LayoutGrid, Plus, X } from "lucide-react";
import { play, useEnsemble } from "../choir/ensemble.ts";
import { useAudio } from "../audio/audio.ts";
import { SONGBOOK } from "../choir/songbook.ts";
import { SKITS } from "../choir/skits.ts";
import { CAST } from "../choir/voices.ts";
import { resolvePerformerIdentity } from "../choir/performer.ts";
import { getCastCharacter } from "../choir/castManifest.ts";
import { useMoppet, type Lesson } from "../choir/store.ts";
import { NewRehearsal } from "./NewRehearsal.tsx";

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
  return getCastCharacter(artKey)?.portraitUrl ?? `/rehearsal/img/${artKey}-rest.webp`;
}

export function buildCatalog(studio404: boolean, freshSkitTitle?: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  const resolveCastFromIds = (ids: readonly string[], title: string) => {
    const unique = [...new Set(ids)].filter((id) => id !== "band");
    const list = (unique.length ? unique : ["neon"]).slice(0, 4).map((id) => {
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
      leadColor: cast[0]?.color ?? "#34D399",
      accentB: cast[1]?.color ?? cast[0]?.accentB ?? "#F5B851",
    });
  }

  entries.push({
    id: "intro",
    title: "The First Hello",
    label: "Start · The First Hello",
    category: "choir",
    bpm: 116,
    keyLabel: "D major",
    cast: resolveCastFromIds(["neon", "cue", "tabby", "gruff"], "The First Hello"),
    leadColor: "#34D399",
    accentB: "#F5B851",
  });

  entries.push({
    id: "round",
    title: "The Jam Round",
    label: "Start · The Jam Round",
    category: "choir",
    bpm: 108,
    keyLabel: "D major",
    cast: resolveCastFromIds(["neon", "clank", "cue", "gruff"], "The Jam Round"),
    leadColor: "#34D399",
    accentB: "#F5B851",
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
      leadColor: cast[0]?.color ?? "#F5B851",
      accentB: cast[1]?.color ?? "#34D399",
    });
  }

  if (freshSkitTitle) {
    entries.push({
      id: "newskit",
      title: freshSkitTitle,
      label: `New · ${freshSkitTitle}`,
      category: "skit",
      bpm: 0,
      keyLabel: "Spoken Skit",
      cast: resolveCastFromIds(["neon", "cue"], freshSkitTitle),
      leadColor: "#34D399",
      accentB: "#F5B851",
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
  const [newOpen, setNewOpen] = useState(false);
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
    <section
      className="rounded-xl border border-[#283542] bg-[#11161C] p-3 text-[#F1F5F9] space-y-2.5"
      aria-label="Interactive song and skit navigator"
    >
      {/* Top Row: Category Pills + Prev/Next + Poster Wall + New Song/Skit */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter songs by category">
          <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase text-[#A8B8C8]">
            <Disc3 className="size-3.5 text-[#34D399]" />
            Vinyl Crates
          </span>
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
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                filter === key
                  ? "border-[#34D399] bg-[#34D399]/15 text-[#34D399]"
                  : "border-[#283542] bg-[#182028] text-[#A8B8C8] hover:border-[#34D399]/50 hover:text-[#F1F5F9]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous song"
            onClick={() => stepSong(-1)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#283542] bg-[#182028] px-2.5 py-1 text-xs font-semibold text-[#F1F5F9] hover:border-[#34D399] cursor-pointer"
          >
            <ChevronLeft className="size-3.5" />
            Prev
          </button>
          <button
            type="button"
            aria-label="Next song"
            onClick={() => stepSong(1)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#283542] bg-[#182028] px-2.5 py-1 text-xs font-semibold text-[#F1F5F9] hover:border-[#34D399] cursor-pointer"
          >
            Next
            <ChevronRight className="size-3.5" />
          </button>
          <button
            type="button"
            aria-expanded={posterOpen}
            onClick={() => setPosterOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
              posterOpen
                ? "border-[#34D399] bg-[#34D399]/15 text-[#34D399]"
                : "border-[#283542] bg-[#182028] text-[#F1F5F9] hover:border-[#34D399]"
            }`}
          >
            <LayoutGrid className="size-3.5" />
            {posterOpen ? "Close Wall" : "Poster Wall"}
          </button>
          <button
            type="button"
            aria-expanded={newOpen}
            onClick={() => setNewOpen((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
              newOpen
                ? "border-[#F5B851] bg-[#F5B851]/15 text-[#F5B851]"
                : "border-[#283542] bg-[#182028] text-[#F1F5F9] hover:border-[#F5B851]"
            }`}
          >
            {newOpen ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            New Song / Skit
          </button>
        </div>
      </div>

      {newOpen && <NewRehearsal />}

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
              className={`group relative flex w-[224px] shrink-0 items-center gap-2.5 rounded-xl border p-2 text-left transition-colors cursor-pointer ${
                active
                  ? "border-[#34D399] bg-[#182028] ring-1 ring-[#34D399]/50"
                  : "border-[#283542] bg-[#182028]/80 hover:border-[#A8B8C8]/60 hover:bg-[#182028]"
              }`}
            >
              <div className="relative flex h-12 w-12 shrink-0 items-end justify-center overflow-hidden rounded-lg border border-[#283542] bg-[#0A0D10]">
                <img
                  src={portrait(item.cast[0]?.artKey ?? "neon")}
                  alt=""
                  className="h-11 w-11 object-contain"
                  loading="lazy"
                />
                {active && (
                  <span className="absolute top-1 right-1 size-2 rounded-full bg-[#34D399]" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className="rounded border border-[#283542] bg-[#11161C] px-1.5 py-0.5 text-xs font-bold uppercase"
                    style={{ color: item.leadColor }}
                  >
                    {item.category}
                  </span>
                  <span className="truncate text-xs text-[#A8B8C8]">
                    {item.bpm > 0 ? `${item.bpm} BPM` : "Spoken"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs font-bold text-[#F1F5F9]">{item.title}</div>
                <div className="truncate text-xs text-[#A8B8C8]">
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
          className="grid grid-cols-2 gap-2.5 border-t border-[#283542] pt-2.5 sm:grid-cols-3 lg:grid-cols-4"
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
                className={`flex flex-col justify-between rounded-xl border p-2.5 text-left cursor-pointer transition-colors ${
                  active
                    ? "border-[#34D399] bg-[#182028]"
                    : "border-[#283542] bg-[#182028]/80 hover:border-[#A8B8C8]"
                }`}
              >
                <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase">
                  <span style={{ color: item.leadColor }}>{item.category}</span>
                  <span className="text-[#A8B8C8]">{item.keyLabel}</span>
                </div>
                <div className="mb-2 flex h-20 items-end justify-center gap-1 overflow-hidden rounded-lg bg-[#0A0D10] px-2 pt-2">
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
                <div className="truncate text-sm font-bold text-[#F1F5F9]">{item.title}</div>
                <div className="truncate text-xs text-[#A8B8C8]">
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
