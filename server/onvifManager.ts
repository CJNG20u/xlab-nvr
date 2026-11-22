import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import type {
  ActiveRecording,
  CameraConfig,
  DetectionClip,
  DetectionLabel,
  NvrSettings,
  TestConnectionResult,
} from '../src/types.ts';
import { insertDetectionClip } from './db.ts';
import { nvrEvents } from './eventBus.ts';
import {
  assertSafeRecordingPath,
  buildRecordingUrl,
  formatLocalDate,
  formatLocalTimeFile,
  readCameras,
  readSettings,
} from './storage.ts';

const require = createRequire(import.meta.url);

type CamConstructor = new (
  opts: Record<string, unknown>,
  cb?: (err?: Error) => void
) => Record<string, unknown>;

let cachedCamConstructor: CamConstructor | null = null;

function extractCamConstructor(mod: unknown): CamConstructor | null {
  if (!mod || typeof mod !== 'object') return null;
  const rec = mod as Record<string, unknown>;
  if (typeof rec.Cam === 'function') {
    return rec.Cam as CamConstructor;
  }
  const def = rec.default as Record<string, unknown> | undefined;
  if (def && typeof def.Cam === 'function') {
    return def.Cam as CamConstructor;
  }
  return null;
}

async function resolveCamConstructor(): Promise<CamConstructor> {
  if (cachedCamConstructor) return cachedCamConstructor;

  // Prefer onvif/compatibility (onvif v1.x) then root onvif (onvif v0.x) across CJS & ESM
  const specifiers = ['onvif/compatibility', 'onvif'];

  for (const specifier of specifiers) {
    try {
      const mod = require(specifier);
      const ctor = extractCamConstructor(mod);
      if (ctor) {
        cachedCamConstructor = ctor;
        return ctor;
      }
    } catch {
      // try next resolution path
    }
  }

  for (const specifier of specifiers) {
    try {
      const mod = await import(specifier);
      const ctor = extractCamConstructor(mod);
      if (ctor) {
        cachedCamConstructor = ctor;
        return ctor;
      }
    } catch {
      // try next resolution path
    }
  }

  throw new Error('Unable to resolve ONVIF Cam constructor from installed onvif package');
}

interface OnvifListenerState {
  cameraId: string;
  configHash: string;
  stopped: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  backoffMs: number;
}

const listeners = new Map<string, OnvifListenerState>();
const lastTriggerAt = new Map<string, number>();
const activeRecordings = new Map<string, ActiveRecording>();

function buildOnvifHash(cam: CameraConfig): string {
  return `${cam.onvifHost}|${cam.onvifPort}|${cam.onvifUser}|${cam.onvifPass}|${cam.detectObjects}|${cam.go2rtcStreamName}`;
}

export function getActiveRecordings(): ActiveRecording[] {
  return Array.from(activeRecordings.values());
}

export function getActiveRecordingForCamera(cameraId: string): ActiveRecording | undefined {
  return activeRecordings.get(cameraId);
}

export function isObjectDetectionActive(cameraId: string): boolean {
  const state = listeners.get(cameraId);
  return Boolean(state && !state.stopped);
}

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function extractSimpleItems(dataNode: unknown): Array<{ name: string; value: string }> {
  if (!dataNode || typeof dataNode !== 'object') return [];
  const obj = dataNode as Record<string, unknown>;
  const rawItems = asArray(obj.simpleItem ?? obj.SimpleItem);
  const results: Array<{ name: string; value: string }> = [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const attrs = (rec.$ as Record<string, unknown> | undefined) ?? rec;
    const name = String(attrs.Name ?? attrs.name ?? '');
    const value = String(attrs.Value ?? attrs.value ?? '');
    if (name || value) {
      results.push({ name, value });
    }
  }
  return results;
}

function isTruthyTriggerValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'active';
}

