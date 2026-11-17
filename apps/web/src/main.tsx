import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { diagnostics, installGlobalErrorLogging } from './app/diagnostics';
import './styles/theme.css';

installGlobalErrorLogging();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support (PLAT-4): the service worker caches same-origin files as they are used. Production builds only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
    diagnostics.log('warn', 'pwa', 'Service worker registration failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
  });
}
