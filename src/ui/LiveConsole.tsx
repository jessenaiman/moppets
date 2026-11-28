/**
 * Unified Vintage Analog Studio Console:
 *  - Single-line `VintageConsoleHeader` (Studio 404 nameplate, Song Picker, New Song, World, Camera, MIDI, Keys, Views)
 *  - Desktop (`>= 1024px`) 5/7 split: 16:9 Live 3D Stage + Vintage Analog Control Deck on the left,
 *    Always-Visible Responsive Sheet Music (`abcjs`) on the right!
 *  - Mobile & Tablet (`< 1024px`): Responsive stack keeping Sheet Music ALWAYS visible!
 *  - Playable 2-octave Vintage Synth Keyboard (`ChimeraMidiKeys`) docked below.
 */
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAudio } from "../audio/audio.ts";
import { getCastCharacter } from "../choir/castManifest.ts";
import { play, seek, setSoloMix, useEnsemble } from "../choir/ensemble.ts";
import { useMoppet } from "../choir/store.ts";
import { LEAD_IN } from "../choir/timeline.ts";
import { unmuteVoices, voiceLevel } from "../choir/voiceLevels.ts";
import { canRecordClip } from "../stage/recordClip.ts";
import {
  CastPartsAuditPanel,
  buildFull21CastAuditSummary,
  usePieceBibleAudit,
} from "./CastPartsAuditPanel.tsx";
import { ChimeraMidiKeys } from "./ChimeraMidiKeys.tsx";
import { ResponsiveSheetMusic } from "./studio/ResponsiveSheetMusic.tsx";
import { ScrollingMidiMiniNav } from "./studio/ScrollingMidiMiniNav.tsx";
import { VintageConsoleHeader } from "./studio/VintageConsoleHeader.tsx";
import { VintageControlStrip } from "./studio/VintageControlStrip.tsx";

const SongbookPanel = lazy(() =>
  import("./SongbookStoryboardView.tsx").then((m) => ({ default: m.SongbookPanel })),
);

