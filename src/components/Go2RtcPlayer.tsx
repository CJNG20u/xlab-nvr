import { useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';

interface Go2RtcPlayerProps {
  streamName: string;
  cameraName: string;
  muted?: boolean;
  className?: string;
}

const MSE_CODECS = [
  'avc1.640029',
  'avc1.64002A',
  'avc1.640033',
  'hvc1.1.6.L153.B0',
  'mp4a.40.2',
  'mp4a.40.5',
  'flac',
  'opus',
];

function getSupportedMseCodecs(): string {
  if (typeof MediaSource === 'undefined' || typeof MediaSource.isTypeSupported !== 'function') {
    return '';
  }
  return MSE_CODECS.filter((codec) =>
    MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`)
  ).join(',');
}

export function Go2RtcPlayer({
  streamName,
  cameraName,
  muted = true,
  className = '',
}: Go2RtcPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mode, setMode] = useState<'connecting' | 'mse' | 'snapshot' | 'offline'>('connecting');
  const [snapshotUrl, setSnapshotUrl] = useState<string>('');
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let snapshotTimer: number | null = null;
    let backoffMs = 2000;
    let mediaSource: MediaSource | null = null;
    let objectUrl: string | null = null;

    const cleanupMediaSource = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      mediaSource = null;
    };

    const startSnapshotFallback = () => {
      if (disposed) return;
      setMode('snapshot');
      const loadFrame = () => {
        if (disposed) return;
        setSnapshotUrl(
          `/go2rtc/api/frame.jpeg?src=${encodeURIComponent(streamName)}&t=${Date.now()}`
        );
      };
      loadFrame();
      if (snapshotTimer) window.clearInterval(snapshotTimer);
      snapshotTimer = window.setInterval(loadFrame, 2500);
    };

    const stopSnapshotFallback = () => {
      if (snapshotTimer) {
        window.clearInterval(snapshotTimer);
        snapshotTimer = null;
      }
    };

    const connectMse = () => {
      if (disposed) return;

      const codecs = getSupportedMseCodecs();
      if (!codecs || typeof MediaSource === 'undefined') {
        startSnapshotFallback();
        return;
      }

      cleanupMediaSource();
      const ms = new MediaSource();
      mediaSource = ms;
      objectUrl = URL.createObjectURL(ms);

      const video = videoRef.current;
      if (video) {
        video.src = objectUrl;
        video.muted = muted;
      }

      let sourceBuffer: SourceBuffer | null = null;
      const queue: ArrayBuffer[] = [];

      const flushQueue = () => {
        if (!sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
        const next = queue.shift();
        if (!next) return;
        try {
          sourceBuffer.appendBuffer(next);
        } catch {
          queue.length = 0;
        }
      };

      const onSourceOpen = () => {
        if (disposed) return;
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProto}//${window.location.host}/go2rtc/api/ws?src=${encodeURIComponent(
          streamName
        )}`;

        ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          if (disposed || !ws) return;
          backoffMs = 2000;
          ws.send(JSON.stringify({ type: 'mse', value: codecs }));
        };

        ws.onmessage = (evt) => {
          if (disposed) return;
          if (typeof evt.data === 'string') {
            try {
              const msg = JSON.parse(evt.data) as { type?: string; value?: string };
              if (msg.type === 'mse' && msg.value && ms.readyState === 'open') {
                if (!sourceBuffer) {
                  sourceBuffer = ms.addSourceBuffer(msg.value);
                  sourceBuffer.mode = 'segments';
                  sourceBuffer.addEventListener('updateend', () => {
                    flushQueue();
                    if (video && sourceBuffer && sourceBuffer.buffered.length > 0) {
                      const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
                      if (end - video.currentTime > 3) {
                        video.currentTime = Math.max(0, end - 0.25);
                      }
                    }
                  });
                }
                stopSnapshotFallback();
                setMode('mse');
                video?.play().catch(() => {});
              } else if (msg.type === 'error') {
                ws?.close();
              }
            } catch {
              // ignore non-json
            }
          } else if (evt.data instanceof ArrayBuffer) {
            if (!sourceBuffer) return;
            if (queue.length < 30) {
              queue.push(evt.data);
              flushQueue();
            }
          }
        };

        ws.onerror = () => {
          ws?.close();
        };

        ws.onclose = () => {
          if (disposed) return;
          startSnapshotFallback();
          if (reconnectTimer) window.clearTimeout(reconnectTimer);
          const delay = backoffMs;
          backoffMs = Math.min(15_000, Math.round(backoffMs * 1.6));
          reconnectTimer = window.setTimeout(connectMse, delay);
        };
      };

      ms.addEventListener('sourceopen', onSourceOpen, { once: true });
    };

    setMode('connecting');
    setSnapshotLoaded(false);
    connectMse();

    return () => {
      disposed = true;
      stopSnapshotFallback();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      cleanupMediaSource();
    };
  }, [streamName]);

  return (
    <div className={`relative w-full h-full bg-[#09090b] overflow-hidden select-none ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          mode === 'mse' ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {mode !== 'mse' && snapshotUrl && (
        <img
          src={snapshotUrl}
          alt={`Live snapshot from ${cameraName}`}
          referrerPolicy="no-referrer"
          onLoad={() => {
            setSnapshotLoaded(true);
            setMode('snapshot');
          }}
          onError={() => {
            setSnapshotLoaded(false);
            setMode('offline');
          }}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            snapshotLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {mode !== 'mse' && !snapshotLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[#121214] text-zinc-500 px-4 text-center">
          <VideoOff className="w-5 h-5 text-zinc-600" />
          <p className="text-xs font-medium text-zinc-400 truncate max-w-full">{cameraName}</p>
          <p className="text-[11px] font-mono text-zinc-600 truncate max-w-full">
            {mode === 'connecting' ? 'Connecting…' : streamName}
          </p>
        </div>
      )}
    </div>
  );
}
