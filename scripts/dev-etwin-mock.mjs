#!/usr/bin/env node
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = parseInt(process.env.ETERNALTWIN_MOCK_PORT ?? '8002', 10);
const EXPECTED_CLIENT_ID = process.env.ETERNALTWIN_CLIENT_ID ?? 'intrusion@clients';
const EXPECTED_CLIENT_SECRET = process.env.ETERNALTWIN_CLIENT_SECRET ?? 'dev_secret';
const EXPECTED_CALLBACK_URI =
  process.env.ETERNALTWIN_CALLBACK_URL ?? 'http://localhost:5173/api/auth/eternaltwin/callback';

/** @type {Map<string, { username: string; redirectUri: string; expiresAt: number }>} */
const authCodes = new Map();
/** @type {Map<string, { username: string; userId: string; expiresAt: number }>} */
const accessTokens = new Map();

function userIdFromName(name) {
  return `dev:${name.trim().toLowerCase()}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // 1. GET /oauth/authorize — Consentement OAuth 2.0 simulé
  if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
    const responseType = url.searchParams.get('response_type');
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state') ?? '';
    const scope = url.searchParams.get('scope') ?? 'base';

    if (responseType !== 'code' || clientId !== EXPECTED_CLIENT_ID || redirectUri !== EXPECTED_CALLBACK_URI) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        `Paramètres OAuth invalides.\nAttendu: client_id=${EXPECTED_CLIENT_ID}, redirect_uri=${EXPECTED_CALLBACK_URI}\nReçu: client_id=${clientId}, redirect_uri=${redirectUri}`
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Eternaltwin (Local :${PORT}) — Autorisation OAuth</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #18141c; color: #f2eef7; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
    .card { background: #26202e; border: 1px solid #4a3d59; border-radius: 8px; padding: 24px; width: 380px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
    h1 { font-size: 18px; margin: 0 0 8px; color: #ff5c6c; }
    p { font-size: 13px; line-height: 1.45; color: #cfc6dc; }
    label { display: block; font-size: 12px; margin: 14px 0 6px; color: #e6def0; }
    input[type="text"] { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 4px; border: 1px solid #5c4d6e; background: #141018; color: #fff; font-size: 14px; }
    .actions { display: flex; gap: 10px; margin-top: 18px; }
    button { flex: 1; padding: 9px 12px; border-radius: 4px; border: 0; font-weight: 600; cursor: pointer; font-size: 13px; }
    .allow { background: #e84558; color: #fff; }
    .deny { background: #3b3246; color: #ddd; }
    code { font-size: 11px; color: #ffb3bc; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Eternaltwin OAuth (Local)</h1>
    <p>L'application <strong>Intrusion</strong> (<code>${escapeHtml(clientId)}</code>) demande l'accès <code>${escapeHtml(scope)}</code> à votre identité Eternaltwin.</p>
    <form method="POST" action="/oauth/authorize/decision">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <label for="username">Compte Eternaltwin simulé :</label>
      <input id="username" name="username" type="text" value="Dorios" minlength="2" maxlength="32" required />
      <div class="actions">
        <button class="allow" type="submit" name="decision" value="allow">Autoriser</button>
        <button class="deny" type="submit" name="decision" value="deny">Refuser</button>
      </div>
    </form>
  </div>
</body>
</html>`);
    return;
  }

  // 2. POST /oauth/authorize/decision — Redirection vers callback_uri
  if (req.method === 'POST' && url.pathname === '/oauth/authorize/decision') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const form = new URLSearchParams(raw);
      const redirectUri = form.get('redirect_uri') ?? '';
      const state = form.get('state') ?? '';
      const decision = form.get('decision');
      const username = (form.get('username') ?? 'Dorios').trim().slice(0, 32) || 'Dorios';

      if (redirectUri !== EXPECTED_CALLBACK_URI) {
        res.writeHead(400);
        res.end('Invalid redirect_uri');
        return;
      }

      const cb = new URL(redirectUri);
      if (state) cb.searchParams.set('state', state);

      if (decision !== 'allow') {
        cb.searchParams.set('error', 'access_denied');
        res.writeHead(302, { Location: cb.toString() });
        res.end();
        return;
      }

      const code = randomBytes(24).toString('hex');
      authCodes.set(code, {
        username,
        redirectUri,
        expiresAt: Date.now() + 60_000,
      });
      cb.searchParams.set('code', code);
      res.writeHead(302, { Location: cb.toString() });
      res.end();
    });
    return;
  }

  // 3. POST /oauth/token — Échange authorization_code -> access_token
  if (req.method === 'POST' && url.pathname === '/oauth/token') {
    const expectedBasic = Buffer.from(
      `${EXPECTED_CLIENT_ID}:${EXPECTED_CLIENT_SECRET}`,
      'utf8'
    ).toString('base64');
    if (req.headers.authorization !== `Basic ${expectedBasic}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_client' }));
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const params = new URLSearchParams(raw);
      const grantType = params.get('grant_type');
      const code = params.get('code') ?? '';
      const redirectUri = params.get('redirect_uri') ?? '';
      const record = authCodes.get(code);
      authCodes.delete(code);

      if (
        grantType !== 'authorization_code' ||
        !record ||
        record.expiresAt < Date.now() ||
        record.redirectUri !== redirectUri
      ) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }

      const token = randomBytes(24).toString('hex');
      accessTokens.set(token, {
        username: record.username,
        userId: userIdFromName(record.username),
        expiresAt: Date.now() + 3600_000,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: token,
          token_type: 'Bearer',
          expires_in: 3600,
        })
      );
    });
    return;
  }

  // 4. GET /api/v1/auth/self — AccessTokenAuthContext Eternaltwin
  if (req.method === 'GET' && url.pathname === '/api/v1/auth/self') {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const session = accessTokens.get(token);

    if (!session || session.expiresAt < Date.now()) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'AccessToken',
        scope: 'Default',
        client: {
          type: 'OauthClient',
          id: '00000000-0000-0000-0000-000000000001',
          key: EXPECTED_CLIENT_ID,
          display_name: 'Intrusion',
        },
        user: {
          type: 'User',
          id: session.userId,
          display_name: {
            current: { value: session.username },
          },
        },
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(
    `[Mock Eternaltwin OAuth] Prêt sur http://localhost:${PORT} (client_id=${EXPECTED_CLIENT_ID})`
  );
});
