import React, { useMemo, useRef, useState } from 'react';
import {
  Camera,
  Folder,
  History,
  Home,
  LayoutGrid,
  Pencil,
  Plus,
  Radio,
  Rows3,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  ActiveRecording,
  CameraModesPatch,
  CameraRuntimeStatus,
  PublicCameraConfig,
} from '../types';
import { Go2RtcPlayer } from './Go2RtcPlayer';
import { XlabLogo } from './XlabLogo';

interface LiveViewProps {
  cameras: PublicCameraConfig[];
  activeRecordings: Record<string, ActiveRecording>;
  runtimeStatuses: Record<string, CameraRuntimeStatus>;
  onSelectCamera: (cameraId: string, openPlayback?: boolean) => void;
  onToggleModes: (cameraId: string, patch: CameraModesPatch) => Promise<void>;
  onSetAllLiveOnly: () => Promise<void>;
  onAddCamera: () => void;
  onNavigateSettings: () => void;
}

function getDenseGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 md:grid-cols-2';
  if (count <= 4) return 'grid-cols-1 md:grid-cols-2';
  if (count <= 6) return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
  return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4';
}

export function LiveView({
  cameras,
  activeRecordings,
  runtimeStatuses,
  onSelectCamera,
  onToggleModes,
  onSetAllLiveOnly,
  onAddCamera,
  onNavigateSettings,
}: LiveViewProps) {
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'grid' | 'stacked'>('grid');
  const [editMode, setEditMode] = useState(false);
  const [unmutedIds, setUnmutedIds] = useState<Record<string, boolean>>({});
  const [settingAllLiveOnly, setSettingAllLiveOnly] = useState(false);
  const [revealedTileId, setRevealedTileId] = useState<string | null>(null);
  const tileRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const cam of cameras) {
      if (cam.group.trim()) set.add(cam.group.trim());
    }
    return Array.from(set).sort();
  }, [cameras]);

  const visibleCameras = useMemo(() => {
    if (selectedGroup === 'ALL') return cameras;
    return cameras.filter((c) => c.group.trim() === selectedGroup);
  }, [cameras, selectedGroup]);

  const anyActiveRecordingOrAi = useMemo(
    () => cameras.some((c) => c.recordContinuous || c.detectObjects),
    [cameras]
  );

  const toggleMute = (e: React.MouseEvent, camId: string) => {
    e.stopPropagation();
    setUnmutedIds((prev) => ({ ...prev, [camId]: !prev[camId] }));
  };

  const handleBulkLiveOnly = async () => {
    setSettingAllLiveOnly(true);
    try {
      await onSetAllLiveOnly();
    } finally {
      setSettingAllLiveOnly(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-black">
      {/* Compact Frigate Single-Row Pitch-Black Top Bar (h-14 px-3) with Safe-Area Inset */}
      <header className="shrink-0 bg-black border-b border-zinc-900 pt-[env(safe-area-inset-top)]">
        <div className="relative h-14 px-3 flex items-center justify-between gap-2">
        {/* Left: Home/All + Group Rounded-Square Icon Buttons + Edit Layout Pencil */}
        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar z-10">
          <button
            type="button"
            onClick={() => setSelectedGroup('ALL')}
            title="All Cameras"
            aria-label="All Cameras"
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer border ${
              selectedGroup === 'ALL'
                ? 'bg-[#1e293b] text-[#7c9cf5] border-[#3b5998]/50'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            <Home className="w-4 h-4" />
          </button>

          {groups.map((grp) => {
            const active = selectedGroup === grp;
            const initials = grp.slice(0, 2).toUpperCase();
            return (
              <button
                key={grp}
                type="button"
                onClick={() => setSelectedGroup(grp)}
                title={grp}
                aria-label={`Filter group ${grp}`}
                className={`h-9 min-w-9 px-2 rounded-lg flex items-center justify-center gap-1.5 shrink-0 transition-colors cursor-pointer border text-xs font-medium ${
                  active
                    ? 'bg-[#1e293b] text-[#7c9cf5] border-[#3b5998]/50'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100 hover:bg-zinc-800'
                }`}
              >
                <Folder className="w-3.5 h-3.5 shrink-0 hidden sm:block" />
                <span className="sm:hidden font-mono text-[11px]">{initials}</span>
                <span className="hidden sm:inline max-w-[84px] truncate">{grp}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            title="Edit Layout & Modes"
            aria-label="Edit Layout"
            aria-pressed={editMode}
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer border ${
              editMode
                ? 'bg-[#1e293b] text-[#7c9cf5] border-[#3b5998]/50'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>

        {/* Center: Minimalist xlab-nvr Geometric SVG Logo */}
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <XlabLogo className="w-7 h-7" />
          <span className="hidden lg:inline text-sm font-semibold tracking-tight text-zinc-200">
            xlab-nvr
          </span>
        </div>

        {/* Right: Multi-Camera Grid / Stacked Feed View Toggles + Add Camera */}
        <div className="flex items-center gap-1.5 shrink-0 z-10">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            title="Multi-Camera Grid"
            aria-label="Multi-Camera Grid"
            aria-pressed={viewMode === 'grid'}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer border ${
              viewMode === 'grid'
                ? 'bg-[#1e293b] text-[#7c9cf5] border-[#3b5998]/50'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setViewMode('stacked')}
            title="Full-Width Stacked Feed"
            aria-label="Full-Width Stacked Feed"
            aria-pressed={viewMode === 'stacked'}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer border ${
              viewMode === 'stacked'
                ? 'bg-[#1e293b] text-[#7c9cf5] border-[#3b5998]/50'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            <Rows3 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onAddCamera}
            title="Add Camera"
            aria-label="Add Camera"
            className="w-9 h-9 rounded-lg flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        </div>
      </header>

      {/* Collapsible Edit Layout & Bulk Mode Strip */}
      {editMode && (
        <div className="shrink-0 px-3 py-2 bg-[#121214] border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-zinc-400">
            <span>Quick Mode Controls</span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono tabular-nums text-zinc-500">
              {visibleCameras.length} cameras visible
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={settingAllLiveOnly || !anyActiveRecordingOrAi}
              onClick={handleBulkLiveOnly}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 border border-zinc-800 text-zinc-200 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <Radio className="w-3.5 h-3.5 text-[#7c9cf5]" />
              Set All to Live Only
            </button>
            <button
              type="button"
              onClick={onNavigateSettings}
              className="px-2.5 py-1.5 rounded-lg bg-[#1e293b] hover:bg-[#3b5998] text-zinc-100 border border-[#3b5998]/40 transition-colors cursor-pointer"
            >
              Manage Cameras
            </button>
            <button
              type="button"
              onClick={() => setEditMode(false)}
              aria-label="Close edit controls"
              className="p-1 text-zinc-500 hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Edge-to-Edge Camera Feed Grid (8px gaps, rounded-xl corners) */}
      <div className="flex-1 overflow-y-auto p-2 bg-black">
        {cameras.length === 0 ? (
          <div className="h-full flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-xl bg-[#121214] border border-zinc-800 p-6 text-center">
              <div className="w-11 h-11 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-3.5">
                <Camera className="w-5 h-5 text-zinc-400" />
              </div>
              <h2 className="text-sm font-semibold text-zinc-100 mb-5">No cameras configured</h2>
              <button
                type="button"
                onClick={onAddCamera}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[#1e293b] hover:bg-[#3b5998] text-zinc-100 border border-[#3b5998]/50 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add Camera
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`grid gap-2 ${
              viewMode === 'stacked'
                ? 'grid-cols-1 max-w-5xl mx-auto'
                : getDenseGridClass(visibleCameras.length)
            }`}
          >
            {visibleCameras.map((cam) => {
              const activeRec = activeRecordings[cam.id];
              const rt = runtimeStatuses[cam.id];
              const isMuted = !unmutedIds[cam.id];
              const isLiveOnly = !cam.recordContinuous && !cam.detectObjects;
              const isCapturing = Boolean(activeRec || rt?.capturingClip);
              const isRevealed = revealedTileId === cam.id;

              return (
                <div
                  key={cam.id}
                  ref={(el) => {
                    tileRefs.current[cam.id] = el;
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectCamera(cam.id, false)}
                  onMouseLeave={() => {
                    if (isRevealed) setRevealedTileId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectCamera(cam.id, false);
                    }
                  }}
                  className="group relative aspect-video w-full bg-[#09090b] rounded-xl overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f6bed]"
                >
                  <Go2RtcPlayer
                    streamName={cam.go2rtcStreamName}
                    cameraName={cam.name}
                    muted={isMuted}
                  />

                  {/* Minimalist Top-Right Indicators: 8px red REC dot + tiny emerald/cyan AI badge */}
                  {(cam.recordContinuous || cam.detectObjects || isCapturing) && (
                    <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5 pointer-events-none">
                      {cam.detectObjects && (
                        <span
                          className={`px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm border border-emerald-500/40 text-[9px] font-mono font-semibold tracking-wider text-emerald-400 ${
                            isCapturing ? 'animate-pulse border-cyan-400 text-cyan-300' : ''
                          }`}
                        >
                          AI
                        </span>
                      )}
                      {cam.recordContinuous && (
                        <span
                          title="24/7 Recording active"
                          className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.85)]"
                        />
                      )}
                    </div>
                  )}

                  {/* Translucent Bottom Control Bar on Hover / Focus */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/65 to-transparent pt-8 pb-2.5 px-3 transition-opacity duration-150 ${
                      isRevealed
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-100 truncate max-w-[42%]">
                        {cam.name}
                      </span>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Live Only Pill */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onToggleModes(cam.id, {
                              recordContinuous: false,
                              detectObjects: false,
                            });
                          }}
                          title="Switch to Live Only (no recording or AI)"
                          aria-pressed={isLiveOnly}
                          className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer border ${
                            isLiveOnly
                              ? 'bg-[#1e293b] border-[#3b5998]/70 text-[#93b0ff]'
                              : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-100'
                          }`}
                        >
                          Live Only
                        </button>

                        {/* 24/7 REC Pill */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onToggleModes(cam.id, {
                              recordContinuous: !cam.recordContinuous,
                            });
                          }}
                          title="Toggle 24/7 Continuous Recording"
                          aria-pressed={cam.recordContinuous}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer border ${
                            cam.recordContinuous
                              ? 'bg-red-950/90 border-red-500/60 text-red-200'
                              : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-100'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              cam.recordContinuous ? 'bg-red-500' : 'bg-zinc-600'
                            }`}
                          />
                          REC
                        </button>

                        {/* AI Object Detection Pill */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onToggleModes(cam.id, {
                              detectObjects: !cam.detectObjects,
                            });
                          }}
                          title="Toggle ONVIF Object Detection Clips"
                          aria-pressed={cam.detectObjects}
                          className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer border ${
                            cam.detectObjects
                              ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-300'
                              : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-100'
                          }`}
                        >
                          AI
                        </button>

                        {/* Audio Mute Toggle */}
                        <button
                          type="button"
                          onClick={(e) => toggleMute(e, cam.id)}
                          title={isMuted ? 'Unmute audio' : 'Mute audio'}
                          aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                          className="p-1.5 rounded-md bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                        >
                          {isMuted ? (
                            <VolumeX className="w-3.5 h-3.5" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {/* History / Day Playback */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCamera(cam.id, true);
                          }}
                          title="History & Day Playback"
                          aria-label="History and Day Playback"
                          className="p-1.5 rounded-md bg-zinc-900/80 hover:bg-[#1e293b] border border-zinc-800 hover:border-[#3b5998]/60 text-zinc-300 hover:text-[#93b0ff] transition-colors cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