export function parseOnvifNotification(
  notification: unknown
): DetectionLabel | null {
  if (!notification || typeof notification !== 'object') return null;
  const note = notification as Record<string, unknown>;

  const topicNode = (note.topic ?? note.Topic) as Record<string, unknown> | string | undefined;
  const topicText =
    typeof topicNode === 'string'
      ? topicNode
      : String(topicNode?._ ?? topicNode?.['#text'] ?? '');

  const messageWrapper = (note.message ?? note.Message) as Record<string, unknown> | undefined;
  const innerMessage =
    (messageWrapper?.message as Record<string, unknown> | undefined) ??
    (messageWrapper?.Message as Record<string, unknown> | undefined) ??
    messageWrapper;

  const dataNode = innerMessage?.data ?? innerMessage?.Data;
  const sourceNode = innerMessage?.source ?? innerMessage?.Source;
  const dataItems = extractSimpleItems(dataNode);
  const sourceItems = extractSimpleItems(sourceNode);

  const triggerItem = dataItems.find((item) =>
    /^(state|ismotion|isinside|active|triggered|value|logicalstate|status)$/i.test(
      item.name
    )
  );
  if (triggerItem) {
    if (!isTruthyTriggerValue(triggerItem.value)) {
      return null;
    }
  } else {
    const explicitFalse = dataItems.some(
      (item) => item.value.trim().toLowerCase() === 'false' || item.value.trim() === '0'
    );
    if (explicitFalse) return null;
  }

  const combinedText = [
    topicText,
    ...dataItems.map((i) => `${i.name}:${i.value}`),
    ...sourceItems.map((i) => `${i.name}:${i.value}`),
  ]
    .join(' ')
    .toLowerCase();

  if (!combinedText.trim()) return null;

  if (/(person|human|people|pedestrian|face|body)/i.test(combinedText)) {
    return 'person';
  }
  if (/(vehicle|car|truck|bus|motorcycle|bicycle|lpr|licenseplate|auto)/i.test(combinedText)) {
    return 'vehicle';
  }
  if (/(pet|animal|dog|cat)/i.test(combinedText)) {
    return 'pet';
  }
  if (
    /(line_?cross|linedetector|crossline|tripwire|fielddetector|intrusion|perimeter)/i.test(
      combinedText
    )
  ) {
    return 'line_crossing';
  }
  if (/(motion|celldetector|md|tamper|ruleengine|videoanalytics)/i.test(combinedText)) {
    return 'motion';
  }

  return triggerItem ? 'motion' : null;
}

async function fetchSnapshotToFile(
  go2rtcUrl: string,
  streamName: string,
  destPath: string
): Promise<boolean> {
  const url = `${go2rtcUrl.replace(/\/+$/, '')}/api/frame.jpeg?src=${encodeURIComponent(streamName)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return false;
    fs.writeFileSync(destPath, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function recordShortClipFfmpeg(
  rtspUrl: string,
  durationSeconds: number,
  destPath: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-rtsp_transport',
      'tcp',
      '-i',
      rtspUrl,
      '-t',
      String(durationSeconds),
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-y',
      destPath,
    ];
    const proc = spawn('ffmpeg', args, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const maxTimeout = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    }, (durationSeconds + 20) * 1000);

    proc.on('error', () => {
      clearTimeout(maxTimeout);
      resolve(false);
    });
    proc.on('close', (code) => {
      clearTimeout(maxTimeout);
      try {
        const exists = fs.existsSync(destPath) && fs.statSync(destPath).size > 0;
        resolve(code === 0 && exists);
      } catch {
        resolve(false);
      }
    });
  });
}

export async function handleDetectionTrigger(
  cameraId: string,
  label: DetectionLabel
): Promise<void> {
  const cameras = readCameras();
  const camera = cameras.find((c) => c.id === cameraId);
  if (!camera || !camera.detectObjects) return;

  const settings = readSettings();
  const now = Date.now();
  const prev = lastTriggerAt.get(cameraId) ?? 0;

  if (now - prev < settings.eventCooldownSeconds * 1000) {
    return;
  }
  if (activeRecordings.has(cameraId)) {
    return;
  }

  lastTriggerAt.set(cameraId, now);

  const activeRec: ActiveRecording = {
    cameraId,
    label,
    startedAt: now,
  };
  activeRecordings.set(cameraId, activeRec);
  nvrEvents.broadcast({ type: 'recording_started', recording: activeRec });

  const eventDate = new Date(now);
  const dateStr = formatLocalDate(eventDate);
  const timeStr = formatLocalTimeFile(eventDate);
  const safeBaseName = `${timeStr}_${label}`;

  const clipDirRel = path.posix.join(camera.id, 'clips', dateStr);
  const clipDirAbs = assertSafeRecordingPath(clipDirRel);
  fs.mkdirSync(clipDirAbs, { recursive: true });

  const thumbRel = path.posix.join(clipDirRel, `${safeBaseName}.jpg`);
  const clipRel = path.posix.join(clipDirRel, `${safeBaseName}.mp4`);
  const thumbAbs = assertSafeRecordingPath(thumbRel);
  const clipAbs = assertSafeRecordingPath(clipRel);

  const rtspUrl = `rtsp://${settings.go2rtcRtspHost}/${camera.go2rtcStreamName}`;

  try {
    const [, clipOk] = await Promise.all([
      fetchSnapshotToFile(settings.go2rtcUrl, camera.go2rtcStreamName, thumbAbs),
      recordShortClipFfmpeg(rtspUrl, settings.clipDurationSeconds, clipAbs),
    ]);

    if (clipOk) {
      const hasThumb = fs.existsSync(thumbAbs);
      const clipRecord: DetectionClip = {
        id: crypto.randomUUID(),
        cameraId: camera.id,
        label,
        date: dateStr,
        timestamp: now,
        duration: settings.clipDurationSeconds,
        clipPath: clipRel,
        thumbnailPath: hasThumb ? thumbRel : '',
        clipUrl: buildRecordingUrl(clipRel),
        thumbnailUrl: hasThumb ? buildRecordingUrl(thumbRel) : '',
      };
      insertDetectionClip(clipRecord);
      nvrEvents.broadcast({ type: 'clip_created', clip: clipRecord });
    }
  } catch (err) {
    console.warn(`[onvif:${camera.id}] clip capture failed:`, err);
  } finally {
    activeRecordings.delete(cameraId);
    nvrEvents.broadcast({ type: 'recording_finished', cameraId });
  }
}

