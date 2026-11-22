import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  Download,
  ExternalLink,
  Film,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import {
  DETECTION_LABELS,
  type DetectionClip,
  type DetectionLabel,
  type PublicCameraConfig,
} from '../types';
import { deleteClipApi, fetchClips } from '../lib/api';
import {
  LABEL_META,
  formatDateTimeShort,
  formatDurationSeconds,
  recordingUrl,
} from '../lib/format';

interface ClipsViewProps {
  cameras: PublicCameraConfig[];
  refreshToken: number;
  onJumpToTimeline: (cameraId: string, date: string, timestampMs: number) => void;
}

const PAGE_SIZE = 24;

export function ClipsView({
  cameras,
  refreshToken,
  onJumpToTimeline,
}: ClipsViewProps) {
  const [cameraFilter, setCameraFilter] = useState<string>('');
  const [labelFilter, setLabelFilter] = useState<DetectionLabel | ''>('');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  const [clips, setClips] = useState<DetectionClip[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeClip, setActiveClip] = useState<DetectionClip | null>(null);
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const cameraMap = useMemo(() => {
    const map: Record<string, PublicCameraConfig> = {};
    for (const c of cameras) map[c.id] = c;
    return map;
  }, [cameras]);

  const loadClips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchClips({
        cameraId: cameraFilter || undefined,
        label: labelFilter || undefined,
        date: dateFilter || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setClips(res.clips);
      setTotal(res.total);
    } catch {
      setClips([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [cameraFilter, labelFilter, dateFilter, page]);

  useEffect(() => {
    void loadClips();
  }, [loadClips, refreshToken]);

  useEffect(() => {
    if (!activeClip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveClip(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeClip]);

  const handleDeleteClip = async (clip: DetectionClip) => {
    setDeletingId(clip.id);
    try {
      await deleteClipApi(clip.id);
      setClips((prev) => prev.filter((c) => c.id !== clip.id));
      setTotal((prev) => Math.max(0, prev - 1));
      if (activeClip?.id === clip.id) {
        setActiveClip(null);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col h-full min-h-0 bg-black">
      {/* Filter Toolbar */}
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-2.5 px-3 pt-[calc(0.625rem+env(safe-area-inset-top))] pb-2.5 border-b border-zinc-900 bg-black">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold text-zinc-100 mr-1">Clips</h1>

          <select
            aria-label="Filter by camera"
            value={cameraFilter}
            onChange={(e) => {
              setCameraFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2.5 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
          >
            <option value="">All Cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="relative inline-flex items-center">
            <Calendar className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 pointer-events-none" />
            <input
              type="date"
              aria-label="Filter by date"
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-mono tabular-nums rounded-lg pl-8 pr-2.5 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => {
                  setDateFilter('');
                  setPage(1);
                }}
                aria-label="Clear date filter"
                className="ml-1 p-1 text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <button
            type="button"
            onClick={() => {
              setLabelFilter('');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
              labelFilter === ''
                ? 'bg-[#1e293b] border-[#3b5998]/60 text-[#93b0ff]'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100'
            }`}
          >
            All Objects
          </button>
          {DETECTION_LABELS.map((lbl) => {
            const meta = LABEL_META[lbl];
            const active = labelFilter === lbl;
            return (
              <button
                key={lbl}
                type="button"
                onClick={() => {
                  setLabelFilter(active ? '' : lbl);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                  active
                    ? 'bg-[#1e293b] border-[#3b5998]/60 text-[#93b0ff]'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                {meta.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Clips Grid */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-black">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl bg-[#121214] border border-zinc-800 overflow-hidden animate-pulse"
              >
                <div className="aspect-video bg-zinc-900" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-2/3 bg-zinc-800 rounded" />
                  <div className="h-3 w-1/2 bg-zinc-900 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : clips.length === 0 ? (
          <div className="h-full flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-xl bg-[#121214] border border-zinc-800 p-6 text-center">
              <div className="w-11 h-11 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-3.5">
                <Film className="w-5 h-5 text-zinc-500" />
              </div>
              <h2 className="text-sm font-semibold text-zinc-200 mb-1">No detection clips</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Captured ONVIF hardware object detections (person, vehicle, pet, line crossing,
                motion) will appear here once cameras trigger.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {clips.map((clip) => {
                const camName = cameraMap[clip.cameraId]?.name || clip.cameraId;
                const meta = LABEL_META[clip.label] ?? LABEL_META.motion;
                const thumbSrc =
                  clip.thumbnailUrl ||
                  (clip.thumbnailPath ? recordingUrl(clip.thumbnailPath) : '');
                const showThumb = Boolean(thumbSrc) && !brokenThumbs[clip.id];

                return (
                  <article
                    key={clip.id}
                    onClick={() => setActiveClip(clip)}
                    className="group rounded-xl bg-[#121214] border border-zinc-800 hover:border-zinc-700 overflow-hidden transition-colors cursor-pointer"
                  >
                    <div className="relative aspect-video bg-black overflow-hidden">
                      {showThumb ? (
                        <img
                          src={thumbSrc}
                          alt={`${meta.label} detected on ${camName}`}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setBrokenThumbs((prev) => ({ ...prev, [clip.id]: true }))
                          }
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-700">
                          <Film className="w-6 h-6" />
                        </div>
                      )}

                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-10 h-10 rounded-full bg-black/80 border border-zinc-700 flex items-center justify-center text-white">
                          <Play className="w-4 h-4 fill-white ml-0.5" />
                        </div>
                      </div>

                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[11px] font-mono tabular-nums text-zinc-200">
                        {formatDurationSeconds(clip.duration)}
                      </span>
                    </div>

                    <div className="p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-medium text-zinc-100 truncate">{camName}</h3>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 ${meta.pillClass}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                          {meta.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono tabular-nums">
                        <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <span>{formatDateTimeShort(clip.timestamp)}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between border-t border-zinc-900 pt-4 text-xs text-zinc-400">
                <span className="font-mono tabular-nums">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of{' '}
                  {total} clips
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 text-zinc-200 cursor-pointer disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="font-mono tabular-nums">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 text-zinc-200 cursor-pointer disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Instant Clip Playback Modal */}
      {activeClip && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Clip playback"
          onClick={() => setActiveClip(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl rounded-xl bg-[#18181b] border border-zinc-800 overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <h2 className="text-sm font-semibold text-zinc-100 truncate">
                  {cameraMap[activeClip.cameraId]?.name || activeClip.cameraId}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 ${
                    (LABEL_META[activeClip.label] ?? LABEL_META.motion).pillClass
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      (LABEL_META[activeClip.label] ?? LABEL_META.motion).dotClass
                    }`}
                  />
                  {(LABEL_META[activeClip.label] ?? LABEL_META.motion).label}
                </span>
                <span className="text-xs font-mono tabular-nums text-zinc-400 hidden sm:inline">
                  {formatDateTimeShort(activeClip.timestamp)} ·{' '}
                  {formatDurationSeconds(activeClip.duration)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setActiveClip(null)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-black aspect-video w-full">
              <video
                src={activeClip.clipUrl || recordingUrl(activeClip.clipPath)}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#121214] border-t border-zinc-800">
              <button
                type="button"
                disabled={deletingId === activeClip.id}
                onClick={() => handleDeleteClip(activeClip)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Clip
              </button>

              <div className="flex items-center gap-2">
                <a
                  href={activeClip.clipUrl || recordingUrl(activeClip.clipPath)}
                  download={`${activeClip.cameraId}_${activeClip.label}_${activeClip.date}.mp4`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-100 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download MP4
                </a>

                <button
                  type="button"
                  onClick={() => {
                    const c = activeClip;
                    setActiveClip(null);
                    onJumpToTimeline(c.cameraId, c.date, c.timestamp);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#3b5998] hover:bg-[#4f6bed] text-white transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Jump to Timeline
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
