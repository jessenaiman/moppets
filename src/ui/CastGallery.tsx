/**
 * Studio 404 Character Bible Gallery (`?cast`, `S-5`, `D-9`):
 * Reads 100% of all 20 Studio 404 characters, portraits, roles, CHIMERA voice parameters,
 * solo showcases, and verified Character Bible WebP clips from the single unified Bible manifest.
 */
import { BIBLE_SOLO_ORDER } from "../choir/bibleSolos.ts";
import { CAST_MANIFEST } from "../choir/castManifest.ts";
import { noteName } from "../choir/music.ts";
import { SONGBOOK } from "../choir/songbook.ts";
import { CAST } from "../choir/voices.ts";

const FEATURED_ENSEMBLE_ACT: Readonly<Record<string, string>> = {
  cue: "line",
  neon: "take-two",
  tabby: "tabby-solo",
  gruff: "close-up",
  chip: "one-more-thing",
  clank: "late-answer",
  watt: "every-socket",
  zap: "zap",
  tracker: "good-bit",
  hertz: "good-bit",
  moonbell: "borrowed-light",
  fuzz: "quiet-bar",
  click: "quiet-bar",
  thrum: "quiet-bar",
  clacker: "quiet-bar",
  deck: "deck-audition",
  tally: "tally-audition",
  ozzi: "ozzi-audition",
  folio: "found",
  leadsinger: "rock-royalty-404",
};

export function CastGallery() {
  return (
    <main className="min-h-screen bg-[#17110f] px-4 py-5 text-[#fff4df] sm:px-8" data-testid="cast-gallery">
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Studio 404 Character Bibles</h1>
            <p className="mt-1 text-xs text-[#c7b194]">
              {BIBLE_SOLO_ORDER.length} canonical characters · single Character Bible manifest + live CHIMERA voices
            </p>
          </div>
          <div className="flex gap-4 text-sm underline">
            <a href="/">Live Console</a>
            <a href="?scale">Size Chart</a>
            <a href="?watch=tabby-solo">Theater</a>
            <a href="?kids">Kids Farm (Separate)</a>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {BIBLE_SOLO_ORDER.map((entry) => {
            const ch = CAST_MANIFEST.characters[entry.castId];
            if (!ch) return null;
            const voice = CAST.find((v) => v.id === entry.voiceId);
            const featuredId = FEATURED_ENSEMBLE_ACT[entry.castId] ?? entry.lessonId;
            const featuredTitle =
              SONGBOOK.find((song) => song.id === featuredId)?.song.title ?? entry.songTitle;
            const heroUrl = ch.portraitUrl;
            const regText = voice
              ? `${noteName(voice.register[0])}–${noteName(voice.register[1])} · ${(voice.size ?? 1).toFixed(2)}× airway`
              : `${ch.heightDu} DU`;

            return (
              <article
                key={ch.id}
                data-cast-card={ch.id}
                className="flex flex-col overflow-hidden rounded-xl border border-[#705342] bg-[#241a15]"
              >
                <a
                  href={`?watch=${encodeURIComponent(entry.lessonId)}`}
                  aria-label={`Watch ${ch.displayName} in ${entry.songTitle}`}
                  className="block flex-1 p-3 hover:bg-[#2d211b] transition-colors"
                >
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-black/35 p-2">
                    <img
                      src={heroUrl}
                      alt={ch.displayName}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: ch.color, boxShadow: `0 0 8px ${ch.color}` }}
                    />
                    <h2 className="text-lg font-bold text-[#fff4df]">{ch.displayName}</h2>
                  </div>
                  <p className="mt-0.5 text-xs text-[#d6c2a5]">{ch.role}</p>
                  <p className="mt-1 font-mono text-[11px] text-[#8fe8cf]">{regText}</p>
                  <span className="mt-2 block text-xs font-semibold text-[#efd8a6]">
                    ▶ {entry.songTitle}
                  </span>
                </a>

                <div className="flex items-center justify-between border-t border-[#59473d] px-3 py-1.5 text-[11px] text-[#c7b194]">
                  <a href={`?watch=${encodeURIComponent(featuredId)}`} className="truncate underline hover:text-white">
                    {featuredTitle}
                  </a>
                  <span className="shrink-0 font-mono text-[10px] text-emerald-300">
                    {Object.keys(ch.clips).length} clips
                  </span>
                </div>

                <details className="border-t border-[#59473d] px-3 py-2 text-xs">
                  <summary className="cursor-pointer text-[#e3bd7f]">Bible clips ({Object.keys(ch.clips).length})</summary>
                  <ul className="mt-2 space-y-1.5">
                    {Object.entries(ch.clips).map(([clipKey, clip]) => (
                      <li key={clipKey} className="flex items-center justify-between gap-2">
                        <a href={clip.url} target="_blank" rel="noreferrer" className="underline hover:text-white">
                          {clipKey}
                        </a>
                        <span className="font-mono text-[10px] text-[#b9a386]">
                          {clip.frames}f · {clip.cols}×{clip.rows}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
