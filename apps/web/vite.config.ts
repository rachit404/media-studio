import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { securityHeaders } from './security-headers.ts';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(process.env['npm_package_version'] ?? '0.0.0') },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  server: { port: 5173 },
  // The preview server serves the production build with the production security headers,
  // so the e2e suite exercises the real CSP.
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, headers: securityHeaders },
});
