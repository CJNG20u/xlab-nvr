import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Circle,
  Clock,
  Download,
  FastForward,
  Film,
  Maximize2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  RotateCw,
  ScanEye,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  ActiveRecording,
  CameraModesPatch,
  ContinuousSegment,
  DetectionClip,
  DetectionLabel,
  ObjectCountSummary,
  PublicCameraConfig,
} from '../types';
import { fetchCameraRecordings } from '../lib/api';
import {
  LABEL_META,
  formatDurationSeconds,
  formatTimeHms,
  recordingUrl,
  todayDateString,
  yesterdayDateString,
} from '../lib/format';
import { Go2RtcPlayer } from './Go2RtcPlayer';
import { TimelineScrubber } from './TimelineScrubber';

interface CameraDetailViewProps {
  cameras: PublicCameraConfig[];
  cameraId: string;
  initialDate?: string;
  initialTimestampMs?: number | null;
  preferHistoryOnOpen?: boolean;
  activeRecording?: ActiveRecording;
  onSelectCamera: (cameraId: string) => void;
  onToggleModes: (cameraId: string, patch: CameraModesPatch) => Promise<void>;
  onBack: () => void;
}

const SPEEDS = [1, 2, 4, 8] as const;

const OBJECT_FILTER_TABS: Array<{ id: '' | DetectionLabel; label: string }> = [
  { id: '', label: 'All' },
  { id: 'person', label: 'Person' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'pet', label: 'Pet' },
  { id: 'motion', label: 'Motion' },
  { id: 'line_crossing', label: 'Line' },
];

const EMPTY_COUNTS: ObjectCountSummary = {
  person: 0,
  vehicle: 0,
  pet: 0,
  line_crossing: 0,
  motion: 0,
};

