import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Circle,
  Footprints,
  Hand,
  Keyboard,
  Layers,
  Maximize2,
  Minimize2,
  Music,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Settings,
  Sliders,
  Sparkles,
  Square,
  Users,
  Video,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAudio } from "../audio/audio.ts";
import { getCastCharacter } from "../choir/castManifest.ts";
import { inspect, play, seek, setLoopRange, setSoloMix, stop, useEnsemble } from "../choir/ensemble.ts";
import { auditionNote } from "../choir/live.ts";
import { measures } from "../choir/meter.ts";
import { triggerCharacterAction } from "../choir/stageActionBus.ts";
import { useMoppet, type TempoScale } from "../choir/store.ts";
import { beatSeconds, LEAD_IN, pieceSeconds } from "../choir/timeline.ts";
import { resetVoiceLevels, setVoiceLevel, unmuteVoices, useVoiceLevels, voiceLevel } from "../choir/voiceLevels.ts";
import { canRecordClip } from "../stage/recordClip.ts";
import {
  BibleAuditStatusPill,
  CastPartsAuditPanel,
  buildFull21CastAuditSummary,
  usePieceBibleAudit,
} from "./CastPartsAuditPanel.tsx";
import { ChimeraMidiKeys, MidiConnectButton } from "./ChimeraMidiKeys.tsx";
import { MidiPianoRoll } from "./MidiPianoRoll.tsx";
import { MusicRack } from "./MusicRack.tsx";
import { SongCommandPicker } from "./SongCommandPicker.tsx";
import { SongNavigator } from "./SongNavigator.tsx";
import { RafLedVuMeter, SvgRotaryKnob } from "./VuRotaryControls.tsx";

const SongbookPanel = lazy(() =>
  import("./SongbookStoryboardView.tsx").then((m) => ({ default: m.SongbookPanel })),
);

type ConsoleMode = "cast" | "gestures" | "scenes";
type MusicDockMode = "midi" | "score" | "compact";

function PortraitThumb({
  src,
  alt,
  name,
  color,
  className,
}: {
  src?: string | null;
  alt: string;
  name: string;
  color: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  const clean = src?.trim() ?? "";
  if (!clean || failed) {
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    return (
      <span
        aria-hidden={alt === "" ? true : undefined}
        role={alt === "" ? undefined : "img"}
        aria-label={alt === "" ? undefined : alt}
        style={{ color, borderColor: `${color}66` }}
        className={`${className} inline-flex items-center justify-center border font-mono text-[10px] font-bold`}
      >
        {initials || "?"}
      </span>
    );
  }
  return <img src={clean} alt={alt} onError={() => setFailed(true)} className={className} />;
}

function scrollIntoDrawer(ref: RefObject<HTMLElement | null>) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

const PAD_PALETTES = [
  { border: "#ec4899", bg: "rgba(190, 24, 93, 0.36)", glow: "rgba(236, 72, 153, 0.55)", text: "#fbcfe8" },
  { border: "#f43f5e", bg: "rgba(190, 18, 60, 0.36)", glow: "rgba(244, 63, 94, 0.55)", text: "#fecdd3" },
  { border: "#f59e0b", bg: "rgba(180, 83, 9, 0.38)", glow: "rgba(245, 158, 11, 0.55)", text: "#fde68a" },
  { border: "#2dd4bf", bg: "rgba(13, 148, 136, 0.42)", glow: "rgba(45, 212, 191, 0.65)", text: "#ccfbf1" },
  { border: "#84cc16", bg: "rgba(77, 124, 15, 0.38)", glow: "rgba(132, 204, 22, 0.55)", text: "#ecfccb" },
  { border: "#eab308", bg: "rgba(161, 98, 7, 0.38)", glow: "rgba(234, 179, 8, 0.55)", text: "#fef08a" },
  { border: "#a855f7", bg: "rgba(126, 34, 206, 0.38)", glow: "rgba(168, 85, 247, 0.55)", text: "#f3e8ff" },
  { border: "#3b82f6", bg: "rgba(29, 78, 216, 0.38)", glow: "rgba(59, 130, 246, 0.55)", text: "#dbeafe" },
] as const;

const PAD_ROWS = [
  { key: "sing", label: "Sing", icon: Music },
  { key: "clap", label: "Clap", icon: Hand },
  { key: "step", label: "Step", icon: Footprints },
  { key: "fx", label: "FX", icon: Sparkles },
] as const;

/**
 * Live Multi-Track MIDI Piano Roll Strip reading directly from `piece.tracks` and `useEnsemble` clock
 * via `requestAnimationFrame` playhead DOM mutation (zero React re-renders during playback).
 */
function LiveMidiPianoRollStrip() {
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const studio404 = useMoppet((s) => s.studio404);
  const playheadRef = useRef<HTMLDivElement>(null);
  const totalSec = Math.max(1, pieceSeconds(piece));
  const bars = useMemo(() => measures(piece), [piece]);

  const { minMidi, spanMidi, noteBars } = useMemo(() => {
    const midis = piece.tracks.flatMap((t) => t.events.map((e) => e.midi));
    const lo = midis.length ? Math.min(...midis) - 2 : 48;
    const hi = midis.length ? Math.max(...midis) + 2 : 76;
    const bs = beatSeconds(piece);
    const items: { key: string; leftPct: number; widthPct: number; topPct: number; color: string }[] = [];
    piece.tracks.forEach((track) => {
      const voice = voices.find((v) => v.id === track.id);
      const char = getCastCharacter(track.id);
      const color = (studio404 ? char?.color : undefined) ?? voice?.color ?? "#34d399";
      track.events.forEach((ev, idx) => {
        const startSec = LEAD_IN + ev.beat * bs;
        const durSec = Math.max(0.12, ev.beats * bs);
        items.push({
          key: `${track.id}-${idx}`,
          leftPct: (startSec / totalSec) * 100,
          widthPct: Math.max(0.6, (durSec / totalSec) * 100),
          topPct: 12 + ((hi - ev.midi) / Math.max(1, hi - lo)) * 74,
          color,
        });
      });
    });
    return { minMidi: lo, spanMidi: Math.max(1, hi - lo), noteBars: items };
  }, [piece, voices, studio404, totalSec]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = useEnsemble.getState().time;
      const pct = Math.max(0, Math.min(100, (t / totalSec) * 100));
      if (playheadRef.current) {
        playheadRef.current.style.left = `${pct.toFixed(3)}%`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [totalSec]);

  void minMidi;
  void spanMidi;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Live MIDI timeline scrubber"
      aria-valuemin={0}
      aria-valuemax={Math.round(totalSec)}
      aria-valuenow={0}
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
        seek(ratio * totalSec);
      }}
      className="relative h-12 min-w-[220px] flex-1 overflow-hidden rounded-lg border border-white/15 bg-[#070a0c] cursor-pointer"
    >
      {/* Bar markers */}
      {bars.map((m, idx) => {
        const stride = bars.length > 32 ? 4 : bars.length > 16 ? 2 : 1;
        if (idx % stride !== 0) return null;
        const leftPct = ((LEAD_IN + m.start * beatSeconds(piece)) / totalSec) * 100;
        return (
          <div
            key={m.start}
            className="pointer-events-none absolute inset-y-0 border-l border-white/10"
            style={{ left: `${leftPct.toFixed(2)}%` }}
          >
            <span className="ml-1 font-mono text-[9px] text-slate-400">{idx + 1}</span>
          </div>
        );
      })}

      {/* Color-coded voice note bars */}
      {noteBars.map((nb) => (
        <span
          key={nb.key}
          className="pointer-events-none absolute h-[3px] rounded-full opacity-90"
          style={{
            left: `${nb.leftPct.toFixed(2)}%`,
            width: `${nb.widthPct.toFixed(2)}%`,
            top: `${nb.topPct.toFixed(1)}%`,
            backgroundColor: nb.color,
            boxShadow: `0 0 6px ${nb.color}`,
          }}
        />
      ))}

      {/* Live Cyan Playhead */}
      <div
        ref={playheadRef}
        className="pointer-events-none absolute inset-y-0 w-[2px] bg-[#22d3ee] shadow-[0_0_10px_#22d3ee]"
        style={{ left: "0%" }}
      >
        <span className="absolute -top-0.5 -left-[4px] size-2.5 rotate-45 bg-[#22d3ee]" />
      </div>
    </div>
  );
}

