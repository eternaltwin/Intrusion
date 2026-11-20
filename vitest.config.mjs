import { defineConfig } from 'vitest/config';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || path.join(os.tmpdir(), 'intrusion-vite-cache'),
  resolve: {
    alias: {
      '@intrusion/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
  },
});
