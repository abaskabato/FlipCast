'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Crosshair, RotateCcw } from 'lucide-react';

import { CENTER_FOCUS, normalizeFocus, type Focus } from '@/lib/video/geometry';

/**
 * Manual crop focal point picker.
 *
 * Shows the source frame and lets the user place the point that must survive the
 * crop. It draws the *actual* crop rectangle for each selected ratio rather than
 * a generic centre box, so what you see is what ffmpeg samples: `geometry.filterExpr`
 * computes the same rectangle, just symbolically at render time.
 *
 * Keyboard accessible by design — a drag-only control would be unusable without a
 * pointer. Arrows nudge, shift-arrow nudges further, Home recentres.
 */

type Props = {
  focus: Focus;
  onChange: (focus: Focus) => void;
  disabled?: boolean;
  /** Source dimensions, used to draw a true-to-shape crop rectangle. */
  sourceWidth: number | null;
  sourceHeight: number | null;
  /** Output ratios the user selected, so we can overlay each crop window. */
  ratios: readonly string[];
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export default function FocusPicker({
  focus,
  onChange,
  disabled,
  sourceWidth,
  sourceHeight,
  ratios,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  /** Convert a pointer position into normalized frame coordinates. */
  const pointFromEvent = useCallback((clientX: number, clientY: number): Focus => {
    const el = boxRef.current;
    if (!el) return CENTER_FOCUS;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return CENTER_FOCUS;
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      // Capture on the element so a drag that leaves the box still tracks.
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      onChange(pointFromEvent(e.clientX, e.clientY));
    },
    [disabled, onChange, pointFromEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !dragging) return;
      onChange(pointFromEvent(e.clientX, e.clientY));
    },
    [disabled, dragging, onChange, pointFromEvent],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }, []);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (disabled) return;
      const next = normalizeFocus({ x: focus.x + dx, y: focus.y + dy });
      onChange(next);
    },
    [disabled, focus.x, focus.y, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      // Bigger step with Shift so the whole frame is reachable in a few presses.
      const step = e.shiftKey ? 0.1 : 0.02;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          nudge(-step, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          nudge(step, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          nudge(0, -step);
          break;
        case 'ArrowDown':
          e.preventDefault();
          nudge(0, step);
          break;
        case 'Home':
          e.preventDefault();
          onChange(CENTER_FOCUS);
          break;
        default:
          break;
      }
    },
    [disabled, nudge, onChange],
  );

  const isCentred =
    Math.abs(focus.x - CENTER_FOCUS.x) < 1e-6 && Math.abs(focus.y - CENTER_FOCUS.y) < 1e-6;

  // Crop rectangles in frame-relative percentages. Mirrors geometry.filterExpr:
  // largest rectangle of the target aspect that fits, then slid by the focus.
  const overlays = useMemo(() => {
    if (!sourceWidth || !sourceHeight) return [];
    const s = sourceWidth / sourceHeight;
    return ratios.map((r) => {
      const parts = r.split(':').map(Number);
      const [rw, rh] = parts.length === 2 && parts[0] && parts[1] ? parts : [9, 16];
      const t = rw / rh;
      let cw: number; // fraction of source width
      let ch: number; // fraction of source height
      if (Math.abs(s - t) < 1e-6) {
        cw = 1;
        ch = 1;
      } else if (s > t) {
        // trim sides
        ch = 1;
        cw = t / s;
      } else {
        // trim top/bottom
        cw = 1;
        ch = s / t;
      }
      const slideX = (1 - cw) * focus.x;
      const slideY = (1 - ch) * focus.y;
      return {
        ratio: r,
        left: slideX * 100,
        top: slideY * 100,
        width: cw * 100,
        height: ch * 100,
      };
    });
  }, [sourceWidth, sourceHeight, ratios, focus.x, focus.y]);

  return (
    <div className="fc-card-inset mt-3 space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
          <Crosshair className="h-3.5 w-3.5 text-indigo-400" />
          Focal point
        </p>
        <button
          type="button"
          onClick={() => onChange(CENTER_FOCUS)}
          disabled={disabled || isCentred}
          className="fc-btn-ghost disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Recentre
        </button>
      </div>

      <div
        ref={boxRef}
        role="application"
        aria-label="Focal point picker. Click or drag to set the point that stays in frame. Arrow keys move it, Shift plus arrows move further, Home recentres."
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        className={`relative aspect-video w-full touch-none select-none overflow-hidden rounded-lg border border-slate-700 bg-slate-900 ${
          disabled ? 'cursor-not-allowed opacity-60' : dragging ? 'cursor-grabbing' : 'cursor-crosshair'
        }`}
      >
        {/* Crop windows: the area that survives into each output. */}
        {overlays.map((o, i) => (
          <div
            key={o.ratio}
            className="pointer-events-none absolute border-2 border-dashed border-indigo-400/60"
            style={{
              left: `${o.left}%`,
              top: `${o.top}%`,
              width: `${o.width}%`,
              height: `${o.height}%`,
              zIndex: 1,
            }}
          >
            <span className="absolute -top-0.5 left-1 rounded bg-slate-950/80 px-1 text-[10px] font-semibold text-indigo-300">
              {o.ratio}
              {overlays.length > 1 ? ` ${i + 1}` : ''}
            </span>
          </div>
        ))}

        {/* The focus handle itself. */}
        <div
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%`, zIndex: 2 }}
        >
          <span className="absolute inset-0 rounded-full border-2 border-emerald-400" />
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400" />
        </div>

        {!sourceWidth && (
          <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-slate-500">
            Frame dimensions unavailable — you can still set a focal point.
          </p>
        )}
      </div>

      <p className="fc-meta">
        {isCentred
          ? 'Centred — same as Auto Centre.'
          : `Kept at ${Math.round(focus.x * 100)}% across, ${Math.round(focus.y * 100)}% down. Applies to every format.`}
      </p>
    </div>
  );
}