export function LiveConsole({
  stageNode,
  controllerNode,
  recordingClip = false,
  onToggleRecordClip,
  onOpenCast: _onOpenCast,
  onToggleKeyboardDrawer,
}: {
  stageNode: ReactNode;
  controllerNode?: ReactNode;
  recordingClip?: boolean;
  onToggleRecordClip?: () => void;
  onOpenCast?: () => void;
  onToggleKeyboardDrawer?: () => void;
}) {
  const lesson = useMoppet((s) => s.lesson);
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const select = useMoppet((s) => s.select);
  const studio404 = useMoppet((s) => s.studio404);
  const tempoScale = useMoppet((s) => s.tempoScale);
  const setTempoScale = useMoppet((s) => s.setTempoScale);
  const band = useMoppet((s) => s.band);
  const setBand = useMoppet((s) => s.setBand);
  const status = useEnsemble((s) => s.status);
  const soloMix = useEnsemble((s) => s.soloMix);
  const loopRange = useEnsemble((s) => s.loopRange);
  const startAudio = useAudio((s) => s.start);
  const volume = useAudio((s) => s.volume);
  const setVolume = useAudio((s) => s.setVolume);
  const levels = useVoiceLevels((s) => s.levels);

  const [consoleMode, setConsoleMode] = useState<ConsoleMode>("cast");
  const [barRange, setBarRange] = useState<[number, number]>([1, 3]);
  const [padPage, setPadPage] = useState(0);
  const [activePad, setActivePad] = useState<string | null>(null);
  const [soloTargetId, setSoloTargetId] = useState<string | null>(null);
  const [savedMutes, setSavedMutes] = useState<Record<string, number>>({});
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"pads" | "mix" | "midi">("pads");
  const [musicDockMode, setMusicDockMode] = useState<MusicDockMode>("midi");
  const [musicDockTall, setMusicDockTall] = useState(false);
  const [bibleInspectorOpen, setBibleInspectorOpen] = useState(false);
  const [showFullCastBibles, setShowFullCastBibles] = useState(false);
  const [mixFocused, setMixFocused] = useState(false);
  const [storyboardOpen, setStoryboardOpen] = useState(false);

  const auditSummary = usePieceBibleAudit(piece, voices, studio404);
  const fullBibleSummary = useMemo(
    () => (showFullCastBibles ? buildFull21CastAuditSummary(piece, voices, studio404) : auditSummary),
    [showFullCastBibles, piece, voices, studio404, auditSummary],
  );
  const stageSlotRef = useRef<HTMLDivElement>(null);
  const mixRailRef = useRef<HTMLElement>(null);
  const padDeckRef = useRef<HTMLDivElement>(null);
  const storyboardDrawerRef = useRef<HTMLDivElement>(null);
  const bibleDrawerRef = useRef<HTMLDivElement>(null);
  const keyboardDrawerRef = useRef<HTMLDivElement>(null);

  const totalBars = Math.max(1, measures(piece).length);
  const isPlaying = status === "playing" || status === "buffering";
  const isBusy = status === "preparing" || status === "rendering";

  // Characters shown in the illuminated pad matrix & voice strip
  const consoleCast = useMemo(() => {
    if (auditSummary.items.length > 0) return auditSummary.items;
    return voices.slice(0, 8).map((v) => {
      const ch = getCastCharacter(v.id);
      return {
        key: v.id,
        voiceId: v.id,
        artKey: ch?.id ?? v.id,
        displayName: ch?.displayName ?? v.name,
        role: ch?.role ?? v.role,
        roleTier: "downstage" as const,
        color: ch?.color ?? v.color,
        portraitUrl: ch?.portraitUrl ?? `/rehearsal/img/${v.id}-rest.webp`,
        manifest: ch,
        bibleAudit: ch?.bibleAudit,
        hasAudioTrack: true,
        actions: [],
      };
    });
  }, [auditSummary.items, voices]);

  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(consoleCast.length / pageSize));
  const safePage = Math.min(padPage, pageCount - 1);
  const desktopPads = consoleCast.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const mobilePads = consoleCast.slice(safePage * 4, safePage * 4 + 4);

  // Guard against switching into a song with transient solo state or every onstage voice muted.
  useEffect(() => {
    setSoloMix(false);
    setSoloTargetId(null);
    const singingIds = consoleCast.filter((c) => c.hasAudioTrack).map((c) => c.voiceId);
    const idsToCheck = singingIds.length > 0 ? singingIds : consoleCast.map((c) => c.voiceId);
    if (idsToCheck.length > 0 && idsToCheck.every((id) => voiceLevel(id) <= 0.01)) {
      unmuteVoices(idsToCheck);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, piece.title]);

  const hasMixOverrides =
    soloMix || consoleCast.some((item) => (levels[item.voiceId] ?? 1) < 0.99);

  const toggleKeyboardDrawer = () => {
    setKeyboardOpen((prev) => {
      const next = !prev;
      if (next) scrollIntoDrawer(keyboardDrawerRef);
      return next;
    });
    onToggleKeyboardDrawer?.();
  };

  const toggleLoop = (checked: boolean) => {
    if (!checked) {
      setLoopRange(null);
      return;
    }
    const ms = measures(piece);
    const bs = beatSeconds(piece);
    const bStart = ms[Math.max(0, barRange[0] - 1)]?.start ?? 0;
    const bEnd = ms[Math.min(ms.length - 1, barRange[1] - 1)]?.end ?? piece.beats;
    setLoopRange({
      startSec: LEAD_IN + bStart * bs,
      endSec: LEAD_IN + bEnd * bs,
      label: `Bars ${barRange[0]}–${barRange[1]}`,
    });
  };

  const shiftBarWindow = (delta: number) => {
    const span = barRange[1] - barRange[0];
    const nextStart = Math.max(1, Math.min(Math.max(1, totalBars - span), barRange[0] + delta));
    const nextEnd = Math.min(totalBars, nextStart + span);
    setBarRange([nextStart, nextEnd]);
    if (loopRange) {
      const ms = measures(piece);
      const bs = beatSeconds(piece);
      const bStart = ms[Math.max(0, nextStart - 1)]?.start ?? 0;
      const bEnd = ms[Math.min(ms.length - 1, nextEnd - 1)]?.end ?? piece.beats;
      setLoopRange({
        startSec: LEAD_IN + bStart * bs,
        endSec: LEAD_IN + bEnd * bs,
        label: `Bars ${nextStart}–${nextEnd}`,
      });
    }
  };

  const firePad = (
    item: (typeof consoleCast)[number],
    rowKey: (typeof PAD_ROWS)[number]["key"],
  ) => {
    const padKey = `${item.key}:${rowKey}`;
    setActivePad(padKey);
    setTimeout(() => setActivePad((c) => (c === padKey ? null : c)), 650);

    const vIdx = voices.findIndex((v) => v.id === item.voiceId);
    if (vIdx >= 0) select(vIdx);

    if (rowKey === "sing") {
      triggerCharacterAction(item.artKey, "sing", { voiceId: item.voiceId });
      const voice = voices[vIdx >= 0 ? vIdx : selected];
      if (voice) {
        const track = piece.tracks.find((t) => t.id === voice.id);
        const midi = track?.events[0]?.midi ?? Math.round((voice.register[0] + voice.register[1]) / 2);
        void auditionNote(voice, midi, "la", 440);
      }
    } else if (rowKey === "clap") {
      triggerCharacterAction(item.artKey, "clap", { voiceId: item.voiceId });
    } else if (rowKey === "step") {
      triggerCharacterAction(item.artKey, "walk", { voiceId: item.voiceId });
    } else {
      const specialTake = item.actions.find((a) => a.kind === "gag" || a.kind === "take")?.id ?? "fx";
      triggerCharacterAction(item.artKey, specialTake, { voiceId: item.voiceId });
    }
  };

  return (
    <div
      className="live-console-theme min-h-screen w-full bg-[#070a0c] text-[#edf6f3] flex flex-col"
      data-testid="live-console"
    >
      {/* Top Hardware Console Chrome */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0d1215] px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`?watch=${encodeURIComponent(lesson)}`}
            className="flex items-center gap-1.5 font-serif text-lg font-bold tracking-[0.18em] text-[#e7d8b5] hover:text-white cursor-pointer no-underline"
          >
            <ArrowLeft className="size-4 text-emerald-400" />
            MOPPETS
          </a>

          <nav className="hidden md:flex items-center gap-1 rounded-lg border border-white/10 bg-[#080b0d] p-0.5 text-xs font-semibold tracking-wider uppercase">
            <a
              href={`?watch=${encodeURIComponent(lesson)}`}
              className="rounded-md px-2.5 py-1 text-slate-300 hover:text-white cursor-pointer no-underline"
            >
              Theater
            </a>
            <button
              type="button"
              aria-current="page"
              className="rounded-md border border-emerald-400/60 bg-emerald-500/20 px-2.5 py-1 text-emerald-200 shadow-[0_0_12px_rgba(52,211,153,0.25)] cursor-pointer"
            >
              Live Console
            </button>
            <button
              type="button"
              aria-pressed={consoleMode === "scenes"}
              onClick={() => {
                setMixFocused(false);
                setMobilePanel("pads");
                setConsoleMode((m) => {
                  const next = m === "scenes" ? "cast" : "scenes";
                  if (next === "scenes") scrollIntoDrawer(padDeckRef);
                  return next;
                });
              }}
              className={`rounded-md px-2.5 py-1 cursor-pointer ${
                consoleMode === "scenes"
                  ? "border border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Songs
            </button>
            <button
              type="button"
              onClick={() => {
                setMixFocused(false);
                setBibleInspectorOpen((prev) => {
                  const next = !prev;
                  if (next) scrollIntoDrawer(bibleDrawerRef);
                  return next;
                });
              }}
              aria-pressed={bibleInspectorOpen}
              className={`rounded-md px-2.5 py-1 cursor-pointer ${
                bibleInspectorOpen
                  ? "border border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Cast
            </button>
            <button
              type="button"
              aria-pressed={mixFocused}
              onClick={() => {
                setBibleInspectorOpen(false);
                setStoryboardOpen(false);
                if (consoleMode === "scenes") setConsoleMode("cast");
                setMobilePanel("mix");
                setMixFocused((prev) => {
                  const next = !prev;
                  if (next) scrollIntoDrawer(mixRailRef);
                  return next;
                });
              }}
              className={`rounded-md px-2.5 py-1 cursor-pointer ${
                mixFocused
                  ? "border border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Mix
            </button>
            <button
              type="button"
              aria-pressed={storyboardOpen}
              onClick={() => {
                setMixFocused(false);
                setStoryboardOpen((prev) => {
                  const next = !prev;
                  if (next) scrollIntoDrawer(storyboardDrawerRef);
                  return next;
                });
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 cursor-pointer ${
                storyboardOpen
                  ? "border border-amber-400/60 bg-amber-500/20 text-amber-200"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <BookOpen className="size-3.5" />
              Storyboard
            </button>
            {onToggleRecordClip && canRecordClip() && (
              <button
                type="button"
                aria-pressed={recordingClip}
                onClick={onToggleRecordClip}
                data-testid="record-clip-button"
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 cursor-pointer ${
                  recordingClip
                    ? "border border-rose-400 bg-rose-500/25 text-rose-100 animate-pulse"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <Video className="size-3.5" />
                {recordingClip ? "Save Clip" : "Record Clip"}
              </button>
            )}
          </nav>
        </div>

        {/* Live Telemetry Status + BPM + KEY */}
        <div className="flex flex-wrap items-center gap-2">
          <BibleAuditStatusPill
            summary={auditSummary}
            variant="console"
            onClick={() => {
              setBibleInspectorOpen((prev) => {
                const next = !prev;
                if (next) scrollIntoDrawer(bibleDrawerRef);
                return next;
              });
            }}
          />

          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/45 bg-emerald-950/60 px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-300">
            <Radio className={`size-3.5 ${isPlaying ? "animate-pulse text-emerald-400" : ""}`} />
            {isPlaying ? "LIVE CHIMERA" : "CHIMERA READY"}
          </span>

          <span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-white/15 bg-[#11171b] px-2 py-1 font-mono text-[11px] text-slate-200">
            <span className="text-slate-400">BPM</span> {piece.bpm || "—"}
          </span>

          <span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-white/15 bg-[#11171b] px-2 py-1 font-mono text-[11px] text-cyan-200">
            <span className="text-slate-400">KEY</span> {piece.key} {piece.mode}
          </span>

          <MidiConnectButton />

          <button
            type="button"
            aria-label="Toggle hardware keyboard drawer"
            aria-expanded={keyboardOpen}
            aria-pressed={keyboardOpen}
            onClick={toggleKeyboardDrawer}
            className={`flex size-8 items-center justify-center rounded-lg border cursor-pointer ${
              keyboardOpen
                ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                : "border-white/15 bg-[#12181c] text-slate-300 hover:border-emerald-400/50 hover:text-white"
            }`}
          >
            <Settings className="size-4" />
          </button>
        </div>
      </header>

      {/* Transport Bar + Music & MIDI Dock Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/10 bg-[#0b0f12] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Rewind to start"
              onClick={() => seek(0)}
              className="flex size-9 items-center justify-center rounded-lg border border-white/15 bg-[#141b1f] text-slate-200 hover:border-emerald-400/50 cursor-pointer"
            >
              <ChevronLeft className="size-4" />
            </button>

            <button
              type="button"
              data-testid="moppet-play"
              disabled={isBusy}
              aria-label={isPlaying ? "Pause live choir" : "Play live choir"}
              onClick={() => void play(startAudio)}
              style={{ color: "#04140e" }}
              className="moppet-play flex h-9 min-w-[44px] items-center justify-center rounded-lg border border-emerald-400 bg-emerald-500 px-3 text-[#04140e] shadow-[0_0_16px_rgba(16,185,129,0.5)] hover:bg-emerald-400 cursor-pointer"
            >
              {isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
            </button>

            <button
              type="button"
              aria-label="Stop playback"
              disabled={status === "idle"}
              onClick={stop}
              className="flex size-9 items-center justify-center rounded-lg border border-white/15 bg-[#141b1f] text-slate-200 hover:border-white/35 disabled:opacity-40 cursor-pointer"
            >
              <Square className="size-3.5 fill-current" />
            </button>

            <button
              type="button"
              aria-label="Audition selected voice"
              onClick={() => {
                const v = voices[selected];
                if (v) void auditionNote(v, Math.round((v.register[0] + v.register[1]) / 2), "ah", 420);
              }}
              className="flex size-9 items-center justify-center rounded-lg border border-white/15 bg-[#141b1f] text-rose-400 hover:border-rose-400/60 cursor-pointer"
              title="Audition selected singer"
            >
              <Circle className="size-3.5 fill-current" />
            </button>
          </div>

          <SongCommandPicker live compact variant="console" />
        </div>

        {/* Inline compact preview when MIDI dock is collapsed */}
        {musicDockMode === "compact" && <LiveMidiPianoRollStrip />}

        <div className="flex flex-wrap items-center gap-1.5">
          <div
            className="flex items-center rounded-lg border border-white/15 bg-[#0f1519] p-0.5 text-[11px] font-semibold"
            role="group"
            aria-label="Music and MIDI view mode"
          >
            {(
              [
                ["midi", "MIDI Roll"],
                ["score", "Choir Score"],
                ["compact", "Compact"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={musicDockMode === mode}
                onClick={() => setMusicDockMode(mode)}
                className={`rounded-md px-2.5 py-1 transition-colors cursor-pointer ${
                  musicDockMode === mode
                    ? "border border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                    : "border border-transparent text-slate-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {musicDockMode !== "compact" && (
            <button
              type="button"
              aria-label={musicDockTall ? "Normal MIDI dock height" : "Expand MIDI dock height"}
              onClick={() => setMusicDockTall((v) => !v)}
              className="hidden sm:inline-flex h-8 items-center gap-1 rounded-lg border border-white/15 bg-[#141b1f] px-2.5 text-[11px] font-semibold text-slate-200 hover:border-emerald-400/50 cursor-pointer"
            >
              {musicDockTall ? (
                <>
                  <Minimize2 className="size-3.5" /> Normal
                </>
              ) : (
                <>
                  <Maximize2 className="size-3.5" /> Taller
                </>
              )}
            </button>
          )}

          <button
            type="button"
            aria-label="Fullscreen live stage"
            onClick={() => {
              if (stageSlotRef.current) {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void stageSlotRef.current.requestFullscreen();
              }
            }}
            className="hidden lg:flex size-8 items-center justify-center rounded-lg border border-white/15 bg-[#141b1f] text-slate-300 hover:text-white cursor-pointer"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>

      {/* Dedicated Expanded Multi-Track MIDI Piano Roll & Music Score Dock */}
      {musicDockMode !== "compact" && (
        <section
          aria-label="Live Console Music and MIDI Dock"
          className="hidden sm:block border-b border-white/10 bg-[#090d10] px-3 py-2"
        >
          {musicDockMode === "midi" ? (
            <MidiPianoRoll
              piece={piece}
              voices={voices}
              studio404={studio404}
              theme="console"
              loopRange={loopRange}
              heightPx={musicDockTall ? 256 : 154}
              onSeekStageSec={(s) => seek(s)}
              ariaLabel="Live MIDI timeline scrubber"
            />
          ) : (
            <div
              className="vs-score-desk overflow-auto rounded-xl border border-emerald-500/30 bg-[#f0f6f2]"
              style={{ maxHeight: musicDockTall ? 360 : 230 }}
            >
              <MusicRack />
            </div>
          )}
        </section>
      )}

      {/* Main 3-Column Console Body */}
      <div className="grid flex-1 min-h-0 grid-cols-1 gap-2.5 p-2.5 lg:grid-cols-[220px_minmax(0,1fr)_270px]">
        {/* Left Control Rail (Desktop) */}
        <aside className="hidden lg:flex flex-col gap-3 rounded-xl border border-white/10 bg-[#0d1215] p-3">
          <div>
            <div className="mb-1.5 text-[10px] font-bold tracking-widest uppercase text-slate-400">Song</div>
            <SongCommandPicker live compact variant="console" />
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-bold tracking-widest uppercase text-slate-400">Mode</div>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  ["cast", "Cast", Users],
                  ["gestures", "Gestures", Hand],
                  ["scenes", "Scenes", Layers],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setConsoleMode(id)}
                  className={`flex flex-col items-center gap-1 rounded-lg border py-2 text-[10px] font-semibold transition-colors cursor-pointer ${
                    consoleMode === id
                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-200 shadow-[0_0_12px_rgba(52,211,153,0.22)]"
                      : "border-white/10 bg-[#12191d] text-slate-300 hover:border-white/25"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <div className="mb-1.5 text-[10px] font-bold tracking-widest uppercase text-slate-400">
                Rehearsal Tempo
              </div>
              <div className="grid grid-cols-3 gap-1" role="group" aria-label="Rehearsal tempo scale">
                {([0.5, 0.75, 1] as const satisfies readonly TempoScale[]).map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    aria-pressed={tempoScale === scale}
                    disabled={isBusy || piece.kind === "skit"}
                    onClick={() => setTempoScale(scale)}
                    className={`rounded-md border py-1 font-mono text-[11px] font-semibold cursor-pointer disabled:opacity-40 ${
                      tempoScale === scale
                        ? "border-emerald-400 bg-emerald-500/25 text-emerald-100"
                        : "border-white/10 bg-[#12191d] text-slate-300 hover:text-white"
                    }`}
                  >
                    {scale === 1 ? "1.0×" : `${scale}×`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#12181c] px-2.5 py-1.5">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Backing Band</span>
              <Switch
                checked={band}
                disabled={isBusy}
                onCheckedChange={setBand}
                aria-label="Toggle backing band"
              />
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#12181c] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300">Loop</span>
              <Switch checked={Boolean(loopRange)} onCheckedChange={toggleLoop} aria-label="Toggle loop range" />
            </div>
            <div className="flex items-center justify-between gap-1 rounded-md border border-white/10 bg-[#0a0e10] px-1.5 py-1">
              <button
                type="button"
                aria-label="Previous bar range"
                onClick={() => shiftBarWindow(-1)}
                className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="font-mono text-[11px] text-slate-200">
                Bars {barRange[0]} – {barRange[1]}
              </span>
              <button
                type="button"
                aria-label="Next bar range"
                onClick={() => shiftBarWindow(1)}
                className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-auto space-y-2 border-t border-white/10 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Keyboard</span>
              <button
                type="button"
                aria-pressed={keyboardOpen}
                aria-expanded={keyboardOpen}
                onClick={toggleKeyboardDrawer}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold cursor-pointer ${
                  keyboardOpen
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                    : "border-white/15 bg-[#12191d] text-slate-200 hover:border-emerald-400/50"
                }`}
              >
                <Keyboard className="size-3.5" />
                {keyboardOpen ? "Hide Keys" : "MIDI Keys"}
              </button>
            </div>
          </div>
        </aside>

        {/* Center: Live Stage Window + 8×4 Desktop / 4×4 Mobile Illuminated Pad Matrix */}
        <section className="flex min-w-0 flex-col gap-2.5">
          {/* ● LIVE Stage Window */}
          <div
            ref={stageSlotRef}
            className="relative overflow-hidden rounded-xl border border-white/15 bg-[#0a0608] shadow-xl"
          >
            <div className="pointer-events-none absolute top-2.5 left-2.5 z-30 flex items-center gap-1.5 rounded-md border border-emerald-400/40 bg-black/75 px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase text-emerald-300 backdrop-blur-sm">
              <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              LIVE
            </div>
            {stageNode}
          </div>

          {/* Inline Live Storyboard & Variable Stage Director Drawer */}
          {storyboardOpen && (
            <div
              ref={storyboardDrawerRef}
              data-testid="console-storyboard-drawer"
              className="flex h-[480px] max-h-[68vh] min-w-0 w-full flex-col overflow-hidden rounded-xl border border-amber-500/40 bg-[#f7f2e8] shadow-xl"
            >
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center font-mono text-xs text-slate-400">
                    Loading Studio 404 Storyboard…
                  </div>
                }
              >
                <SongbookPanel
                  lessonId={lesson}
                  piece={piece}
                  onSeekStageSec={(stageSec) => {
                    const target = LEAD_IN + Math.max(0, stageSec);
                    seek(target);
                    if (status !== "playing" && status !== "buffering" && status !== "paused") {
                      void play(startAudio, target);
                    }
                  }}
                />
              </Suspense>
            </div>
          )}

          {/* Inline Character Bible Audit & Inspector Drawer */}
          {bibleInspectorOpen && (
            <div
              ref={bibleDrawerRef}
              data-testid="console-bible-inspector"
              className="flex h-[380px] min-w-0 w-full flex-col overflow-hidden rounded-xl border border-emerald-500/40 bg-[#1a110b] shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-[#745438]/40 bg-[#140d08] px-3 py-1.5 text-[11px]">
                <span className="text-[#d4bc97]">
                  {showFullCastBibles
                    ? `Showing all ${fullBibleSummary.totalCount} Studio 404 Character Bibles from unified manifest`
                    : `Inspecting ${auditSummary.totalCount} onstage Studio 404 Character Bibles from unified manifest`}
                </span>
                <button
                  type="button"
                  aria-pressed={showFullCastBibles}
                  onClick={() => setShowFullCastBibles((v) => !v)}
                  className={`rounded border px-2 py-0.5 font-semibold cursor-pointer ${
                    showFullCastBibles
                      ? "border-emerald-400 bg-emerald-500/25 text-emerald-100"
                      : "border-emerald-500/45 bg-emerald-950/60 text-emerald-200 hover:bg-emerald-900/70"
                  }`}
                >
                  {showFullCastBibles ? "Onstage Cast Only" : "Toggle Full 21-Cast Bibles"}
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <CastPartsAuditPanel
                  summary={showFullCastBibles ? fullBibleSummary : auditSummary}
                  piece={piece}
                  fullCastMode={showFullCastBibles}
                />
              </div>
            </div>
          )}

          {/* Mobile Mode Switcher (Pads | MIDI | Mix) */}
          <div className="flex items-center justify-between gap-2 lg:hidden">
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#0d1215] p-1">
              <button
                type="button"
                onClick={() => {
                  setMixFocused(false);
                  setMobilePanel("pads");
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase ${
                  mobilePanel === "pads" ? "bg-emerald-500/25 text-emerald-200 border border-emerald-400/60" : "text-slate-400"
                }`}
              >
                Cast Pads
              </button>
              <button
                type="button"
                onClick={() => {
                  setMixFocused(false);
                  setMobilePanel("midi");
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase ${
                  mobilePanel === "midi" ? "bg-emerald-500/25 text-emerald-200 border border-emerald-400/60" : "text-slate-400"
                }`}
              >
                MIDI
              </button>
              <button
                type="button"
                onClick={() => {
                  setMixFocused(true);
                  setMobilePanel("mix");
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase ${
                  mobilePanel === "mix" ? "bg-emerald-500/25 text-emerald-200 border border-emerald-400/60" : "text-slate-400"
                }`}
              >
                Voice Mix
              </button>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPadPage((p) => (p - 1 + pageCount) % pageCount)}
                  className="rounded border border-white/15 bg-[#12191d] p-1 text-slate-300"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPadPage((p) => (p + 1) % pageCount)}
                  className="rounded border border-white/15 bg-[#12191d] p-1 text-slate-300"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Mobile Dedicated MIDI Roll Panel */}
          {mobilePanel === "midi" && (
            <div className="rounded-xl border border-emerald-500/30 bg-[#0d1215] p-2.5 lg:hidden">
              <MidiPianoRoll
                piece={piece}
                voices={voices}
                studio404={studio404}
                theme="console"
                loopRange={loopRange}
                heightPx={220}
                onSeekStageSec={(s) => seek(s)}
                ariaLabel="Mobile Live MIDI piano roll"
              />
            </div>
          )}

          {/* Pad Matrix / Gestures / Scenes Deck */}
          <div
            ref={padDeckRef}
            className={`min-w-0 w-full rounded-xl border border-white/10 bg-[#0d1215] p-2.5 ${
              mobilePanel !== "pads" ? "hidden lg:block" : "block"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="console-tab-cast"
                  onClick={() => setConsoleMode("cast")}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider cursor-pointer ${
                    consoleMode === "cast"
                      ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                      : "border-white/10 bg-[#12191d] text-slate-400 hover:text-white"
                  }`}
                >
                  <Users className="size-3.5" /> Cast
                </button>
                <button
                  type="button"
                  data-testid="console-tab-gestures"
                  onClick={() => setConsoleMode("gestures")}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider cursor-pointer ${
                    consoleMode === "gestures"
                      ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                      : "border-white/10 bg-[#12191d] text-slate-400 hover:text-white"
                  }`}
                >
                  <Hand className="size-3.5" /> Gestures
                </button>
                <button
                  type="button"
                  data-testid="console-tab-scenes"
                  onClick={() => setConsoleMode("scenes")}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider cursor-pointer ${
                    consoleMode === "scenes"
                      ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                      : "border-white/10 bg-[#12191d] text-slate-400 hover:text-white"
                  }`}
                >
                  <Layers className="size-3.5" /> Scenes
                </button>
              </div>

              {consoleMode === "cast" && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Previous pad bank"
                    onClick={() => setPadPage((p) => (p - 1 + pageCount) % pageCount)}
                    className="rounded-md border border-white/10 bg-[#12191d] p-1 text-slate-300 hover:text-white cursor-pointer"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.max(1, pageCount) }, (_, idx) => (
                      <span
                        key={idx}
                        className={`size-1.5 rounded-full ${
                          idx === safePage ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-white/20"
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label="Next pad bank"
                    onClick={() => setPadPage((p) => (p + 1) % pageCount)}
                    className="rounded-md border border-white/10 bg-[#12191d] p-1 text-slate-300 hover:text-white cursor-pointer"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              )}
            </div>

            {consoleMode === "cast" && (
              <>
                {/* Desktop 8x4 Pad Grid */}
                <div className="hidden md:grid grid-cols-[64px_repeat(8,minmax(0,1fr))] gap-1.5 items-stretch">
                  <div />
                  {Array.from({ length: 8 }, (_, colIdx) => {
                    const item = desktopPads[colIdx];
                    if (!item) return <div key={`empty-h-${colIdx}`} className="rounded-lg border border-white/5 bg-[#090d0f]/50" />;
                    const pal = PAD_PALETTES[colIdx % PAD_PALETTES.length];
                    const isSelected = voices[selected]?.id === item.voiceId;
                    const auditStatus = item.bibleAudit?.status;
                    const dotColor =
                      auditStatus === "verified-bible"
                        ? "bg-emerald-400"
                        : auditStatus === "mismatch"
                          ? "bg-rose-500"
                          : "bg-amber-400";
                    return (
                      <button
                        key={`head-${item.key}`}
                        type="button"
                        onClick={() => {
                          const idx = voices.findIndex((v) => v.id === item.voiceId);
                          if (idx >= 0) select(idx);
                          inspect(item.voiceId);
                          if (soloMix) setSoloTargetId(item.voiceId);
                        }}
                        style={{
                          borderColor: isSelected ? "#34d399" : `${pal.border}80`,
                          boxShadow: isSelected ? "0 0 14px rgba(52,211,153,0.45)" : undefined,
                        }}
                        className="relative flex flex-col items-center gap-1 rounded-lg border bg-[#12181c] p-1.5 text-center transition-all hover:brightness-110 cursor-pointer"
                      >
                        <span
                          className={`absolute top-1 right-1 size-2 rounded-full ${dotColor}`}
                          title={`Bible Audit: ${auditStatus ?? "legacy"}`}
                        />
                        <PortraitThumb
                          src={item.portraitUrl}
                          alt={item.displayName}
                          name={item.displayName}
                          color={item.color}
                          className="h-10 w-10 rounded object-contain bg-black/40"
                        />
                        <span className="w-full truncate text-[11px] font-bold text-slate-100">{item.displayName}</span>
                      </button>
                    );
                  })}

                  {PAD_ROWS.map((row) => {
                    const RowIcon = row.icon;
                    return (
                      <div key={row.key} className="contents">
                        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-[#090d0f] px-2 text-[11px] font-semibold text-slate-300">
                          <RowIcon className="size-3.5 text-slate-400 shrink-0" />
                          <span>{row.label}</span>
                        </div>
                        {Array.from({ length: 8 }, (_, colIdx) => {
                          const item = desktopPads[colIdx];
                          if (!item) {
                            return (
                              <div
                                key={`empty-${row.key}-${colIdx}`}
                                className="h-11 rounded-lg border border-white/5 bg-[#090d0f]/40"
                              />
                            );
                          }
                          const pal = PAD_PALETTES[colIdx % PAD_PALETTES.length];
                          const padKey = `${item.key}:${row.key}`;
                          const firing = activePad === padKey;
                          const specialLabel =
                            row.key === "fx"
                              ? item.actions.find((a) => a.kind === "gag" || a.kind === "take")?.label ?? "FX"
                              : row.label;
                          return (
                            <button
                              key={padKey}
                              type="button"
                              aria-label={`${item.displayName} ${specialLabel}`}
                              onClick={() => firePad(item, row.key)}
                              style={{
                                borderColor: firing ? "#ffffff" : pal.border,
                                background: firing ? pal.border : pal.bg,
                                boxShadow: firing ? `0 0 18px ${pal.glow}` : `inset 0 0 10px ${pal.bg}`,
                                color: firing ? "#090d0f" : pal.text,
                              }}
                              className="flex h-11 flex-col items-center justify-center rounded-lg border transition-transform active:scale-95 cursor-pointer"
                              title={`${item.displayName}: ${specialLabel}`}
                            >
                              <RowIcon className="size-4" />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* Mobile 4x4 Pad Grid */}
                <div className="grid grid-cols-4 gap-1.5 md:hidden">
                  {mobilePads.map((item, colIdx) => {
                    const pal = PAD_PALETTES[colIdx % PAD_PALETTES.length];
                    const auditStatus = item.bibleAudit?.status;
                    const dotColor =
                      auditStatus === "verified-bible"
                        ? "bg-emerald-400"
                        : auditStatus === "mismatch"
                          ? "bg-rose-500"
                          : "bg-amber-400";
                    return (
                      <button
                        key={`mhead-${item.key}`}
                        type="button"
                        onClick={() => {
                          const idx = voices.findIndex((v) => v.id === item.voiceId);
                          if (idx >= 0) select(idx);
                        }}
                        style={{ borderColor: `${pal.border}85` }}
                        className="relative flex flex-col items-center gap-0.5 rounded-lg border bg-[#12181c] p-1.5 text-center"
                      >
                        <span className={`absolute top-1 right-1 size-1.5 rounded-full ${dotColor}`} />
                        <PortraitThumb
                          src={item.portraitUrl}
                          alt={item.displayName}
                          name={item.displayName}
                          color={item.color}
                          className="h-9 w-9 rounded object-contain bg-black/40"
                        />
                        <span className="w-full truncate text-[10px] font-bold text-slate-100">{item.displayName}</span>
                      </button>
                    );
                  })}
                  {PAD_ROWS.map((row) => {
                    const RowIcon = row.icon;
                    return mobilePads.map((item, colIdx) => {
                      const pal = PAD_PALETTES[colIdx % PAD_PALETTES.length];
                      const padKey = `${item.key}:${row.key}`;
                      const firing = activePad === padKey;
                      return (
                        <button
                          key={`mpad-${padKey}`}
                          type="button"
                          aria-label={`${item.displayName} ${row.label}`}
                          onClick={() => firePad(item, row.key)}
                          style={{
                            borderColor: firing ? "#ffffff" : pal.border,
                            background: firing ? pal.border : pal.bg,
                            color: firing ? "#090d0f" : pal.text,
                          }}
                          className="flex h-11 items-center justify-center rounded-lg border active:scale-95"
                        >
                          <RowIcon className="size-4" />
                        </button>
                      );
                    });
                  })}
                </div>
              </>
            )}

            {consoleMode === "gestures" && (() => {
              const activeItem =
                consoleCast.find((c) => c.voiceId === voices[selected]?.id) ?? consoleCast[0];
              const bibleClips = Object.entries(activeItem?.manifest?.clips ?? {});
              const stageGestures = ["nod", "tilt", "clap", "cheer", "laugh", "shrug", "gasp", "bow", "jump", "walk"] as const;
              return (
                <div data-testid="console-gestures-deck" className="space-y-2.5">
                  {/* Onstage performer selector */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {consoleCast.map((item) => {
                      const isCurrent = item.key === activeItem?.key;
                      return (
                        <button
                          key={`gest-char-${item.key}`}
                          type="button"
                          onClick={() => {
                            const idx = voices.findIndex((v) => v.id === item.voiceId);
                            if (idx >= 0) select(idx);
                            inspect(item.voiceId);
                            if (soloMix) setSoloTargetId(item.voiceId);
                          }}
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold cursor-pointer ${
                            isCurrent
                              ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                              : "border-white/10 bg-[#12181c] text-slate-300 hover:border-white/25"
                          }`}
                        >
                          <PortraitThumb
                            src={item.portraitUrl}
                            alt=""
                            name={item.displayName}
                            color={item.color}
                            className="size-5 rounded object-contain bg-black/40"
                          />
                          <span>{item.displayName}</span>
                        </button>
                      );
                    })}
                  </div>

                  {activeItem && (
                    <>
                      <div>
                        <div className="mb-1 text-[10px] font-bold tracking-widest uppercase text-emerald-300">
                          {activeItem.displayName} · Character Bible Clips &amp; Directed Takes ({bibleClips.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {bibleClips.map(([clipKey, clip]) => {
                            const padKey = `${activeItem.key}:clip:${clipKey}`;
                            const firing = activePad === padKey;
                            return (
                              <button
                                key={clipKey}
                                type="button"
                                onClick={() => {
                                  setActivePad(padKey);
                                  setTimeout(() => setActivePad((c) => (c === padKey ? null : c)), 900);
                                  triggerCharacterAction(activeItem.artKey, clipKey, { voiceId: activeItem.voiceId });
                                  if (clipKey === "sing") {
                                    const v = voices.find((x) => x.id === activeItem.voiceId);
                                    if (v) {
                                      void auditionNote(v, Math.round((v.register[0] + v.register[1]) / 2), "la", 420);
                                    }
                                  }
                                }}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold capitalize transition-all cursor-pointer ${
                                  firing
                                    ? "border-emerald-300 bg-emerald-400 text-[#05150f] shadow-[0_0_14px_rgba(52,211,153,0.6)]"
                                    : "border-emerald-500/35 bg-[#121c19] text-emerald-100 hover:border-emerald-400"
                                }`}
                              >
                                <Sparkles className="size-3.5" />
                                <span>{clipKey.replaceAll("-", " ")}</span>
                                <span className="font-mono text-[10px] opacity-75">
                                  {clip.frames}f@{clip.fps}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="mb-1 text-[10px] font-bold tracking-widest uppercase text-slate-400">
                          Live Stage &amp; CHIMERA Expression Gestures
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {stageGestures.map((g) => {
                            const padKey = `${activeItem.key}:gest:${g}`;
                            const firing = activePad === padKey;
                            return (
                              <button
                                key={g}
                                type="button"
                                onClick={() => {
                                  setActivePad(padKey);
                                  setTimeout(() => setActivePad((c) => (c === padKey ? null : c)), 650);
                                  triggerCharacterAction(activeItem.artKey, g, { voiceId: activeItem.voiceId });
                                }}
                                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold capitalize cursor-pointer ${
                                  firing
                                    ? "border-cyan-300 bg-cyan-400 text-[#041418]"
                                    : "border-white/15 bg-[#12181c] text-slate-200 hover:border-cyan-400/60"
                                }`}
                              >
                                {g}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {consoleMode === "scenes" && (() => {
              const barMeasures = measures(piece);
              const bs = beatSeconds(piece);
              const cueButtons =
                piece.scenes && piece.scenes.length > 0
                  ? piece.scenes.map((sc, idx) => ({
                      key: `scene-${idx}`,
                      label: `Scene ${idx + 1}`,
                      beat: sc.beat,
                    }))
                  : barMeasures
                      .map((m, idx) => ({ start: m.start, bar: idx + 1 }))
                      .filter((_, idx) => idx === 0 || idx % 4 === 0)
                      .slice(0, 12)
                      .map((m, idx) => ({
                        key: `bar-${m.bar}`,
                        label: idx === 0 ? "Intro · Bar 1" : `Bar ${m.bar}`,
                        beat: m.start,
                      }));
              return (
                <div data-testid="console-scenes-deck" className="space-y-2.5">
                  {cueButtons.length > 0 && (
                    <div>
                      <div className="mb-1 text-[10px] font-bold tracking-widest uppercase text-emerald-300">
                        {piece.title} · Cue Markers
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cueButtons.map((cue) => (
                          <button
                            key={cue.key}
                            type="button"
                            onClick={() => seek(LEAD_IN + cue.beat * bs)}
                            className="rounded-lg border border-white/15 bg-[#12191d] px-2.5 py-1 font-mono text-xs font-semibold text-slate-200 hover:border-emerald-400 hover:text-emerald-200 cursor-pointer"
                          >
                            {cue.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <SongNavigator live />
                </div>
              );
            })()}
          </div>

          {/* Expandable Hardware MIDI & Keyboard Controller Bay */}
          {keyboardOpen && (
            <div
              ref={keyboardDrawerRef}
              className="min-w-0 w-full rounded-xl border border-emerald-500/30 bg-[#0d1215] p-2.5"
              data-testid="hardware-keyboard-drawer"
            >
              {controllerNode ?? <ChimeraMidiKeys />}
            </div>
          )}
        </section>

        {/* Right Rail: VOICE Channel Strip Mixer + MASTER */}
        <aside
          ref={mixRailRef}
          aria-label="CHIMERA Voice Mix"
          className={`flex min-h-0 flex-col overflow-hidden rounded-xl border bg-[#0d1215] p-3 transition-all lg:sticky lg:top-2.5 lg:self-start lg:min-h-[300px] ${
            musicDockMode === "compact"
              ? "lg:max-h-[calc(100dvh-124px)]"
              : musicDockTall
                ? "lg:max-h-[calc(100dvh-396px)]"
                : "lg:max-h-[calc(100dvh-296px)]"
          } ${
            mixFocused
              ? "border-emerald-400/75 ring-1 ring-emerald-400/35 shadow-[0_0_24px_rgba(52,211,153,0.18)]"
              : "border-white/10"
          } ${mobilePanel === "mix" ? "flex max-h-[75vh]" : "hidden lg:flex"}`}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 border-b border-white/10 pb-2">
            <span className="flex items-center gap-1.5 text-xs font-bold tracking-widest uppercase text-slate-200">
              <Sliders className="size-3.5 text-emerald-400" />
              Voice
            </span>
            <div className="flex items-center gap-1.5">
              {hasMixOverrides && (
                <button
                  type="button"
                  onClick={() => {
                    resetVoiceLevels();
                    setSavedMutes({});
                    setSoloMix(false);
                    setSoloTargetId(null);
                  }}
                  title="Reset all voice faders, mutes, and solo"
                  className="inline-flex items-center gap-1 rounded border border-emerald-400/45 bg-emerald-950/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-200 hover:bg-emerald-900/70 cursor-pointer"
                >
                  <RotateCcw className="size-2.5" />
                  Reset Mix
                </button>
              )}
              <span className="font-mono text-[10px] text-slate-400">CHIMERA MIX</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-1.5 [scrollbar-width:thin] [scrollbar-color:rgba(52,211,153,0.45)_transparent]">
            {consoleCast.map((item, idx) => {
              const gain = levels[item.voiceId] ?? 1;
              const isMuted = gain <= 0.01;
              const isSolo = soloMix && soloTargetId === item.voiceId;
              const isSelected = voices[selected]?.id === item.voiceId;
              const pal = PAD_PALETTES[idx % PAD_PALETTES.length];
              return (
                <div
                  key={`strip-${item.key}`}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 ${
                    isSelected
                      ? "border-emerald-400/75 bg-emerald-950/25 shadow-[0_0_12px_rgba(52,211,153,0.18)]"
                      : "border-white/10 bg-[#12181c]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      const vIdx = voices.findIndex((v) => v.id === item.voiceId);
                      if (vIdx >= 0) select(vIdx);
                      inspect(item.voiceId);
                      if (soloMix) setSoloTargetId(item.voiceId);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                  >
                    <PortraitThumb
                      src={item.portraitUrl}
                      alt=""
                      name={item.displayName}
                      color={item.color}
                      className="size-7 shrink-0 rounded bg-black/40 object-contain"
                    />
                    <span className="truncate text-xs font-semibold text-slate-100">{item.displayName}</span>
                  </button>

                  <SvgRotaryKnob
                    value={gain}
                    accent={isSelected ? "#34d399" : pal.border}
                    label={`${item.displayName} channel gain`}
                    onChange={(val) => setVoiceLevel(item.voiceId, val)}
                    size={32}
                  />

                  <RafLedVuMeter voiceId={item.voiceId} segments={8} gain={gain} />

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Solo ${item.displayName}`}
                      aria-pressed={isSolo}
                      style={{ color: isSolo ? "#05130e" : undefined }}
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
                      className={`flex size-6 items-center justify-center rounded border text-[10px] font-bold cursor-pointer ${
                        isSolo
                          ? "border-emerald-400 bg-emerald-500 text-[#05130e]"
                          : "border-white/15 bg-[#0b0f12] text-slate-300 hover:border-white/35"
                      }`}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      aria-label={`Mute ${item.displayName}`}
                      aria-pressed={isMuted}
                      onClick={() => {
                        if (isMuted) {
                          const prev = savedMutes[item.voiceId];
                          setVoiceLevel(item.voiceId, prev && prev > 0.05 ? prev : 1);
                        } else {
                          setSavedMutes((prev) => ({ ...prev, [item.voiceId]: gain > 0.05 ? gain : 1 }));
                          setVoiceLevel(item.voiceId, 0);
                        }
                      }}
                      className={`flex size-6 items-center justify-center rounded border text-[10px] font-bold cursor-pointer ${
                        isMuted
                          ? "border-rose-500 bg-rose-500/30 text-rose-200"
                          : "border-white/15 bg-[#0b0f12] text-slate-300 hover:border-white/35"
                      }`}
                    >
                      M
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* MASTER Strip (always pinned & visible) */}
          <div className="mt-2.5 shrink-0 rounded-xl border border-white/15 bg-[#090d0f] p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold tracking-widest uppercase text-slate-400">
              <span>Master</span>
              <span className="font-mono text-emerald-400">{Math.round(volume * 100)}%</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <RafLedVuMeter master segments={16} />
              <SvgRotaryKnob
                value={volume}
                accent="#34d399"
                label="Master output gain"
                onChange={setVolume}
                size={38}
              />
            </div>
            <input
              aria-label="Master volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="mt-2 w-full accent-emerald-400 h-1.5 cursor-pointer"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
