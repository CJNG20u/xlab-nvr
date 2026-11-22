import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

interface PWAInstallSnapshot {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstalled: boolean;
  isIOS: boolean;
  isSafari: boolean;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isClassicIOS = /iPad|iPhone|iPod/.test(ua);
  const isIPadOSDesktopUA =
    navigator.platform === 'MacIntel' &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1;
  return isClassicIOS || isIPadOSDesktopUA;
}

function detectSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/i.test(ua);
}

let initialized = false;
let state: PWAInstallSnapshot = {
  deferredPrompt: null,
  isInstalled: false,
  isIOS: false,
  isSafari: false,
};

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function initPWAInstallListener(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  state = {
    deferredPrompt: null,
    isInstalled: detectStandalone(),
    isIOS: detectIOS(),
    isSafari: detectSafari(),
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state = {
      ...state,
      deferredPrompt: event as BeforeInstallPromptEvent,
    };
    notify();
  });

  window.addEventListener('appinstalled', () => {
    state = {
      ...state,
      deferredPrompt: null,
      isInstalled: true,
    };
    notify();
  });

  const mediaQuery = window.matchMedia('(display-mode: standalone)');
  const onDisplayModeChange = (ev: MediaQueryListEvent) => {
    state = {
      ...state,
      isInstalled: ev.matches || window.navigator.standalone === true,
    };
    notify();
  };
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onDisplayModeChange);
  }
}

export function usePWAInstall() {
  const [snapshot, setSnapshot] = useState<PWAInstallSnapshot>(() => {
    initPWAInstallListener();
    return state;
  });
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    initPWAInstallListener();
    const onUpdate = () => setSnapshot(state);
    listeners.add(onUpdate);
    setSnapshot(state);
    return () => {
      listeners.delete(onUpdate);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const deferred = state.deferredPrompt;
    if (!deferred) return 'unavailable';
    setInstalling(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      state = {
        ...state,
        deferredPrompt: null,
        isInstalled: choice.outcome === 'accepted' ? true : state.isInstalled,
      };
      notify();
      return choice.outcome;
    } finally {
      setInstalling(false);
    }
  }, []);

  return {
    isInstallable: snapshot.deferredPrompt !== null && !snapshot.isInstalled,
    isInstalled: snapshot.isInstalled,
    isIOS: snapshot.isIOS,
    isSafari: snapshot.isSafari,
    installing,
    promptInstall,
  };
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
