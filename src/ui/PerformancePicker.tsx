import { useMemo, useState } from "react";
import { resolvePerformerIdentity } from "../choir/performer.ts";
import { SKITS } from "../choir/skits.ts";
import { SONGBOOK } from "../choir/songbook.ts";
import { useMoppet, type Lesson } from "../choir/store.ts";
import { WORLD_LENSES, type WorldLens } from "../stage/worlds.ts";

const repertoire = [
  ...SONGBOOK.map(({ id, song }) => ({
    id, title: song.title,
    cast: [song.lead, ...(song.stage ?? song.seats.map(([singer]) => singer))],
  })),
  { id: "round", title: "The Jam Round", cast: ["vee", "clank", "scribe"] },
  ...SKITS.map(skit => ({ id: skit.id, title: skit.title, cast: skit.scenes.flatMap(scene => scene.map(line => line.who)) })),
] satisfies { id: Lesson; title: string; cast: string[] }[];

const places: Record<WorldLens, string> = {
  diorama: "/rehearsal/sets/gruff.webp",
  caravan: "/rehearsal/sets/gruff-bench.webp",
  filmstrip: "/rehearsal/sets/neon-repair.webp",
  chimera: "/rehearsal/sets/watt.webp",
  signal: "/rehearsal/sets/zap-crt-playing.webp",
  zine: "/rehearsal/sets/chip.webp",
  vinyl: "/rehearsal/sets/neon.webp",
  archive: "/rehearsal/sets/right-on-cue.webp",
};
const originalArt = new Set(["chip", "clank", "gruff", "pip", "scribe", "tabby", "vee", "zap"]);
const choiceClass = "shrink-0 snap-start overflow-hidden rounded-lg border border-white/20 bg-[#251b15] text-left hover:border-[#e3bd7f] aria-pressed:border-[#50cfad] aria-pressed:bg-[#18332b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#50cfad]";

export function PerformancePicker({ world, onWorldChange }: {
  world: WorldLens;
  onWorldChange: (id: WorldLens) => void;
}) {
  const lesson = useMoppet(s => s.lesson);
  const setLesson = useMoppet(s => s.setLesson);
  const studio404 = useMoppet(s => s.studio404);
  const voices = useMoppet(s => s.voices);
  const [showPlaces, setShowPlaces] = useState(false);
  const [search, setSearch] = useState("");

  const songs = useMemo(() => repertoire.map(entry => {
    const cast = [...new Set(entry.cast)].flatMap(id => {
      const voice = voices.find(v => v.id === id);
      return voice ? [resolvePerformerIdentity(voice, studio404, entry.title)] : [];
    });
    const lead = cast[0];
    const artist = cast.length > 2 ? `${lead.name} & company` : cast.map(voice => voice.name).join(" & ") || "The Moppets";
    const art = entry.title === "Borrowed Light" ? "/rehearsal/moonbeam/idle.webp"
      : lead && originalArt.has(lead.artKey) ? `/moppets/${lead.artKey}/closed.webp`
      : `/rehearsal/img/${lead?.artKey ?? "neon"}-rest.webp`;
    return { ...entry, artist, art, color: lead?.color ?? "#e3bd7f" };
  }), [studio404, voices]);

  const query = search.trim().toLowerCase();
  const filtered = songs.filter(song => `${song.title} ${song.artist}`.toLowerCase().includes(query));

  return (
    <section aria-label="Performance picker" className="min-w-0 rounded-xl border border-[#745438]/60 bg-[#1a120d] p-2.5 text-[#f8efe2]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Browse the performance" className="flex gap-1">
          <button type="button" aria-pressed={!showPlaces} onClick={() => setShowPlaces(false)} className="min-h-11 rounded-md px-3 text-sm font-semibold aria-pressed:bg-[#284338]">
            Playlist
          </button>
          <button type="button" aria-pressed={showPlaces} onClick={() => setShowPlaces(true)} className="min-h-11 rounded-md px-3 text-sm font-semibold aria-pressed:bg-[#284338]">
            Places
          </button>
        </div>
        {!showPlaces && (
          <input type="search" aria-label="Find a song or performer" placeholder="Find a song or performer"
            value={search} onChange={event => setSearch(event.target.value)}
            className="ml-auto min-h-11 w-44 max-w-full rounded-md border border-white/20 bg-black/30 px-2 text-sm sm:w-60" />
        )}
      </div>
      {showPlaces ? (
        <div className="flex snap-x gap-2 overflow-x-auto px-0.5 py-1.5" aria-label="Stage places">
          {WORLD_LENSES.map(place => (
            <button key={place.id} type="button" aria-pressed={world === place.id} onClick={() => onWorldChange(place.id)}
              title={place.tagline} className={`${choiceClass} w-28`}>
              <img src={places[place.id]} alt="" loading="lazy" className="aspect-video w-full object-cover" />
              <span className="block px-2 py-1.5 text-xs font-semibold">{place.shortLabel}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex snap-x gap-2 overflow-x-auto px-0.5 py-1.5" aria-label="Songs and skits">
          {filtered.length === 0 && <p role="status" className="px-2 text-sm">No matching performances.</p>}
          {filtered.map(song => (
            <button key={song.id} type="button" aria-pressed={lesson === song.id}
              onClick={() => { if (lesson !== song.id) setLesson(song.id); }} className={`${choiceClass} w-36`}>
              <img src={song.art} alt="" loading="lazy" className="h-14 w-full object-contain"
                style={{ background: `linear-gradient(135deg, ${song.color}50, #16110d 85%)` }} />
              <span className="block px-2 pt-1.5 text-xs leading-tight font-semibold">{song.title}</span>
              <span className="block px-2 pt-0.5 pb-1.5 text-[11px] leading-tight text-[#d8c8b0]">{song.artist}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
