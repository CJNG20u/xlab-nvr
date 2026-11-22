import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  Save,
  Share,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CameraConfig,
  NvrSettings,
  PublicCameraConfig,
  TestConnectionResult,
} from '../types';
import {
  createCamera,
  deleteCamera,
  fetchSettings,
  saveSettings,
  testCameraConnectionApi,
  updateCamera,
} from '../lib/api';
import { XlabLogo } from './XlabLogo';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface SettingsViewProps {
  cameras: PublicCameraConfig[];
  openAddToken?: number;
  onCamerasChanged: () => Promise<void>;
}

const EMPTY_CAMERA: Partial<CameraConfig> = {
  id: '',
  name: '',
  group: 'Exterior',
  go2rtcStreamName: '',
  onvifHost: '',
  onvifPort: 80,
  onvifUser: '',
  onvifPass: '',
  recordContinuous: false,
  detectObjects: false,
};

export function SettingsView({
  cameras,
  openAddToken = 0,
  onCamerasChanged,
}: SettingsViewProps) {
  const [settings, setSettings] = useState<NvrSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<CameraConfig>>(EMPTY_CAMERA);
  const [savingCamera, setSavingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestConnectionResult>>({});
  const [modalTestResult, setModalTestResult] = useState<TestConnectionResult | null>(null);
  const { isInstallable, isInstalled, isIOS, installing, promptInstall } = usePWAInstall();

  useEffect(() => {
    fetchSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (openAddToken > 0) {
      setEditingId(null);
      setForm({ ...EMPTY_CAMERA });
      setCameraError(null);
      setModalTestResult(null);
      setModalOpen(true);
    }
  }, [openAddToken]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      const updated = await saveSettings(settings);
      setSettings(updated);
      setSettingsMsg({ type: 'ok', text: 'Settings saved and camera workers synchronized.' });
    } catch (err) {
      setSettingsMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save settings',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setForm({ ...EMPTY_CAMERA });
    setCameraError(null);
    setModalTestResult(null);
    setModalOpen(true);
  };

  const openEditModal = (cam: PublicCameraConfig) => {
    setEditingId(cam.id);
    setForm({
      id: cam.id,
      name: cam.name,
      group: cam.group,
      go2rtcStreamName: cam.go2rtcStreamName,
      onvifHost: cam.onvifHost,
      onvifPort: cam.onvifPort,
      onvifUser: cam.onvifUser,
      onvifPass: cam.onvifPass,
      recordContinuous: cam.recordContinuous,
      detectObjects: cam.detectObjects,
    });
    setCameraError(null);
    setModalTestResult(null);
    setModalOpen(true);
  };

  const handleSaveCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCamera(true);
    setCameraError(null);
    try {
      if (editingId) {
        await updateCamera(editingId, form);
      } else {
        await createCamera(form);
      }
      await onCamerasChanged();
      setModalOpen(false);
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Failed to save camera');
    } finally {
      setSavingCamera(false);
    }
  };

  const handleDeleteCamera = async (camId: string) => {
    try {
      await deleteCamera(camId);
      await onCamerasChanged();
    } catch {
      // ignore
    }
  };

  const handleTestRow = async (cam: PublicCameraConfig) => {
    setTestingKey(cam.id);
    try {
      const res = await testCameraConnectionApi({
        id: cam.id,
        go2rtcStreamName: cam.go2rtcStreamName,
        onvifHost: cam.onvifHost,
        onvifPort: cam.onvifPort,
        onvifUser: cam.onvifUser,
        onvifPass: cam.onvifPass,
      });
      setTestResults((prev) => ({ ...prev, [cam.id]: res }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [cam.id]: {
          ok: false,
          go2rtc: { ok: false, error: err instanceof Error ? err.message : 'Test failed' },
          onvif: { ok: false, error: 'Not run' },
        },
      }));
    } finally {
      setTestingKey(null);
    }
  };

  const handleTestModal = async () => {
    setTestingKey('__modal__');
    setModalTestResult(null);
    setCameraError(null);
    try {
      const res = await testCameraConnectionApi({
        id: editingId || undefined,
        go2rtcStreamName: form.go2rtcStreamName || '',
        onvifHost: form.onvifHost || '',
        onvifPort: Number(form.onvifPort) || 80,
        onvifUser: form.onvifUser || '',
        onvifPass: form.onvifPass || '',
      });
      setModalTestResult(res);
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTestingKey(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-black">
      <header className="shrink-0 border-b border-zinc-900 bg-black pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 h-14">
          <h1 className="text-sm font-semibold text-zinc-100">Settings</h1>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1e293b] hover:bg-[#3b5998] border border-[#3b5998]/50 text-zinc-100 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Camera
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-black">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Cameras Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-100">Cameras</h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Configure go2rtc streams, 24/7 continuous recording, and ONVIF object detection.
                  New cameras default to Live Only mode.
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-zinc-500">
                {cameras.length} configured
              </span>
            </div>

            <div className="rounded-xl bg-[#121214] border border-zinc-800 overflow-hidden">
              {cameras.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-zinc-400 mb-4">
                    No cameras configured in{' '}
                    <span className="font-mono text-zinc-300">/data/cameras.json</span> yet.
                  </p>
                  <button
                    type="button"
                    onClick={openAddModal}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[#1e293b] hover:bg-[#3b5998] border border-[#3b5998]/50 text-zinc-100 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Add Camera
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {cameras.map((cam) => {
                    const testRes = testResults[cam.id];
                    const isLiveOnly = !cam.recordContinuous && !cam.detectObjects;
                    return (
                      <div key={cam.id} className="p-4 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-zinc-100 truncate">
                                {cam.name}
                              </span>
                              <span className="text-xs text-zinc-600">·</span>
                              <span className="text-xs text-zinc-400">{cam.group}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-zinc-500 mt-1">
                              <span>stream: {cam.go2rtcStreamName}</span>
                              {cam.onvifHost && (
                                <span>
                                  onvif: {cam.onvifHost}:{cam.onvifPort}
                                </span>
                              )}
                              {isLiveOnly ? (
                                <span className="text-[#7c9cf5]">mode: Live Only</span>
                              ) : (
                                <>
                                  <span className={cam.recordContinuous ? 'text-red-400' : ''}>
                                    24/7: {cam.recordContinuous ? 'On' : 'Off'}
                                  </span>
                                  <span className={cam.detectObjects ? 'text-emerald-400' : ''}>
                                    AI: {cam.detectObjects ? 'On' : 'Off'}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={testingKey === cam.id}
                              onClick={() => handleTestRow(cam)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {testingKey === cam.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <PlugZap className="w-3.5 h-3.5" />
                              )}
                              Test Connection
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(cam)}
                              aria-label={`Edit ${cam.name}`}
                              className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCamera(cam.id)}
                              aria-label={`Delete ${cam.name}`}
                              className="p-2 rounded-lg bg-zinc-900 hover:bg-red-950/60 border border-zinc-800 text-zinc-400 hover:text-red-300 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {testRes && <ConnectionTestSummary result={testRes} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* System & Retention Settings */}
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-100">System & Retention</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Stored locally in{' '}
                <span className="font-mono text-zinc-300">/data/settings.json</span>. Hourly
                cleanup prunes expired recordings automatically.
              </p>
            </div>

            {settings && (
              <form
                onSubmit={handleSaveSettings}
                className="rounded-xl bg-[#121214] border border-zinc-800 p-5 space-y-5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      go2rtc HTTP URL
                    </label>
                    <input
                      type="url"
                      required
                      value={settings.go2rtcUrl}
                      onChange={(e) => setSettings({ ...settings, go2rtcUrl: e.target.value })}
                      placeholder="http://localhost:1984"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      go2rtc RTSP Host
                    </label>
                    <input
                      type="text"
                      required
                      value={settings.go2rtcRtspHost}
                      onChange={(e) =>
                        setSettings({ ...settings, go2rtcRtspHost: e.target.value })
                      }
                      placeholder="localhost:8554"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Continuous Retention (Days)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      required
                      value={settings.continuousRetentionDays}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          continuousRetentionDays: Number(e.target.value),
                        })
                      }
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Detection Clips Retention (Days)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      required
                      value={settings.clipRetentionDays}
                      onChange={(e) =>
                        setSettings({ ...settings, clipRetentionDays: Number(e.target.value) })
                      }
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Event Clip Duration (Seconds)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={180}
                      required
                      value={settings.clipDurationSeconds}
                      onChange={(e) =>
                        setSettings({ ...settings, clipDurationSeconds: Number(e.target.value) })
                      }
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Event Cooldown per Camera (Seconds)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={600}
                      required
                      value={settings.eventCooldownSeconds}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          eventCooldownSeconds: Number(e.target.value),
                        })
                      }
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>
                </div>

                {settingsMsg && (
                  <div
                    className={`flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-xs border ${
                      settingsMsg.type === 'ok'
                        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                        : 'bg-red-500/10 border-red-500/25 text-red-300'
                    }`}
                  >
                    {settingsMsg.type === 'ok' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{settingsMsg.text}</span>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#1e293b] hover:bg-[#3b5998] border border-[#3b5998]/50 disabled:opacity-50 text-zinc-100 transition-colors cursor-pointer"
                  >
                    {savingSettings ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save Settings
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* About Xlab-nvr Section */}
          <section className="rounded-xl bg-[#121214] border border-zinc-800 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <XlabLogo className="w-10 h-10 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Xlab-nvr</h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Self-hosted single-container NVR · Local JSON config, SQLite index, FFmpeg
                  stream-copy recording, ONVIF hardware AI, and go2rtc WebSocket MSE streaming.
                </p>
              </div>
            </div>
            <div className="text-xs font-mono text-zinc-500 shrink-0 space-y-0.5 sm:text-right">
              <p>Config: /data/cameras.json</p>
              <p>Index: /data/nvr.db</p>
              <p>Storage: /recordings</p>
            </div>
          </section>

          {/* Compact Install App (PWA) Card */}
          <section className="rounded-xl bg-[#121214] border border-zinc-800 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-[#7c9cf5]">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-100">Install App (PWA)</h2>
                  {isInstalled && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 border border-emerald-500/25 text-emerald-300">
                      <CheckCircle2 className="w-3 h-3" />
                      Installed (Standalone Mode)
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {isInstalled
                    ? 'Xlab-nvr is running full-screen in standalone app mode.'
                    : isInstallable
                      ? 'Add Xlab-nvr to your home screen or desktop for full-screen live monitoring without browser bars.'
                      : isIOS
                        ? 'Install on iPhone or iPad for full-screen standalone mode without Safari bars.'
                        : 'Install from your browser address bar or menu to launch Xlab-nvr in standalone mode (requires HTTPS or localhost).'}
                </p>
              </div>
            </div>

            <div className="shrink-0">
              {isInstalled ? null : isInstallable ? (
                <button
                  type="button"
                  disabled={installing}
                  onClick={() => void promptInstall()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-[#1e293b] hover:bg-[#3b5998] border border-[#3b5998]/50 disabled:opacity-50 text-zinc-100 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {installing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Install Xlab-nvr
                </button>
              ) : isIOS ? (
                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
                  <Share className="w-3.5 h-3.5 text-[#7c9cf5] shrink-0" />
                  <span>
                    Tap <strong className="text-zinc-100 font-medium">Share</strong> →{' '}
                    <strong className="text-zinc-100 font-medium">Add to Home Screen</strong>
                  </span>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400">
                  Browser Menu → Install
                </span>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Add / Edit Camera Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? 'Edit camera' : 'Add camera'}
          onClick={() => setModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSaveCamera}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-xl bg-[#18181b] border border-zinc-800 overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-100">
                {editingId ? `Edit Camera (${editingId})` : 'Add Camera'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close dialog"
                className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Camera Name
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name || ''}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Front Door"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Group</label>
                  <input
                    type="text"
                    value={form.group || ''}
                    onChange={(e) => setForm({ ...form, group: e.target.value })}
                    placeholder="Exterior"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                  />
                </div>

                {!editingId && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Camera ID (optional slug)
                    </label>
                    <input
                      type="text"
                      value={form.id || ''}
                      onChange={(e) => setForm({ ...form, id: e.target.value })}
                      placeholder="front_door"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>
                )}

                <div className={editingId ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    go2rtc Stream Name
                  </label>
                  <input
                    type="text"
                    required
                    value={form.go2rtcStreamName || ''}
                    onChange={(e) => setForm({ ...form, go2rtcStreamName: e.target.value })}
                    placeholder="front_door_main"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                  />
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <p className="text-xs font-medium text-zinc-300 mb-3">
                  ONVIF Hardware Detection Service
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-zinc-400 mb-1">ONVIF Host / IP</label>
                    <input
                      type="text"
                      value={form.onvifHost || ''}
                      onChange={(e) => setForm({ ...form, onvifHost: e.target.value })}
                      placeholder="192.168.1.50"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Port</label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={form.onvifPort ?? 80}
                      onChange={(e) => setForm({ ...form, onvifPort: Number(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">ONVIF Username</label>
                    <input
                      type="text"
                      value={form.onvifUser || ''}
                      onChange={(e) => setForm({ ...form, onvifUser: e.target.value })}
                      placeholder="admin"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">ONVIF Password</label>
                    <input
                      type="password"
                      value={form.onvifPass || ''}
                      onChange={(e) => setForm({ ...form, onvifPass: e.target.value })}
                      placeholder={editingId ? 'Leave unchanged' : '••••••••'}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#4f6bed]"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">24/7 Continuous Recording</p>
                    <p className="text-xs text-zinc-500">
                      Writes 5-minute stream-copy MP4 segments continuously to NAS.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(form.recordContinuous)}
                    onClick={() =>
                      setForm({ ...form, recordContinuous: !form.recordContinuous })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer ${
                      form.recordContinuous ? 'bg-red-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                        form.recordContinuous ? 'translate-x-5.5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Object Detection Clips</p>
                    <p className="text-xs text-zinc-500">
                      Listens to ONVIF hardware AI triggers and saves short event clips + snapshots.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(form.detectObjects)}
                    onClick={() => setForm({ ...form, detectObjects: !form.detectObjects })}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer ${
                      form.detectObjects ? 'bg-emerald-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                        form.detectObjects ? 'translate-x-5.5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {!form.recordContinuous && !form.detectObjects && (
                  <p className="text-xs text-[#7c9cf5]">
                    Live Only mode active: zero FFmpeg recording processes and zero ONVIF polling.
                  </p>
                )}
              </div>

              {modalTestResult && <ConnectionTestSummary result={modalTestResult} />}

              {cameraError && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/25 px-3 py-2 text-xs text-red-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{cameraError}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 bg-[#121214] border-t border-zinc-800">
              <button
                type="button"
                disabled={testingKey === '__modal__' || !form.go2rtcStreamName}
                onClick={handleTestModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 text-zinc-100 transition-colors cursor-pointer"
              >
                {testingKey === '__modal__' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PlugZap className="w-3.5 h-3.5" />
                )}
                Test Connection
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCamera}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[#3b5998] hover:bg-[#4f6bed] disabled:opacity-50 text-white cursor-pointer"
                >
                  {savingCamera && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editingId ? 'Save Changes' : 'Add Camera'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function ConnectionTestSummary({ result }: { result: TestConnectionResult }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
      <div
        className={`rounded-lg px-3 py-2 border flex items-start gap-2 ${
          result.go2rtc.ok
            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
            : 'bg-red-500/10 border-red-500/25 text-red-300'
        }`}
      >
        {result.go2rtc.ok ? (
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <p className="font-medium">go2rtc Frame Snapshot</p>
          <p className="opacity-80 truncate font-mono text-[11px]">
            {result.go2rtc.ok
              ? `HTTP ${result.go2rtc.status} · ${result.go2rtc.bytes} bytes`
              : result.go2rtc.error}
          </p>
        </div>
      </div>

      <div
        className={`rounded-lg px-3 py-2 border flex items-start gap-2 ${
          result.onvif.skipped
            ? 'bg-zinc-900 border-zinc-800 text-zinc-400'
            : result.onvif.ok
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
              : 'bg-red-500/10 border-red-500/25 text-red-300'
        }`}
      >
        {result.onvif.skipped ? (
          <PlugZap className="w-4 h-4 shrink-0 mt-0.5 text-zinc-500" />
        ) : result.onvif.ok ? (
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <p className="font-medium">ONVIF Event Service</p>
          <p className="opacity-80 truncate font-mono text-[11px]">
            {result.onvif.skipped
              ? 'Skipped (no ONVIF host configured)'
              : result.onvif.ok
                ? [result.onvif.manufacturer, result.onvif.model].filter(Boolean).join(' ') ||
                  'Authenticated'
                : result.onvif.error}
          </p>
        </div>
      </div>
    </div>
  );
}
