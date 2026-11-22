import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { CameraConfig, NvrSettings } from '../src/types.ts';
import { getSegmentByPath, upsertSegment } from './db.ts';
import {
  RECORDINGS_DIR,
  assertSafeRecordingPath,
  formatLocalDate,
  readCameras,
  readSettings,
} from './storage.ts';

interface RecorderWorker {
  cameraId: string;
  configHash: string;
  process: ChildProcess | null;
  restartTimer: NodeJS.Timeout | null;
  forceKillTimer: NodeJS.Timeout | null;
  startedAt: number;
  backoffMs: number;
  stopped: boolean;
}

const workers = new Map<string, RecorderWorker>();
let scanInterval: NodeJS.Timeout | null = null;
let dirPrepareInterval: NodeJS.Timeout | null = null;

function buildConfigHash(camera: CameraConfig, settings: NvrSettings): string {
  return `${settings.go2rtcRtspHost}|${camera.go2rtcStreamName}|${camera.recordContinuous}`;
}

function ensureDateDirectoriesForCamera(cameraId: string): void {
  const baseDir = assertSafeRecordingPath(path.join(cameraId, 'continuous'));
  const now = new Date();
  for (let offset = 0; offset <= 2; offset++) {
    const d = new Date(now.getTime() + offset * 86_400_000);
    const dayDir = path.join(baseDir, formatLocalDate(d));
    fs.mkdirSync(dayDir, { recursive: true });
  }
}

function parseSegmentStartTime(dateStr: string, filename: string): number | null {
  const match = filename.match(/^(\d{2})-(\d{2})-(\d{2})\.mp4$/);
  if (!match) return null;
  const [, hh, mm, ss] = match;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, Number(hh), Number(mm), Number(ss), 0);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function probeDurationSeconds(absFilePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        absFilePath,
      ],
      { shell: false, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let output = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve(null);
    }, 5000);

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      const dur = parseFloat(output.trim());
      resolve(Number.isFinite(dur) && dur > 0 ? dur : null);
    });
  });
}

export async function scanCameraContinuousSegments(
  cameraId: string,
  includeRecent = false
): Promise<void> {
  const baseDir = assertSafeRecordingPath(path.join(cameraId, 'continuous'));
  if (!fs.existsSync(baseDir)) return;

  let dateDirs: string[];
  try {
    dateDirs = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return;
  }

  const nowMs = Date.now();
  for (const dateStr of dateDirs) {
    const dayDir = path.join(baseDir, dateStr);
    let files: string[];
    try {
      files = fs
        .readdirSync(dayDir)
        .filter((f) => f.endsWith('.mp4'))
        .sort();
    } catch {
      continue;
    }

    for (const file of files) {
      const absPath = path.join(dayDir, file);
      const relPath = path.posix.join(cameraId, 'continuous', dateStr, file);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(absPath);
      } catch {
        continue;
      }

      if (stat.size <= 0) continue;

      if (!includeRecent && nowMs - stat.mtimeMs < 6000) {
        continue;
      }

      const existing = getSegmentByPath(relPath);
      if (existing && existing.fileSize === stat.size && existing.duration > 0) {
        continue;
      }

      const startTime = parseSegmentStartTime(dateStr, file);
      if (startTime === null) continue;

      let duration = await probeDurationSeconds(absPath);
      if (duration === null) {
        const estimated = Math.max(1, (stat.mtimeMs - startTime) / 1000);
        duration = Math.min(360, estimated);
      }

      const endTime = Math.round(startTime + duration * 1000);
      const id =
        existing?.id ||
        crypto.createHash('sha1').update(relPath).digest('hex').slice(0, 20);

      upsertSegment({
        id,
        cameraId,
        date: dateStr,
        startTime,
        endTime,
        duration: Math.round(duration * 100) / 100,
        filePath: relPath,
        fileSize: stat.size,
      });
    }
  }
}

