import fs from 'fs';
import path from 'path';
import {
  deleteExpiredClips,
  deleteExpiredSegments,
  getExpiredClips,
  getExpiredSegments,
} from './db.ts';
import { RECORDINGS_DIR, assertSafeRecordingPath, readSettings } from './storage.ts';

let retentionTimer: NodeJS.Timeout | null = null;

function safeUnlink(relativePath: string): void {
  if (!relativePath) return;
  try {
    const absPath = assertSafeRecordingPath(relativePath);
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    }
  } catch {
    // ignore missing or inaccessible file
  }
}

function pruneEmptyDateDirs(parentDir: string): void {
  if (!fs.existsSync(parentDir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subDir = path.join(parentDir, entry.name);
    try {
      const children = fs.readdirSync(subDir);
      if (children.length === 0) {
        fs.rmdirSync(subDir);
      }
    } catch {
      // ignore
    }
  }
}

function deleteOldUnindexedFiles(
  baseDir: string,
  cutoffMs: number,
  allowedExts: string[]
): number {
  if (!fs.existsSync(baseDir)) return 0;
  let removed = 0;
  let dateDirs: fs.Dirent[];
  try {
    dateDirs = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const dir of dateDirs) {
    if (!dir.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(dir.name)) continue;
    const dayPath = path.join(baseDir, dir.name);
    let files: string[];
    try {
      files = fs.readdirSync(dayPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!allowedExts.some((ext) => file.endsWith(ext))) continue;
      const absPath = path.join(dayPath, file);
      try {
        const stat = fs.statSync(absPath);
        if (stat.mtimeMs < cutoffMs) {
          fs.unlinkSync(absPath);
          removed++;
        }
      } catch {
        // ignore
      }
    }
  }
  return removed;
}

export function runRetentionCleanup(): {
  removedSegments: number;
  removedClips: number;
} {
  const settings = readSettings();
  const now = Date.now();
  const continuousCutoffMs = now - settings.continuousRetentionDays * 86_400_000;
  const clipCutoffMs = now - settings.clipRetentionDays * 86_400_000;

  // 1. Delete expired continuous segments from disk & SQLite
  const expiredSegments = getExpiredSegments(continuousCutoffMs);
  for (const seg of expiredSegments) {
    safeUnlink(seg.filePath);
  }
  const removedSegments = deleteExpiredSegments(continuousCutoffMs);

  // 2. Delete expired detection clips & thumbnails from disk & SQLite
  const expiredClips = getExpiredClips(clipCutoffMs);
  for (const clip of expiredClips) {
    safeUnlink(clip.clipPath);
    safeUnlink(clip.thumbnailPath);
  }
  const removedClips = deleteExpiredClips(clipCutoffMs);

  // 3. Sweep any unindexed stale files and prune empty date directories
  if (fs.existsSync(RECORDINGS_DIR)) {
    let cameraDirs: fs.Dirent[] = [];
    try {
      cameraDirs = fs.readdirSync(RECORDINGS_DIR, { withFileTypes: true });
    } catch {
      cameraDirs = [];
    }

    for (const camDir of cameraDirs) {
      if (!camDir.isDirectory()) continue;
      const continuousDir = path.join(RECORDINGS_DIR, camDir.name, 'continuous');
      const clipsDir = path.join(RECORDINGS_DIR, camDir.name, 'clips');

      deleteOldUnindexedFiles(continuousDir, continuousCutoffMs, ['.mp4']);
      deleteOldUnindexedFiles(clipsDir, clipCutoffMs, ['.mp4', '.jpg']);

      pruneEmptyDateDirs(continuousDir);
      pruneEmptyDateDirs(clipsDir);
    }
  }

  if (removedSegments > 0 || removedClips > 0) {
    console.info(
      `[retention] Cleaned up ${removedSegments} continuous segments and ${removedClips} detection clips`
    );
  }

  return { removedSegments, removedClips };
}

export function startRetentionScheduler(): void {
  // Run initial sweep shortly after boot, then hourly
  setTimeout(() => {
    runRetentionCleanup();
  }, 15_000);

  if (!retentionTimer) {
    retentionTimer = setInterval(() => {
      runRetentionCleanup();
    }, 60 * 60 * 1000);
  }
}

export function stopRetentionScheduler(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}
