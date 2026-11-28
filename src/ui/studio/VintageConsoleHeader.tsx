/**
 * Single-Line Vintage Studio Header (`STUDIO 404` nameplate + Song Picker + New Song +
 * Stage World + Camera + MIDI + Keys Switch + Views Menu).
 */
import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, Plus, Users, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAudio } from "../../audio/audio.ts";
import { useMoppet } from "../../choir/store.ts";
import { useStageView, type StageCameraPreset } from "../../stage/stageViewStore.ts";
import { STAGE_WORLD_LIST, type StageWorldId } from "../../stage/stageWorlds.ts";
import { MidiConnectButton } from "../ChimeraMidiKeys.tsx";
import { NewRehearsal } from "../NewRehearsal.tsx";
import { SongCommandPicker } from "../SongCommandPicker.tsx";
import { VintageToggleSwitch } from "./VintageKnobs.tsx";

const CAMERA_OPTIONS: readonly { id: StageCameraPreset; label: string }[] = [
  { id: "authored", label: "Auto" },
  { id: "wide", label: "Wide" },
  { id: "closeup", label: "Close" },
  { id: "low-angle", label: "Low" },
];

export function VintageConsoleHeader({
  keyboardOpen,
  onToggleKeyboard,
  onOpenBibleAudit,
  onOpenStoryboard,
  recordingClip,
  onToggleRecordClip,
  canRecord,
}: {
  readonly keyboardOpen: boolean;
  readonly onToggleKeyboard: (next: boolean) => void;
  readonly onOpenBibleAudit: () => void;
  readonly onOpenStoryboard: () => void;
  readonly recordingClip?: boolean;
  readonly onToggleRecordClip?: () => void;
  readonly canRecord?: boolean;
}) {
  const lesson = useMoppet((s) => s.lesson);
  const world = useAudio((s) => s.world);
  const setWorld = useAudio((s) => s.setWorld);
  const cameraMode = useStageView((s) => s.cameraMode);
  const setCameraMode = useStageView((s) => s.setCameraMode);

  const [newOpen, setNewOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);

  useEffect(() => {
    setNewOpen(false);
  }, [lesson]);

  return (
    <header className="border-b border-[#2E2B26] bg-[#181614] px-3 py-2">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2">
        {/* Left: STUDIO 404 Brass/Ivory Nameplate + Song Picker + New Draft */}
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <a
            href={`?watch=${encodeURIComponent(lesson)}`}
            className="flex items-center gap-2 rounded-lg border border-[#443C30] bg-[#121110] px-2.5 py-1.5 text-[#F4EFE6] no-underline hover:border-[#D9A75C]"
          >
            <span className="size-2 rounded-full bg-[#D9A75C]" aria-hidden="true" />
            <span className="text-sm font-bold tracking-[0.14em] text-[#F4EFE6]">STUDIO 404</span>
          </a>

          <SongCommandPicker live compact variant="console" />

          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 border-[#3B362E] bg-[#1E1C19] text-xs font-semibold text-[#F4EFE6] hover:border-[#D9A75C] hover:bg-[#26231E] hover:text-[#F4EFE6]"
              >
                <Plus data-icon="inline-start" />
                New Song
              </Button>
            </DialogTrigger>
            <DialogContent className="border-[#3B362E] bg-[#181614] text-[#F4EFE6]">
              <DialogHeader>
                <DialogTitle className="text-[#F4EFE6]">Create New Song or Skit Draft</DialogTitle>
              </DialogHeader>
              <NewRehearsal />
            </DialogContent>
          </Dialog>
        </div>

        {/* Right: World, Camera, MIDI, Keys Switch, Views */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={world} onValueChange={(v) => setWorld(v as StageWorldId)}>
            <SelectTrigger
              aria-label="Stage world"
              size="sm"
              className="h-9 border-[#3B362E] bg-[#121110] text-xs font-semibold text-[#F4EFE6]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[#3B362E] bg-[#191714] text-[#F4EFE6]">
              <SelectGroup>
                {STAGE_WORLD_LIST.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.shortLabel}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            value={cameraMode}
            onValueChange={(v) => setCameraMode(v as StageCameraPreset)}
          >
            <SelectTrigger
              aria-label="Stage camera"
              size="sm"
              className="h-9 border-[#3B362E] bg-[#121110] text-xs font-semibold text-[#F4EFE6]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[#3B362E] bg-[#191714] text-[#F4EFE6]">
              <SelectGroup>
                {CAMERA_OPTIONS.map((cam) => (
                  <SelectItem key={cam.id} value={cam.id}>
                    Cam: {cam.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <MidiConnectButton />

          <VintageToggleSwitch
            label="Keys"
            checked={keyboardOpen}
            onCheckedChange={onToggleKeyboard}
            testId="toggle-keys-button"
          />

          <Popover open={viewsOpen} onOpenChange={setViewsOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="studio-menu-trigger"
                className="h-9 border-[#3B362E] bg-[#1E1C19] text-xs font-semibold text-[#F4EFE6] hover:border-[#D9A75C] hover:bg-[#26231E] hover:text-[#F4EFE6]"
              >
                Views
                <ChevronDown data-icon="inline-end" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-60 border-[#3B362E] bg-[#181614] p-1.5 text-[#F4EFE6] shadow-xl"
            >
              <div className="flex flex-col gap-0.5 text-xs">
                <a
                  href={`?watch=${encodeURIComponent(lesson)}`}
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-[#F4EFE6] no-underline hover:bg-[#24211D]"
                >
                  <span>Theater</span>
                  <ExternalLink className="size-3.5 text-[#B7AEA0]" />
                </a>
                <a
                  href="?cast"
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-[#F4EFE6] no-underline hover:bg-[#24211D]"
                >
                  <span>Cast Bibles</span>
                  <ExternalLink className="size-3.5 text-[#B7AEA0]" />
                </a>
                <a
                  href="?scale"
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-[#F4EFE6] no-underline hover:bg-[#24211D]"
                >
                  <span>Size Chart</span>
                  <ExternalLink className="size-3.5 text-[#B7AEA0]" />
                </a>
                <a
                  href="?kids"
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-[#F4EFE6] no-underline hover:bg-[#24211D]"
                >
                  <span>Kids Farm</span>
                  <ExternalLink className="size-3.5 text-[#B7AEA0]" />
                </a>
                <a
                  href={`?songbook=${encodeURIComponent(lesson)}`}
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-[#F4EFE6] no-underline hover:bg-[#24211D]"
                >
                  <span>Songbook</span>
                  <ExternalLink className="size-3.5 text-[#B7AEA0]" />
                </a>
                <a
                  href="?chimera"
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-[#F4EFE6] no-underline hover:bg-[#24211D]"
                >
                  <span>CHIMERA Synth</span>
                  <ExternalLink className="size-3.5 text-[#B7AEA0]" />
                </a>
                <a
                  href="/rig.html"
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-[#F4EFE6] no-underline hover:bg-[#24211D]"
                >
                  <span>3D Rig</span>
                  <ExternalLink className="size-3.5 text-[#B7AEA0]" />
                </a>
                <div className="my-1 border-t border-[#2E2B26]" />
                <button
                  type="button"
                  onClick={() => {
                    setViewsOpen(false);
                    onOpenStoryboard();
                  }}
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-left text-[#F4EFE6] hover:bg-[#24211D] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <BookOpen className="size-3.5 text-[#D9A75C]" />
                    Storyboard Drawer
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="toggle-bible-audit"
                  onClick={() => {
                    setViewsOpen(false);
                    onOpenBibleAudit();
                  }}
                  className="flex items-center justify-between rounded-md px-2.5 py-2 text-left text-[#F4EFE6] hover:bg-[#24211D] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3.5 text-[#34D399]" />
                    Cast Bible Audit
                  </span>
                </button>
                {canRecord && onToggleRecordClip && (
                  <button
                    type="button"
                    data-testid="record-clip-button"
                    onClick={() => {
                      setViewsOpen(false);
                      onToggleRecordClip();
                    }}
                    className="flex items-center justify-between rounded-md px-2.5 py-2 text-left font-semibold text-[#D9A75C] hover:bg-[#24211D] cursor-pointer"
                  >
                    <span>{recordingClip ? "Save Video Clip" : "Record Video Clip"}</span>
                  </button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
}