async function connectOnvifCam(camera: CameraConfig): Promise<Record<string, unknown>> {
  const CamCtor = await resolveCamConstructor();
  return new Promise((resolve, reject) => {
    let cam: Record<string, unknown>;
    try {
      cam = new CamCtor(
        {
          hostname: camera.onvifHost,
          username: camera.onvifUser || undefined,
          password: camera.onvifPass || undefined,
          port: camera.onvifPort || 80,
          timeout: 10_000,
        },
        (err?: Error) => {
          if (err) {
            reject(err);
          } else {
            resolve(cam);
          }
        }
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function createPullPointSubscription(cam: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const fn = cam.createPullPointSubscription as
      | ((cb: (err?: Error) => void) => void)
      | undefined;
    if (typeof fn !== 'function') {
      reject(new Error('Camera ONVIF client does not support CreatePullPointSubscription'));
      return;
    }
    fn.call(cam, (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function pullMessagesOnce(cam: Record<string, unknown>): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const fn = cam.pullMessages as
      | ((
          opts: Record<string, unknown>,
          cb: (err?: Error, res?: Record<string, unknown>) => void
        ) => void)
      | undefined;
    if (typeof fn !== 'function') {
      reject(new Error('Camera ONVIF client does not support PullMessages'));
      return;
    }
    fn.call(cam, { timeout: 'PT5S', messageLimit: 20 }, (err?: Error, res?: Record<string, unknown>) => {
      if (err) {
        reject(err);
        return;
      }
      const messages = asArray(res?.notificationMessage ?? res?.NotificationMessage);
      resolve(messages);
    });
  });
}

async function runOnvifLoop(state: OnvifListenerState, camera: CameraConfig): Promise<void> {
  if (state.stopped) return;

  try {
    const cam = await connectOnvifCam(camera);
    if (state.stopped) return;

    await createPullPointSubscription(cam);
    if (state.stopped) return;

    state.backoffMs = 5000;
    console.info(
      `[onvif:${camera.id}] PullPoint subscription established on ${camera.onvifHost}:${camera.onvifPort}`
    );

    while (!state.stopped) {
      const notifications = await pullMessagesOnce(cam);
      if (state.stopped) break;

      for (const note of notifications) {
        const label = parseOnvifNotification(note);
        if (label) {
          void handleDetectionTrigger(camera.id, label);
        }
      }
    }
  } catch (err) {
    if (state.stopped) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[onvif:${camera.id}] event stream error (${msg}); reconnecting in ${Math.round(
        state.backoffMs / 1000
      )}s`
    );
    const delay = state.backoffMs;
    state.backoffMs = Math.min(60_000, Math.round(state.backoffMs * 1.8));
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (state.stopped) return;
      const latest = readCameras().find((c) => c.id === camera.id);
      if (!latest || !latest.detectObjects || !latest.onvifHost) {
        stopObjectDetection(camera.id);
        return;
      }
      void runOnvifLoop(state, latest);
    }, delay);
  }
}

export function startObjectDetection(camera: CameraConfig): void {
  if (!camera.onvifHost || !camera.go2rtcStreamName) {
    stopObjectDetection(camera.id);
    return;
  }
  const hash = buildOnvifHash(camera);
  const existing = listeners.get(camera.id);
  if (existing && !existing.stopped && existing.configHash === hash) {
    return;
  }
  if (existing) {
    stopObjectDetection(camera.id);
  }

  const state: OnvifListenerState = {
    cameraId: camera.id,
    configHash: hash,
    stopped: false,
    reconnectTimer: null,
    backoffMs: 5000,
  };
  listeners.set(camera.id, state);
  void runOnvifLoop(state, camera);
}

export function stopObjectDetection(cameraId: string): void {
  const state = listeners.get(cameraId);
  if (!state) return;
  state.stopped = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  listeners.delete(cameraId);
}

export function syncOnvifListeners(): void {
  const cameras = readCameras();
  const desiredIds = new Set<string>();

  for (const cam of cameras) {
    if (!cam.detectObjects || !cam.onvifHost) {
      stopObjectDetection(cam.id);
      continue;
    }
    desiredIds.add(cam.id);
    startObjectDetection(cam);
  }

  for (const existingId of Array.from(listeners.keys())) {
    if (!desiredIds.has(existingId)) {
      stopObjectDetection(existingId);
    }
  }
}

export function stopAllOnvifListeners(): void {
  for (const camId of Array.from(listeners.keys())) {
    stopObjectDetection(camId);
  }
}

export async function testCameraConnection(
  camera: Pick<
    CameraConfig,
    'go2rtcStreamName' | 'onvifHost' | 'onvifPort' | 'onvifUser' | 'onvifPass'
  >,
  settings: NvrSettings
): Promise<TestConnectionResult> {
  const frameUrl = `${settings.go2rtcUrl.replace(/\/+$/, '')}/api/frame.jpeg?src=${encodeURIComponent(
    camera.go2rtcStreamName
  )}`;

  let go2rtcResult: TestConnectionResult['go2rtc'];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(frameUrl, { signal: controller.signal });
    const contentType = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const ok = res.ok && buf.length > 0 && contentType.includes('image');
    go2rtcResult = {
      ok,
      status: res.status,
      contentType,
      bytes: buf.length,
      url: frameUrl,
      error: ok ? undefined : `HTTP ${res.status} (${contentType || 'no image data'})`,
    };
  } catch (err) {
    go2rtcResult = {
      ok: false,
      url: frameUrl,
      error: err instanceof Error ? err.message : 'Unable to reach go2rtc',
    };
  } finally {
    clearTimeout(timeout);
  }

  let onvifResult: TestConnectionResult['onvif'];
  if (!camera.onvifHost) {
    onvifResult = { ok: true, skipped: true };
  } else {
    try {
      const cam = await connectOnvifCam({
        id: 'test',
        name: 'test',
        group: 'General',
        recordContinuous: false,
        detectObjects: false,
        ...camera,
      });

      const deviceInfo = await new Promise<Record<string, unknown>>((resolve) => {
        const fn = cam.getDeviceInformation as
          | ((cb: (err?: Error, info?: Record<string, unknown>) => void) => void)
          | undefined;
        if (typeof fn !== 'function') {
          resolve({});
          return;
        }
        fn.call(cam, (_err, info) => resolve(info || {}));
      });

      onvifResult = {
        ok: true,
        manufacturer: deviceInfo.manufacturer ? String(deviceInfo.manufacturer) : undefined,
        model: deviceInfo.model ? String(deviceInfo.model) : undefined,
        firmwareVersion: deviceInfo.firmwareVersion
          ? String(deviceInfo.firmwareVersion)
          : undefined,
      };
    } catch (err) {
      onvifResult = {
        ok: false,
        error: err instanceof Error ? err.message : 'ONVIF handshake failed',
      };
    }
  }

  return {
    ok: go2rtcResult.ok && onvifResult.ok,
    go2rtc: go2rtcResult,
    onvif: onvifResult,
  };
}
