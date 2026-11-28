/**
 * Tactile Vintage Analog Control Deck sitting beneath the 16:9 Stage:
 *  - Transport + backlit tape counter (`00:16 / 00:37`) + seek bar + `Band` / `Loop` switches
 *  - Real `KnobHeadless` rotary knob bank: `Master` (+ VU), `Tempo`, `Singer Vol`, `Warmth`, `Tension`, `Breath`, `Vibrato`
 *  - Compact Performer selector pills (`Solo` / `Mute`) + 4 vintage broadcast action buttons (`Sing`, `Clap`, `Step`, `FX`)
 *  - Presets & Export (`WAV` / `MIDI` / `Reset`) popover so power tools stay cleanly accessible
 */
import { useState } from "react";
import { Download, Footprints, Hand, Music, Pause, Play, RotateCcw, Sliders, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAudio } from "../../audio/audio.ts";
import { applyControl, resetSelectedVocal } from "../../choir/controller.ts";
import {
  cancel,
  editVoice,
  exportWav,
  inspect,
  play,
  seek,
  setLoopRange,
  setSoloMix,
  stop,
  useEnsemble,
} from "../../choir/ensemble.ts";
import { auditionNote } from "../../choir/live.ts";
import { measures } from "../../choir/meter.ts";
import { midiBytes } from "../../choir/performanceMidi.ts";
import { applyPresetToVoice, CHIMERA_VOICE_PRESETS } from "../../choir/performer.ts";
import { triggerCharacterAction } from "../../choir/stageActionBus.ts";
import { useMoppet, type TempoScale } from "../../choir/store.ts";
import { studio404Name } from "../../choir/studio404.ts";
import { beatSeconds, LEAD_IN, pieceSeconds } from "../../choir/timeline.ts";
import { setVoiceLevel, useVoiceLevels } from "../../choir/voiceLevels.ts";
import type { CastAuditItem } from "../CastPartsAuditPanel.tsx";
import { VintageRotaryKnob, VintageToggleSwitch, VintageVuMeter } from "./VintageKnobs.tsx";

