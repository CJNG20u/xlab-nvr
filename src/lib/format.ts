import type { DetectionLabel } from '../types';

export interface LabelMeta {
  label: string;
  dotClass: string;
  barClass: string;
  pillClass: string;
  textClass: string;
}

export const LABEL_META: Record<DetectionLabel, LabelMeta> = {
  person: {
    label: 'Person',
    dotClass: 'bg-blue-500',
    barClass: 'bg-blue-500',
    pillClass: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
    textClass: 'text-blue-400',
  },
  vehicle: {
    label: 'Vehicle',
    dotClass: 'bg-amber-500',
    barClass: 'bg-amber-500',
    pillClass: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    textClass: 'text-amber-400',
  },
  pet: {
    label: 'Pet',
    dotClass: 'bg-emerald-500',
    barClass: 'bg-emerald-500',
    pillClass: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    textClass: 'text-emerald-400',
  },
  line_crossing: {
    label: 'Line Crossing',
    dotClass: 'bg-purple-500',
    barClass: 'bg-purple-500',
    pillClass: 'bg-purple-500/15 text-purple-300 border border-purple-500/30',
    textClass: 'text-purple-400',
  },
  motion: {
    label: 'Motion',
    dotClass: 'bg-slate-400',
    barClass: 'bg-slate-400',
    pillClass: 'bg-slate-500/20 text-slate-300 border border-slate-500/30',
    textClass: 'text-slate-400',
  },
};

export function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function yesterdayDateString(): string {
  const d = new Date(Date.now() - 86_400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dateToDayBounds(dateStr: string): { dayStartMs: number; dayEndMs: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime();
  return {
    dayStartMs: start,
    dayEndMs: start + 86_400_000,
  };
}

export function formatTimeHms(epochMs: number): string {
  const dt = new Date(epochMs);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatDateTimeShort(epochMs: number): string {
  const dt = new Date(epochMs);
  return dt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDurationSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function recordingUrl(relativePath: string): string {
  if (!relativePath) return '';
  const cleaned = relativePath.replace(/^\/+/, '');
  return `/recordings/${cleaned.split('/').map(encodeURIComponent).join('/')}`;
}
