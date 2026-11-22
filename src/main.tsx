import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initPWAInstallListener } from './hooks/usePWAInstall.ts';

initPWAInstallListener();

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => {
        // Ignore registration failure on unsupported or non-secure origins
      });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
