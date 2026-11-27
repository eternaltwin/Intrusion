import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { openDatabaseFromEnv } from './db/database.js';
import type { EternaltwinOauthConfig } from './services/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const envCandidates = [
  process.env.ENV_FILE,
  path.resolve(process.cwd(), '.env'),
  path.join(repoRoot, '.env'),
].filter((p): p is string => Boolean(p));

if (typeof process.loadEnvFile === 'function') {
  const seen = new Set<string>();
  for (const candidate of envCandidates) {
    const resolved = path.resolve(candidate);
    if (!seen.has(resolved) && fs.existsSync(resolved)) {
      seen.add(resolved);
      process.loadEnvFile(resolved);
    }
  }
}

const isProduction =
  process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
const host = process.env.HOST?.trim() || undefined;
const port = parseInt(process.env.PORT ?? '8001', 10);
const publicUrl =
  process.env.SELF_URL?.trim() ||
  process.env.SELF_API_URL?.trim() ||
  process.env.PUBLIC_URL?.trim() ||
  (isProduction ? `http://localhost:${port}` : 'http://localhost:5173');
const sourceRepoUrl =
  process.env.SOURCE_REPO_URL ?? 'https://github.com/eternaltwin/intrusion';
const assetsDir = path.join(repoRoot, 'assets');
const clientDistDir = path.join(repoRoot, 'packages', 'client', 'dist');

function cleanEnvSecret(raw: string | undefined): string {
  const val = (raw ?? '').trim();
  if (!val || (val.startsWith('<') && val.endsWith('>'))) return '';
  return val;
}

const eternaltwinUrl = process.env.ETERNALTWIN_URL ?? 'https://eternaltwin.org';
const eternaltwinExternalUrl = process.env.ETERNALTWIN_EXTERNAL_URL ?? eternaltwinUrl;
const eternaltwinClientId = cleanEnvSecret(process.env.ETERNALTWIN_CLIENT_ID);
const eternaltwinClientSecret = cleanEnvSecret(process.env.ETERNALTWIN_CLIENT_SECRET);
const eternaltwinCallbackUrl =
  process.env.ETERNALTWIN_CALLBACK_URL ??
  `${publicUrl.replace(/\/+$/, '')}/api/auth/eternaltwin/callback`;

if (
  (process.env.ETERNALTWIN_CLIENT_ID?.includes('<') ||
    process.env.ETERNALTWIN_CLIENT_SECRET?.includes('<')) &&
  (!eternaltwinClientId || !eternaltwinClientSecret)
) {
  console.warn(
    '[Intrusion Server] ETERNALTWIN_CLIENT_ID / ETERNALTWIN_CLIENT_SECRET contiennent encore des placeholders (<...>) dans .env : OAuth Eternaltwin ignoré jusqu’à configuration réelle.'
  );
}

const eternaltwinOauth: EternaltwinOauthConfig | undefined =
  eternaltwinClientId && eternaltwinClientSecret
    ? {
        internalUrl: eternaltwinUrl,
        externalUrl: eternaltwinExternalUrl,
        clientId: eternaltwinClientId,
        clientSecret: eternaltwinClientSecret,
        callbackUrl: eternaltwinCallbackUrl,
        scope: process.env.ETERNALTWIN_OAUTH_SCOPE ?? 'base',
      }
    : undefined;

if (isProduction && !eternaltwinOauth) {
  console.warn(
    '[Intrusion Server] ATTENTION: NODE_ENV=production mais ETERNALTWIN_CLIENT_ID / ETERNALTWIN_CLIENT_SECRET ne sont pas configurés.'
  );
}

const allowDevAuth =
  !isProduction && (!eternaltwinOauth || process.env.ETERNALTWIN_DEV_AUTH === 'true');

const db = await openDatabaseFromEnv(process.env, isProduction, repoRoot);

const { app } = await createApp({
  db,
  assetsDir,
  clientDistDir,
  isProduction,
  publicUrl,
  sourceRepoUrl,
  eternaltwinOauth,
  allowDevAuth,
});

const httpServer = serve(
  { fetch: app.fetch, port, ...(host ? { hostname: host } : {}) },
  (info) => {
    console.log(
      `[Intrusion Server] Listening on http://${host ?? 'localhost'}:${info.port} (mode=${isProduction ? 'production' : 'development'}, eternaltwinOauth=${Boolean(eternaltwinOauth)}, devAuth=${allowDevAuth})`
    );
  }
);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close();
  await db.close().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
