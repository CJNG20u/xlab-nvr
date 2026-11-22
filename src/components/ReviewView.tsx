import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  FastForward,
  Film,
  Pause,
  Play,
  SkipForward,
} from 'lucide-react';
import type {
  ContinuousSegment,
  DetectionClip,
  PublicCameraConfig,
} from '../types';
import { fetchReviewDay } from '../lib/api';
import {
  dateToDayBounds,
  formatTimeHms,
  recordingUrl,
  todayDateString,
} from '../lib/format';
import { TimelineScrubber } from './TimelineScrubber';

interface ReviewViewProps {
  cameras: PublicCameraConfig[];
  onOpenCameraTimeline: (cameraId: string, date: string, timestampMs: number) => void;
}

const SPEEDS = [1, 2, 4, 8] as const;

interface SyncVideoTileProps {
  camera: PublicCameraConfig;
  segments: ContinuousSegment[];
  currentTimeMs: number;
  isPlaying: boolean;
  playbackRate: number;
  onClick: () => void;
}

function SyncVideoTile({
  camera,
  segments,
  currentTimeMs,
  isPlaying,
  playbackRate,
  onClick,
}: SyncVideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const activeSegment = useMemo(
    () => segments.find((s) => currentTimeMs >= s.startTime && currentTimeMs <= s.endTime) || null,
    [segments, currentTimeMs]
  );

  const src = activeSegment ? activeSegment.fileUrl || recordingUrl(activeSegment.filePath) : '';

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !activeSegment) return;

    vid.playbackRate = playbackRate;
    const expectedSec = Math.max(
      0,
      Math.min(activeSegment.duration - 0.1, (currentTimeMs - activeSegment.startTime) / 1000)
    );

    if (Math.abs(vid.currentTime - expectedSec) > 1.25) {
      vid.currentTime = expectedSec;
    }

    if (isPlaying && vid.paused) {
      vid.play().catch(() => {});
    } else if (!isPlaying && !vid.paused) {
      vid.pause();
    }
  }, [activeSegment, currentTimeMs, isPlaying, playbackRate]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="group relative aspect-video w-full bg-[#121214] rounded-xl overflow-hidden cursor-pointer border border-zinc-900 hover:border-[#3b5998] transition-colors"
    >
      {src ? (
        <video
          key={src}
          ref={videoRef}
          src={src}
          muted
          playsInline
          onLoadedMetadata={() => {
            const vid = videoRef.current;
            if (!vid || !activeSegment) return;
            vid.playbackRate = playbackRate;
            vid.currentTime = Math.max(0, (currentTimeMs - activeSegment.startTime) / 1000);
            if (isPlaying) vid.play().catch(() => {});
          }}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 bg-[#121214] gap-1.5">
          <Film className="w-5 h-5 text-zinc-700" />
          <span className="text-xs font-medium text-zinc-400">{camera.name}</span>
          <span className="text-[11px] font-mono text-zinc-600">
            No footage · {formatTimeHms(currentTimeMs)}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-100 truncate">{camera.name}</span>
        <span className="text-[10px] font-mono tabular-nums text-zinc-400">
          {activeSegment ? 'REC' : 'GAP'}
        </span>
      </div>
    </div>
  );
}

export function ReviewView({ cameras, onOpenCameraTimeline }: ReviewViewProps) {
  const [date, setDate] = useState<string>(todayDateString());
  const [segments, setSegments] = useState<ContinuousSegment[]>([]);
  const [clips, setClips] = useState<DetectionClip[]>([]);
  const [loading, setLoading] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [skipEmptyOnly, setSkipEmptyOnly] = useState(false);

  const { dayStartMs, dayEndMs } = useMemo(() => dateToDayBounds(date), [date]);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(() => Date.now() - 60_000);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchReviewDay(date)
      .then((res) => {
        if (cancelled) return;
        setSegments(res.segments);
        setClips(res.clips);
        if (res.segments.length > 0) {
          setCurrentTimeMs(res.segments[res.segments.length - 1].startTime);
        } else if (res.clips.length > 0) {
          setCurrentTimeMs(res.clips[res.clips.length - 1].timestamp);
        } else {
          setCurrentTimeMs(dateToDayBounds(date).dayStartMs + 12 * 3600 * 1000);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSegments([]);
          setClips([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [date]);

  const segmentsByCamera = useMemo(() => {
    const map: Record<string, ContinuousSegment[]> = {};
    for (const seg of segments) {
      if (!map[seg.cameraId]) map[seg.cameraId] = [];
      map[seg.cameraId].push(seg);
    }
    return map;
  }, [segments]);

  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = 250;
    const timer = window.setInterval(() => {
      setCurrentTimeMs((prev) => {
        const next = prev + intervalMs * speed;
        if (next >= dayEndMs) {
          setIsPlaying(false);
          return dayEndMs;
        }

        if (skipEmptyOnly) {
          const inEventWindow = clips.some(
            (c) => next >= c.timestamp - 3000 && next <= c.timestamp + (c.duration + 3) * 1000
          );
          if (!inEventWindow) {
            const nextClip = clips.find((c) => c.timestamp > next);
            if (nextClip) {
              return Math.max(dayStartMs, nextClip.timestamp - 2000);
            }
            setIsPlaying(false);
            return prev;
          }
        } else {
          const hasAnyFootage = segments.some((s) => next >= s.startTime && next <= s.endTime);
          if (!hasAnyFootage) {
            const nextSeg = segments.find((s) => s.startTime > next);
            if (nextSeg && nextSeg.startTime - next > 30_000) {
              return nextSeg.startTime;
            }
          }
        }
        return next;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, speed, skipEmptyOnly, clips, segments, dayStartMs, dayEndMs]);

  const gridColsClass =
    cameras.length <= 1
      ? 'grid-cols-1 max-w-5xl mx-auto'
      : cameras.length <= 4
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="flex flex-col h-full min-h-0 bg-black">
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-2.5 px-3 pt-[calc(0.625rem+env(safe-area-inset-top))] pb-2.5 border-b border-zinc-900 bg-black">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold text-zinc-100 mr-1">Review</h1>

          <label className="relative inline-flex items-center">
            <Calendar className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 pointer-events-none" />
            <input
              type="date"
              aria-label="Review date"
              value={date}
              onChange={(e) => {
                setIsPlaying(false);
                setDate(e.target.value);
              }}
              className="h-9 bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-mono tabular-nums rounded-lg pl-8 pr-2.5 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
            />
          </label>

          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-[#3b5998] hover:bg-[#4f6bed] text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <div className="inline-flex items-center h-9 rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
            <FastForward className="w-3.5 h-3.5 text-zinc-500 mx-1.5" />
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded-md text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                  speed === s
                    ? 'bg-[#1e293b] text-[#93b0ff]'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSkipEmptyOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
              skipEmptyOnly
                ? 'bg-[#1e293b] text-[#93b0ff] border-[#3b5998]/60'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100'
            }`}
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip Empty / Motion Only
          </button>
        </div>

        <div className="flex items-center h-9 font-mono tabular-nums text-xs text-zinc-200 px-3 rounded-lg bg-zinc-900 border border-zinc-800">
          {formatTimeHms(currentTimeMs)}
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-2 bg-black">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className="aspect-video rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse"
                />
              ))}
            </div>
          ) : cameras.length === 0 ? (
            <div className="h-full flex items-center justify-center p-4">
              <div className="rounded-xl bg-[#121214] border border-zinc-800 px-6 py-5 text-xs text-zinc-400">
                Add cameras in Settings to review synchronized recordings.
              </div>
            </div>
          ) : (
            <div className={`grid gap-2 ${gridColsClass}`}>
              {cameras.map((cam) => (
                <SyncVideoTile
                  key={cam.id}
                  camera={cam}
                  segments={segmentsByCamera[cam.id] || []}
                  currentTimeMs={currentTimeMs}
                  isPlaying={isPlaying}
                  playbackRate={speed}
                  onClick={() => onOpenCameraTimeline(cam.id, date, currentTimeMs)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="lg:hidden shrink-0">
          <TimelineScrubber
            date={date}
            segments={segments}
            clips={clips}
            currentTimeMs={currentTimeMs}
            orientation="horizontal"
            onSeek={(ms) => setCurrentTimeMs(ms)}
          />
        </div>

        <div className="hidden lg:flex h-full shrink-0">
          <TimelineScrubber
            date={date}
            segments={segments}
            clips={clips}
            currentTimeMs={currentTimeMs}
            orientation="vertical"
            onSeek={(ms) => setCurrentTimeMs(ms)}
          />
        </div>
      </div>
    </div>
  );
}
