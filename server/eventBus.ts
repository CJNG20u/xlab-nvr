import { EventEmitter } from 'events';
import type {
  ActiveRecording,
  CameraRuntimeStatus,
  DetectionClip,
} from '../src/types.ts';

export type NvrEventPayload =
  | { type: 'recording_started'; recording: ActiveRecording }
  | { type: 'recording_finished'; cameraId: string }
  | { type: 'clip_created'; clip: DetectionClip }
  | { type: 'status_updated'; status: CameraRuntimeStatus };

class NvrEventBus extends EventEmitter {
  broadcast(event: NvrEventPayload): void {
    this.emit('nvr_event', event);
  }
}

export const nvrEvents = new NvrEventBus();
nvrEvents.setMaxListeners(100);
