import type { CameraConfig, CameraRuntimeStatus } from '../src/types.ts';
import { nvrEvents } from './eventBus.ts';
import {
  getActiveRecordingForCamera,
  getActiveRecordings,
  isObjectDetectionActive,
  startObjectDetection as startOnvifDetectionWorker,
  stopAllOnvifListeners,
  stopObjectDetection as stopOnvifDetectionWorker,
  syncOnvifListeners,
} from './onvifManager.ts';
import {
  isContinuousRecordingActive,
  startContinuousRecorderService,
  startContinuousRecording as startContinuousWorker,
  stopContinuousRecorderService,
  stopContinuousRecording as stopContinuousWorker,
  syncContinuousRecorders,
} from './recorder.ts';
import { readCameras } from './storage.ts';

export function getCameraRuntimeStatus(cameraId: string): CameraRuntimeStatus {
  const activeClip = getActiveRecordingForCamera(cameraId);
  return {
    cameraId,
    recordingActive: isContinuousRecordingActive(cameraId),
    detectionActive: isObjectDetectionActive(cameraId),
    capturingClip: Boolean(activeClip),
    capturingLabel: activeClip?.label,
    capturingStartedAt: activeClip?.startedAt,
  };
}

export function getAllCameraRuntimeStatus(): Record<string, CameraRuntimeStatus> {
  const cameras = readCameras();
  const map: Record<string, CameraRuntimeStatus> = {};
  for (const cam of cameras) {
    map[cam.id] = getCameraRuntimeStatus(cam.id);
  }
  return map;
}

function broadcastCameraStatus(cameraId: string): void {
  nvrEvents.broadcast({
    type: 'status_updated',
    status: getCameraRuntimeStatus(cameraId),
  });
}

export function startContinuousRecording(camera: CameraConfig): void {
  startContinuousWorker(camera);
  broadcastCameraStatus(camera.id);
}

export function stopContinuousRecording(cameraId: string): void {
  stopContinuousWorker(cameraId);
  broadcastCameraStatus(cameraId);
}

export function startObjectDetection(camera: CameraConfig): void {
  startOnvifDetectionWorker(camera);
  broadcastCameraStatus(camera.id);
}

export function stopObjectDetection(cameraId: string): void {
  stopOnvifDetectionWorker(cameraId);
  broadcastCameraStatus(cameraId);
}

export function applyCameraModes(camera: CameraConfig): CameraRuntimeStatus {
  if (camera.recordContinuous) {
    startContinuousWorker(camera);
  } else {
    stopContinuousWorker(camera.id);
  }

  if (camera.detectObjects && camera.onvifHost) {
    startOnvifDetectionWorker(camera);
  } else {
    stopOnvifDetectionWorker(camera.id);
  }

  const status = getCameraRuntimeStatus(camera.id);
  nvrEvents.broadcast({ type: 'status_updated', status });
  return status;
}

export function removeCameraWorkers(cameraId: string): void {
  stopContinuousWorker(cameraId);
  stopOnvifDetectionWorker(cameraId);
}

export function syncAllWorkers(): void {
  syncContinuousRecorders();
  syncOnvifListeners();
  for (const cam of readCameras()) {
    broadcastCameraStatus(cam.id);
  }
}

export function startWorkerServices(): void {
  startContinuousRecorderService();
  syncOnvifListeners();
}

export function stopWorkerServices(): void {
  stopContinuousRecorderService();
  stopAllOnvifListeners();
}

export { getActiveRecordings };
