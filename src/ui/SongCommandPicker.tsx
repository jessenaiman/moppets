import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Music2, Search } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { play, useEnsemble } from "../choir/ensemble.ts";
import { useAudio } from "../audio/audio.ts";
import { BIBLE_SOLO_ORDER } from "../choir/bibleSolos.ts";
import { getCastCharacter } from "../choir/castManifest.ts";
import { useMoppet, type Lesson } from "../choir/store.ts";
import { buildCatalog } from "./SongNavigator.tsx";

export type SongCategoryFilter = "all" | "bibles" | "solo" | "choir" | "skit";

function portrait(artKey: string) {
  return getCastCharacter(artKey)?.portraitUrl ?? `/rehearsal/img/${artKey}-rest.webp`;
}

export function useSongCatalog() {
  const studio404 = useMoppet((s) => s.studio404);
  const freshSkit = useMoppet((s) => s.freshSkit);
  return useMemo(() => buildCatalog(studio404, freshSkit?.title), [studio404, freshSkit?.title]);
}

export function SongCommandPicker({
  live = false,
  compact = false,
  variant = "theater",
  filter = "all",
  onFilterChange,
  showCategoryPills = false,
}: {
  live?: boolean;
  compact?: boolean;
  variant?: "theater" | "console";
  filter?: SongCategoryFilter;
  onFilterChange?: (next: SongCategoryFilter) => void;
  showCategoryPills?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lesson = useMoppet((s) => s.lesson);
  const piece = useMoppet((s) => s.piece);
  const setLesson = useMoppet((s) => s.setLesson);
  const catalog = useSongCatalog();

  const currentEntry = catalog.find((c) => c.id === lesson) ?? catalog[0];
  const filtered = useMemo(() => {
    if (filter === "all") return catalog;
    if (filter === "bibles") {
      const byId = new Map(catalog.map((c) => [c.id, c]));
      return BIBLE_SOLO_ORDER.flatMap((b) => {
        const entry = byId.get(b.lessonId as Lesson);
        return entry ? [entry] : [];
      });
    }
    return catalog.filter((item) => item.category === filter);
  }, [catalog, filter]);

  const selectAct = (id: Lesson) => {
    setOpen(false);
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isConsole = variant === "console";
  const meterLabel = Array.isArray(piece.meter)
    ? `${piece.meter[0]}/${piece.meter[1]}`
    : typeof piece.meter === "string" && piece.meter.trim()
      ? piece.meter.trim()
      : "4/4";
  const metaLine = `${piece.key} ${piece.mode} · ${meterLabel} · ${piece.bpm > 0 ? `${piece.bpm} BPM` : "Spoken"}`;

  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Select song or skit (Cmd+K)"
            data-testid="song-command-trigger"
            className={`group flex items-center gap-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
              compact ? "px-2.5 py-1.5" : "px-3 py-1.5"
            } ${
              isConsole
                ? "border-emerald-500/30 bg-[#10171a] text-[#eef6f4] hover:border-emerald-400/60"
                : "border-[#8c6438]/65 bg-[#20150e]/95 text-[#f8efe2] hover:border-[#e3bd7f]"
            }`}
          >
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${
                isConsole
                  ? "border-emerald-500/35 bg-emerald-950/50 text-emerald-300"
                  : "border-[#a87b44]/60 bg-[#2d1e13] text-[#e3bd7f]"
              }`}
            >
              <Music2 className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-semibold text-sm leading-tight">
                  {currentEntry?.title ?? piece.title}
                </span>
                {!compact && (
                  <kbd
                    className={`hidden sm:inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      isConsole
                        ? "border-white/15 bg-black/40 text-emerald-300/80"
                        : "border-[#8c6438]/50 bg-[#140d09] text-[#c7b194]"
                    }`}
                  >
                    ⌘K
                  </kbd>
                )}
              </span>
              <span className="block truncate text-[11px] text-[#bfa788]">{metaLine}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-70 group-hover:opacity-100" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className={`w-[340px] p-0 ${
            isConsole
              ? "border-emerald-500/35 bg-[#10171a] text-[#eef6f4]"
              : "border-[#8c6438]/75 bg-[#1c130d] text-[#f8efe2]"
          }`}
        >
          <Command className="bg-transparent">
            <CommandInput placeholder="Search 40 songs, solos & skits…" />
            <CommandList className="max-h-80">
              <CommandEmpty>No matching act found.</CommandEmpty>
              <CommandGroup heading={`Catalog (${filtered.length})`}>
                {filtered.map((item) => {
                  const active = item.id === lesson;
                  return (
                    <CommandItem
                      key={item.id}
                      value={`${item.title} ${item.category} ${item.cast.map((c) => c.name).join(" ")}`}
                      onSelect={() => selectAct(item.id)}
                      className={`flex items-center gap-2.5 px-2.5 py-2 cursor-pointer ${
                        active ? "bg-[#e3bd7f]/20 text-white" : ""
                      }`}
                    >
                      <img
                        src={portrait(item.cast[0]?.artKey ?? "neon")}
                        alt=""
                        className="size-8 rounded bg-black/40 object-contain shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold">{item.title}</div>
                        <div className="truncate text-[10px] opacity-75">
                          {item.category.toUpperCase()} · {item.bpm > 0 ? `${item.bpm} BPM` : "Skit"} ·{" "}
                          {item.cast.map((c) => c.name).join(", ")}
                        </div>
                      </div>
                      {active && <span className="size-2 rounded-full bg-[#50cfad]" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showCategoryPills && onFilterChange && (
        <div
          className="flex flex-wrap items-center gap-1 rounded-lg border border-[#745438]/55 bg-[#1a110b]/90 p-1"
          role="group"
          aria-label="Filter songs by category"
        >
          {(
            [
              ["all", `All (${catalog.length})`],
              ["bibles", `Bibles (${BIBLE_SOLO_ORDER.length})`],
              ["solo", "Solos"],
              ["choir", "Choir"],
              ["skit", "Skits"],
            ] as const
          ).map(([key, label]) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterChange(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? "border border-[#e3bd7f] bg-gradient-to-b from-[#4a321b] to-[#2e1e10] text-[#fff6e5] shadow-[0_0_12px_rgba(227,189,127,0.22)]"
                    : "border border-transparent text-[#c7b194] hover:bg-[#2a1c13] hover:text-[#f8efe2]"
                }`}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open quick search"
            className="ml-0.5 inline-flex items-center justify-center rounded-md p-1 text-[#c7b194] hover:bg-[#2a1c13] hover:text-[#f8efe2] cursor-pointer"
          >
            <Search className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
