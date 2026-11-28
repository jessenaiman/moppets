import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, Sparkles, Volume2, VolumeX, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CAST_MANIFEST,
  canonicalCastId,
  getCastCharacter,
  type BibleAuditRecord,
  type CastCharacterManifest,
} from "../choir/castManifest.ts";
import { inspect, setSoloMix, useEnsemble } from "../choir/ensemble.ts";
import { auditionNote } from "../choir/live.ts";
import type { Piece } from "../choir/music.ts";
import { resolvePerformerIdentity } from "../choir/performer.ts";
import { resolveRiserCastIds } from "../choir/songCasting.ts";
import { triggerCharacterAction } from "../choir/stageActionBus.ts";
import { stageVoicesForPiece } from "../choir/stageCast.ts";
import { setVoiceLevel, useVoiceLevels } from "../choir/voiceLevels.ts";
import type { MoppetVoice } from "../choir/voices.ts";
import { useMoppet } from "../choir/store.ts";

export interface CastAuditItem {
  readonly key: string;
  readonly voiceId: string;
  readonly artKey: string;
  readonly displayName: string;
  readonly role: string;
  readonly roleTier: "downstage" | "riser" | "backstage";
  readonly color: string;
  readonly portraitUrl: string;
  readonly manifest?: CastCharacterManifest;
  readonly bibleAudit?: BibleAuditRecord;
  readonly hasAudioTrack: boolean;
  readonly actions: readonly { id: string; label: string; kind: "take" | "gag" | "gesture" }[];
}

export interface PieceBibleAuditSummary {
  readonly items: readonly CastAuditItem[];
  readonly verifiedCount: number;
  readonly legacyCount: number;
  readonly mismatchCount: number;
  readonly totalCount: number;
}

const CHARACTER_EXTRA_GAGS: Readonly<Record<string, readonly { id: string; label: string; kind: "take" | "gag" }[]>> = {
  ozzi: [{ id: "adjust-specs", label: "Adjust Specs", kind: "gag" }],
  fuzz: [{ id: "overdrive", label: "Overdrive Arc", kind: "gag" }],
  gruff: [{ id: "toaster-shrug", label: "Toaster Shrug", kind: "take" }],
  deck: [{ id: "logging-clip", label: "Logging Clip", kind: "take" }],
  cue: [
    { id: "letter", label: "Letter", kind: "take" },
    { id: "bow", label: "Bow", kind: "take" },
  ],
  chip: [{ id: "stamp", label: "Stamp", kind: "take" }],
  tabby: [
    { id: "toast", label: "Toast", kind: "take" },
    { id: "bow", label: "Bow", kind: "take" },
  ],
  tally: [{ id: "ticker-cue", label: "Ticker Cue", kind: "take" }],
  tracker: [{ id: "drawer-lead", label: "Drawer Lead", kind: "take" }],
  hertz: [{ id: "crt-answer", label: "CRT Answer", kind: "take" }],
  folio: [{ id: "chuckle", label: "Chuckle", kind: "take" }],
  neon: [{ id: "bow", label: "Bow", kind: "take" }],
};

function buildActionsForCast(artKey: string, manifest?: CastCharacterManifest) {
  const out: { id: string; label: string; kind: "take" | "gag" | "gesture" }[] = [];
  const seen = new Set<string>();
  const push = (id: string, label: string, kind: "take" | "gag" | "gesture") => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label, kind });
  };

  for (const extra of CHARACTER_EXTRA_GAGS[artKey] ?? []) {
    push(extra.id, extra.label, extra.kind);
  }
  if (manifest) {
    for (const [alias, clipKey] of Object.entries(manifest.directedTakes)) {
      if (!seen.has(clipKey)) {
        push(clipKey, clipKey.replaceAll("-", " "), "take");
      } else if (alias !== clipKey && out.length < 4 && !seen.has(alias)) {
        // Keep primary clipKey clean without duplicates
      }
    }
    for (const clipKey of Object.keys(manifest.clips)) {
      if (clipKey !== "idle" && clipKey !== "sing" && clipKey !== "sing-open" && clipKey !== "sing-closed" && clipKey !== "alt") {
        push(clipKey, clipKey.replaceAll("-", " "), "take");
      }
    }
  }
  push("sing", "Sing", "gesture");
  push("cheer", "Cheer", "gesture");
  push("shrug", "Shrug", "gesture");
  return out;
}

