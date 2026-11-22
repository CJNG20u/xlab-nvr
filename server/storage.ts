import fs from 'fs';
import path from 'path';
import type { CameraConfig, NvrSettings, PublicCameraConfig } from '../src/types.ts';

export const PASSWORD_MASK = '••••••••';

export const DEFAULT_SETTINGS: NvrSettings = {
  go2rtcUrl: 'http://localhost:1984',
  go2rtcRtspHost: 'localhost:8554',
  continuousRetentionDays: 14,
  clipRetentionDays: 30,
  clipDurationSeconds: 15,
  eventCooldownSeconds: 15,
};

function resolveWritableDir(preferred: string, fallbackName: string): string {
  const target = path.resolve(preferred);
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.accessSync(target, fs.constants.W_OK | fs.constants.R_OK);
    return target;
  } catch {
    const fallback = path.resolve(process.cwd(), fallbackName);
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

export const DATA_DIR = resolveWritableDir(process.env.DATA_DIR || '/data', 'data');
export const RECORDINGS_DIR = resolveWritableDir(
  process.env.RECORDINGS_DIR || '/recordings',
  'recordings'
);

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CAMERAS_FILE = path.join(DATA_DIR, 'cameras.json');

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
]);

export function assertSafeRecordingPath(relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, '');
  const resolved = path.resolve(RECORDINGS_DIR, cleaned);
  const rootWithSep = RECORDINGS_DIR.endsWith(path.sep)
    ? RECORDINGS_DIR
    : RECORDINGS_DIR + path.sep;
  if (resolved !== RECORDINGS_DIR && !resolved.startsWith(rootWithSep)) {
    throw new Error('Invalid recording path outside storage directory');
  }
  return resolved;
}

export function buildRecordingUrl(relativePath: string): string {
  if (!relativePath) return '';
  const cleaned = relativePath.replace(/^\/+/, '');
  return `/recordings/${cleaned.split('/').map(encodeURIComponent).join('/')}`;
}

export function sanitizeCameraId(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  if (!normalized || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(
      'Camera ID must start with a letter or digit and contain only a-z, 0-9, _, or -'
    );
  }
  return normalized;
}

export function validateStreamName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) {
    throw new Error('go2rtc stream name is required (max 128 chars)');
  }
  if (trimmed.includes('..') || !/^[a-zA-Z0-9._:@/-]+$/.test(trimmed)) {
    throw new Error('go2rtc stream name contains unsupported characters');
  }
  return trimmed;
}

function isBlockedMetadataHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_METADATA_HOSTS.has(lower)) return true;
  if (lower.startsWith('169.254.')) return true;
  if (lower === 'fd00:ec2::254') return true;
  return false;
}

