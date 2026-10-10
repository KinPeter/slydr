import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev topology (spec §2.2): Vite serves the UI on 5173 and proxies every
 * /api request to the Express API on 127.0.0.1:4317. The browser therefore
 * only ever talks to one origin, which is why CORS is never enabled
 * anywhere in Slydr (spec §3.4).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    open: false, // the root `dev:client` script passes --open; see section 4.7
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: false,
        ws: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false, ws: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    // Raw (uncompressed) kB per chunk. This only silences/raises Vite's own warning;
    // the NFR-8 gzip target is reported (not enforced) by `npm run size:client` (section 4.9).
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
