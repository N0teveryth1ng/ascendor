import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Pinned to IPv4: the default `localhost` binds ::1 only on Windows, which
    // makes 127.0.0.1 probes (and the e2e harness) fail against a live server.
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      // Proxying keeps the browser same-origin, so the httpOnly session cookie
      // is sent without any CORS handling. FORGE_API lets the e2e harness aim
      // a throwaway API instance instead of the developer's own on 5174.
      '/api': {
        target: process.env.FORGE_API ?? 'http://127.0.0.1:5174',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Charts are only used on the progress and teacher screens, so they
        // are split out rather than shipped in the initial candidate bundle.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'charts';
          if (/node_modules[\\/](react|react-dom|react-is|scheduler)[\\/]/.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