function isTypingElement(target: EventTarget | null): boolean {
  const el = (target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function LiveConsole({
  stageNode,
  controllerNode,
  recordingClip = false,
  onToggleRecordClip,
}: {
  stageNode: ReactNode;
  controllerNode?: ReactNode;
  recordingClip?: boolean;
  onToggleRecordClip?: () => void;
  onOpenCast?: () => void;
  onToggleKeyboardDrawer?: () => void;
  cameraFollow?: boolean;
  onToggleCameraFollow?: () => void;
}) {
  const lesson = useMoppet((s) => s.lesson);
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const studio404 = useMoppet((s) => s.studio404);
  const status = useEnsemble((s) => s.status);
  const startAudio = useAudio((s) => s.start);

  const [keyboardOpen, setKeyboardOpen] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true,
  );
  const [bibleOpen, setBibleOpen] = useState(false);
  const [showAllBibles, setShowAllBibles] = useState(false);
  const [storyboardOpen, setStoryboardOpen] = useState(false);

  const auditSummary = usePieceBibleAudit(piece, voices, studio404);
  const fullBibleSummary = useMemo(
    () => (showAllBibles ? buildFull21CastAuditSummary(piece, voices, studio404) : auditSummary),
    [showAllBibles, piece, voices, studio404, auditSummary],
  );

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

  // Reset transient solo or all-muted state when switching songs
  useEffect(() => {
    setSoloMix(false);
    const singingIds = consoleCast.filter((c) => c.hasAudioTrack).map((c) => c.voiceId);
    const checkIds = singingIds.length > 0 ? singingIds : consoleCast.map((c) => c.voiceId);
    if (checkIds.length > 0 && checkIds.every((id) => voiceLevel(id) <= 0.01)) {
      unmuteVoices(checkIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, piece.title]);

  // Global `K` shortcut for Keys dock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingElement(e.target) || isTypingElement(document.activeElement)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setKeyboardOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="live-console-theme flex min-h-screen w-full flex-col bg-[#121316] text-[#F4EFE6]"
      data-testid="live-console"
    >
      <VintageConsoleHeader
        keyboardOpen={keyboardOpen}
        onToggleKeyboard={setKeyboardOpen}
        onOpenBibleAudit={() => setBibleOpen(true)}
        onOpenStoryboard={() => setStoryboardOpen(true)}
        recordingClip={recordingClip}
        onToggleRecordClip={onToggleRecordClip}
        canRecord={canRecordClip()}
      />

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 p-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-stretch">
          {/* Left 5 cols: 16:9 Live Stage + Vintage Analog Control Deck + Scrolling MIDI Mini-Navigator */}
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[#34302A] bg-[#0B0A09] shadow-lg">
              {stageNode}
            </div>
            <VintageControlStrip cast={consoleCast} />
            <ScrollingMidiMiniNav />
          </div>

          {/* Right 7 cols: Always-Visible Responsive Sheet Music Stand (internally scrollable, aligned with left console) */}
          <div
            className={`flex h-[480px] min-w-0 flex-col lg:col-span-7 ${
              keyboardOpen
                ? "lg:h-[calc(100dvh-236px)] lg:min-h-[640px] lg:max-h-[820px]"
                : "lg:h-[calc(100dvh-88px)] lg:min-h-[680px]"
            }`}
          >
            <ResponsiveSheetMusic />
          </div>
        </div>

        {keyboardOpen && (
          <div data-testid="hardware-keyboard-drawer" className="w-full min-w-0">
            {controllerNode ?? <ChimeraMidiKeys onClose={() => setKeyboardOpen(false)} />}
          </div>
        )}
      </main>

      {/* Storyboard Dialog */}
      <Dialog open={storyboardOpen} onOpenChange={setStoryboardOpen}>
        <DialogContent className="max-w-4xl border-[#3B362E] bg-[#161513] p-0 text-[#F4EFE6] sm:max-w-4xl overflow-hidden">
          <DialogHeader className="border-b border-[#2E2B26] px-4 py-3">
            <DialogTitle className="text-[#F4EFE6]">Studio 404 Storyboard · {piece.title}</DialogTitle>
          </DialogHeader>
          <div className="h-[70vh] bg-[#FAF5E8]">
            <Suspense fallback={<p className="p-4 text-xs text-[#5E4B3A]">Loading storyboard…</p>}>
              <SongbookPanel
                lessonId={lesson}
                piece={piece}
                onSeekStageSec={(sec) => {
                  const target = LEAD_IN + Math.max(0, sec);
                  seek(target);
                  if (status !== "playing" && status !== "buffering" && status !== "paused") {
                    void play(startAudio, target);
                  }
                }}
              />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cast Bible Audit Dialog */}
      <Dialog open={bibleOpen} onOpenChange={setBibleOpen}>
        <DialogContent className="max-w-4xl border-[#3B362E] bg-[#161513] text-[#F4EFE6] sm:max-w-4xl">
          <DialogHeader className="flex flex-row items-center justify-between gap-2 pr-8">
            <DialogTitle className="text-[#F4EFE6]">
              {showAllBibles
                ? `All ${fullBibleSummary.totalCount} Studio 404 Character Bibles`
                : `Onstage Character Bibles (${auditSummary.totalCount})`}
            </DialogTitle>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setShowAllBibles((v) => !v)}
              className="border-[#3B362E] bg-[#121110] text-[#F4EFE6]"
            >
              {showAllBibles ? "Onstage Only" : `All ${fullBibleSummary.totalCount}`}
            </Button>
          </DialogHeader>
          <div className="h-[65vh]">
            <CastPartsAuditPanel
              summary={showAllBibles ? fullBibleSummary : auditSummary}
              piece={piece}
              fullCastMode={showAllBibles}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
