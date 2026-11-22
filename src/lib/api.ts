import type {
  ActiveRecording,
  CameraConfig,
  CameraDayRecordings,
  CameraModesPatch,
  CameraRuntimeStatus,
  ClipsResponse,
  ContinuousSegment,
  DetectionClip,
  NvrRuntimeStatusResponse,
  NvrSettings,
  PublicCameraConfig,
  TestConnectionResult,
} from '../types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`
    );
  }
  return data as T;
}

export function fetchSettings(): Promise<NvrSettings> {
  return requestJson<NvrSettings>('/api/settings');
}

export function saveSettings(settings: NvrSettings): Promise<NvrSettings> {
  return requestJson<NvrSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function fetchCameras(): Promise<PublicCameraConfig[]> {
  return requestJson<PublicCameraConfig[]>('/api/cameras');
}

export function createCamera(camera: Partial<CameraConfig>): Promise<PublicCameraConfig> {
  return requestJson<PublicCameraConfig>('/api/cameras', {
    method: 'POST',
    body: JSON.stringify(camera),
  });
}

export function updateCamera(
  id: string,
  camera: Partial<CameraConfig>
): Promise<PublicCameraConfig> {
  return requestJson<PublicCameraConfig>(`/api/cameras/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(camera),
  });
}

export function patchCameraModes(
  id: string,
  patch: CameraModesPatch
): Promise<PublicCameraConfig> {
  return requestJson<PublicCameraConfig>(`/api/cameras/${encodeURIComponent(id)}/modes`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function setAllCamerasLiveOnly(): Promise<PublicCameraConfig[]> {
  return requestJson<PublicCameraConfig[]>('/api/cameras/live-only', {
    method: 'POST',
  });
}

export function deleteCamera(id: string): Promise<{ ok: boolean; id: string }> {
  return requestJson<{ ok: boolean; id: string }>(`/api/cameras/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function testCameraConnectionApi(
  payload: Partial<CameraConfig>
): Promise<TestConnectionResult> {
  return requestJson<TestConnectionResult>('/api/cameras/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchRuntimeStatus(): Promise<NvrRuntimeStatusResponse> {
  return requestJson<NvrRuntimeStatusResponse>('/api/status');
}

export function fetchCameraRecordings(
  cameraId: string,
  date: string
): Promise<CameraDayRecordings> {
  return requestJson<CameraDayRecordings>(
    `/api/recordings/${encodeURIComponent(cameraId)}/${encodeURIComponent(date)}`
  );
}

export function fetchReviewDay(date: string): Promise<{
  date: string;
  segments: ContinuousSegment[];
  clips: DetectionClip[];
}> {
  return requestJson(`/api/review/${encodeURIComponent(date)}`);
}

export function fetchClips(params: {
  cameraId?: string;
  label?: string;
  date?: string;
  page?: number;
  limit?: number;
}): Promise<ClipsResponse> {
  const qs = new URLSearchParams();
  if (params.cameraId) qs.set('cameraId', params.cameraId);
  if (params.label) qs.set('label', params.label);
  if (params.date) qs.set('date', params.date);
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  return requestJson<ClipsResponse>(`/api/clips?${qs.toString()}`);
}

export function deleteClipApi(id: string): Promise<{ ok: boolean; id: string }> {
  return requestJson<{ ok: boolean; id: string }>(`/api/clips/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function downloadExportClip(params: {
  cameraId: string;
  startTime: number;
  endTime: number;
}): Promise<{ filename: string; bytes: number }> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      typeof errData?.error === 'string' ? errData.error : `Export failed (${res.status})`
    );
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || `${params.cameraId}_export.mp4`;

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

  return { filename, bytes: blob.size };
}

export interface StreamEventMessage {
  type: 'init' | 'recording_started' | 'recording_finished' | 'clip_created' | 'status_updated';
  cameras?: Record<string, CameraRuntimeStatus>;
  activeRecordings?: ActiveRecording[];
  recording?: ActiveRecording;
  cameraId?: string;
  clip?: DetectionClip;
  status?: CameraRuntimeStatus;
}

export function subscribeNvrEvents(
  onMessage: (msg: StreamEventMessage) => void
): () => void {
  const source = new EventSource('/api/events/stream');
  source.onmessage = (evt) => {
    try {
      const parsed = JSON.parse(evt.data) as StreamEventMessage;
      onMessage(parsed);
    } catch {
      // ignore malformed event
    }
  };
  return () => {
    source.close();
  };
}