export function validateGo2RtcUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error('go2rtcUrl must be a valid HTTP or HTTPS URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('go2rtcUrl must use http:// or https://');
  }
  if (isBlockedMetadataHost(parsed.hostname)) {
    throw new Error('go2rtcUrl points to a disallowed metadata host');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function validateRtspHost(raw: string): string {
  const trimmed = raw.trim().replace(/^rtsp:\/\//i, '').replace(/\/.*$/, '');
  if (!trimmed || !/^[a-zA-Z0-9._:\[\]-]{1,128}$/.test(trimmed)) {
    throw new Error('go2rtcRtspHost must be a valid host or host:port');
  }
  const hostOnly = trimmed.replace(/:\d+$/, '').toLowerCase();
  if (isBlockedMetadataHost(hostOnly)) {
    throw new Error('go2rtcRtspHost points to a disallowed metadata host');
  }
  return trimmed;
}

export function validateOnvifHost(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!/^[a-zA-Z0-9._:\[\]-]{1,128}$/.test(trimmed)) {
    throw new Error('ONVIF host contains invalid characters');
  }
  if (isBlockedMetadataHost(trimmed)) {
    throw new Error('ONVIF host points to a disallowed metadata host');
  }
  return trimmed;
}

export function validateDateString(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('Date must be formatted as YYYY-MM-DD');
  }
  return dateStr;
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function readSettings(): NvrSettings {
  if (!fs.existsSync(SETTINGS_FILE)) {
    writeJsonAtomic(SETTINGS_FILE, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<NvrSettings>;
    return {
      go2rtcUrl:
        typeof raw.go2rtcUrl === 'string' && raw.go2rtcUrl
          ? raw.go2rtcUrl
          : DEFAULT_SETTINGS.go2rtcUrl,
      go2rtcRtspHost:
        typeof raw.go2rtcRtspHost === 'string' && raw.go2rtcRtspHost
          ? raw.go2rtcRtspHost
          : DEFAULT_SETTINGS.go2rtcRtspHost,
      continuousRetentionDays: clampInt(
        raw.continuousRetentionDays,
        1,
        3650,
        DEFAULT_SETTINGS.continuousRetentionDays
      ),
      clipRetentionDays: clampInt(
        raw.clipRetentionDays,
        1,
        3650,
        DEFAULT_SETTINGS.clipRetentionDays
      ),
      clipDurationSeconds: clampInt(
        raw.clipDurationSeconds,
        5,
        180,
        DEFAULT_SETTINGS.clipDurationSeconds
      ),
      eventCooldownSeconds: clampInt(
        raw.eventCooldownSeconds,
        1,
        600,
        DEFAULT_SETTINGS.eventCooldownSeconds
      ),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(input: Partial<NvrSettings>): NvrSettings {
  const current = readSettings();
  const next: NvrSettings = {
    go2rtcUrl:
      input.go2rtcUrl !== undefined ? validateGo2RtcUrl(String(input.go2rtcUrl)) : current.go2rtcUrl,
    go2rtcRtspHost:
      input.go2rtcRtspHost !== undefined
        ? validateRtspHost(String(input.go2rtcRtspHost))
        : current.go2rtcRtspHost,
    continuousRetentionDays:
      input.continuousRetentionDays !== undefined
        ? clampInt(input.continuousRetentionDays, 1, 3650, current.continuousRetentionDays)
        : current.continuousRetentionDays,
    clipRetentionDays:
      input.clipRetentionDays !== undefined
        ? clampInt(input.clipRetentionDays, 1, 3650, current.clipRetentionDays)
        : current.clipRetentionDays,
    clipDurationSeconds:
      input.clipDurationSeconds !== undefined
        ? clampInt(input.clipDurationSeconds, 5, 180, current.clipDurationSeconds)
        : current.clipDurationSeconds,
    eventCooldownSeconds:
      input.eventCooldownSeconds !== undefined
        ? clampInt(input.eventCooldownSeconds, 1, 600, current.eventCooldownSeconds)
        : current.eventCooldownSeconds,
  };
  writeJsonAtomic(SETTINGS_FILE, next);
  return next;
}

/**
 * Automatically migrates legacy `recordClips` property to `detectObjects`
 * and ensures both `recordContinuous` and `detectObjects` exist as booleans.
 */
export function migrateCameraSchemaIfNeeded(): void {
  if (!fs.existsSync(CAMERAS_FILE)) {
    writeJsonAtomic(CAMERAS_FILE, []);
    return;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(CAMERAS_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return;

    let changed = false;
    const migrated: CameraConfig[] = parsed.map((raw: Record<string, unknown>) => {
      const hasLegacyClips = 'recordClips' in raw;
      const missingDetect = typeof raw.detectObjects !== 'boolean';
      const missingContinuous = typeof raw.recordContinuous !== 'boolean';

      if (hasLegacyClips || missingDetect || missingContinuous) {
        changed = true;
      }

      const detectObjects =
        typeof raw.detectObjects === 'boolean'
          ? raw.detectObjects
          : typeof raw.recordClips === 'boolean'
            ? raw.recordClips
            : false;

      const recordContinuous =
        typeof raw.recordContinuous === 'boolean' ? raw.recordContinuous : false;

      return {
        id: String(raw.id || ''),
        name: String(raw.name || raw.id || 'Camera'),
        group: String(raw.group || 'General'),
        go2rtcStreamName: String(raw.go2rtcStreamName || ''),
        onvifHost: String(raw.onvifHost || ''),
        onvifPort: clampInt(raw.onvifPort, 1, 65535, 80),
        onvifUser: String(raw.onvifUser || ''),
        onvifPass: String(raw.onvifPass || ''),
        recordContinuous,
        detectObjects,
      };
    });

    if (changed) {
      writeJsonAtomic(CAMERAS_FILE, migrated);
      console.info('[storage] Migrated legacy camera schema (recordClips -> detectObjects)');
    }
  } catch {
    // keep existing file untouched on parse error
  }
}

export function readCameras(): CameraConfig[] {
  if (!fs.existsSync(CAMERAS_FILE)) {
    writeJsonAtomic(CAMERAS_FILE, []);
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(CAMERAS_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: Record<string, unknown>) => {
      const detectObjects =
        typeof item.detectObjects === 'boolean'
          ? item.detectObjects
          : typeof item.recordClips === 'boolean'
            ? item.recordClips
            : false;

      return {
        id: String(item.id || ''),
        name: String(item.name || item.id || 'Camera'),
        group: String(item.group || 'General'),
        go2rtcStreamName: String(item.go2rtcStreamName || ''),
        onvifHost: String(item.onvifHost || ''),
        onvifPort: clampInt(item.onvifPort, 1, 65535, 80),
        onvifUser: String(item.onvifUser || ''),
        onvifPass: String(item.onvifPass || ''),
        recordContinuous: Boolean(item.recordContinuous ?? false),
        detectObjects,
      };
    });
  } catch {
    return [];
  }
}

export function writeCameras(cameras: CameraConfig[]): void {
  writeJsonAtomic(CAMERAS_FILE, cameras);
}

export function toPublicCamera(cam: CameraConfig): PublicCameraConfig {
  return {
    id: cam.id,
    name: cam.name,
    group: cam.group,
    go2rtcStreamName: cam.go2rtcStreamName,
    onvifHost: cam.onvifHost,
    onvifPort: cam.onvifPort,
    onvifUser: cam.onvifUser,
    hasOnvifPass: cam.onvifPass.length > 0,
    onvifPass: cam.onvifPass.length > 0 ? PASSWORD_MASK : '',
    recordContinuous: cam.recordContinuous,
    detectObjects: cam.detectObjects,
  };
}

export function normalizeCameraInput(
  body: Record<string, unknown>,
  existing?: CameraConfig
): CameraConfig {
  const name = String(body.name ?? existing?.name ?? '').trim();
  if (!name || name.length > 80) {
    throw new Error('Camera name is required (max 80 chars)');
  }
  const rawId = existing
    ? existing.id
    : typeof body.id === 'string' && body.id.trim()
      ? body.id
      : name;
  const id = sanitizeCameraId(rawId);
  const group = String(body.group ?? existing?.group ?? 'General').trim().slice(0, 48) || 'General';
  const go2rtcStreamName = validateStreamName(
    String(body.go2rtcStreamName ?? existing?.go2rtcStreamName ?? '')
  );
  const onvifHost = validateOnvifHost(String(body.onvifHost ?? existing?.onvifHost ?? ''));
  const onvifPort = clampInt(body.onvifPort ?? existing?.onvifPort, 1, 65535, 80);
  const onvifUser = String(body.onvifUser ?? existing?.onvifUser ?? '').trim().slice(0, 128);

  let onvifPass = existing?.onvifPass ?? '';
  if (typeof body.onvifPass === 'string') {
    if (body.onvifPass !== PASSWORD_MASK) {
      onvifPass = body.onvifPass;
    }
  }

  const rawDetect =
    body.detectObjects !== undefined
      ? body.detectObjects
      : body.recordClips !== undefined
        ? body.recordClips
        : existing?.detectObjects ?? false;

  return {
    id,
    name,
    group,
    go2rtcStreamName,
    onvifHost,
    onvifPort,
    onvifUser,
    onvifPass,
    recordContinuous:
      body.recordContinuous !== undefined
        ? Boolean(body.recordContinuous)
        : existing?.recordContinuous ?? false,
    detectObjects: Boolean(rawDetect),
  };
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatLocalTimeFile(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}-${mm}-${ss}`;
}