export function CameraDetailView({
  cameras,
  cameraId,
  initialDate,
  initialTimestampMs = null,
  preferHistoryOnOpen = false,
  activeRecording,
  onSelectCamera,
  onToggleModes,
  onBack,
}: CameraDetailViewProps) {
  const camera = useMemo(
    () => cameras.find((c) => c.id === cameraId) || cameras[0],
    [cameras, cameraId]
  );

  const today = useMemo(() => todayDateString(), []);
  const yesterday = useMemo(() => yesterdayDateString(), []);

  const [date, setDate] = useState<string>(initialDate || today);
  const [segments, setSegments] = useState<ContinuousSegment[]>([]);
  const [clips, setClips] = useState<DetectionClip[]>([]);
  const [objectCounts, setObjectCounts] = useState<ObjectCountSummary>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(false);

  const [isLive, setIsLive] = useState<boolean>(
    initialTimestampMs === null && !preferHistoryOnOpen
  );
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(
    initialTimestampMs ?? Date.now()
  );
  const [activeSegment, setActiveSegment] = useState<ContinuousSegment | null>(null);
  const [activeClip, setActiveClip] = useState<DetectionClip | null>(null);
  const [pendingSeekOffsetSec, setPendingSeekOffsetSec] = useState<number>(0);

  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [muted, setMuted] = useState(true);
  const [noFootageNotice, setNoFootageNotice] = useState(false);

  const [objectFilter, setObjectFilter] = useState<'' | DetectionLabel>('');
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const initialSeekAppliedRef = useRef<string>('');

  useEffect(() => {
    if (!isLive) return;
    const tick = () => setCurrentTimeMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isLive]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  const seekToTimestamp = useCallback(
    (targetMs: number, segList: ContinuousSegment[], clipList: DetectionClip[]) => {
      setIsLive(false);
      setCurrentTimeMs(targetMs);

      let seg = segList.find((s) => targetMs >= s.startTime && targetMs <= s.endTime);

      if (!seg && segList.length > 0) {
        let nearest: ContinuousSegment | undefined;
        let minDist = 120_000;
        for (const candidate of segList) {
          const dist = Math.min(
            Math.abs(targetMs - candidate.startTime),
            Math.abs(targetMs - candidate.endTime)
          );
          if (dist < minDist) {
            minDist = dist;
            nearest = candidate;
          }
        }
        seg = nearest;
      }

      if (seg) {
        setNoFootageNotice(false);
        setActiveClip(null);
        const offsetSec = Math.max(
          0,
          Math.min(seg.duration - 0.2, (targetMs - seg.startTime) / 1000)
        );
        if (activeSegment?.id === seg.id && videoRef.current) {
          videoRef.current.currentTime = offsetSec;
          videoRef.current.playbackRate = playbackSpeed;
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
        } else {
          setActiveSegment(seg);
          setPendingSeekOffsetSec(offsetSec);
        }
        return;
      }

      const matchingClip = clipList.find(
        (c) =>
          targetMs >= c.timestamp - 5000 &&
          targetMs <= c.timestamp + (c.duration + 10) * 1000
      );
      if (matchingClip) {
        setNoFootageNotice(false);
        setActiveSegment(null);
        setActiveClip(matchingClip);
        setPendingSeekOffsetSec(Math.max(0, (targetMs - matchingClip.timestamp) / 1000));
        return;
      }

      setActiveSegment(null);
      setActiveClip(null);
      setNoFootageNotice(true);
    },
    [activeSegment?.id, playbackSpeed]
  );

  useEffect(() => {
    if (!camera) return;
    let cancelled = false;
    setLoading(true);

    fetchCameraRecordings(camera.id, date)
      .then((data) => {
        if (cancelled) return;
        setSegments(data.segments);
        setClips(data.clips);
        setObjectCounts(data.objectCounts || EMPTY_COUNTS);

        const deepKey = `${camera.id}:${initialDate || ''}:${initialTimestampMs ?? ''}:${preferHistoryOnOpen}`;
        if (initialTimestampMs !== null && initialSeekAppliedRef.current !== deepKey) {
          initialSeekAppliedRef.current = deepKey;
          seekToTimestamp(initialTimestampMs, data.segments, data.clips);
        } else if (preferHistoryOnOpen && initialSeekAppliedRef.current !== deepKey) {
          initialSeekAppliedRef.current = deepKey;
          if (data.clips.length > 0) {
            const latestClip = data.clips[data.clips.length - 1];
            setIsLive(false);
            setActiveSegment(null);
            setActiveClip(latestClip);
            setCurrentTimeMs(latestClip.timestamp);
            setPendingSeekOffsetSec(0);
            setNoFootageNotice(false);
          } else if (data.segments.length > 0) {
            const latestSeg = data.segments[data.segments.length - 1];
            seekToTimestamp(latestSeg.startTime, data.segments, data.clips);
          } else {
            setIsLive(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSegments([]);
          setClips([]);
          setObjectCounts(EMPTY_COUNTS);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [camera, date, initialDate, initialTimestampMs, preferHistoryOnOpen, seekToTimestamp]);

  const filteredClips = useMemo(() => {
    const list = objectFilter ? clips.filter((c) => c.label === objectFilter) : clips;
    return [...list].sort((a, b) => b.timestamp - a.timestamp);
  }, [clips, objectFilter]);

  const handleGoLive = () => {
    setDate(todayDateString());
    setIsLive(true);
    setActiveSegment(null);
    setActiveClip(null);
    setNoFootageNotice(false);
    setCurrentTimeMs(Date.now());
  };

  const handleSelectClipCard = (clip: DetectionClip) => {
    setIsLive(false);
    setNoFootageNotice(false);
    setActiveSegment(null);
    setActiveClip(clip);
    setCurrentTimeMs(clip.timestamp);
    setPendingSeekOffsetSec(0);
  };

  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (pendingSeekOffsetSec > 0 && Number.isFinite(vid.duration)) {
      vid.currentTime = Math.min(pendingSeekOffsetSec, Math.max(0, vid.duration - 0.1));
    }
    vid.muted = muted;
    vid.playbackRate = playbackSpeed;
    vid.play().catch(() => {});
    setIsPlaying(true);
  };

  const handleVideoTimeUpdate = () => {
    const vid = videoRef.current;
    if (!vid || isLive) return;
    if (activeSegment) {
      setCurrentTimeMs(Math.round(activeSegment.startTime + vid.currentTime * 1000));
    } else if (activeClip) {
      setCurrentTimeMs(Math.round(activeClip.timestamp + vid.currentTime * 1000));
    }
  };

  const handleVideoEnded = () => {
    if (activeSegment) {
      const idx = segments.findIndex((s) => s.id === activeSegment.id);
      if (idx !== -1 && idx + 1 < segments.length) {
        const next = segments[idx + 1];
        setActiveSegment(next);
        setPendingSeekOffsetSec(0);
        setCurrentTimeMs(next.startTime);
        return;
      }
    }
    setIsPlaying(false);
  };

  const togglePlayPause = () => {
    const vid = videoRef.current;
    if (!vid || isLive) return;
    if (vid.paused) {
      vid.play().catch(() => {});
      setIsPlaying(true);
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  };

  const jumpRelative = (deltaSec: number) => {
    if (isLive) {
      seekToTimestamp(Date.now() + deltaSec * 1000, segments, clips);
    } else {
      seekToTimestamp(currentTimeMs + deltaSec * 1000, segments, clips);
    }
  };

  const handleFullscreen = () => {
    const el = playerContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  const handleSnapshot = () => {
    if (!camera) return;
    const url = `/go2rtc/api/frame.jpeg?src=${encodeURIComponent(camera.go2rtcStreamName)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${camera.id}_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!camera) return null;

  const isLiveOnlyMode = !camera.recordContinuous && !camera.detectObjects;
  const videoSrc = activeSegment
    ? activeSegment.fileUrl || recordingUrl(activeSegment.filePath)
    : activeClip
      ? activeClip.clipUrl || recordingUrl(activeClip.clipPath)
      : '';

  return (
    <div className="flex flex-col h-full min-h-0 bg-black">
      {/* Top Pitch-Black Header Bar */}
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-2.5 px-3 pt-[calc(0.625rem+env(safe-area-inset-top))] pb-2.5 border-b border-zinc-900 bg-black">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Live Grid"
            className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-colors shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Live</span>
          </button>

          <select
            aria-label="Select camera"
            value={camera.id}
            onChange={(e) => {
              onSelectCamera(e.target.value);
              setIsLive(true);
              setActiveSegment(null);
              setActiveClip(null);
              setNoFootageNotice(false);
            }}
            className="h-9 bg-zinc-900 border border-zinc-800 text-zinc-100 text-xs font-semibold rounded-lg px-2.5 focus:outline-none focus:ring-2 focus:ring-[#4f6bed] max-w-[170px]"
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Independent Mode Quick-Toggle Pills */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() =>
                void onToggleModes(camera.id, {
                  recordContinuous: false,
                  detectObjects: false,
                })
              }
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                isLiveOnlyMode
                  ? 'bg-[#1e293b] text-[#93b0ff]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`}
            >
              <Radio className="w-3 h-3" />
              Live Only
            </button>

            <button
              type="button"
              onClick={() =>
                void onToggleModes(camera.id, {
                  recordContinuous: !camera.recordContinuous,
                })
              }
              aria-pressed={camera.recordContinuous}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                camera.recordContinuous
                  ? 'bg-red-950/90 text-red-200 border border-red-500/40'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`}
            >
              <Circle
                className={`w-2.5 h-2.5 ${
                  camera.recordContinuous ? 'fill-red-500 text-red-500' : 'text-zinc-500'
                }`}
              />
              REC
            </button>

            <button
              type="button"
              onClick={() =>
                void onToggleModes(camera.id, {
                  detectObjects: !camera.detectObjects,
                })
              }
              aria-pressed={camera.detectObjects}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                camera.detectObjects
                  ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/40'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`}
            >
              <ScanEye className="w-3 h-3" />
              AI
            </button>
          </div>
        </div>

        {/* Date Picker & LIVE Button */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <div className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
            <button
              type="button"
              onClick={() => setDate(today)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                date === today ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                setDate(yesterday);
                setIsLive(false);
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                date === yesterday
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Yesterday
            </button>
          </div>

          <label className="relative inline-flex items-center">
            <Calendar className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 pointer-events-none" />
            <input
              type="date"
              aria-label="Select recording date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                if (e.target.value !== todayDateString()) {
                  setIsLive(false);
                }
              }}
              className="h-9 bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-mono tabular-nums rounded-lg pl-8 pr-2 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
            />
          </label>

          <button
            type="button"
            onClick={handleGoLive}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold tracking-wide transition-colors cursor-pointer whitespace-nowrap border ${
              isLive
                ? 'bg-red-600 border-red-500 text-white'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-red-600/90 hover:border-red-500 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            LIVE
          </button>
        </div>
      </header>

      {/* Main Split: Video + Timeline | Object Detections Drawer */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 lg:min-h-0 bg-black">
          <div
            ref={playerContainerRef}
            className="relative w-full aspect-video lg:aspect-auto lg:flex-1 lg:min-h-0 flex items-center justify-center overflow-hidden bg-black"
          >
            {isLive ? (
              <Go2RtcPlayer
                streamName={camera.go2rtcStreamName}
                cameraName={camera.name}
                muted={muted}
                className="w-full h-full"
              />
            ) : videoSrc ? (
              <video
                key={videoSrc}
                ref={videoRef}
                src={videoSrc}
                playsInline
                muted={muted}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleVideoTimeUpdate}
                onEnded={handleVideoEnded}
                className="w-full h-full object-contain bg-black"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-center px-6 py-12">
                <p className="text-sm font-medium text-zinc-300">
                  {loading
                    ? 'Loading daily recordings…'
                    : noFootageNotice
                      ? `No continuous recording at ${formatTimeHms(currentTimeMs)}`
                      : 'Scrub the 24-hour timeline or select a detection clip'}
                </p>
                <p className="text-xs text-zinc-500 mt-1.5">
                  Steel-blue blocks represent 24/7 continuous footage; colored pins mark object
                  detections.
                </p>
                <button
                  type="button"
                  onClick={handleGoLive}
                  className="mt-4 px-3.5 py-1.5 rounded-lg bg-[#1e293b] hover:bg-[#3b5998] border border-[#3b5998]/50 text-zinc-100 text-xs font-medium cursor-pointer"
                >
                  Return to Live
                </button>
              </div>
            )}

            {!isLive && activeClip && (
              <div className="absolute top-3 left-3 z-20 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-black/80 border border-zinc-800 backdrop-blur-sm text-xs">
                <span
                  className={`w-2 h-2 rounded-full ${
                    (LABEL_META[activeClip.label] ?? LABEL_META.motion).dotClass
                  }`}
                />
                <span className="font-medium text-zinc-100">
                  {(LABEL_META[activeClip.label] ?? LABEL_META.motion).label}
                </span>
                <span className="font-mono tabular-nums text-zinc-400">
                  {formatTimeHms(activeClip.timestamp)}
                </span>
              </div>
            )}

            {activeRecording && (
              <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/90 text-white text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span>Capturing {LABEL_META[activeRecording.label]?.label}</span>
              </div>
            )}
          </div>

          {/* Transport Bar */}
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0a0a0c] border-t border-zinc-900">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => jumpRelative(-10)}
                title="Back 10 seconds"
                aria-label="Back 10 seconds"
                className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              {!isLive && (
                <button
                  type="button"
                  onClick={togglePlayPause}
                  title={isPlaying ? 'Pause' : 'Play'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="p-2 rounded-lg bg-[#3b5998] hover:bg-[#4f6bed] text-white transition-colors cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
              )}

              <button
                type="button"
                onClick={() => jumpRelative(10)}
                title="Forward 10 seconds"
                aria-label="Forward 10 seconds"
                className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              <div className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5 ml-1">
                <FastForward className="w-3.5 h-3.5 text-zinc-500 mx-1.5 hidden sm:block" />
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPlaybackSpeed(s)}
                    className={`px-2 py-1 rounded-md text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                      playbackSpeed === s
                        ? 'bg-[#1e293b] text-[#93b0ff]'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                title={muted ? 'Unmute' : 'Mute'}
                aria-label={muted ? 'Unmute' : 'Mute'}
                className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={handleSnapshot}
                title="Download live snapshot"
                aria-label="Download live snapshot"
                className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleFullscreen}
                title="Fullscreen"
                aria-label="Fullscreen"
                className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scrollable & Zoomable 24-Hour Timeline Bar */}
          <div className="shrink-0">
            <TimelineScrubber
              date={date}
              segments={segments}
              clips={clips}
              currentTimeMs={currentTimeMs}
              isLive={isLive}
              orientation="horizontal"
              zoomable
              onSeek={(ms) => seekToTimestamp(ms, segments, clips)}
            />
          </div>
        </div>

        {/* Dedicated Object Detections Side Panel */}
        <aside className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col bg-[#0a0a0c] border-t lg:border-t-0 lg:border-l border-zinc-900 lg:h-full lg:min-h-0">
          <div className="shrink-0 px-4 py-3 border-b border-zinc-900 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">Object Detections</h2>
              <span className="text-xs font-mono tabular-nums text-zinc-500">
                {clips.length} · {date}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {OBJECT_FILTER_TABS.map((tab) => {
                const count = tab.id === '' ? clips.length : objectCounts[tab.id] || 0;
                const active = objectFilter === tab.id;
                const dotClass = tab.id ? LABEL_META[tab.id].dotClass : '';
                return (
                  <button
                    key={tab.id || 'all'}
                    type="button"
                    onClick={() => setObjectFilter(tab.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer border ${
                      active
                        ? 'bg-[#1e293b] border-[#3b5998]/60 text-[#93b0ff]'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {tab.id && <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />}
                    <span>{tab.label}</span>
                    <span className="font-mono tabular-nums opacity-75">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-20 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse"
                  />
                ))}
              </div>
            ) : filteredClips.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <Film className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
                <p className="text-xs font-medium text-zinc-300">No detections for {date}</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  {camera.detectObjects
                    ? 'Hardware ONVIF object clips captured on this date will appear here.'
                    : 'Enable AI above to capture short object detection clips.'}
                </p>
              </div>
            ) : (
              filteredClips.map((clip) => {
                const meta = LABEL_META[clip.label] ?? LABEL_META.motion;
                const isSelected = activeClip?.id === clip.id && !isLive;
                const thumbSrc =
                  clip.thumbnailUrl ||
                  (clip.thumbnailPath ? recordingUrl(clip.thumbnailPath) : '');
                const showThumb = Boolean(thumbSrc) && !brokenThumbs[clip.id];
                const hasContinuousMatch = segments.some(
                  (s) => clip.timestamp >= s.startTime && clip.timestamp <= s.endTime
                );

                return (
                  <div
                    key={clip.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectClipCard(clip)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectClipCard(clip);
                      }
                    }}
                    className={`group flex gap-3 p-2 rounded-xl border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#1e293b]/50 border-[#3b5998]'
                        : 'bg-[#121214] border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="relative w-28 aspect-video rounded-lg overflow-hidden bg-black shrink-0">
                      {showThumb ? (
                        <img
                          src={thumbSrc}
                          alt={`${meta.label} at ${formatTimeHms(clip.timestamp)}`}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setBrokenThumbs((prev) => ({ ...prev, [clip.id]: true }))
                          }
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-700">
                          <Film className="w-4 h-4" />
                        </div>
                      )}
                      <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/80 text-[10px] font-mono tabular-nums text-zinc-200">
                        {formatDurationSeconds(clip.duration)}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                      <span
                        className={`self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium ${meta.pillClass}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                        {meta.label}
                      </span>

                      <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-zinc-300 mt-1">
                        <Clock className="w-3 h-3 text-zinc-500 shrink-0" />
                        <span>{formatTimeHms(clip.timestamp)}</span>
                      </div>

                      {hasContinuousMatch && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            seekToTimestamp(clip.timestamp, segments, clips);
                          }}
                          className="self-start mt-1 text-[10px] font-medium text-[#7c9cf5] hover:underline cursor-pointer"
                        >
                          Jump in 24/7 timeline
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
