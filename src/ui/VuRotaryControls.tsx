import { useEffect, useId, useRef } from "react";
import { pose, useEnsemble } from "../choir/ensemble.ts";

/**
 * Zero-rerender SVG Rotary Gain Knob.
 * Pointer drags mutate the SVG indicator rotation & arc path directly via refs
 * and commit `onChange(nextVal)` smoothly without re-rendering sibling mixer strips.
 */
export function SvgRotaryKnob({
  value,
  onChange,
  label,
  accent = "#34d399",
  size = 36,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  accent?: string;
  size?: number;
}) {
  const gradId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const dialRef = useRef<SVGGElement>(null);
  const arcRef = useRef<SVGPathElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startVal: number } | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const valRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valRef.current = value;
  onChangeRef.current = onChange;

  const r = 13;
  const cx = 18;
  const cy = 18;

  const paintKnob = (norm: number) => {
    const clamped = Math.max(0, Math.min(1, norm));
    const deg = -135 + clamped * 270;
    if (svgRef.current) {
      svgRef.current.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
    }
    if (dialRef.current) {
      dialRef.current.setAttribute("transform", `rotate(${deg.toFixed(1)} ${cx} ${cy})`);
    }
    if (arcRef.current) {
      const startRad = (-225 * Math.PI) / 180;
      const endRad = ((-225 + clamped * 270) * Math.PI) / 180;
      const x1 = cx + r * Math.cos(startRad);
      const y1 = cy + r * Math.sin(startRad);
      const x2 = cx + r * Math.cos(endRad);
      const y2 = cy + r * Math.sin(endRad);
      const largeArc = clamped * 270 > 180 ? 1 : 0;
      if (clamped <= 0.005) {
        arcRef.current.setAttribute("d", "");
      } else {
        arcRef.current.setAttribute(
          "d",
          `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
        );
      }
    }
  };

  useEffect(() => {
    paintKnob(value);
  }, [value]);

  useEffect(() => {
    return () => {
      cleanupDragRef.current?.();
      cleanupDragRef.current = null;
    };
  }, []);

  const commitValue = (next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    valRef.current = clamped;
    paintKnob(clamped);
    onChangeRef.current(clamped);
  };

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 36 36"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      className="shrink-0 select-none cursor-ns-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-full"
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        cleanupDragRef.current?.();
        const targetEl = e.currentTarget;
        const pointerId = e.pointerId;
        try {
          targetEl.setPointerCapture(pointerId);
        } catch {
          /* synthetic or tiny-target pointer events may skip capture */
        }
        dragRef.current = { pointerId, startY: e.clientY, startVal: valRef.current };

        const onWinMove = (ev: PointerEvent) => {
          const drag = dragRef.current;
          if (!drag) return;
          if (ev.pointerId && drag.pointerId && ev.pointerId !== drag.pointerId) return;
          const delta = (drag.startY - ev.clientY) / 96;
          commitValue(drag.startVal + delta);
        };

        const cleanup = () => {
          window.removeEventListener("pointermove", onWinMove);
          window.removeEventListener("pointerup", onWinUp);
          window.removeEventListener("pointercancel", onWinUp);
          try {
            if (targetEl.hasPointerCapture(pointerId)) {
              targetEl.releasePointerCapture(pointerId);
            }
          } catch {
            /* ignore if target unmounted or capture already released */
          }
          dragRef.current = null;
          if (cleanupDragRef.current === cleanup) cleanupDragRef.current = null;
        };

        const onWinUp = (ev: PointerEvent) => {
          const drag = dragRef.current;
          if (drag && ev.pointerId && drag.pointerId && ev.pointerId !== drag.pointerId) return;
          cleanup();
        };

        cleanupDragRef.current = cleanup;
        window.addEventListener("pointermove", onWinMove);
        window.addEventListener("pointerup", onWinUp);
        window.addEventListener("pointercancel", onWinUp);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        commitValue(1);
      }}
      onWheel={(e) => {
        e.preventDefault();
        const step = e.shiftKey ? 0.08 : 0.04;
        commitValue(valRef.current + (e.deltaY < 0 ? step : -step));
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.05;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          commitValue(valRef.current + step);
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          commitValue(valRef.current - step);
        } else if (e.key === "Home") {
          e.preventDefault();
          commitValue(0);
        } else if (e.key === "End") {
          e.preventDefault();
          commitValue(1);
        }
      }}
    >
      <circle cx={cx} cy={cy} r={14} fill="#141a1d" stroke="#2a363c" strokeWidth="1.5" />
      <path ref={arcRef} fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={10} fill={`url(#${gradId})`} stroke="#37444a" strokeWidth="1" />
      <g ref={dialRef} transform={`rotate(${(-135 + value * 270).toFixed(1)} ${cx} ${cy})`}>
        <line x1={cx} y1={cy - 2} x2={cx} y2={cy - 8.5} stroke={accent} strokeWidth="2" strokeLinecap="round" />
      </g>
      <defs>
        <radialGradient id={gradId} cx="35%" cy="30%">
          <stop offset="0%" stopColor="#323d42" />
          <stop offset="100%" stopColor="#12171a" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/**
 * rAF-driven LED VU Meter that mutates segment DOM attributes directly inside `requestAnimationFrame`
 * without triggering any React `setState` re-renders.
 */
export function RafLedVuMeter({
  voiceId,
  master = false,
  segments = 10,
  gain = 1,
}: {
  voiceId?: string;
  master?: boolean;
  segments?: number;
  gain?: number;
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
        raw = playing ? Math.max(st.peak, 0.18) : 0;
      } else if (voiceId && playing) {
        const p = pose(voiceId);
        raw = (p.singing ? Math.max(0.22, p.level) : 0) * gainRef.current;
      }
      smoothed = raw > smoothed ? raw : smoothed * 0.84;
      const litCount = Math.round(Math.max(0, Math.min(1, smoothed)) * segments);
      for (let i = 0; i < segments; i++) {
        const el = segRefs.current[i];
        if (!el) continue;
        el.style.opacity = i < litCount ? "1" : "0.18";
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voiceId, master, segments]);

  return (
    <div
      className="flex items-center gap-[2px]"
      aria-hidden="true"
      data-vu-meter={master ? "master" : voiceId}
    >
      {Array.from({ length: segments }, (_, i) => {
        const ratio = i / Math.max(1, segments - 1);
        const color = ratio > 0.84 ? "#ef4444" : ratio > 0.65 ? "#f59e0b" : "#34d399";
        return (
          <span
            key={i}
            ref={(el) => {
              segRefs.current[i] = el;
            }}
            className="h-2.5 w-1.5 rounded-[1px] transition-none"
            style={{ backgroundColor: color, opacity: 0.18 }}
          />
        );
      })}
    </div>
  );
}
