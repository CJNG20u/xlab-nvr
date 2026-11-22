import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { ContinuousSegment, DetectionClip } from '../types';
import { LABEL_META, dateToDayBounds, formatTimeHms } from '../lib/format';

interface TimelineScrubberProps {
  date: string;
  segments: ContinuousSegment[];
  clips: DetectionClip[];
  currentTimeMs: number | null;
  isLive?: boolean;
  orientation: 'vertical' | 'horizontal';
  zoomable?: boolean;
  onSeek: (targetMs: number) => void;
}

const DAY_MS = 86_400_000;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ZOOM_LEVELS = [1, 2, 4, 8] as const;

export function TimelineScrubber({
  date,
  segments,
  clips,
  currentTimeMs,
  isLive = false,
  orientation,
  zoomable = false,
  onSeek,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState<(typeof ZOOM_LEVELS)[number]>(1);
  const [hoverInfo, setHoverInfo] = useState<{
    ratio: number;
    timeMs: number;
    clip?: DetectionClip;
  } | null>(null);

  const { dayStartMs, dayEndMs } = useMemo(() => dateToDayBounds(date), [date]);

  const ratioFromPointer = (clientX: number, clientY: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const raw =
      orientation === 'vertical'
        ? (clientY - rect.top) / Math.max(1, rect.height)
        : (clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(1, raw));
  };

  const timeFromRatio = (ratio: number): number => {
    return Math.round(dayStartMs + ratio * DAY_MS);
  };

  const findNearestClip = (targetMs: number): DetectionClip | undefined => {
    let best: DetectionClip | undefined;
    let bestDist = (4 * 60 * 1000) / zoom;
    for (const clip of clips) {
      const dist = Math.abs(clip.timestamp - targetMs);
      if (dist < bestDist) {
        bestDist = dist;
        best = clip;
      }
    }
    return best;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    const ratio = ratioFromPointer(e.clientX, e.clientY);
    onSeek(timeFromRatio(ratio));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ratio = ratioFromPointer(e.clientX, e.clientY);
    const ms = timeFromRatio(ratio);
    setHoverInfo({ ratio, timeMs: ms, clip: findNearestClip(ms) });
    if (isDragging) {
      onSeek(ms);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const playheadRatio = useMemo(() => {
    if (currentTimeMs === null) return null;
    if (currentTimeMs < dayStartMs || currentTimeMs > dayEndMs) return null;
    return (currentTimeMs - dayStartMs) / DAY_MS;
  }, [currentTimeMs, dayStartMs, dayEndMs]);

  useEffect(() => {
    if (orientation !== 'horizontal' || !zoomable || playheadRatio === null) return;
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const targetScrollLeft =
      playheadRatio * scroller.scrollWidth - scroller.clientWidth * 0.5;
    scroller.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior: 'smooth',
    });
  }, [zoom, orientation, zoomable]);

  const normalizedSegments = useMemo(() => {
    return segments
      .map((seg) => {
        const clampedStart = Math.max(dayStartMs, seg.startTime);
        const clampedEnd = Math.min(dayEndMs, seg.endTime);
        if (clampedEnd <= clampedStart) return null;
        return {
          id: seg.id,
          startPct: ((clampedStart - dayStartMs) / DAY_MS) * 100,
          sizePct: Math.max(0.2, ((clampedEnd - clampedStart) / DAY_MS) * 100),
        };
      })
      .filter((item): item is { id: string; startPct: number; sizePct: number } => item !== null);
  }, [segments, dayStartMs, dayEndMs]);

  const normalizedClips = useMemo(() => {
    return clips
      .map((clip) => {
        if (clip.timestamp < dayStartMs || clip.timestamp > dayEndMs) return null;
        const pct = ((clip.timestamp - dayStartMs) / DAY_MS) * 100;
        return { clip, pct };
      })
      .filter((item): item is { clip: DetectionClip; pct: number } => item !== null);
  }, [clips, dayStartMs, dayEndMs]);

  const stepZoom = (dir: 1 | -1) => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    const nextIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx + dir));
    setZoom(ZOOM_LEVELS[nextIdx]);
  };

  if (orientation === 'vertical') {
    return (
      <div className="flex flex-col h-full w-32 xl:w-36 shrink-0 bg-[#0a0a0c] border-l border-zinc-900 select-none">
        <div className="px-3 py-2.5 border-b border-zinc-900 flex items-center justify-between text-[11px] text-zinc-400">
          <span className="font-medium text-zinc-300">Timeline</span>
          <span className="font-mono tabular-nums text-zinc-500">{clips.length} evts</span>
        </div>

        <div
          ref={trackRef}
          role="slider"
          aria-label="24-hour recording timeline"
          aria-valuemin={dayStartMs}
          aria-valuemax={dayEndMs}
          aria-valuenow={currentTimeMs ?? dayStartMs}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            if (!isDragging) setHoverInfo(null);
          }}
          className="relative flex-1 cursor-ns-resize touch-none overflow-hidden"
        >
          {HOURS.map((hour) => {
            const topPct = (hour / 24) * 100;
            const showLabel = hour % 2 === 0;
            return (
              <div
                key={hour}
                style={{ top: `${topPct}%` }}
                className="absolute inset-x-0 pointer-events-none flex items-start"
              >
                <div className="w-full border-t border-zinc-900" />
                {showLabel && (
                  <span className="absolute left-2 -translate-y-1/2 text-[10px] font-mono tabular-nums text-zinc-500 bg-[#0a0a0c] px-0.5">
                    {String(hour).padStart(2, '0')}:00
                  </span>
                )}
              </div>
            );
          })}

          <div className="absolute top-0 bottom-0 left-14 right-7 pointer-events-none">
            {normalizedSegments.map((seg) => (
              <div
                key={seg.id}
                style={{ top: `${seg.startPct}%`, height: `${seg.sizePct}%` }}
                className="absolute inset-x-0 bg-[#3b5998]/40 border-y border-[#4f6bed]/30 rounded-[1px]"
              />
            ))}
          </div>

          <div className="absolute top-0 bottom-0 right-2 w-4 pointer-events-none">
            {normalizedClips.map(({ clip, pct }) => {
              const meta = LABEL_META[clip.label] ?? LABEL_META.motion;
              return (
                <div
                  key={clip.id}
                  style={{ top: `${pct}%` }}
                  className={`absolute inset-x-0 h-1.5 -translate-y-1/2 rounded-sm ${meta.barClass} shadow-sm`}
                />
              );
            })}
          </div>

          {hoverInfo && (
            <div
              style={{ top: `${hoverInfo.ratio * 100}%` }}
              className="absolute inset-x-0 pointer-events-none z-20"
            >
              <div className="w-full border-t border-zinc-500/70" />
              <div className="absolute right-1.5 -translate-y-full -mt-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono tabular-nums text-zinc-200 whitespace-nowrap shadow-lg">
                {formatTimeHms(hoverInfo.timeMs)}
                {hoverInfo.clip && (
                  <span className={`ml-1.5 ${LABEL_META[hoverInfo.clip.label].textClass}`}>
                    {LABEL_META[hoverInfo.clip.label].label}
                  </span>
                )}
              </div>
            </div>
          )}

          {playheadRatio !== null && (
            <div
              style={{ top: `${playheadRatio * 100}%` }}
              className="absolute inset-x-0 pointer-events-none z-30"
            >
              <div className={`w-full h-0.5 ${isLive ? 'bg-red-500' : 'bg-[#4f6bed]'}`} />
              <div
                className={`absolute left-1 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums font-medium text-white shadow ${
                  isLive ? 'bg-red-600' : 'bg-[#3b5998]'
                }`}
              >
                {formatTimeHms(currentTimeMs!)}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const hourStep = zoom >= 4 ? 1 : zoom >= 2 ? 2 : 3;

  return (
    <div className="w-full bg-[#0a0a0c] border-t border-zinc-900 px-3 sm:px-4 py-2.5 select-none">
      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400 mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-mono tabular-nums text-xs font-medium text-zinc-100">
            {currentTimeMs ? formatTimeHms(currentTimeMs) : '00:00:00'}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="font-mono tabular-nums text-zinc-500 truncate">
            {segments.length} segments · {clips.length} detections
          </span>
        </div>

        {zoomable && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => stepZoom(-1)}
              disabled={zoom === ZOOM_LEVELS[0]}
              aria-label="Zoom out timeline"
              className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-35 text-zinc-300 cursor-pointer disabled:cursor-not-allowed"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono tabular-nums text-[11px] text-zinc-300 min-w-[2.2rem] text-center">
              {zoom}x
            </span>
            <button
              type="button"
              onClick={() => stepZoom(1)}
              disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              aria-label="Zoom in timeline"
              className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-35 text-zinc-300 cursor-pointer disabled:cursor-not-allowed"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollContainerRef}
        className="w-full overflow-x-auto rounded-lg bg-black border border-zinc-800"
      >
        <div
          ref={trackRef}
          role="slider"
          aria-label="24-hour recording timeline"
          aria-valuemin={dayStartMs}
          aria-valuemax={dayEndMs}
          aria-valuenow={currentTimeMs ?? dayStartMs}
          tabIndex={0}
          style={{ width: `${zoom * 100}%`, minWidth: '100%' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            if (!isDragging) setHoverInfo(null);
          }}
          className="relative h-16 cursor-ew-resize touch-none"
        >
          {HOURS.map((hour) => {
            const leftPct = (hour / 24) * 100;
            const showLabel = hour % hourStep === 0;
            return (
              <div
                key={hour}
                style={{ left: `${leftPct}%` }}
                className="absolute inset-y-0 border-l border-zinc-900 pointer-events-none"
              >
                {showLabel && (
                  <span className="absolute bottom-1 left-1 text-[10px] font-mono tabular-nums text-zinc-500">
                    {String(hour).padStart(2, '0')}:00
                  </span>
                )}
              </div>
            );
          })}
          <span className="absolute bottom-1 right-1.5 text-[10px] font-mono tabular-nums text-zinc-600 pointer-events-none">
            23:59
          </span>

          <div className="absolute top-2 h-5 inset-x-0 pointer-events-none">
            {normalizedSegments.map((seg) => (
              <div
                key={seg.id}
                style={{ left: `${seg.startPct}%`, width: `${seg.sizePct}%` }}
                className="absolute inset-y-0 bg-[#3b5998]/45 border-x border-[#4f6bed]/35 rounded-[1px]"
              />
            ))}
          </div>

          <div className="absolute top-8 h-3 inset-x-0 pointer-events-none">
            {normalizedClips.map(({ clip, pct }) => {
              const meta = LABEL_META[clip.label] ?? LABEL_META.motion;
              return (
                <div
                  key={clip.id}
                  style={{ left: `${pct}%` }}
                  className={`absolute inset-y-0 w-1.5 -translate-x-1/2 rounded-full ${meta.barClass} shadow-sm`}
                />
              );
            })}
          </div>

          {hoverInfo && (
            <div
              style={{ left: `${hoverInfo.ratio * 100}%` }}
              className="absolute inset-y-0 pointer-events-none z-20"
            >
              <div className="h-full w-px bg-zinc-500/75" />
              <div className="absolute top-1 left-1.5 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono tabular-nums text-zinc-100 whitespace-nowrap shadow-md">
                {formatTimeHms(hoverInfo.timeMs)}
                {hoverInfo.clip && (
                  <span className={`ml-1.5 ${LABEL_META[hoverInfo.clip.label].textClass}`}>
                    {LABEL_META[hoverInfo.clip.label].label}
                  </span>
                )}
              </div>
            </div>
          )}

          {playheadRatio !== null && (
            <div
              style={{ left: `${playheadRatio * 100}%` }}
              className={`absolute inset-y-0 w-0.5 pointer-events-none z-30 ${
                isLive ? 'bg-red-500' : 'bg-[#4f6bed]'
              }`}
            >
              <div
                className={`w-2.5 h-2.5 -translate-x-[4px] -translate-y-0.5 rounded-full ${
                  isLive ? 'bg-red-500' : 'bg-[#4f6bed]'
                }`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
