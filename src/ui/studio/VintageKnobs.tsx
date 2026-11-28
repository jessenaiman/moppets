/**
 * Tactile vintage analog studio controls built on `react-knob-headless`:
 *  - `VintageRotaryKnob`: machined bakelite/brushed-brass rotary cap, 11-tick engraved bezel,
 *    amber active arc, double-click reset, wheel & keyboard arrow control (`touch-action: none`).
 *  - `VintageToggleSwitch`: physical metal rocker / broadcast push-latch with jewel pilot lamp.
 *  - `VintageVuMeter`: rAF-driven warm analog LED ladder with zero React re-render churn.
 */
import { useEffect, useId, useRef } from "react";
import {
  KnobHeadless,
  KnobHeadlessLabel,
  KnobHeadlessOutput,
  useKnobKeyboardControls,
} from "react-knob-headless";
import { pose, useEnsemble } from "../../choir/ensemble.ts";

const TICK_ANGLES = Array.from({ length: 11 }, (_, i) => -135 + i * 27);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  if (Math.abs(endDeg - startDeg) < 0.8) return "";
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export interface VintageRotaryKnobProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly defaultValue?: number;
  readonly onChange: (next: number) => void;
  readonly formatValue?: (val: number) => string;
  readonly size?: number;
  readonly accent?: string;
  readonly disabled?: boolean;
}

export function VintageRotaryKnob({
  label,
  value,
  min,
  max,
  step = (max - min) / 100,
  defaultValue,
  onChange,
  formatValue,
  size = 52,
  accent = "#D9A75C",
  disabled = false,
}: VintageRotaryKnobProps) {
  const rawId = useId();
  const labelId = `${rawId}-lbl`;
  const roundFn = (v: number) => {
    const stepped = Math.round((v - min) / step) * step + min;
    return clamp(Number(stepped.toFixed(4)), min, max);
  };
  const displayFn = (v: number) => (formatValue ? formatValue(v) : v.toFixed(2));
  const norm = clamp((value - min) / Math.max(1e-6, max - min), 0, 1);
  const angleDeg = -135 + norm * 270;

  const { onKeyDown } = useKnobKeyboardControls({
    valueRaw: value,
    valueMin: min,
    valueMax: max,
    step,
    stepLarger: step * 10,
    onValueRawChange: (next) => {
      if (!disabled) onChange(roundFn(next));
    },
  });

  const activeArc = describeArc(32, 32, 26, -135, angleDeg);
  const trackArc = describeArc(32, 32, 26, -135, 135);

  return (
    <div
      className={`flex flex-col items-center gap-1 select-none ${disabled ? "opacity-45 pointer-events-none" : ""}`}
    >
      <KnobHeadless
        id={rawId}
        aria-labelledby={labelId}
        valueRaw={value}
        valueMin={min}
        valueMax={max}
        dragSensitivity={0.006}
        includeIntoTabOrder
        valueRawRoundFn={roundFn}
        valueRawDisplayFn={displayFn}
        onValueRawChange={(next) => {
          if (!disabled) onChange(next);
        }}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          if (!disabled && defaultValue !== undefined) onChange(roundFn(defaultValue));
        }}
        onWheel={(e) => {
          if (disabled) return;
          e.preventDefault();
          const mult = e.shiftKey ? 5 : 1;
          onChange(roundFn(value + (e.deltaY < 0 ? step : -step) * mult));
        }}
        style={{ width: size, height: size, touchAction: "none" }}
        className="relative flex items-center justify-center rounded-full cursor-ns-resize outline-none focus-visible:ring-2 focus-visible:ring-[#D9A75C]"
      >
        <svg viewBox="0 0 64 64" className="size-full overflow-visible pointer-events-none" aria-hidden="true">
          {/* Outer engraved scale ticks */}
          {TICK_ANGLES.map((deg) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            const inner = 27.5;
            const outer = deg === -135 || deg === 0 || deg === 135 ? 31.5 : 30;
            return (
              <line
                key={deg}
                x1={32 + inner * Math.cos(rad)}
                y1={32 + inner * Math.sin(rad)}
                x2={32 + outer * Math.cos(rad)}
                y2={32 + outer * Math.sin(rad)}
                stroke={deg <= angleDeg ? accent : "#524E48"}
                strokeWidth={deg === 0 ? 1.8 : 1.2}
                strokeLinecap="round"
              />
            );
          })}
          {/* Recessed track arc + warm amber/emerald active arc */}
          <path d={trackArc} fill="none" stroke="#262523" strokeWidth="2.4" strokeLinecap="round" />
          {activeArc && (
            <path d={activeArc} fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round" />
          )}
          {/* Machined bakelite / brushed-brass cap */}
          <circle cx="32" cy="32" r="20" fill="#1C1B19" stroke="#3D3830" strokeWidth="1.5" />
          <circle cx="32" cy="32" r="17.5" fill="url(#vintage-knob-cap)" stroke="#554B3C" strokeWidth="0.9" />
          {/* Rotating indicator needle */}
          <g transform={`rotate(${angleDeg.toFixed(1)} 32 32)`}>
            <line
              x1="32"
              y1="26"
              x2="32"
              y2="16"
              stroke="#F4EFE6"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <circle cx="32" cy="18.5" r="1.4" fill={accent} />
          </g>
          <defs>
            <radialGradient id="vintage-knob-cap" cx="35%" cy="28%">
              <stop offset="0%" stopColor="#3B362E" />
              <stop offset="55%" stopColor="#211E1A" />
              <stop offset="100%" stopColor="#141210" />
            </radialGradient>
          </defs>
        </svg>
      </KnobHeadless>
      <KnobHeadlessLabel
        id={labelId}
        className="text-xs font-medium tracking-wide text-[#D4CBBF] whitespace-nowrap"
      >
        {label}
      </KnobHeadlessLabel>
      <KnobHeadlessOutput
        htmlFor={rawId}
        className="text-xs font-semibold tabular-nums text-[#D9A75C] leading-none"
      >
        {displayFn(value)}
      </KnobHeadlessOutput>
    </div>
  );
}