function summarizeAuditItems(items: readonly CastAuditItem[]): PieceBibleAuditSummary {
  let verifiedCount = 0;
  let legacyCount = 0;
  let mismatchCount = 0;
  for (const item of items) {
    const st = item.bibleAudit?.status;
    if (st === "verified-bible") verifiedCount++;
    else if (st === "mismatch") mismatchCount++;
    else legacyCount++;
  }
  return {
    items,
    verifiedCount,
    legacyCount,
    mismatchCount,
    totalCount: items.length,
  };
}

export function buildPieceBibleAuditSummary(
  piece: Piece,
  voices: readonly MoppetVoice[],
  studio404: boolean,
): PieceBibleAuditSummary {
  const stageVoices = stageVoicesForPiece(piece, voices, studio404);
  const downstageItems: CastAuditItem[] = [];
  const seenArt = new Set<string>();

  for (const sv of stageVoices) {
    const v = voices.find((x) => x.id === sv.id);
    const ident = v
      ? resolvePerformerIdentity(v, studio404, piece.title)
      : { id: sv.id, artKey: canonicalCastId(sv.id), name: sv.name, color: sv.color };
    const artKey = canonicalCastId(ident.artKey);
    const manifest = getCastCharacter(artKey);
    seenArt.add(artKey);
    downstageItems.push({
      key: `down-${sv.id}-${artKey}`,
      voiceId: sv.id,
      artKey,
      displayName: manifest?.displayName ?? ident.name,
      role: manifest?.role ?? v?.role ?? "Performer",
      roleTier: "downstage",
      color: manifest?.color ?? ident.color,
      portraitUrl: manifest?.portraitUrl ?? `/rehearsal/img/${artKey}-rest.webp`,
      manifest,
      bibleAudit: manifest?.bibleAudit,
      hasAudioTrack: piece.tracks.some((t) => t.id === sv.id),
      actions: buildActionsForCast(artKey, manifest),
    });
  }

  const riserIds = resolveRiserCastIds(
    piece,
    downstageItems.map((d) => d.artKey),
    studio404,
  );
  const riserItems: CastAuditItem[] = [];
  for (const rid of riserIds) {
    const artKey = canonicalCastId(rid);
    if (seenArt.has(artKey)) continue;
    seenArt.add(artKey);
    const manifest = getCastCharacter(artKey);
    if (!manifest) continue;
    riserItems.push({
      key: `riser-${artKey}`,
      voiceId: artKey,
      artKey,
      displayName: manifest.displayName,
      role: manifest.role,
      roleTier: "riser",
      color: manifest.color,
      portraitUrl: manifest.portraitUrl,
      manifest,
      bibleAudit: manifest.bibleAudit,
      hasAudioTrack: false,
      actions: buildActionsForCast(artKey, manifest),
    });
  }

  return summarizeAuditItems([...downstageItems, ...riserItems]);
}

export function buildFull21CastAuditSummary(
  piece: Piece,
  voices: readonly MoppetVoice[],
  studio404: boolean,
): PieceBibleAuditSummary {
  const onstage = buildPieceBibleAuditSummary(piece, voices, studio404);
  const seenArt = new Set(onstage.items.map((item) => item.artKey));
  const backstageItems: CastAuditItem[] = [];

  for (const manifest of Object.values(CAST_MANIFEST.characters)) {
    if (seenArt.has(manifest.id)) continue;
    seenArt.add(manifest.id);
    backstageItems.push({
      key: `backstage-${manifest.id}`,
      voiceId: manifest.id,
      artKey: manifest.id,
      displayName: manifest.displayName,
      role: manifest.role,
      roleTier: "backstage",
      color: manifest.color,
      portraitUrl: manifest.portraitUrl,
      manifest,
      bibleAudit: manifest.bibleAudit,
      hasAudioTrack: piece.tracks.some((t) => t.id === manifest.id),
      actions: buildActionsForCast(manifest.id, manifest),
    });
  }

  return summarizeAuditItems([...onstage.items, ...backstageItems]);
}

