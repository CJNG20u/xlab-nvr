import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Response } from 'express';
import { getSegmentsInRange } from './db.ts';
import { assertSafeRecordingPath, sanitizeCameraId } from './storage.ts';

function escapeConcatPath(absPath: string): string {
  if (/[\r\n\0]/.test(absPath)) {
    throw new Error('Invalid characters in segment path');
  }
  return absPath.replace(/'/g, "'\\''");
}

export async function exportContinuousRange(params: {
  cameraId: string;
  startTime: number;
  endTime: number;
  res: Response;
}): Promise<void> {
  const cameraId = sanitizeCameraId(params.cameraId);
  const { startTime, endTime, res } = params;

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    res.status(400).json({ error: 'Invalid export time range: endTime must be after startTime' });
    return;
  }

  const durationSec = (endTime - startTime) / 1000;
  if (durationSec > 6 * 3600) {
    res.status(400).json({ error: 'Export range cannot exceed 6 hours per clip' });
    return;
  }

  const segments = getSegmentsInRange(cameraId, startTime, endTime).filter((seg) => {
    try {
      const abs = assertSafeRecordingPath(seg.filePath);
      return fs.existsSync(abs) && fs.statSync(abs).size > 0;
    } catch {
      return false;
    }
  });

  if (segments.length === 0) {
    res.status(404).json({ error: 'No continuous recordings found for the selected time range' });
    return;
  }

  const tmpId = crypto.randomBytes(8).toString('hex');
  const listPath = path.join(os.tmpdir(), `nvr-export-${tmpId}.txt`);
  const outPath = path.join(os.tmpdir(), `nvr-export-${tmpId}.mp4`);

  const cleanup = () => {
    for (const f of [listPath, outPath]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }
  };

  try {
    const firstSeg = segments[0];
    const trimStartSec = Math.max(0, (startTime - firstSeg.startTime) / 1000);
    const totalRequestedSec = Math.max(1, (endTime - startTime) / 1000);

    const concatBody = segments
      .map((seg) => `file '${escapeConcatPath(assertSafeRecordingPath(seg.filePath))}'`)
      .join('\n');
    fs.writeFileSync(listPath, concatBody + '\n', 'utf8');

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-ss',
      trimStartSec.toFixed(2),
      '-t',
      totalRequestedSec.toFixed(2),
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      '-y',
      outPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', ffmpegArgs, {
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
          resolve();
        } else {
          reject(new Error(stderr.trim() || `ffmpeg exited with code ${code ?? 'unknown'}`));
        }
      });
    });

    const startLabel = new Date(startTime).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${cameraId}_${startLabel}.mp4`;
    const stat = fs.statSync(outPath);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(outPath);
    stream.on('close', cleanup);
    stream.on('error', () => {
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream exported clip' });
      }
    });
    stream.pipe(res);
  } catch (err) {
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to export video clip',
      });
    }
  }
}
