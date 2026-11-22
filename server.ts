import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  closeDatabase,
  deleteClipRecord,
  getClipById,
  getClipsForCameraDate,
  getClipsForDate,
  getSegmentsForCameraDate,
  getSegmentsForDate,
  queryClips,
} from './server/db.ts';
import { nvrEvents, type NvrEventPayload } from './server/eventBus.ts';
import { exportContinuousRange } from './server/exporter.ts';
import { attachGo2RtcWsProxy, handleGo2RtcHttpProxy } from './server/go2rtcProxy.ts';
import { testCameraConnection } from './server/onvifManager.ts';
import { startRetentionScheduler, stopRetentionScheduler } from './server/retention.ts';
import {
  DATA_DIR,
  PASSWORD_MASK,
  RECORDINGS_DIR,
  assertSafeRecordingPath,
  buildRecordingUrl,
  migrateCameraSchemaIfNeeded,
  normalizeCameraInput,
  readCameras,
  readSettings,
  sanitizeCameraId,
  toPublicCamera,
  validateDateString,
  validateOnvifHost,
  validateStreamName,
  writeCameras,
  writeSettings,
} from './server/storage.ts';
import {
  applyCameraModes,
  getActiveRecordings,
  getAllCameraRuntimeStatus,
  removeCameraWorkers,
  startWorkerServices,
  stopWorkerServices,
  syncAllWorkers,
} from './server/workerManager.ts';
import { DETECTION_LABELS, type ObjectCountSummary } from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  // Automatically migrate any legacy recordClips flags to detectObjects before booting workers
  migrateCameraSchemaIfNeeded();

  const app = express();
  const server = http.createServer(app);

  // Proxy /go2rtc/* HTTP requests BEFORE body parsers so raw bodies/streams pass through untouched
  app.use('/go2rtc', handleGo2RtcHttpProxy);

  // Attach WebSocket upgrade proxy for /go2rtc/* (MSE / WebRTC)
  attachGo2RtcWsProxy(server);

  app.use(express.json({ limit: '1mb' }));

  // Serve /recordings statically with full HTTP Range (206 Partial Content) support and path confinement
  app.use('/recordings', (req: Request, res: Response, next: NextFunction) => {
    try {
      const decoded = decodeURIComponent(req.path);
      assertSafeRecordingPath(decoded);
      next();
    } catch {
      res.status(400).json({ error: 'Invalid recording path' });
    }
  });
  app.use(
    '/recordings',
    express.static(RECORDINGS_DIR, {
      acceptRanges: true,
      dotfiles: 'deny',
      fallthrough: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.mp4')) {
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Cache-Control', 'public, max-age=3600');
        } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
      },
    })
  );

  // --- Settings API ---
  app.get('/api/settings', (_req: Request, res: Response) => {
    res.json(readSettings());
  });

  app.put('/api/settings', (req: Request, res: Response) => {
    try {
      const updated = writeSettings(req.body || {});
      syncAllWorkers();
      res.json(updated);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to save settings',
      });
    }
  });

  // --- Cameras CRUD & Live Mode APIs ---
  app.get('/api/cameras', (_req: Request, res: Response) => {
    const cameras = readCameras().map(toPublicCamera);
    res.json(cameras);
  });

  app.post('/api/cameras', (req: Request, res: Response) => {
    try {
      const cameras = readCameras();
      const nextCam = normalizeCameraInput(req.body || {});
      if (cameras.some((c) => c.id === nextCam.id)) {
        res.status(409).json({ error: `A camera with ID "${nextCam.id}" already exists` });
        return;
      }
      cameras.push(nextCam);
      writeCameras(cameras);
      applyCameraModes(nextCam);
      res.status(201).json(toPublicCamera(nextCam));
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid camera configuration',
      });
    }
  });

  app.put('/api/cameras/:id', (req: Request, res: Response) => {
    try {
      const camId = sanitizeCameraId(String(req.params.id || ''));
      const cameras = readCameras();
      const idx = cameras.findIndex((c) => c.id === camId);
      if (idx === -1) {
        res.status(404).json({ error: 'Camera not found' });
        return;
      }
      const updated = normalizeCameraInput(req.body || {}, cameras[idx]);
      cameras[idx] = updated;
      writeCameras(cameras);
      applyCameraModes(updated);
      res.json(toPublicCamera(updated));
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to update camera',
      });
    }
  });

  // Fast per-camera mode toggle endpoint (Live Only / 24/7 Recording / Object Detection)
  app.patch('/api/cameras/:id/modes', (req: Request, res: Response) => {
    try {
      const camId = sanitizeCameraId(String(req.params.id || ''));
      const body = (req.body || {}) as Record<string, unknown>;
      const cameras = readCameras();
      const idx = cameras.findIndex((c) => c.id === camId);
      if (idx === -1) {
        res.status(404).json({ error: 'Camera not found' });
        return;
      }

      if (
        body.recordContinuous !== undefined &&
        typeof body.recordContinuous !== 'boolean'
      ) {
        res.status(400).json({ error: 'recordContinuous must be a boolean' });
        return;
      }
      if (body.detectObjects !== undefined && typeof body.detectObjects !== 'boolean') {
        res.status(400).json({ error: 'detectObjects must be a boolean' });
        return;
      }

      const current = cameras[idx];
      const updated = {
        ...current,
        recordContinuous:
          body.recordContinuous !== undefined
            ? body.recordContinuous
            : current.recordContinuous,
        detectObjects:
          body.detectObjects !== undefined ? body.detectObjects : current.detectObjects,
      };

      cameras[idx] = updated;
      writeCameras(cameras);
      applyCameraModes(updated);
      res.json(toPublicCamera(updated));
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to toggle camera modes',
      });
    }
  });

  // Bulk action: Set all cameras to Live Only (zero ffmpeg workers, zero ONVIF polling)
  app.post('/api/cameras/live-only', (_req: Request, res: Response) => {
    try {
      const cameras = readCameras().map((cam) => ({
        ...cam,
        recordContinuous: false,
        detectObjects: false,
      }));
      writeCameras(cameras);
      for (const cam of cameras) {
        applyCameraModes(cam);
      }
      res.json(cameras.map(toPublicCamera));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to switch cameras to Live Only',
      });
    }
  });

  app.delete('/api/cameras/:id', (req: Request, res: Response) => {
    try {
      const camId = sanitizeCameraId(String(req.params.id || ''));
      const cameras = readCameras();
      const next = cameras.filter((c) => c.id !== camId);
      if (next.length === cameras.length) {
        res.status(404).json({ error: 'Camera not found' });
        return;
      }
      writeCameras(next);
      removeCameraWorkers(camId);
      res.json({ ok: true, id: camId });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to delete camera',
      });
    }
  });

  // --- Camera Test Connection API ---
  app.post('/api/cameras/test', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const settings = readSettings();
      const existing =
        typeof body.id === 'string' && body.id.trim()
          ? readCameras().find((c) => c.id === body.id)
          : undefined;

      const streamName = validateStreamName(
        String(body.go2rtcStreamName ?? existing?.go2rtcStreamName ?? '')
      );
      const onvifHost = validateOnvifHost(String(body.onvifHost ?? existing?.onvifHost ?? ''));
      const onvifPort = Number(body.onvifPort ?? existing?.onvifPort ?? 80) || 80;
      const onvifUser = String(body.onvifUser ?? existing?.onvifUser ?? '');
      let onvifPass = existing?.onvifPass ?? '';
      if (typeof body.onvifPass === 'string' && body.onvifPass !== PASSWORD_MASK) {
        onvifPass = body.onvifPass;
      }

      const result = await testCameraConnection(
        {
          go2rtcStreamName: streamName,
          onvifHost,
          onvifPort,
          onvifUser,
          onvifPass,
        },
        settings
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    }
  });

  // --- Real-time Runtime Status & SSE Stream ---
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({
      cameras: getAllCameraRuntimeStatus(),
      activeRecordings: getActiveRecordings(),
    });
  });

  app.get('/api/events/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(
      `data: ${JSON.stringify({
        type: 'init',
        cameras: getAllCameraRuntimeStatus(),
        activeRecordings: getActiveRecordings(),
      })}\n\n`
    );

    const onEvent = (payload: NvrEventPayload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    nvrEvents.on('nvr_event', onEvent);
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepalive);
      nvrEvents.off('nvr_event', onEvent);
    });
  });

  // --- Per-Camera Daily Playback & Object Summary API ---
  app.get('/api/recordings/:cameraId/:date', (req: Request, res: Response) => {
    try {
      const cameraId = sanitizeCameraId(String(req.params.cameraId || ''));
      const date = validateDateString(String(req.params.date || ''));

      const segments = getSegmentsForCameraDate(cameraId, date).map((seg) => ({
        ...seg,
        fileUrl: buildRecordingUrl(seg.filePath),
      }));

      const clips = getClipsForCameraDate(cameraId, date).map((clip) => ({
        ...clip,
        clipUrl: buildRecordingUrl(clip.clipPath),
        thumbnailUrl: clip.thumbnailPath ? buildRecordingUrl(clip.thumbnailPath) : '',
      }));

      const objectCounts: ObjectCountSummary = {
        person: 0,
        vehicle: 0,
        pet: 0,
        line_crossing: 0,
        motion: 0,
      };
      for (const clip of clips) {
        if (clip.label in objectCounts) {
          objectCounts[clip.label]++;
        }
      }

      res.json({
        cameraId,
        date,
        segments,
        clips,
        objectCounts,
        totalClips: clips.length,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid parameters',
      });
    }
  });

  app.get('/api/review/:date', (req: Request, res: Response) => {
    try {
      const date = validateDateString(String(req.params.date || ''));
      const segments = getSegmentsForDate(date).map((seg) => ({
        ...seg,
        fileUrl: buildRecordingUrl(seg.filePath),
      }));
      const clips = getClipsForDate(date).map((clip) => ({
        ...clip,
        clipUrl: buildRecordingUrl(clip.clipPath),
        thumbnailUrl: clip.thumbnailPath ? buildRecordingUrl(clip.thumbnailPath) : '',
      }));
      res.json({ date, segments, clips });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid date parameter',
      });
    }
  });

  // --- Detection Clips API ---
  app.get('/api/clips', (req: Request, res: Response) => {
    try {
      const cameraId =
        typeof req.query.cameraId === 'string' && req.query.cameraId.trim()
          ? sanitizeCameraId(req.query.cameraId)
          : undefined;
      const date =
        typeof req.query.date === 'string' && req.query.date.trim()
          ? validateDateString(req.query.date)
          : undefined;
      const rawLabel =
        typeof req.query.label === 'string' ? req.query.label.trim().toLowerCase() : '';
      const label =
        rawLabel && (DETECTION_LABELS as readonly string[]).includes(rawLabel)
          ? rawLabel
          : undefined;
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 40;

      const result = queryClips({ cameraId, label, date, page, limit });
      res.json({
        ...result,
        clips: result.clips.map((clip) => ({
          ...clip,
          clipUrl: buildRecordingUrl(clip.clipPath),
          thumbnailUrl: clip.thumbnailPath ? buildRecordingUrl(clip.thumbnailPath) : '',
        })),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid clip query parameters',
      });
    }
  });

  app.delete('/api/clips/:id', (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Clip ID is required' });
      return;
    }
    const clip = getClipById(id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found' });
      return;
    }
    for (const rel of [clip.clipPath, clip.thumbnailPath]) {
      if (!rel) continue;
      try {
        const abs = assertSafeRecordingPath(rel);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {
        // ignore missing file
      }
    }
    deleteClipRecord(id);
    res.json({ ok: true, id });
  });

  // --- Export API ---
  app.post('/api/export', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const cameraId = String(body.cameraId || '');
      const parseTime = (val: unknown): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const num = Number(val);
          if (Number.isFinite(num) && val.trim() !== '') return num;
          return Date.parse(val);
        }
        return NaN;
      };
      const startTime = parseTime(body.startTime);
      const endTime = parseTime(body.endTime);

      await exportContinuousRange({ cameraId, startTime, endTime, res });
    } catch (err) {
      if (!res.headersSent) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Export request failed',
        });
      }
    }
  });

  // Fallback error handler for /recordings static errors
  app.use((err: Error & { status?: number }, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/recordings') || req.path.startsWith('/api')) {
      res.status(err.status || 404).json({ error: err.message || 'Not found' });
      return;
    }
    next(err);
  });

  // --- PWA Manifest & Service Worker Headers (Dev & Production) ---
  const resolvePublicAsset = (filename: string): string => {
    const primaryDir = IS_PROD ? path.join(__dirname, 'dist') : path.join(__dirname, 'public');
    const primaryPath = path.join(primaryDir, filename);
    if (fs.existsSync(primaryPath)) return primaryPath;
    return path.join(__dirname, 'public', filename);
  };

  app.get('/manifest.webmanifest', (_req: Request, res: Response) => {
    const filePath = resolvePublicAsset('manifest.webmanifest');
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(filePath);
  });

  app.get('/sw.js', (_req: Request, res: Response) => {
    const filePath = resolvePublicAsset('sw.js');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(filePath);
  });

  // --- Frontend Serving (Vite Dev Middleware vs Production Dist) ---
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Start per-camera NVR workers & hourly retention cleanup
  startWorkerServices();
  startRetentionScheduler();

  server.listen(PORT, '0.0.0.0', () => {
    console.info(`Xlab-nvr listening on http://0.0.0.0:${PORT}`);
    console.info(`Data directory: ${DATA_DIR} | Recordings directory: ${RECORDINGS_DIR}`);
  });

  const shutdown = () => {
    stopWorkerServices();
    stopRetentionScheduler();
    closeDatabase();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
