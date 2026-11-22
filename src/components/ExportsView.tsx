import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileVideo,
  Loader2,
} from 'lucide-react';
import type { ContinuousSegment, PublicCameraConfig } from '../types';
import { downloadExportClip, fetchCameraRecordings } from '../lib/api';
import { formatBytes, formatTimeHms, todayDateString } from '../lib/format';

interface ExportsViewProps {
  cameras: PublicCameraConfig[];
}

interface ExportHistoryItem {
  id: string;
  cameraName: string;
  date: string;
  startLabel: string;
  endLabel: string;
  filename: string;
  bytes: number;
  exportedAt: number;
}

function defaultTimeWindow(): { start: string; end: string } {
  const now = new Date();
  const startDt = new Date(now.getTime() - 10 * 60 * 1000);
  const fmt = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { start: fmt(startDt), end: fmt(now) };
}

function combineDateAndTimeMs(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).getTime();
}

export function ExportsView({ cameras }: ExportsViewProps) {
  const initialWindow = useMemo(() => defaultTimeWindow(), []);
  const [cameraId, setCameraId] = useState<string>(cameras[0]?.id || '');
  const [date, setDate] = useState<string>(todayDateString());
  const [startTime, setStartTime] = useState<string>(initialWindow.start);
  const [endTime, setEndTime] = useState<string>(initialWindow.end);

  const [daySegments, setDaySegments] = useState<ContinuousSegment[]>([]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<ExportHistoryItem[]>([]);

  useEffect(() => {
    if (!cameraId && cameras.length > 0) {
      setCameraId(cameras[0].id);
    }
  }, [cameras, cameraId]);

  useEffect(() => {
    if (!cameraId || !date) {
      setDaySegments([]);
      return;
    }
    let cancelled = false;
    fetchCameraRecordings(cameraId, date)
      .then((res) => {
        if (!cancelled) setDaySegments(res.segments);
      })
      .catch(() => {
        if (!cancelled) setDaySegments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cameraId, date]);

  const startMs = combineDateAndTimeMs(date, startTime);
  const endMs = combineDateAndTimeMs(date, endTime);

  const overlappingSegments = useMemo(() => {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return [];
    }
    return daySegments.filter((s) => s.endTime >= startMs && s.startTime <= endMs);
  }, [daySegments, startMs, endMs]);

  const applyPresetMinutes = (minutes: number) => {
    const start = combineDateAndTimeMs(date, startTime);
    if (!Number.isFinite(start)) return;
    const endDt = new Date(start + minutes * 60 * 1000);
    setEndTime(
      `${String(endDt.getHours()).padStart(2, '0')}:${String(endDt.getMinutes()).padStart(2, '0')}`
    );
  };

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!cameraId) {
      setError('Please select a camera first.');
      return;
    }
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      setError('End time must be after start time.');
      return;
    }

    setExporting(true);
    try {
      const result = await downloadExportClip({
        cameraId,
        startTime: startMs,
        endTime: endMs,
      });
      const camName = cameras.find((c) => c.id === cameraId)?.name || cameraId;
      setSuccessMsg(`Downloaded ${result.filename} (${formatBytes(result.bytes)})`);
      setHistory((prev) => [
        {
          id: `${Date.now()}`,
          cameraName: camName,
          date,
          startLabel: startTime,
          endLabel: endTime,
          filename: result.filename,
          bytes: result.bytes,
          exportedAt: Date.now(),
        },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-black">
      <header className="shrink-0 border-b border-zinc-900 bg-black pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 h-14">
          <h1 className="text-sm font-semibold text-zinc-100">Exports</h1>
          <span className="text-xs text-zinc-500">Lossless FFmpeg stream-copy MP4 trim</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-black">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <form
            onSubmit={handleExport}
            className="lg:col-span-7 rounded-xl bg-[#121214] border border-zinc-800 p-5 sm:p-6 space-y-5"
          >
            <div>
              <h2 className="text-base font-semibold text-zinc-100">Export Continuous Footage</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Select a camera and time range to stitch and trim matching 5-minute NAS segments
                without re-encoding.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Camera</label>
                <select
                  value={cameraId}
                  onChange={(e) => setCameraId(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                >
                  {cameras.length === 0 ? (
                    <option value="">No cameras configured</option>
                  ) : (
                    cameras.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500 mr-1">Duration from start:</span>
              {[1, 5, 15, 30].map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => applyPresetMinutes(min)}
                  className="px-2.5 py-1 rounded-md text-xs font-mono tabular-nums bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-colors cursor-pointer"
                >
                  +{min}m
                </button>
              ))}
            </div>

            <div className="rounded-lg bg-black border border-zinc-800 px-3.5 py-3 text-xs flex items-center justify-between gap-2">
              <span className="text-zinc-400">Indexed continuous segments in window</span>
              <span
                className={`font-mono tabular-nums font-medium ${
                  overlappingSegments.length > 0 ? 'text-emerald-400' : 'text-zinc-500'
                }`}
              >
                {overlappingSegments.length} matching ({daySegments.length} total on {date})
              </span>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/25 px-3.5 py-2.5 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-3.5 py-2.5 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={exporting || cameras.length === 0}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-[#1e293b] hover:bg-[#3b5998] border border-[#3b5998]/50 disabled:opacity-45 text-zinc-100 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Stitching MP4…
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export & Download MP4
                </>
              )}
            </button>
          </form>

          <div className="lg:col-span-5 rounded-xl bg-[#121214] border border-zinc-800 p-5">
            <h2 className="text-sm font-semibold text-zinc-100 mb-3">Recent Downloads</h2>
            {history.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-500">
                <FileVideo className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
                Exported MP4 clips from this session will be listed here.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {history.map((item) => (
                  <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-200 truncate">
                        {item.cameraName}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
                        {formatBytes(item.bytes)}
                      </span>
                    </div>
                    <p className="text-xs font-mono tabular-nums text-zinc-500 mt-1">
                      {item.date} · {item.startLabel} – {item.endLabel}
                    </p>
                    <p className="text-[11px] font-mono text-zinc-600 truncate mt-0.5">
                      {item.filename} · {formatTimeHms(item.exportedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
