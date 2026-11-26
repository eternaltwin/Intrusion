import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import type { EtwinOauthConfig } from './services/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const envFilePath = path.join(repoRoot, '.env');
if (fs.existsSync(envFilePath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFilePath);
}

const isProduction = process.env.NODE_ENV === 'production';
const port = parseInt(process.env.PORT ?? '8001', 10);
const publicUrl =
  process.env.PUBLIC_URL ?? (isProduction ? `http://localhost:${port}` : 'http://localhost:5173');
const sourceRepoUrl =
  process.env.SOURCE_REPO_URL ?? 'https://github.com/eternaltwin/intrusion';
const dbPath = process.env.DB_PATH ?? path.join(repoRoot, 'data', 'intrusion.sqlite');
const assetsDir = path.join(repoRoot, 'assets');
const clientDistDir = path.join(repoRoot, 'packages', 'client', 'dist');

const etwinUrl = process.env.ETWIN_URL ?? 'https://eternaltwin.org';
const etwinExternalUrl = process.env.ETWIN_EXTERNAL_URL ?? etwinUrl;
const etwinClientId = (process.env.ETWIN_CLIENT_ID ?? '').trim();
const etwinClientSecret = (process.env.ETWIN_CLIENT_SECRET ?? '').trim();
const etwinCallbackUrl =
  process.env.ETWIN_CALLBACK_URL ?? `${publicUrl.replace(/\/+$/, '')}/api/auth/etwin/callback`;

const etwinOauth: EtwinOauthConfig | undefined =
  etwinClientId && etwinClientSecret
    ? {
        internalUrl: etwinUrl,
        externalUrl: etwinExternalUrl,
        clientId: etwinClientId,
        clientSecret: etwinClientSecret,
        callbackUrl: etwinCallbackUrl,
        scope: process.env.ETWIN_OAUTH_SCOPE ?? 'base',
      }
    : undefined;

if (isProduction && !etwinOauth) {
  console.warn(
    '[Intrusion Server] ATTENTION: NODE_ENV=production mais ETWIN_CLIENT_ID / ETWIN_CLIENT_SECRET ne sont pas configurés.'
  );
}

const allowDevAuth =
  !isProduction && (!etwinOauth || process.env.ETWIN_DEV_AUTH === 'true');

const { app } = createApp({
  dbPath,
  assetsDir,
  clientDistDir,
  isProduction,
  publicUrl,
  sourceRepoUrl,
  etwinOauth,
  allowDevAuth,
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[Intrusion Server] Listening on http://localhost:${info.port} (mode=${isProduction ? 'production' : 'development'}, etwinOauth=${Boolean(etwinOauth)}, devAuth=${allowDevAuth})`
  );
});
