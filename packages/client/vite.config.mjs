import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    assetsDir: 'static',
  },
  resolve: {
    alias: {
      '@intrusion/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8001',
      '/assets': 'http://127.0.0.1:8001',
      '/img': 'http://127.0.0.1:8001',
      '/img_faces': 'http://127.0.0.1:8001',
      '/img_cine': 'http://127.0.0.1:8001',
      '/sfx': 'http://127.0.0.1:8001',
      '/fonts': 'http://127.0.0.1:8001',
      '/shapes': 'http://127.0.0.1:8001',
      '/shapes_svg': 'http://127.0.0.1:8001',
      '/vendor': 'http://127.0.0.1:8001',
      '/design.css': 'http://127.0.0.1:8001',
      '/style.css': 'http://127.0.0.1:8001',
      '/fonts.css': 'http://127.0.0.1:8001',
      '/intrusion-engine.js': 'http://127.0.0.1:8001',
      '/client_img': 'http://127.0.0.1:8001',
    },
  },
});