const fmtClock = (t: number) =>
  `${String(Math.floor(Math.max(0, t) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ACTION_BUTTONS = [
  { key: "sing", label: "Sing", Icon: Music },
  { key: "clap", label: "Clap", Icon: Hand },
  { key: "step", label: "Step", Icon: Footprints },
  { key: "fx", label: "FX", Icon: Sparkles },
] as const;

export function VintageControlStrip({
  cast,
}: {
  readonly cast: readonly CastAuditItem[];
}) {
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const select = useMoppet((s) => s.select);
  const studio404 = useMoppet((s) => s.studio404);
  const tempoScale = useMoppet((s) => s.tempoScale);
  const setTempoScale = useMoppet((s) => s.setTempoScale);
  const band = useMoppet((s) => s.band);
  const setBand = useMoppet((s) => s.setBand);
  const edit = useMoppet((s) => s.edit);

  const status = useEnsemble((s) => s.status);
  const time = useEnsemble((s) => s.time);
  const duration = useEnsemble((s) => s.duration);
  const soloMix = useEnsemble((s) => s.soloMix);
  const loopRange = useEnsemble((s) => s.loopRange);
  const ensembleMessage = useEnsemble((s) => s.message);

  const startAudio = useAudio((s) => s.start);
  const volume = useAudio((s) => s.volume);
  const setVolume = useAudio((s) => s.setVolume);
  const levels = useVoiceLevels((s) => s.levels);

  const [savedMutes, setSavedMutes] = useState<Record<string, number>>({});
  const [soloId, setSoloId] = useState<string | null>(null);
  const [wavBusy, setWavBusy] = useState(false);

  const curVoice = voices[selected] ?? voices[0];
  const curName = studio404 ? studio404Name(curVoice.id, curVoice.name) : curVoice.name;
  const singerGain = levels[curVoice.id] ?? 1;
  const isMuted = singerGain <= 0.01;
  const isSolo = soloMix && soloId === curVoice.id;

  const shown = Math.max(1, duration || pieceSeconds(piece));
  const isPlaying = status === "playing" || status === "buffering";
  const isBusy = status === "preparing" || status === "rendering";
  const totalBars = Math.max(1, measures(piece).length);

  const toggleLoop = (on: boolean) => {
    if (!on) {
      setLoopRange(null);
      return;
    }
    const ms = measures(piece);
    const bs = beatSeconds(piece);
    const bEnd = ms[Math.min(ms.length - 1, Math.min(4, totalBars) - 1)]?.end ?? piece.beats;
    setLoopRange({ startSec: LEAD_IN, endSec: LEAD_IN + bEnd * bs, label: `Bars 1–${Math.min(4, totalBars)}` });
  };

  const applyTempoPct = (pct: number) => {
    const snapped: TempoScale = pct <= 62 ? 0.5 : pct <= 87 ? 0.75 : 1;
    if (snapped !== tempoScale) setTempoScale(snapped);
  };

  const fireAction = (actionKey: (typeof ACTION_BUTTONS)[number]["key"]) => {
    const item = cast.find((c) => c.voiceId === curVoice.id) ?? cast[0];
    if (!item) return;
    if (actionKey === "sing") {
      triggerCharacterAction(item.artKey, "sing", { voiceId: item.voiceId });
      const tr = piece.tracks.find((t) => t.id === curVoice.id);
      const midi = tr?.events[0]?.midi ?? Math.round((curVoice.register[0] + curVoice.register[1]) / 2);
      void useAudio.getState().start();
      void auditionNote(curVoice, midi, "la", 420);
    } else if (actionKey === "clap") {
      triggerCharacterAction(item.artKey, "clap", { voiceId: item.voiceId });
    } else if (actionKey === "step") {
      triggerCharacterAction(item.artKey, "walk", { voiceId: item.voiceId });
    } else {
      const fx = item.actions.find((a) => a.kind === "gag" || a.kind === "take")?.id ?? "fx";
      triggerCharacterAction(item.artKey, fx, { voiceId: item.voiceId });
    }
  };

  const handleExportWav = async () => {
    setWavBusy(true);
    try {
      const out = await exportWav(startAudio);
      const slug = piece.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "moppets";
      downloadBlob(new Blob([out.bytes], { type: "audio/wav" }), `${slug}.wav`);
    } finally {
      setWavBusy(false);
    }
  };

  const handleExportMidi = () => {
    const slug = piece.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "moppets";
    downloadBlob(new Blob([midiBytes(piece) as BlobPart], { type: "audio/midi" }), `${slug}.mid`);
  };

  return (
    <section
      aria-label="Studio transport and analog console"
      className="flex flex-col gap-3 rounded-xl border border-[#34302A] bg-[#181614] p-3 text-[#F4EFE6]"
    >
      {/* Row 1: Tape Counter + Seek Bar + Transport & Switches */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div className="rounded-md border border-[#38332C] bg-[#0C0B09] px-2.5 py-1 text-xs font-semibold tabular-nums text-[#D9A75C]">
            {fmtClock(time)} <span className="text-[#787064]">/</span> {fmtClock(shown)}
          </div>
          <input
            aria-label="Song position"
            type="range"
            min={0}
            max={shown}
            step={0.05}
            value={Math.min(time, shown)}
            onChange={(e) => seek(Number(e.target.value))}
            className="h-2 flex-1 cursor-pointer accent-[#D9A75C]"
          />
          <VintageVuMeter master segments={10} label="" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              data-testid="moppet-play"
              disabled={isBusy}
              onClick={() => void play(startAudio)}
              className="moppet-play h-9 bg-[#34D399] px-3.5 text-xs font-bold text-[#051A12] hover:bg-[#4ade80]"
            >
              {isPlaying ? <Pause className="fill-current" data-icon="inline-start" /> : <Play className="fill-current" data-icon="inline-start" />}
              {isPlaying ? "Pause" : isBusy ? "Rendering…" : "Play"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Stop playback"
              disabled={status === "idle"}
              onClick={stop}
              className="size-9 border-[#3B362E] bg-[#121110] text-[#F4EFE6] hover:border-[#D9A75C] hover:bg-[#23201B]"
            >
              <Square className="size-3.5 fill-current" />
            </Button>

            {isBusy && (
              <Button type="button" variant="outline" size="sm" onClick={cancel} className="h-9 border-[#3B362E] bg-[#121110] text-xs text-[#F4EFE6]">
                Cancel
              </Button>
            )}

            <VintageToggleSwitch label="Band" checked={band} onCheckedChange={setBand} disabled={isBusy} />
            <VintageToggleSwitch label="Loop" checked={Boolean(loopRange)} onCheckedChange={toggleLoop} />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 border-[#3B362E] bg-[#121110] text-xs font-semibold text-[#F4EFE6] hover:border-[#D9A75C] hover:bg-[#23201B] hover:text-[#F4EFE6]"
              >
                <Sliders data-icon="inline-start" />
                Presets &amp; Export
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 border-[#3B362E] bg-[#181614] p-3 text-[#F4EFE6]">
              <div className="flex flex-col gap-3 text-xs">
                <div className="flex flex-col gap-1.5">
                  <span className="font-semibold text-[#D9A75C]">CHIMERA Voice Presets ({curName})</span>
                  <div className="flex flex-wrap gap-1.5">
                    {CHIMERA_VOICE_PRESETS.map((preset) => (
                      <Button
                        key={preset.id}
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          edit((voice) => applyPresetToVoice(voice, preset));
                          const updated = useMoppet.getState().voices[useMoppet.getState().selected];
                          editVoice(updated.id, { artic: updated.artic, source: updated.source, rerender: true });
                          void auditionNote(updated, Math.round((updated.register[0] + updated.register[1]) / 2), "ah", 360);
                        }}
                        className="border-[#3B362E] bg-[#121110] text-[#F4EFE6] hover:border-[#34D399]"
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 border-t border-[#2E2B26] pt-2.5">
                  <Button type="button" variant="outline" size="xs" onClick={resetSelectedVocal} className="border-[#3B362E] bg-[#121110] text-[#F4EFE6]">
                    <RotateCcw data-icon="inline-start" />
                    Reset {curName}
                  </Button>
                  <Button type="button" variant="outline" size="xs" disabled={wavBusy} onClick={() => void handleExportWav()} className="border-[#3B362E] bg-[#121110] text-[#F4EFE6]">
                    <Download data-icon="inline-start" />
                    {wavBusy ? "WAV…" : "Export WAV"}
                  </Button>
                  <Button type="button" variant="outline" size="xs" onClick={handleExportMidi} className="border-[#3B362E] bg-[#121110] text-[#F4EFE6]">
                    <Download data-icon="inline-start" />
                    MIDI
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Row 2: Vintage Rotary Knob Bank */}
      <div className="grid grid-cols-3 gap-x-2 gap-y-3 rounded-lg border border-[#2D2A25] bg-[#121110] px-2.5 py-3 sm:grid-cols-7">
        <VintageRotaryKnob
          label="Master"
          value={volume}
          min={0}
          max={1}
          step={0.02}
          defaultValue={1}
          accent="#34D399"
          size={46}
          formatValue={(v) => `${Math.round(v * 100)}%`}
          onChange={setVolume}
        />
        <VintageRotaryKnob
          label="Tempo"
          value={Math.round(tempoScale * 100)}
          min={50}
          max={100}
          step={25}
          defaultValue={100}
          disabled={piece.kind === "skit"}
          size={46}
          formatValue={(v) => `${Math.round(v)}%`}
          onChange={applyTempoPct}
        />
        <VintageRotaryKnob
          label="Singer Vol"
          value={singerGain}
          min={0}
          max={1}
          step={0.02}
          defaultValue={1}
          accent="#34D399"
          size={46}
          formatValue={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => setVoiceLevel(curVoice.id, v)}
        />
        <VintageRotaryKnob
          label="Warmth"
          value={curVoice.source.brightness}
          min={0}
          max={1}
          step={0.02}
          defaultValue={0.35}
          size={46}
          formatValue={(v) => v.toFixed(2)}
          onChange={(v) => applyControl("brightness", v)}
        />
        <VintageRotaryKnob
          label="Tension"
          value={curVoice.source.tension}
          min={0}
          max={1}
          step={0.02}
          defaultValue={0.5}
          size={46}
          formatValue={(v) => v.toFixed(2)}
          onChange={(v) => applyControl("tension", v)}
        />
        <VintageRotaryKnob
          label="Breath"
          value={curVoice.source.breathiness}
          min={0}
          max={0.8}
          step={0.02}
          defaultValue={0.12}
          size={46}
          formatValue={(v) => v.toFixed(2)}
          onChange={(v) => applyControl("breathiness", v)}
        />
        <VintageRotaryKnob
          label="Vibrato"
          value={curVoice.vibrato}
          min={0}
          max={40}
          step={1}
          defaultValue={12}
          size={46}
          formatValue={(v) => `${Math.round(v)}¢`}
          onChange={(cents) => {
            edit((v) => {
              v.vibrato = Math.round(cents);
            });
            editVoice(curVoice.id, { rerender: true });
          }}
        />
      </div>

      {/* Row 3: Cast Singer Selector + Solo/Mute + 4 Broadcast Trigger Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {cast.map((item) => {
            const active = item.voiceId === curVoice.id;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const idx = voices.findIndex((v) => v.id === item.voiceId);
                  if (idx >= 0) select(idx);
                  inspect(item.voiceId);
                  if (soloMix) setSoloId(item.voiceId);
                }}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? "border-[#D9A75C] bg-[#26221B] text-[#F4EFE6]"
                    : "border-[#312D27] bg-[#121110] text-[#B7AEA0] hover:text-[#F4EFE6]"
                }`}
              >
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span>{item.displayName}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <VintageToggleSwitch
            label="Solo"
            checked={isSolo}
            onCheckedChange={(on) => {
              if (!on) {
                setSoloMix(false);
                setSoloId(null);
              } else {
                inspect(curVoice.id);
                setSoloMix(true);
                setSoloId(curVoice.id);
              }
            }}
          />
          <VintageToggleSwitch
            label="Mute"
            checked={isMuted}
            accent="#E06356"
            onCheckedChange={(on) => {
              if (!on) {
                const prev = savedMutes[curVoice.id];
                setVoiceLevel(curVoice.id, prev && prev > 0.05 ? prev : 1);
              } else {
                setSavedMutes((m) => ({ ...m, [curVoice.id]: singerGain > 0.05 ? singerGain : 1 }));
                setVoiceLevel(curVoice.id, 0);
              }
            }}
          />
          {ACTION_BUTTONS.map(({ key, label, Icon }) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fireAction(key)}
              className="h-9 border-[#3B362E] bg-[#121110] text-xs font-semibold text-[#F4EFE6] hover:border-[#D9A75C] hover:bg-[#23201B] hover:text-[#F4EFE6]"
            >
              <Icon data-icon="inline-start" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      {ensembleMessage && (
        <p role="status" className="text-xs text-[#B7AEA0]">
          {ensembleMessage}
        </p>
      )}
    </section>
  );
}
