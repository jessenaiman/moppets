/**
 * Unified Character Bible Inspector (`CastReferences.tsx`, `S-5`, `D-9`):
 * Reads 100% of character portraits, Bible hero plates, provenance notes, CHIMERA voice recipes,
 * IK joints, and stage clips from the single Character Bible manifest (`CAST_MANIFEST` + `CAST`).
 */
import { useState } from "react";
import { BIBLE_SOLO_ORDER } from "../choir/bibleSolos.ts";
import { CAST_MANIFEST } from "../choir/castManifest.ts";
import { auditionNote } from "../choir/live.ts";
import { noteName } from "../choir/music.ts";
import { triggerCharacterAction } from "../choir/stageActionBus.ts";
import { useMoppet, type Lesson } from "../choir/store.ts";
import { CAST } from "../choir/voices.ts";

function CastImageOrInitials({
  src,
  alt,
  name,
  color,
}: {
  src?: string;
  alt: string;
  name: string;
  color: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    return (
      <div
        role="img"
        aria-label={alt}
        style={{ borderColor: `${color}80`, color }}
        className="mx-auto flex h-36 w-28 items-center justify-center rounded-lg border bg-[#1b120c] font-mono text-2xl font-bold"
      >
        {initials || "?"}
      </div>
    );
  }
  return <img src={src} alt={alt} onError={() => setFailed(true)} className="mx-auto h-36 object-contain" />;
}

export function CastReferences() {
  const setLesson = useMoppet((s) => s.setLesson);
  const select = useMoppet((s) => s.select);
  const voices = useMoppet((s) => s.voices);
  const [selectedId, setSelectedId] = useState<string>("tabby");

  const entry = BIBLE_SOLO_ORDER.find((e) => e.castId === selectedId) ?? BIBLE_SOLO_ORDER[0];
  const ch = CAST_MANIFEST.characters[entry.castId];
  const voice = voices.find((v) => v.id === entry.voiceId) ?? CAST.find((v) => v.id === entry.voiceId);
  if (!ch) return null;

  const heroUrl = ch.bibleAudit?.bibleHeroUrl ?? ch.portraitUrl;

  return (
    <section
      className="rounded-xl border border-[#745438]/65 bg-[#1b120c] p-4 text-[#f8efe2] space-y-3"
      aria-label="Character bible"
      data-testid="character-bible-inspector"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#745438]/40 pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#e3bd7f]">
            Character Bible
            <select
              aria-label="Character"
              value={entry.castId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedId(nextId);
                const vIdx = voices.findIndex((v) => v.id === nextId);
                if (vIdx >= 0) select(vIdx);
              }}
              className="rounded-md border border-[#745438] bg-[#2a1c13] px-2.5 py-1 text-sm font-semibold text-[#fff4df]"
            >
              {BIBLE_SOLO_ORDER.map((b) => {
                const c = CAST_MANIFEST.characters[b.castId];
                return (
                  <option key={b.castId} value={b.castId}>
                    {c?.displayName ?? b.castId} · {c?.role ?? ""}
                  </option>
                );
              })}
            </select>
          </label>

          <span className="rounded-full border border-emerald-500/45 bg-emerald-950/60 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-200">
            ✓ {ch.bibleAudit?.bibleFile ?? `${ch.bibleDir}.designcraft`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {voice && (
            <button
              type="button"
              onClick={() => void auditionNote(voice, Math.round((voice.register[0] + voice.register[1]) / 2), "ah", 440)}
              className="rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 cursor-pointer"
            >
              ♪ Audition CHIMERA Voice
            </button>
          )}
          <button
            type="button"
            onClick={() => setLesson(entry.lessonId as Lesson)}
            className="rounded-lg border border-[#e3bd7f]/70 bg-[#322216] px-3 py-1 text-xs font-bold text-[#fff4df] hover:bg-[#412c1d] cursor-pointer"
          >
            ▶ Rehearse {ch.displayName}’s Bible Solo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
          <figure className="rounded-lg border border-[#745438]/45 bg-[#120b08] p-2 text-center">
            <CastImageOrInitials
              key={`hero-${ch.id}-${heroUrl}`}
              src={heroUrl}
              alt={`${ch.displayName} Canon Bible Hero`}
              name={ch.displayName}
              color={ch.color}
            />
            <figcaption className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#e3bd7f]">
              Canon Bible Hero
            </figcaption>
          </figure>
          <figure className="rounded-lg border border-[#745438]/45 bg-[#120b08] p-2 text-center">
            <CastImageOrInitials
              key={`port-${ch.id}-${ch.portraitUrl}`}
              src={ch.portraitUrl}
              alt={`${ch.displayName} Stage Portrait`}
              name={ch.displayName}
              color={ch.color}
            />
            <figcaption className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#50cfad]">
              Stage Atlas Frame 0
            </figcaption>
          </figure>
        </div>

        <div className="space-y-2.5">
          <div>
            <h3 className="text-lg font-bold text-[#fff4df]">
              {ch.displayName} <span className="text-sm font-normal text-[#c7b194]">· {ch.role}</span>
            </h3>
            {ch.bibleAudit?.notes && <p className="mt-1 text-xs text-[#d6c2a5]">{ch.bibleAudit.notes}</p>}
          </div>

          {voice && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#745438]/40 bg-[#140d09] p-2.5 font-mono text-xs sm:grid-cols-4">
              <div>
                <span className="block text-[10px] text-[#a79072]">REGISTER</span>
                <strong>
                  {noteName(voice.register[0])}–{noteName(voice.register[1])}
                </strong>
              </div>
              <div>
                <span className="block text-[10px] text-[#a79072]">AIRWAY SIZE</span>
                <strong>{(voice.size ?? 1).toFixed(2)}× ({ch.heightDu} DU)</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[#a79072]">PRESSURE / TENSION</span>
                <strong>
                  {voice.source.pressure.toFixed(1)} cmH₂O · {voice.source.tension.toFixed(2)}
                </strong>
              </div>
              <div>
                <span className="block text-[10px] text-[#a79072]">VOCAL SYNC</span>
                <strong>{ch.vocalSyncSpec.mode}</strong>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#e3bd7f]">
              Verified Character Bible Clips &amp; Directed Takes ({Object.keys(ch.clips).length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ch.clips).map(([clipKey, clip]) => (
                <button
                  key={clipKey}
                  type="button"
                  onClick={() => triggerCharacterAction(ch.id, clipKey, { voiceId: ch.id })}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#745438]/65 bg-[#261a12] px-2.5 py-1 text-xs font-semibold text-[#fff4df] hover:border-[#50cfad] cursor-pointer"
                >
                  <span>▶ {clipKey}</span>
                  <span className="font-mono text-[10px] text-[#b9a386]">
                    {clip.frames}f@{clip.fps}fps
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-[#c7b194]">
            <strong>Vocal &amp; Acting Focus:</strong> {entry.vocalSyncFocus} · {entry.ikFocus}
          </p>
        </div>
      </div>
    </section>
  );
}