export async function scanAllContinuousSegments(): Promise<void> {
  if (!fs.existsSync(RECORDINGS_DIR)) return;
  let cameraDirs: string[];
  try {
    cameraDirs = fs
      .readdirSync(RECORDINGS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }

  for (const camId of cameraDirs) {
    await scanCameraContinuousSegments(camId);
  }
}

function spawnFfmpeg(
  worker: RecorderWorker,
  camera: CameraConfig,
  settings: NvrSettings
): void {
  if (worker.stopped) return;

  ensureDateDirectoriesForCamera(camera.id);

  const outputPattern = path.join(
    assertSafeRecordingPath(path.join(camera.id, 'continuous')),
    '%Y-%m-%d',
    '%H-%M-%S.mp4'
  );
  const rtspUrl = `rtsp://${settings.go2rtcRtspHost}/${camera.go2rtcStreamName}`;

  const args = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-rtsp_transport',
    'tcp',
    '-i',
    rtspUrl,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-f',
    'segment',
    '-segment_time',
    '300',
    '-segment_format',
    'mp4',
    '-segment_format_options',
    'movflags=+faststart',
    '-reset_timestamps',
    '1',
    '-strftime',
    '1',
    outputPattern,
  ];

  worker.startedAt = Date.now();
  // Keep stdin piped so we can write 'q\n' to finalize active .mp4 cleanly on stop
  const proc = spawn('ffmpeg', args, {
    shell: false,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  worker.process = proc;

  let stderrTail = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-500);
  });

  proc.on('error', (err) => {
    if (worker.stopped) return;
    console.warn(`[recorder:${camera.id}] ffmpeg spawn error: ${err.message}`);
    scheduleRestart(worker, camera);
  });

  proc.on('close', (code) => {
    worker.process = null;
    if (worker.forceKillTimer) {
      clearTimeout(worker.forceKillTimer);
      worker.forceKillTimer = null;
    }

    // Index the finalized .mp4 segment immediately
    void scanCameraContinuousSegments(camera.id, true);

    if (worker.stopped) return;

    const livedMs = Date.now() - worker.startedAt;
    if (livedMs > 30_000) {
      worker.backoffMs = 3000;
    }

    if (code !== 0) {
      console.warn(
        `[recorder:${camera.id}] ffmpeg exited (${code ?? 'signal'}); retrying in ${Math.round(
          worker.backoffMs / 1000
        )}s${stderrTail ? ` — ${stderrTail.trim().split('\n').pop()}` : ''}`
      );
    }

    scheduleRestart(worker, camera);
  });
}

function scheduleRestart(worker: RecorderWorker, camera: CameraConfig): void {
  if (worker.stopped || worker.restartTimer) return;
  const delay = worker.backoffMs;
  worker.backoffMs = Math.min(30_000, Math.round(worker.backoffMs * 1.8));
  worker.restartTimer = setTimeout(() => {
    worker.restartTimer = null;
    if (worker.stopped) return;
    const latestCam = readCameras().find((c) => c.id === camera.id);
    const latestSettings = readSettings();
    if (!latestCam || !latestCam.recordContinuous) {
      stopContinuousRecording(camera.id);
      return;
    }
    spawnFfmpeg(worker, latestCam, latestSettings);
  }, delay);
}

export function startContinuousRecording(camera: CameraConfig): void {
  if (!camera.go2rtcStreamName) return;
  const settings = readSettings();
  const hash = buildConfigHash(camera, settings);
  const existing = workers.get(camera.id);

  if (existing && !existing.stopped && existing.configHash === hash) {
    return;
  }
  if (existing) {
    stopContinuousRecording(camera.id);
  }

  const worker: RecorderWorker = {
    cameraId: camera.id,
    configHash: hash,
    process: null,
    restartTimer: null,
    forceKillTimer: null,
    startedAt: 0,
    backoffMs: 3000,
    stopped: false,
  };
  workers.set(camera.id, worker);
  spawnFfmpeg(worker, camera, settings);
}

export function stopContinuousRecording(cameraId: string): void {
  const worker = workers.get(cameraId);
  if (!worker) return;
  worker.stopped = true;
  if (worker.restartTimer) {
    clearTimeout(worker.restartTimer);
    worker.restartTimer = null;
  }

  const proc = worker.process;
  workers.delete(cameraId);

  if (proc && !proc.killed) {
    // Gracefully ask FFmpeg to finalize the active MP4 moov atom via 'q\n' + SIGINT
    try {
      if (proc.stdin && proc.stdin.writable) {
        proc.stdin.write('q\n');
        proc.stdin.end();
      }
    } catch {
      // ignore pipe error
    }
    try {
      proc.kill('SIGINT');
    } catch {
      // ignore
    }

    worker.forceKillTimer = setTimeout(() => {
      try {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    }, 4000);
  }
}

export function isContinuousRecordingActive(cameraId: string): boolean {
  const worker = workers.get(cameraId);
  return Boolean(worker && !worker.stopped);
}

export function syncContinuousRecorders(): void {
  const cameras = readCameras();
  const desiredIds = new Set<string>();

  for (const cam of cameras) {
    if (!cam.recordContinuous || !cam.go2rtcStreamName) {
      stopContinuousRecording(cam.id);
      continue;
    }
    desiredIds.add(cam.id);
    startContinuousRecording(cam);
  }

  for (const existingId of Array.from(workers.keys())) {
    if (!desiredIds.has(existingId)) {
      stopContinuousRecording(existingId);
    }
  }
}

export function startContinuousRecorderService(): void {
  syncContinuousRecorders();
  void scanAllContinuousSegments();

  if (!scanInterval) {
    scanInterval = setInterval(() => {
      void scanAllContinuousSegments();
    }, 15_000);
  }

  if (!dirPrepareInterval) {
    dirPrepareInterval = setInterval(() => {
      const cameras = readCameras();
      for (const cam of cameras) {
        if (cam.recordContinuous) {
          ensureDateDirectoriesForCamera(cam.id);
        }
      }
    }, 60 * 60 * 1000);
  }
}

export function stopContinuousRecorderService(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (dirPrepareInterval) {
    clearInterval(dirPrepareInterval);
    dirPrepareInterval = null;
  }
  for (const camId of Array.from(workers.keys())) {
    stopContinuousRecording(camId);
  }
}
