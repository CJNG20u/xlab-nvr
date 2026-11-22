import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Disc, Search, Settings, Video, WifiOff } from 'lucide-react';
import type {
  ActiveRecording,
  CameraModesPatch,
  CameraRuntimeStatus,
  PublicCameraConfig,
} from './types';
import {
  fetchCameras,
  patchCameraModes,
  setAllCamerasLiveOnly,
  subscribeNvrEvents,
} from './lib/api';
import { XlabLogo } from './components/XlabLogo';
import { LiveView } from './components/LiveView';
import { CameraDetailView } from './components/CameraDetailView';
import { ReviewView } from './components/ReviewView';
import { ClipsView } from './components/ClipsView';
import { ExportsView } from './components/ExportsView';
import { SettingsView } from './components/SettingsView';
import { useOnlineStatus } from './hooks/usePWAInstall';

type NavTab = 'live' | 'review' | 'clips' | 'exports' | 'settings';

interface FocusedCameraState {
  cameraId: string;
  date?: string;
  timestampMs?: number | null;
  preferHistoryOnOpen?: boolean;
}

/** Stacked play-frame icon matching Frigate's Review navigation icon */
function StackedPlayIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 4h14" />
      <path d="M7 7.5h10" />
      <rect x="3" y="10.5" width="18" height="10.5" rx="2" />
      <polygon points="10.5 13.5 15 15.75 10.5 18 10.5 13.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  renderIcon: (cls: string) => ReactNode;
}> = [
  { id: 'live', label: 'Live', renderIcon: (cls) => <Video className={cls} /> },
  { id: 'review', label: 'Review', renderIcon: (cls) => <StackedPlayIcon className={cls} /> },
  { id: 'clips', label: 'Clips / Detections', renderIcon: (cls) => <Search className={cls} /> },
  { id: 'exports', label: 'Exports', renderIcon: (cls) => <Disc className={cls} /> },
  { id: 'settings', label: 'Settings', renderIcon: (cls) => <Settings className={cls} /> },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('live');
  const [cameras, setCameras] = useState<PublicCameraConfig[]>([]);
  const [activeRecordings, setActiveRecordings] = useState<Record<string, ActiveRecording>>({});
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, CameraRuntimeStatus>>({});
  const [clipsRefreshToken, setClipsRefreshToken] = useState(0);
  const [focusedCamera, setFocusedCamera] = useState<FocusedCameraState | null>(null);
  const [openAddCameraToken, setOpenAddCameraToken] = useState(0);
  const isOnline = useOnlineStatus();

  const loadCameras = useCallback(async () => {
    try {
      const list = await fetchCameras();
      setCameras(list);
    } catch {
      // ignore transient boot error
    }
  }, []);

  useEffect(() => {
    void loadCameras();
  }, [loadCameras]);

  // Real-time SSE updates for active detection recordings, worker statuses & new clips
  useEffect(() => {
    const unsubscribe = subscribeNvrEvents((msg) => {
      if (msg.type === 'init') {
        if (msg.activeRecordings) {
          const next: Record<string, ActiveRecording> = {};
          for (const rec of msg.activeRecordings) {
            next[rec.cameraId] = rec;
          }
          setActiveRecordings(next);
        }
        if (msg.cameras) {
          setRuntimeStatuses(msg.cameras);
        }
      } else if (msg.type === 'recording_started' && msg.recording) {
        setActiveRecordings((prev) => ({
          ...prev,
          [msg.recording!.cameraId]: msg.recording!,
        }));
      } else if (msg.type === 'recording_finished' && msg.cameraId) {
        setActiveRecordings((prev) => {
          const copy = { ...prev };
          delete copy[msg.cameraId!];
          return copy;
        });
      } else if (msg.type === 'status_updated' && msg.status) {
        setRuntimeStatuses((prev) => ({
          ...prev,
          [msg.status!.cameraId]: msg.status!,
        }));
      } else if (msg.type === 'clip_created') {
        setClipsRefreshToken((t) => t + 1);
      }
    });
    return unsubscribe;
  }, []);

  const handleToggleCameraModes = useCallback(
    async (cameraId: string, patch: CameraModesPatch) => {
      let snapshot: PublicCameraConfig[] = [];
      setCameras((prev) => {
        snapshot = prev;
        return prev.map((c) =>
          c.id === cameraId
            ? {
                ...c,
                recordContinuous:
                  patch.recordContinuous !== undefined
                    ? patch.recordContinuous
                    : c.recordContinuous,
                detectObjects:
                  patch.detectObjects !== undefined ? patch.detectObjects : c.detectObjects,
              }
            : c
        );
      });

      try {
        const updated = await patchCameraModes(cameraId, patch);
        setCameras((prev) => prev.map((c) => (c.id === cameraId ? updated : c)));
      } catch {
        setCameras(snapshot);
      }
    },
    []
  );

  const handleSetAllLiveOnly = useCallback(async () => {
    let snapshot: PublicCameraConfig[] = [];
    setCameras((prev) => {
      snapshot = prev;
      return prev.map((c) => ({ ...c, recordContinuous: false, detectObjects: false }));
    });
    try {
      const updated = await setAllCamerasLiveOnly();
      setCameras(updated);
    } catch {
      setCameras(snapshot);
    }
  }, []);

  const handleSelectNav = (tab: NavTab) => {
    setActiveTab(tab);
    setFocusedCamera(null);
  };

  const handleOpenAddCamera = () => {
    setActiveTab('settings');
    setFocusedCamera(null);
    setOpenAddCameraToken((n) => n + 1);
  };

  const handleJumpToTimeline = (cameraId: string, date: string, timestampMs: number) => {
    setActiveTab('live');
    setFocusedCamera({ cameraId, date, timestampMs, preferHistoryOnOpen: false });
  };

  return (
    <div className="h-[100dvh] w-screen overflow-hidden flex flex-col md:flex-row bg-black text-zinc-100">
      {/* Slim 56px Pitch-Black Desktop Left Icon Rail */}
      <aside className="hidden md:flex flex-col items-center w-14 shrink-0 bg-black border-r border-zinc-900 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] select-none">
        <button
          type="button"
          onClick={() => handleSelectNav('live')}
          title="Xlab-nvr"
          aria-label="Xlab-nvr Home"
          className="mb-5 p-1 rounded-lg hover:bg-zinc-900 transition-colors cursor-pointer"
        >
          <XlabLogo className="w-8 h-8" />
        </button>

        <nav aria-label="Primary navigation" className="flex flex-col items-center gap-2 flex-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`group relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#1e293b] text-[#7c9cf5]'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                {item.renderIcon('w-5 h-5')}
                {/* Hover Tooltip */}
                <span className="pointer-events-none absolute left-full ml-2.5 px-2 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-medium text-zinc-100 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-black">
        {activeTab === 'live' && focusedCamera ? (
          <CameraDetailView
            cameras={cameras}
            cameraId={focusedCamera.cameraId}
            initialDate={focusedCamera.date}
            initialTimestampMs={focusedCamera.timestampMs ?? null}
            preferHistoryOnOpen={focusedCamera.preferHistoryOnOpen}
            activeRecording={activeRecordings[focusedCamera.cameraId]}
            onSelectCamera={(id) =>
              setFocusedCamera({ cameraId: id, timestampMs: null, preferHistoryOnOpen: false })
            }
            onToggleModes={handleToggleCameraModes}
            onBack={() => setFocusedCamera(null)}
          />
        ) : activeTab === 'live' ? (
          <LiveView
            cameras={cameras}
            activeRecordings={activeRecordings}
            runtimeStatuses={runtimeStatuses}
            onSelectCamera={(id, openPlayback = false) =>
              setFocusedCamera({
                cameraId: id,
                timestampMs: null,
                preferHistoryOnOpen: openPlayback,
              })
            }
            onToggleModes={handleToggleCameraModes}
            onSetAllLiveOnly={handleSetAllLiveOnly}
            onAddCamera={handleOpenAddCamera}
            onNavigateSettings={() => handleSelectNav('settings')}
          />
        ) : activeTab === 'review' ? (
          <ReviewView
            cameras={cameras}
            onOpenCameraTimeline={handleJumpToTimeline}
          />
        ) : activeTab === 'clips' ? (
          <ClipsView
            cameras={cameras}
            refreshToken={clipsRefreshToken}
            onJumpToTimeline={handleJumpToTimeline}
          />
        ) : activeTab === 'exports' ? (
          <ExportsView cameras={cameras} />
        ) : (
          <SettingsView
            cameras={cameras}
            openAddToken={openAddCameraToken}
            onCamerasChanged={loadCameras}
          />
        )}
      </main>

      {/* Subtle Offline Notice Banner */}
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 bg-[#18181b] border-t border-zinc-800 px-3 py-1.5 flex items-center justify-center gap-2 text-xs text-zinc-300"
        >
          <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Offline — waiting for NVR server connection</span>
        </div>
      )}

      {/* Mobile Icon-Only Pitch-Black Bottom Navigation Bar with Safe-Area Inset */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden shrink-0 bg-black border-t border-zinc-900 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="h-14 grid grid-cols-5 items-center">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                aria-label={item.label}
                title={item.label}
                aria-current={isActive ? 'page' : undefined}
                className="flex items-center justify-center h-full cursor-pointer"
              >
                <span
                  className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                    isActive
                      ? 'bg-[#1e293b] text-[#7c9cf5]'
                      : 'text-zinc-500 active:text-zinc-200'
                  }`}
                >
                  {item.renderIcon('w-5 h-5')}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
