import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const port = parseInt(process.env.PORT ?? '8001', 10);
const dbPath = process.env.DB_PATH ?? path.join(repoRoot, 'data', 'intrusion.sqlite');
const assetsDir = path.join(repoRoot, 'assets');
const clientDistDir = path.join(repoRoot, 'packages', 'client', 'dist');

const { app } = createApp({
  dbPath,
  assetsDir,
  clientDistDir,
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[Intrusion Server] Listening on http://localhost:${info.port}`);
});
