import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Throwaway spike server. Serves every folder under spikes/ (each spike has its own index.html).
// Fixtures are served from /fixtures/. No cross-origin isolation: ADR-0007 says the core path must not need it.
export default defineConfig({
  root: resolve(import.meta.dirname),
  server: { port: 5199, strictPort: true, host: '127.0.0.1', fs: { strict: false } },
  optimizeDeps: { exclude: ['mediabunny'] },
  build: { target: 'es2022' },
});
