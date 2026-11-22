export type DetectionLabel =
  | 'person'
  | 'vehicle'
  | 'pet'
  | 'line_crossing'
  | 'motion';

export const DETECTION_LABELS: readonly DetectionLabel[] = [
  'person',
  'vehicle',
  'pet',
  'line_crossing',
  'motion',
] as const;

export interface NvrSettings {
  go2rtcUrl: string;
  go2rtcRtspHost: string;
  continuousRetentionDays: number;
  clipRetentionDays: number;
  clipDurationSeconds: number;
  eventCooldownSeconds: number;
}

export interface CameraConfig {
  id: string;
  name: string;
  group: string;
  go2rtcStreamName: string;
  onvifHost: string;
  onvifPort: number;
  onvifUser: string;
  onvifPass: string;
  recordContinuous: boolean;
  detectObjects: boolean;
}

export interface PublicCameraConfig extends Omit<CameraConfig, 'onvifPass'> {
  hasOnvifPass: boolean;
  onvifPass: string;
}

export interface CameraModesPatch {
  recordContinuous?: boolean;
  detectObjects?: boolean;
}

export interface CameraRuntimeStatus {
  cameraId: string;
  recordingActive: boolean;
  detectionActive: boolean;
  capturingClip: boolean;
  capturingLabel?: DetectionLabel;
  capturingStartedAt?: number;
}

export interface NvrRuntimeStatusResponse {
  cameras: Record<string, CameraRuntimeStatus>;
  activeRecordings: ActiveRecording[];
}

export interface ContinuousSegment {
  id: string;
  cameraId: string;
  date: string;
  startTime: number;
  endTime: number;
  duration: number;
  filePath: string;
  fileUrl?: string;
  fileSize: number;
}

export interface DetectionClip {
  id: string;
  cameraId: string;
  label: DetectionLabel;
  date: string;
  timestamp: number;
  duration: number;
  clipPath: string;
  thumbnailPath: string;
  clipUrl?: string;
  thumbnailUrl?: string;
}

export interface ActiveRecording {
  cameraId: string;
  label: DetectionLabel;
  startedAt: number;
}

export type ObjectCountSummary = Record<DetectionLabel, number>;

export interface CameraDayRecordings {
  cameraId: string;
  date: string;
  segments: ContinuousSegment[];
  clips: DetectionClip[];
  objectCounts: ObjectCountSummary;
  totalClips: number;
}

export interface ClipsResponse {
  clips: DetectionClip[];
  total: number;
  page: number;
  limit: number;
}

export interface TestConnectionResult {
  ok: boolean;
  go2rtc: {
    ok: boolean;
    status?: number;
    contentType?: string;
    bytes?: number;
    url?: string;
    error?: string;
  };
  onvif: {
    ok: boolean;
    skipped?: boolean;
    manufacturer?: string;
    model?: string;
    firmwareVersion?: string;
    error?: string;
  };
}
