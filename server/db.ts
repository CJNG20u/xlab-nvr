import Database from 'better-sqlite3';
import path from 'path';
import type { ContinuousSegment, DetectionClip, DetectionLabel } from '../src/types.ts';
import { DATA_DIR } from './storage.ts';

const DB_PATH = path.join(DATA_DIR, 'nvr.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS continuous_segments (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    duration REAL NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_segments_cam_date
    ON continuous_segments (camera_id, date, start_time);

  CREATE INDEX IF NOT EXISTS idx_segments_start_time
    ON continuous_segments (start_time);

  CREATE TABLE IF NOT EXISTS detection_clips (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    label TEXT NOT NULL,
    date TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    duration REAL NOT NULL,
    clip_path TEXT NOT NULL,
    thumbnail_path TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_clips_cam_date
    ON detection_clips (camera_id, date, timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_clips_label_ts
    ON detection_clips (label, timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_clips_ts
    ON detection_clips (timestamp DESC);
`);

interface SegmentRow {
  id: string;
  camera_id: string;
  date: string;
  start_time: number;
  end_time: number;
  duration: number;
  file_path: string;
  file_size: number;
}

interface ClipRow {
  id: string;
  camera_id: string;
  label: string;
  date: string;
  timestamp: number;
  duration: number;
  clip_path: string;
  thumbnail_path: string;
}

function mapSegment(row: SegmentRow): ContinuousSegment {
  return {
    id: row.id,
    cameraId: row.camera_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration,
    filePath: row.file_path,
    fileSize: row.file_size,
  };
}

function mapClip(row: ClipRow): DetectionClip {
  return {
    id: row.id,
    cameraId: row.camera_id,
    label: row.label as DetectionLabel,
    date: row.date,
    timestamp: row.timestamp,
    duration: row.duration,
    clipPath: row.clip_path,
    thumbnailPath: row.thumbnail_path,
  };
}

const stmtUpsertSegment = db.prepare(`
  INSERT INTO continuous_segments (id, camera_id, date, start_time, end_time, duration, file_path, file_size)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(file_path) DO UPDATE SET
    end_time = excluded.end_time,
    duration = excluded.duration,
    file_size = excluded.file_size
`);

const stmtSegmentByPath = db.prepare(
  `SELECT * FROM continuous_segments WHERE file_path = ?`
);

const stmtSegmentsByCameraAndDate = db.prepare(`
  SELECT * FROM continuous_segments
  WHERE camera_id = ? AND date = ?
  ORDER BY start_time ASC
`);

const stmtSegmentsByDate = db.prepare(`
  SELECT * FROM continuous_segments
  WHERE date = ?
  ORDER BY camera_id ASC, start_time ASC
`);

const stmtSegmentsOverlappingRange = db.prepare(`
  SELECT * FROM continuous_segments
  WHERE camera_id = ? AND end_time >= ? AND start_time <= ?
  ORDER BY start_time ASC
`);

const stmtInsertClip = db.prepare(`
  INSERT INTO detection_clips (id, camera_id, label, date, timestamp, duration, clip_path, thumbnail_path)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtClipsByCameraAndDate = db.prepare(`
  SELECT * FROM detection_clips
  WHERE camera_id = ? AND date = ?
  ORDER BY timestamp ASC
`);

const stmtClipsByDate = db.prepare(`
  SELECT * FROM detection_clips
  WHERE date = ?
  ORDER BY timestamp ASC
`);

const stmtClipById = db.prepare(`SELECT * FROM detection_clips WHERE id = ?`);

const stmtDeleteClipById = db.prepare(`DELETE FROM detection_clips WHERE id = ?`);

const stmtExpiredSegments = db.prepare(
  `SELECT * FROM continuous_segments WHERE end_time < ?`
);

const stmtDeleteExpiredSegments = db.prepare(
  `DELETE FROM continuous_segments WHERE end_time < ?`
);

const stmtExpiredClips = db.prepare(
  `SELECT * FROM detection_clips WHERE timestamp < ?`
);

const stmtDeleteExpiredClips = db.prepare(
  `DELETE FROM detection_clips WHERE timestamp < ?`
);

const stmtDeleteMissingSegment = db.prepare(
  `DELETE FROM continuous_segments WHERE id = ?`
);

export function upsertSegment(seg: ContinuousSegment): void {
  stmtUpsertSegment.run(
    seg.id,
    seg.cameraId,
    seg.date,
    seg.startTime,
    seg.endTime,
    seg.duration,
    seg.filePath,
    seg.fileSize
  );
}

export function getSegmentByPath(filePath: string): ContinuousSegment | undefined {
  const row = stmtSegmentByPath.get(filePath) as SegmentRow | undefined;
  return row ? mapSegment(row) : undefined;
}

export function getSegmentsForCameraDate(cameraId: string, date: string): ContinuousSegment[] {
  const rows = stmtSegmentsByCameraAndDate.all(cameraId, date) as SegmentRow[];
  return rows.map(mapSegment);
}

export function getSegmentsForDate(date: string): ContinuousSegment[] {
  const rows = stmtSegmentsByDate.all(date) as SegmentRow[];
  return rows.map(mapSegment);
}

export function getSegmentsInRange(
  cameraId: string,
  startMs: number,
  endMs: number
): ContinuousSegment[] {
  const rows = stmtSegmentsOverlappingRange.all(cameraId, startMs, endMs) as SegmentRow[];
  return rows.map(mapSegment);
}

export function insertDetectionClip(clip: DetectionClip): void {
  stmtInsertClip.run(
    clip.id,
    clip.cameraId,
    clip.label,
    clip.date,
    clip.timestamp,
    clip.duration,
    clip.clipPath,
    clip.thumbnailPath
  );
}

export function getClipsForCameraDate(cameraId: string, date: string): DetectionClip[] {
  const rows = stmtClipsByCameraAndDate.all(cameraId, date) as ClipRow[];
  return rows.map(mapClip);
}

export function getClipsForDate(date: string): DetectionClip[] {
  const rows = stmtClipsByDate.all(date) as ClipRow[];
  return rows.map(mapClip);
}

export function getClipById(id: string): DetectionClip | undefined {
  const row = stmtClipById.get(id) as ClipRow | undefined;
  return row ? mapClip(row) : undefined;
}

export function deleteClipRecord(id: string): void {
  stmtDeleteClipById.run(id);
}

export function queryClips(filters: {
  cameraId?: string;
  label?: string;
  date?: string;
  page?: number;
  limit?: number;
}): { clips: DetectionClip[]; total: number; page: number; limit: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.cameraId) {
    clauses.push('camera_id = ?');
    params.push(filters.cameraId);
  }
  if (filters.label) {
    clauses.push('label = ?');
    params.push(filters.label);
  }
  if (filters.date) {
    clauses.push('date = ?');
    params.push(filters.date);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(100, filters.limit ?? 40));
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * limit;

  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM detection_clips ${whereSql}`)
    .get(...params) as { count: number };

  const rows = db
    .prepare(
      `SELECT * FROM detection_clips ${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as ClipRow[];

  return {
    clips: rows.map(mapClip),
    total: countRow.count,
    page,
    limit,
  };
}

export function getExpiredSegments(cutoffMs: number): ContinuousSegment[] {
  return (stmtExpiredSegments.all(cutoffMs) as SegmentRow[]).map(mapSegment);
}

export function deleteExpiredSegments(cutoffMs: number): number {
  return stmtDeleteExpiredSegments.run(cutoffMs).changes;
}

export function getExpiredClips(cutoffMs: number): DetectionClip[] {
  return (stmtExpiredClips.all(cutoffMs) as ClipRow[]).map(mapClip);
}

export function deleteExpiredClips(cutoffMs: number): number {
  return stmtDeleteExpiredClips.run(cutoffMs).changes;
}

export function deleteSegmentRecord(id: string): void {
  stmtDeleteMissingSegment.run(id);
}

export function closeDatabase(): void {
  db.close();
}