export function VintageToggleSwitch({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  accent = "#34D399",
  testId,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onCheckedChange: (next: boolean) => void;
  readonly disabled?: boolean;
  readonly accent?: string;
  readonly testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-45 ${
        checked
          ? "border-[#D9A75C]/70 bg-[#23201B] text-[#F4EFE6] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          : "border-[#33312D] bg-[#181715] text-[#B7AEA0] hover:border-[#554E42] hover:text-[#F4EFE6]"
      }`}
    >
      <span
        aria-hidden="true"
        className="size-2.5 rounded-full border border-black/50 transition-colors"
        style={{
          backgroundColor: checked ? accent : "#3A3732",
          boxShadow: checked ? `0 0 8px ${accent}` : "inset 0 1px 2px rgba(0,0,0,0.6)",
        }}
      />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

export function VintageVuMeter({
  voiceId,
  master = false,
  segments = 12,
  gain = 1,
  label = "VU",
}: {
  readonly voiceId?: string;
  readonly master?: boolean;
  readonly segments?: number;
  readonly gain?: number;
  readonly label?: string;
}) {
  const segRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const gainRef = useRef(gain);
  gainRef.current = gain;

  useEffect(() => {
    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = useEnsemble.getState();
      const playing = st.status === "playing" || st.status === "buffering";
      let raw = 0;
      if (master) {
        raw = playing ? Math.max(st.peak, 0.16) : 0;
      } else if (voiceId && playing) {
        const p = pose(voiceId);
        raw = (p.singing ? Math.max(0.22, p.level) : 0) * gainRef.current;
      }
      smoothed = raw > smoothed ? raw : smoothed * 0.84;
      const lit = Math.round(clamp(smoothed, 0, 1) * segments);
      for (let i = 0; i < segments; i++) {
        const el = segRefs.current[i];
        if (el) el.style.opacity = i < lit ? "1" : "0.18";
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voiceId, master, segments]);

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-md border border-[#35312B] bg-[#0D0C0A] px-2 py-1"
      aria-hidden="true"
      data-vu-meter={master ? "master" : voiceId}
    >
      {label && <span className="text-xs font-semibold text-[#A79E90]">{label}</span>}
      <div className="flex items-center gap-[2px]">
        {Array.from({ length: segments }, (_, i) => {
          const ratio = i / Math.max(1, segments - 1);
          const color = ratio > 0.82 ? "#E06356" : ratio > 0.62 ? "#D9A75C" : "#34D399";
          return (
            <span
              key={i}
              ref={(el) => {
                segRefs.current[i] = el;
              }}
              className="h-3 w-1.5 rounded-[1px]"
              style={{ backgroundColor: color, opacity: 0.18 }}
            />
          );
        })}
      </div>
    </div>
  );
}