export function usePieceBibleAudit(
  piece: Piece,
  voices: readonly MoppetVoice[],
  studio404: boolean,
): PieceBibleAuditSummary {
  return useMemo(() => buildPieceBibleAuditSummary(piece, voices, studio404), [piece, voices, studio404]);
}

export function BibleAuditStatusPill({
  summary,
  onClick,
  variant = "theater",
}: {
  summary: PieceBibleAuditSummary;
  onClick?: () => void;
  variant?: "theater" | "console";
}) {
  const allVerified = summary.totalCount > 0 && summary.verifiedCount === summary.totalCount;
  const hasMismatch = summary.mismatchCount > 0;
  const toneClass = allVerified
    ? "border-emerald-500/50 bg-emerald-950/60 text-emerald-200 hover:bg-emerald-900/70"
    : hasMismatch
      ? "border-rose-500/65 bg-rose-950/70 text-rose-200 hover:bg-rose-900/75"
      : "border-amber-500/60 bg-amber-950/65 text-amber-200 hover:bg-amber-900/70";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          data-testid="bible-audit-pill"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors cursor-pointer ${toneClass} ${variant === "console" ? "font-mono" : ""}`}
        >
          {allVerified ? (
            <CheckCircle2 className="size-3.5 text-emerald-400" />
          ) : hasMismatch ? (
            <XCircle className="size-3.5 text-rose-400" />
          ) : (
            <AlertTriangle className="size-3.5 text-amber-400" />
          )}
          <span>
            <span className="hidden sm:inline">Cast Audit: </span>
            {summary.verifiedCount}/{summary.totalCount}
            <span className="hidden sm:inline"> Verified</span>
            {summary.mismatchCount > 0 ? ` · ${summary.mismatchCount} Mismatch` : summary.legacyCount > 0 ? ` · ${summary.legacyCount} Legacy` : ""}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        {allVerified
          ? "Every onstage character matches its DesignCraft Character Master Bible."
          : `${summary.verifiedCount} verified, ${summary.legacyCount} legacy rehearsal sheets, ${summary.mismatchCount} mismatched models. Click to inspect side-by-side in Parts.`}
      </TooltipContent>
    </Tooltip>
  );
}

export function CastPartsAuditPanel({
  summary,
  piece,
  fullCastMode = false,
}: {
  summary: PieceBibleAuditSummary;
  piece: Piece;
  fullCastMode?: boolean;
}) {
  const levels = useVoiceLevels((s) => s.levels);
  const soloMix = useEnsemble((s) => s.soloMix);
  const voices = useMoppet((s) => s.voices);
  const [soloTargetId, setSoloTargetId] = useState<string | null>(null);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [savedLevels, setSavedLevels] = useState<Record<string, number>>({});

  const triggerAction = (item: CastAuditItem, action: { id: string; label: string; kind: "take" | "gag" | "gesture" }) => {
    const key = `${item.key}:${action.id}`;
    setActiveActionKey(key);
    setTimeout(() => {
      setActiveActionKey((cur) => (cur === key ? null : cur));
    }, 1800);

    triggerCharacterAction(item.artKey, action.id, { voiceId: item.voiceId });

    if (action.id === "sing") {
      const voice = voices.find((v) => v.id === item.voiceId);
      if (voice) {
        const track = piece.tracks.find((t) => t.id === item.voiceId);
        const midi = track?.events[0]?.midi ?? Math.round((voice.register[0] + voice.register[1]) / 2);
        void auditionNote(voice, midi, "la", 460);
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1a110b] text-[#f8efe2]">
      {/* Summary Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#745438]/45 bg-[#241810] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-wider uppercase text-[#e3bd7f]">
            {fullCastMode ? "Full 21-Cast Character Bibles" : "Onstage Cast & Bible Audit"}
          </span>
          <Badge variant="outline" className="border-[#745438]/60 text-[10px] text-[#d6c2a5]">
            {summary.totalCount} Models
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="rounded bg-emerald-950/70 px-1.5 py-0.5 font-semibold text-emerald-300 border border-emerald-500/40">
            ✓ {summary.verifiedCount}
          </span>
          {summary.legacyCount > 0 && (
            <span className="rounded bg-amber-950/70 px-1.5 py-0.5 font-semibold text-amber-300 border border-amber-500/40">
              ⚠ {summary.legacyCount}
            </span>
          )}
          {summary.mismatchCount > 0 && (
            <span className="rounded bg-rose-950/80 px-1.5 py-0.5 font-semibold text-rose-300 border border-rose-500/50">
              ✕ {summary.mismatchCount}
            </span>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-2.5 p-2.5">
          {summary.items.map((item) => {
            const audit = item.bibleAudit;
            const status = audit?.status ?? "legacy-unverified";
            const level = levels[item.voiceId] ?? 1;
            const isMuted = level <= 0.01;
            const isSolo = soloMix && soloTargetId === item.voiceId;

            const statusBadge =
              status === "verified-bible" ? (
                <Badge className="border border-emerald-500/50 bg-emerald-950/80 text-emerald-200 text-[10px] font-bold">
                  ✓ VERIFIED BIBLE
                </Badge>
              ) : status === "mismatch" ? (
                <Badge className="border border-rose-500/60 bg-rose-950/85 text-rose-200 text-[10px] font-bold">
                  ✕ MISMATCH
                </Badge>
              ) : (
                <Badge className="border border-amber-500/55 bg-amber-950/80 text-amber-200 text-[10px] font-bold">
                  ⚠ LEGACY
                </Badge>
              );

            return (
              <div
                key={item.key}
                data-cast-audit-card={item.artKey}
                className="rounded-xl border border-[#745438]/55 bg-[#21160f]/95 p-2.5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="inline-block size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.color, boxShadow: `0 0 8px ${item.color}` }}
                      />
                      <span className="text-sm font-bold text-[#f8efe2]">{item.displayName}</span>
                      <span className="rounded bg-[#322217] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[#d4bc97]">
                        {item.roleTier === "riser"
                          ? "Riser Band"
                          : item.roleTier === "backstage"
                            ? "Backstage"
                            : "Downstage"}
                      </span>
                      {statusBadge}
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#c7b194]">{item.role}</p>
                  </div>

                  {/* Solo / Mute controls for singing tracks */}
                  {item.hasAudioTrack && (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="xs"
                        variant={isSolo ? "default" : "outline"}
                        aria-label={`Solo ${item.displayName}`}
                        aria-pressed={isSolo}
                        className={
                          isSolo
                            ? "h-6 px-2 bg-[#50cfad] text-[#0b1814] font-bold hover:bg-[#50cfad]/90"
                            : "h-6 px-2 border-[#745438]/60 bg-[#2b1d14] text-[#f8efe2]"
                        }
                        onClick={() => {
                          if (isSolo) {
                            setSoloMix(false);
                            setSoloTargetId(null);
                          } else {
                            inspect(item.voiceId);
                            setSoloMix(true);
                            setSoloTargetId(item.voiceId);
                          }
                        }}
                        title={`Solo ${item.displayName}`}
                      >
                        S
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        aria-label={isMuted ? `Unmute ${item.displayName}` : `Mute ${item.displayName}`}
                        aria-pressed={isMuted}
                        className={
                          isMuted
                            ? "h-6 px-2 border-rose-500/60 bg-rose-950/70 text-rose-200"
                            : "h-6 px-2 border-[#745438]/60 bg-[#2b1d14] text-[#f8efe2]"
                        }
                        onClick={() => {
                          if (isMuted) {
                            setVoiceLevel(item.voiceId, savedLevels[item.voiceId] ?? 1);
                          } else {
                            setSavedLevels((prev) => ({ ...prev, [item.voiceId]: level }));
                            setVoiceLevel(item.voiceId, 0);
                          }
                        }}
                        title={isMuted ? `Unmute ${item.displayName}` : `Mute ${item.displayName}`}
                      >
                        {isMuted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Side-by-Side Canon Bible Hero vs Live Stage Portrait */}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-[#745438]/40 bg-[#150e09] p-1.5">
                    <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/50 border border-white/10">
                      <img
                        src={audit?.bibleHeroUrl ?? item.portraitUrl}
                        alt={`${item.displayName} Canon Bible Hero`}
                        className="size-full object-contain"
                        loading="lazy"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#e3bd7f]">
                        Canon Bible
                      </div>
                      <div className="truncate text-[10px] text-[#c7b194]" title={audit?.bibleFile ?? "—"}>
                        {audit?.bibleFile ? audit.bibleFile.split("/").pop() : "Unmapped"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 rounded-lg border border-[#745438]/40 bg-[#150e09] p-1.5">
                    <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/50 border border-white/10">
                      <img
                        src={item.portraitUrl}
                        alt={`${item.displayName} Live Stage Portrait`}
                        className="size-full object-contain"
                        loading="lazy"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#50cfad]">
                        Live Stage
                      </div>
                      <div className="truncate text-[10px] text-[#c7b194]" title={audit?.stageModelSource ?? item.manifest?.renderMode}>
                        {audit?.animationTier ?? item.manifest?.renderMode ?? "atlas"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Exact Provenance Notes */}
                {audit?.notes && (
                  <p className="mt-1.5 rounded border border-[#745438]/30 bg-[#170f0a] px-2 py-1 text-[10px] leading-snug text-[#d4c0a2]">
                    {audit.notes}
                  </p>
                )}

                {/* Vocal Sync & IK Joint Spec Summary */}
                {item.manifest && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                    <span
                      className={`rounded border px-1.5 py-0.5 ${
                        item.manifest.vocalSyncSpec.hasDedicatedMouthOpen
                          ? "border-emerald-500/45 bg-emerald-950/60 text-emerald-200"
                          : "border-amber-500/45 bg-amber-950/60 text-amber-200"
                      }`}
                      title={item.manifest.vocalSyncSpec.note}
                    >
                      Vocal: {item.manifest.vocalSyncSpec.mode}
                    </span>
                    <span className="rounded border border-cyan-500/45 bg-cyan-950/55 px-1.5 py-0.5 text-cyan-200">
                      IK Joints: {item.manifest.ikPoints.length}
                    </span>
                    <span className="rounded border border-[#745438]/45 bg-[#150e09] px-1.5 py-0.5 text-[#c7b194]">
                      Clips: {Object.keys(item.manifest.clips).length}
                    </span>
                  </div>
                )}

                {/* Mechanical Defect Ledger (Never Hidden) */}
                {item.manifest && item.manifest.defects.length > 0 && (
                  <div className="mt-1.5 space-y-1" data-testid={`defects-${item.artKey}`}>
                    {item.manifest.defects.map((def, idx) => (
                      <div
                        key={`${def.code}-${idx}`}
                        className={`flex items-start gap-1.5 rounded border px-2 py-1 text-[10px] leading-snug ${
                          def.severity === "error"
                            ? "border-rose-500/55 bg-rose-950/75 text-rose-100"
                            : "border-amber-500/45 bg-amber-950/55 text-amber-100"
                        }`}
                      >
                        <span className="shrink-0 rounded bg-black/35 px-1 py-0.2 font-mono text-[9px] font-bold uppercase">
                          {def.severity} · {def.category}
                        </span>
                        <span>{def.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Character-Specific Animation Trigger Buttons */}
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`${item.displayName} stage animations`}>
                  {item.actions.map((action) => {
                    const isFiring = activeActionKey === `${item.key}:${action.id}`;
                    const isSpecial = action.kind !== "gesture";
                    return (
                      <button
                        key={action.id}
                        type="button"
                        data-trigger-action={`${item.artKey}:${action.id}`}
                        onClick={() => triggerAction(item, action)}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold capitalize transition-all cursor-pointer ${
                          isFiring
                            ? "border-[#50cfad] bg-[#50cfad]/30 text-white shadow-[0_0_10px_rgba(80,207,173,0.45)]"
                            : isSpecial
                              ? "border-[#e3bd7f]/55 bg-[#2e2015] text-[#f8e2ba] hover:border-[#e3bd7f] hover:bg-[#3f2c1d]"
                              : "border-[#745438]/55 bg-[#221710] text-[#d6c2a5] hover:border-[#50cfad]/70 hover:text-white"
                        }`}
                      >
                        {isSpecial ? <Sparkles className="size-3 text-[#e3bd7f]" /> : <Play className="size-2.5 text-[#50cfad]" />}
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
