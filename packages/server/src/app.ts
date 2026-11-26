import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import {
  ADD_DECK_COST,
  ADD_SLOT_COST,
  buildMissionCards,
  BuyItemSchema,
  DevAuthLoginSchema,
  FORBIDDEN_CHALLENGE_VIRUSES,
  generateMission,
  getAdjustedPrime,
  getChallengeMaxSlots,
  getMissionDifficultyLabel,
  getMissionRefreshCost,
  isChipsetAllowedInChallenge,
  isVirusAllowedInChallenge,
  MissionEndPayloadSchema,
  Rand,
  RedeemCardByNumberSchema,
  RedeemCardSchema,
  SaveChallengeLoadoutSchema,
  SaveDeckSchema,
  SellPackSchema,
  SetChipsetSchema,
  UpdateProfileSchema,
  type AuthConfigDto,
  type LangCode,
  type MissionInitParams,
  type PlayerDto,
} from '@intrusion/shared';
import { openDatabase } from './db/database.js';
import { getCatalog } from './catalog.js';
import {
  buildEtwinAuthorizationUrl,
  buildPlayerDto,
  createOauthState,
  createSession,
  deleteSession,
  exchangeEtwinCodeForIdentity,
  getUserIdFromSession,
  SESSION_TTL_SECONDS,
  upsertEtwinUser,
  verifyOauthState,
  type EtwinOauthConfig,
} from './services/auth.js';

export const BIOS_COSTS = [0, 0, 6000, 15000, 35000] as const; // index = target bios level (2, 3, 4)
const SESSION_COOKIE = 'intrusion_sid';
const OAUTH_STATE_COOKIE = 'intrusion_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 60 * 10; // 10 minutes
const DAILY_PACK_QUOTA = 20;
const DEFAULT_SOURCE_REPO_URL = 'https://github.com/eternaltwin/intrusion';
const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_CLIENT_GOALS = new Set([
  'av',
  'crash',
  'corrup',
  'log',
  'passwd',
  'eextra',
  'mextra',
]);

type AppVariables = {
  userId: number;
  player: PlayerDto;
};

export interface CreateAppOptions {
  dbPath: string;
  assetsDir: string;
  clientDistDir?: string;
  isProduction?: boolean;
  publicUrl?: string;
  sourceRepoUrl?: string;
  etwinOauth?: EtwinOauthConfig;
  allowDevAuth?: boolean;
  fetchImpl?: typeof globalThis.fetch;
}

function todayDateStr(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseTutorialLevel(missionKey: string): number | null {
  if (missionKey === 'tuto_1') return 1;
  if (missionKey === 'tuto_2') return 2;
  if (missionKey === 'tuto_3') return 3;
  return null;
}

function buildOwnedVirusCounts(player: PlayerDto): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const vid of player.viruses) {
    counts[vid] = (counts[vid] ?? 0) + 1;
  }
  return counts;
}

function dailySeedFromDate(dateStr: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 8999999 + 1000000;
}

function getDailyMarketMultipliers(dateStr: string, valuableIds: string[]): Record<string, number> {
  const rng = Rand.fromSeed(dailySeedFromDate(dateStr) ^ 0x7712ab);
  const out: Record<string, number> = {};
  for (const id of valuableIds) {
    // 0.85x to 1.30x daily black market fluctuation
    out[id] = Math.round((0.85 + (rng.random(46) / 100)) * 100) / 100;
  }
  return out;
}

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

export function createApp(opts: CreateAppOptions) {
  const db = openDatabase(opts.dbPath);
  const defaultBundle = getCatalog(opts.assetsDir, 'fr');
  const toPlayerDto = (uid: number) => buildPlayerDto(db, uid, defaultBundle);
  const app = new Hono<{ Variables: AppVariables }>();

  const isProduction = Boolean(opts.isProduction);
  const sourceRepoUrl = opts.sourceRepoUrl ?? DEFAULT_SOURCE_REPO_URL;
  const etwinOauth = opts.etwinOauth;
  const devAuthEnabled = !isProduction && (opts.allowDevAuth ?? !etwinOauth);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const authConfigDto: AuthConfigDto = {
    etwinEnabled: Boolean(etwinOauth),
    etwinAuthorizePath: '/api/auth/etwin/login',
    devAuthEnabled,
    sourceRepoUrl,
  };

  let configuredPublicHost: string | null = null;
  if (opts.publicUrl) {
    try {
      configuredPublicHost = new URL(opts.publicUrl).host.toLowerCase();
    } catch {
      configuredPublicHost = null;
    }
  }

  function isHttpsRequest(c: Context): boolean {
    if (isProduction) return true;
    const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    if (forwardedProto === 'https') return true;
    return c.req.url.startsWith('https://');
  }

  function setSessionCookie(c: Context, rawToken: string): void {
    setCookie(c, SESSION_COOKIE, rawToken, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttpsRequest(c),
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
  }

  // --- Sliding-Window Rate Limiter (protects shared Eternaltwin infrastructure — Art. 4 & 6) ---
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  let lastBucketCleanup = Date.now();

  function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    if (now - lastBucketCleanup > 60_000) {
      lastBucketCleanup = now;
      for (const [k, v] of rateBuckets) {
        if (v.resetAt <= now) rateBuckets.delete(k);
      }
    }
    const existing = rateBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (existing.count >= maxRequests) return false;
    existing.count += 1;
    return true;
  }

  // --- Sanitized Error Handler (never logs OAuth codes, tokens, or stack secrets — Art. 4) ---
  app.onError((err, c) => {
    const safeMsg = (err?.message ?? 'Internal Error').replace(
      /(Bearer\s+|access_token=|code=|intrusion_sid=)[^\s&;"]+/gi,
      '$1[REDACTED]'
    );
    console.error(`[Intrusion Server Error] ${c.req.method} ${c.req.path}: ${safeMsg}`);
    return c.json({ error: 'Erreur interne du serveur.' }, 500);
  });

  // --- Global HTTP Security Headers (Art. 4) ---
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    c.header('Content-Security-Policy', CSP_HEADER);
    if (isHttpsRequest(c)) {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  // --- API Rate Limiting & CSRF Origin Protection on State-Changing Requests ---
  app.use('/api/*', async (c, next) => {
    const clientIp =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip')?.trim() ||
      'local';
    const isAuthRoute = c.req.path.startsWith('/api/auth/');
    const allowed = isAuthRoute
      ? checkRateLimit(`auth:${clientIp}`, 60, 60_000)
      : checkRateLimit(`api:${clientIp}`, 600, 60_000);
    if (!allowed) {
      return c.json({ error: 'Trop de requêtes. Veuillez patienter un instant.' }, 429);
    }

    if (STATE_CHANGING_METHODS.has(c.req.method.toUpperCase())) {
      const secFetchSite = c.req.header('sec-fetch-site')?.toLowerCase();
      if (secFetchSite === 'cross-site') {
        return c.json({ error: 'Requête cross-site refusée (protection CSRF).' }, 403);
      }
      const origin = c.req.header('origin');
      if (origin) {
        let originHost: string;
        try {
          originHost = new URL(origin).host.toLowerCase();
        } catch {
          return c.json({ error: 'En-tête Origin invalide.' }, 403);
        }
        const reqHost = (
          c.req.header('x-forwarded-host')?.split(',')[0]?.trim() ||
          c.req.header('host') ||
          new URL(c.req.url).host
        ).toLowerCase();
        if (originHost !== reqHost && originHost !== configuredPublicHost) {
          return c.json({ error: 'Origine non autorisée (protection CSRF).' }, 403);
        }
      }
    }

    return next();
  });

  // --- Auth Endpoints (Exclusive Eternaltwin OAuth 2.0 in Production — Charte Art. 4) ---
  app.get('/api/auth/etwin/login', (c) => {
    if (!etwinOauth) {
      return c.redirect('/?auth_error=etwin_not_configured', 302);
    }
    const state = createOauthState();
    setCookie(c, OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttpsRequest(c),
      path: '/api/auth/etwin/callback',
      maxAge: OAUTH_STATE_TTL_SECONDS,
    });
    return c.redirect(buildEtwinAuthorizationUrl(etwinOauth, state), 302);
  });

  app.get('/api/auth/etwin/callback', async (c) => {
    const cookieState = getCookie(c, OAUTH_STATE_COOKIE);
    deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/api/auth/etwin/callback' });

    if (!etwinOauth) {
      return c.redirect('/?auth_error=etwin_not_configured', 302);
    }
    if (c.req.query('error')) {
      return c.redirect('/?auth_error=oauth_denied', 302);
    }

    const queryState = c.req.query('state');
    const code = c.req.query('code');
    if (!code || !verifyOauthState(cookieState, queryState)) {
      return c.redirect('/?auth_error=invalid_state', 302);
    }

    try {
      const identity = await exchangeEtwinCodeForIdentity(etwinOauth, code, fetchImpl);
      const catalog = getCatalog(opts.assetsDir, 'fr');
      const userId = upsertEtwinUser(db, catalog, identity.etwinUserId, identity.displayName);
      const rawSessionToken = createSession(db, userId);
      setSessionCookie(c, rawSessionToken);
      return c.redirect('/', 302);
    } catch (err) {
      const safeMsg = (err instanceof Error ? err.message : 'OAuth failure').replace(
        /(Bearer\s+|access_token=|code=)[^\s&;"]+/gi,
        '$1[REDACTED]'
      );
      console.error(`[Intrusion OAuth Callback] ${safeMsg}`);
      return c.redirect('/?auth_error=oauth_exchange_failed', 302);
    }
  });

  app.post('/api/auth/dev-login', zValidator('json', DevAuthLoginSchema), (c) => {
    if (!devAuthEnabled) {
      return c.json(
        {
          error:
            "L'authentification locale est désactivée : veuillez vous connecter exclusivement via Eternaltwin (OAuth 2.0).",
        },
        403
      );
    }
    const { username } = c.req.valid('json');
    const catalog = getCatalog(opts.assetsDir, 'fr');
    const etwinUserId = `dev:${username.toLowerCase()}`;
    const userId = upsertEtwinUser(db, catalog, etwinUserId, username);
    const rawSessionToken = createSession(db, userId);
    setSessionCookie(c, rawSessionToken);
    return c.json({ player: toPlayerDto(userId), auth: authConfigDto }, 200);
  });

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const userId = getUserIdFromSession(db, token);
    if (!userId) return c.json({ player: null, auth: authConfigDto });
    return c.json({ player: toPlayerDto(userId), auth: authConfigDto });
  });

  // --- Public Catalog + Raw XML Bundle for Client Simulation ---
  app.get('/api/catalog', (c) => {
    const langParam = c.req.query('lang') === 'en' ? 'en' : 'fr';
    const bundle = getCatalog(opts.assetsDir, langParam);
    const xmlDir = path.join(opts.assetsDir, 'xml');
    const readXml = (f: string) => fs.readFileSync(path.join(xmlDir, f), 'utf8');

    return c.json({
      lang: langParam,
      viruses: Array.from(bundle.viruses.values()),
      antiviruses: Array.from(bundle.antiviruses.values()).filter((a) => a.key !== 'avslot'),
      chipsets: Array.from(bundle.chipsets.values()),
      valuables: Array.from(bundle.valuables.values()),
      biosCosts: BIOS_COSTS,
      addDeckCost: ADD_DECK_COST,
      addSlotCost: ADD_SLOT_COST,
      rawXml: {
        virus: readXml(langParam === 'en' ? 'virus.en.xml' : 'virus.xml'),
        antivirus: readXml(langParam === 'en' ? 'antivirus.en.xml' : 'antivirus.xml'),
        chipsets: readXml(langParam === 'en' ? 'chipsets.en.xml' : 'chipsets.xml'),
        valuables: readXml(langParam === 'en' ? 'valuables.en.xml' : 'valuables.xml'),
        langClient: readXml(`lang.client.${langParam}.xml`),
        tutorials: readXml(`tutorials.${langParam}.xml`),
        sysPatterns: readXml('sysPatterns.xml'),
        texts: readXml(`texts.${langParam}.xml`),
        fsNames: readXml(`fsNames.${langParam}.xml`),
        names: readXml(`names.${langParam}.xml`),
      },
    });
  });

  // --- Authenticated API Middleware ---
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/catalog') {
      return next();
    }
    const token = getCookie(c, SESSION_COOKIE);
    const userId = getUserIdFromSession(db, token);
    if (!userId) return c.json({ error: 'Non authentifié.' }, 401);
    const player = toPlayerDto(userId);
    if (!player) return c.json({ error: 'Session expirée.' }, 401);
    c.set('userId', userId);
    c.set('player', player);
    return next();
  });

  function getStartOfTodayMs(nowMs = Date.now()): number {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function getNextMidnightMs(nowMs = Date.now()): number {
    const d = new Date(nowMs);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  // --- Helper: Ensure available missions exist & aren't expired ---
  function ensureAvailableMissions(userId: number, player: PlayerDto, lang: LangCode) {
    const now = Date.now();
    const startOfTodayMs = getStartOfTodayMs(now);
    // Clean expired daily missions (available, active, completed created before today's midnight)
    db.prepare('DELETE FROM missions WHERE user_id = ? AND created_at < ?').run(
      userId,
      startOfTodayMs
    );

    if (player.level >= 4) {
      // Purge stale level >= 4 rows from an older batch if a newer level >= 4 batch exists
      db.prepare(
        'DELETE FROM missions WHERE user_id = ? AND level >= 4 AND created_at < (SELECT MAX(created_at) FROM missions WHERE user_id = ? AND level >= 4)'
      ).run(userId, userId);

      // If existing non-completed rows are all leftover from level < 4 (before 3 -> 4 level-up), clear them
      const nonCompleted = db
        .prepare(
          "SELECT level FROM missions WHERE user_id = ? AND status IN ('available', 'active')"
        )
        .all(userId) as Array<{ level: number }>;
      if (nonCompleted.length > 0 && nonCompleted.every((r) => r.level < 4)) {
        db.prepare(
          "DELETE FROM missions WHERE user_id = ? AND status IN ('available', 'active') AND level < 4"
        ).run(userId);
      }
    }

    const batchSize = player.level < 4 ? 1 : 9;
    let shouldGenerate = false;

    if (player.level < 4) {
      const openRow = db
        .prepare(
          "SELECT COUNT(*) as cnt FROM missions WHERE user_id = ? AND status IN ('available', 'active')"
        )
        .get(userId) as { cnt: number };
      shouldGenerate = openRow.cnt === 0;
    } else {
      const openLvl4Row = db
        .prepare(
          "SELECT COUNT(*) as cnt FROM missions WHERE user_id = ? AND status IN ('available', 'active') AND level >= 4"
        )
        .get(userId) as { cnt: number };
      const totalLvl4Row = db
        .prepare('SELECT COUNT(*) as cnt FROM missions WHERE user_id = ? AND level >= 4')
        .get(userId) as { cnt: number };
      shouldGenerate = openLvl4Row.cnt === 0 && totalLvl4Row.cnt < batchSize;
    }

    if (shouldGenerate) {
      if (player.level >= 4) {
        db.prepare(
          "DELETE FROM missions WHERE user_id = ? AND status IN ('available', 'active')"
        ).run(userId);
      }
      const bundle = getCatalog(opts.assetsDir, lang);
      const insertStmt = db.prepare(
        "INSERT OR IGNORE INTO missions (mission_key, user_id, seed, level, prime, status, tries, created_at) VALUES (?, ?, ?, ?, ?, 'available', 0, ?)"
      );
      const seenKeys = new Set<string>(
        (
          db
            .prepare('SELECT mission_key FROM missions WHERE user_id = ?')
            .all(userId) as Array<{ mission_key: string }>
        ).map((r) => r.mission_key)
      );
      let inserted = 0;
      let attempts = 0;
      while (inserted < batchSize && attempts < batchSize * 20) {
        attempts++;
        const seed = Math.floor(100000 + Math.random() * 8900000);
        const rawLvl =
          player.level < 4
            ? player.level
            : Math.max(4, player.level + Math.floor(Math.random() * 3) - 1);
        const mkey = `m_${seed}_${rawLvl}`;
        if (seenKeys.has(mkey)) continue;
        const mdata = generateMission(bundle, rawLvl, seed, player.settings.adult);
        const res = insertStmt.run(mkey, userId, seed, rawLvl, mdata.prime, now);
        seenKeys.add(mkey);
        if (res.changes > 0) inserted++;
      }
    }

    const rows = db
      .prepare("SELECT * FROM missions WHERE user_id = ? AND status = 'available' ORDER BY created_at ASC")
      .all(userId) as Array<{
      mission_key: string;
      seed: number;
      level: number;
      prime: number;
      tries: number;
      created_at: number;
    }>;
    return rows;
  }

  function formatMissionRow(
    bundle: ReturnType<typeof getCatalog>,
    player: PlayerDto,
    row: {
      mission_key: string;
      seed: number;
      level: number;
      tries: number;
      created_at: number;
      status?: string;
    }
  ) {
    const mdata = generateMission(bundle, row.level, row.seed, player.settings.adult);
    return {
      missionKey: row.mission_key,
      seed: row.seed,
      level: mdata.gl,
      corp: mdata.corp,
      colorHex: mdata.colorHex,
      short: mdata.short,
      details: mdata.details,
      basePrime: mdata.prime,
      effectivePrime: getAdjustedPrime(mdata.prime, row.tries),
      bonus: mdata.bonus,
      tries: row.tries,
      difficulty: getMissionDifficultyLabel(mdata.gl, player.level),
      expiresAt: getNextMidnightMs(row.created_at),
      status: row.status ?? 'available',
    };
  }

  function buildOrderedDecks(player: PlayerDto) {
    const sorted = [...player.decks].sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return a.slotIndex - b.slotIndex;
    });
    return sorted.map((d) => ({
      id: d.id,
      name: d.name,
      capacity: d.capacity,
      isFavorite: d.isFavorite,
      content: d.content,
    }));
  }

  // --- Missions Routes ---
  app.get('/api/missions', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    const availableRows = ensureAvailableMissions(userId, player, player.settings.lang);
    const activeRows = db
      .prepare("SELECT * FROM missions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC")
      .all(userId) as any[];
    const completedRows = db
      .prepare("SELECT * FROM missions WHERE user_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 30")
      .all(userId) as any[];

    const tutorials = [1, 2, 3].map((lvl) => {
      const tSeed = 1000 + lvl * 111;
      const mdata = generateMission(bundle, lvl, tSeed, player.settings.adult);
      return {
        missionKey: `tuto_${lvl}`,
        seed: tSeed,
        level: lvl,
        corp: mdata.corp,
        colorHex: mdata.colorHex,
        short: mdata.short,
        details: mdata.details,
        basePrime: mdata.prime,
        effectivePrime: mdata.prime,
        bonus: 0,
        tries: 0,
        difficulty: 'easy' as const,
        expiresAt: getNextMidnightMs(Date.now()),
        status: 'tutorial' as const,
      };
    });

    return c.json({
      tutorials,
      available: availableRows.map((r) => formatMissionRow(bundle, player, r)),
      active: activeRows.map((r) => formatMissionRow(bundle, player, r)),
      completed: completedRows.map((r) => formatMissionRow(bundle, player, r)),
    });
  });

  app.post('/api/missions/refresh', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const refreshCost = getMissionRefreshCost(player.level);
    if (player.money < refreshCost) {
      return c.json({ error: 'Crédits insuffisants.' }, 400);
    }

    let updatedPlayer: PlayerDto;
    let availableRows: ReturnType<typeof ensureAvailableMissions>;
    db.exec('BEGIN IMMEDIATE');
    try {
      const moneyRow = db
        .prepare('SELECT money FROM users WHERE id = ?')
        .get(userId) as { money: number } | undefined;
      if (!moneyRow || moneyRow.money < refreshCost) {
        db.exec('ROLLBACK');
        return c.json({ error: 'Crédits insuffisants.' }, 400);
      }
      db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(refreshCost, userId);
      db.prepare('DELETE FROM missions WHERE user_id = ?').run(userId);
      updatedPlayer = toPlayerDto(userId) ?? { ...player, money: moneyRow.money - refreshCost };
      availableRows = ensureAvailableMissions(userId, updatedPlayer, updatedPlayer.settings.lang);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }

    const bundle = getCatalog(opts.assetsDir, updatedPlayer.settings.lang);
    return c.json({
      available: availableRows.map((r) => formatMissionRow(bundle, updatedPlayer, r)),
      player: updatedPlayer,
    });
  });

  app.post('/api/missions/:missionKey/start', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const missionKey = c.req.param('missionKey');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    let seed: number;
    let level: number;
    let tries = 0;

    if (missionKey.startsWith('tuto_')) {
      const tutoLvl = parseTutorialLevel(missionKey);
      if (tutoLvl === null) {
        return c.json({ error: 'Mission tutoriel invalide.' }, 400);
      }
      level = tutoLvl;
      seed = 1000 + level * 111;
    } else {
      const row = db
        .prepare('SELECT * FROM missions WHERE user_id = ? AND mission_key = ?')
        .get(userId, missionKey) as
        | { seed: number; level: number; status: string; tries: number; created_at: number }
        | undefined;
      if (!row) return c.json({ error: 'Mission introuvable.' }, 404);
      if (row.created_at < getStartOfTodayMs()) {
        db.prepare('DELETE FROM missions WHERE user_id = ? AND mission_key = ?').run(userId, missionKey);
        return c.json({ error: 'Mission expirée.' }, 400);
      }
      if (row.status === 'completed') return c.json({ error: 'Mission déjà accomplie.' }, 400);
      const isScoutAtStart = player.activeChipset === 'scout' ? 1 : 0;
      db.prepare(
        "UPDATE missions SET status = 'active', scout_run = ? WHERE user_id = ? AND mission_key = ?"
      ).run(isScoutAtStart, userId, missionKey);
      seed = row.seed;
      level = row.level;
      tries = row.tries;
    }

    const mdata = generateMission(bundle, level, seed, player.settings.adult);

    // Deterministic credit cards embedded in target network mails/docs via GNetwork.dispatchCards
    const classicCards = buildMissionCards(seed, level, mdata.corp);
    const cardStrings = classicCards.map((card) => card.number);

    const init: MissionInitParams = {
      missionKey,
      seed,
      gl: level,
      mission: mdata,
      cards: cardStrings,
      decks: buildOrderedDecks(player),
      ownedViruses: buildOwnedVirusCounts(player),
      chipset: player.activeChipset,
      isChallenge: false,
      biosLevel: player.biosLevel,
      tries,
      profile: {
        username: player.username,
        level: player.level,
        leet: player.settings.leet,
        adult: player.settings.adult,
        cfg: player.settings.cfg,
        sfx: player.settings.sfx,
        ambiant: player.settings.ambiant,
        beat: player.settings.beat,
        lang: player.settings.lang,
      },
    };

    return c.json({ init });
  });

  app.post('/api/missions/:missionKey/end', zValidator('json', MissionEndPayloadSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const missionKey = c.req.param('missionKey');
    const end = c.req.valid('json');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    const isTutorial = missionKey.startsWith('tuto_');

    if (isTutorial) {
      const tutoLvl = parseTutorialLevel(missionKey);
      if (tutoLvl === null) {
        return c.json({ error: 'Mission tutoriel invalide.' }, 400);
      }
      const tutoScout = Boolean(end.scoutRun && player.activeChipset === 'scout');
      // Replayable tutorials in Apprentissage must never grant money, XP, goals, valuables, files, or cards
      return c.json({
        earnedMoney: 0,
        earnedXp: 0,
        scoutRun: tutoScout,
        player: toPlayerDto(userId),
      });
    }

    const row = db
      .prepare('SELECT * FROM missions WHERE user_id = ? AND mission_key = ?')
      .get(userId, missionKey) as
      | {
          seed: number;
          level: number;
          prime: number;
          status: string;
          tries: number;
          scout_run: number;
          created_at: number;
        }
      | undefined;

    if (!row) return c.json({ error: 'Mission introuvable.' }, 404);
    if (row.created_at < getStartOfTodayMs()) {
      db.prepare('DELETE FROM missions WHERE user_id = ? AND mission_key = ?').run(userId, missionKey);
      return c.json({ error: 'Mission expirée.' }, 400);
    }
    if (row.status !== 'active') {
      return c.json({ error: 'Cette mission n’est pas active.' }, 400);
    }

    // Lock Scout run status from /start (prevents swapping chipset in another tab before /end to dodge tries+1)
    const isScoutRun = row.scout_run === 1;
    if (isScoutRun) {
      db.prepare('UPDATE missions SET scout_run = 0 WHERE user_id = ? AND mission_key = ?').run(
        userId,
        missionKey
      );
      return c.json({
        earnedMoney: 0,
        earnedXp: 0,
        scoutRun: true,
        player: toPlayerDto(userId),
      });
    }

    let earnedMoney = 0;
    let earnedXp = 0;

    db.exec('BEGIN IMMEDIATE');
    try {
      if (end.success) {
        const markDone = db
          .prepare(
            "UPDATE missions SET status = 'completed', completed_at = ? WHERE user_id = ? AND mission_key = ? AND status = 'active'"
          )
          .run(Date.now(), userId, missionKey);
        if (markDone.changes === 0) {
          db.exec('ROLLBACK');
          return c.json({ error: 'Mission déjà accomplie.' }, 400);
        }

        earnedMoney = getAdjustedPrime(row.prime, row.tries);
        earnedXp = 1;

        db.prepare('UPDATE users SET money = money + ?, xp = xp + ? WHERE id = ?').run(
          earnedMoney,
          earnedXp,
          userId
        );

        // Goals (strictly whitelisted + clamped)
        const upsertGoal = db.prepare(`
          INSERT INTO user_goals (user_id, goal_id, value) VALUES (?, ?, ?)
          ON CONFLICT(user_id, goal_id) DO UPDATE SET value = value + excluded.value
        `);
        upsertGoal.run(userId, 'missions_fulfilled', 1);
        if (row.tries === 0) {
          upsertGoal.run(userId, 'firsttry', 1);
        }
        for (const [gid, count] of Object.entries(end.goals)) {
          if (!ALLOWED_CLIENT_GOALS.has(gid)) continue;
          const clampedCount = Math.min(200, Math.max(0, Math.floor(count)));
          if (clampedCount > 0) upsertGoal.run(userId, gid, clampedCount);
        }

        // Valuables
        const upsertValuable = db.prepare(`
          INSERT INTO user_valuables (user_id, valuable_id, quantity) VALUES (?, ?, 1)
          ON CONFLICT(user_id, valuable_id) DO UPDATE SET quantity = quantity + 1
        `);
        for (const vid of end.valuables.slice(0, 50)) {
          if (bundle.valuables.has(vid)) {
            upsertValuable.run(userId, vid);
          }
        }

        // Stolen files
        const insertFile = db.prepare(
          'INSERT INTO stolen_files (id, user_id, name, content, embed) VALUES (?, ?, ?, ?, ?)'
        );
        for (const sf of end.copiedFiles.slice(0, 20)) {
          insertFile.run(randomUUID(), userId, sf.name, sf.content, sf.embed);
        }

        // Stolen credit cards: ONLY persist cards genuinely intercepted by the player (never auto-grant uninspected cards!)
        if (row.level >= 4 && end.stolenCards.length > 0) {
          const mdata = generateMission(bundle, row.level, row.seed, player.settings.adult);
          const validMissionCards = buildMissionCards(row.seed, row.level, mdata.corp);
          const insertCard = db.prepare(`
            INSERT OR IGNORE INTO stolen_cards (id, user_id, holder, card_number, amount, redeemed)
            VALUES (?, ?, ?, ?, ?, 0)
          `);
          const normalizeNum = (s: string) => s.replace(/[\s-]+/g, '').toUpperCase();
          for (const clientCard of end.stolenCards.slice(0, 5)) {
            const clientNorm = normalizeNum(clientCard.number);
            const matched = validMissionCards.find(
              (vc) => vc.id === clientCard.id || normalizeNum(vc.number) === clientNorm
            );
            if (matched) {
              insertCard.run(
                matched.id,
                userId,
                matched.holder,
                matched.number,
                Math.min(5000, Math.max(0, matched.amount))
              );
            }
          }
        }
      } else {
        db.prepare(
          "UPDATE missions SET tries = tries + 1 WHERE user_id = ? AND mission_key = ? AND status = 'active'"
        ).run(userId, missionKey);
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }

    return c.json({
      earnedMoney,
      earnedXp,
      scoutRun: false,
      player: toPlayerDto(userId),
    });
  });

  // --- Daily Challenge Routes (3 levels: 5 Easy, 7 Medium, 9 Hard — no access restriction) ---
  const CHALLENGE_TIERS = [
    { level: 5, difficulty: 'easy' as const, rewardMoney: 1000, rewardXp: 1 },
    { level: 7, difficulty: 'medium' as const, rewardMoney: 1500, rewardXp: 2 },
    { level: 9, difficulty: 'hard' as const, rewardMoney: 2500, rewardXp: 3 },
  ] as const;

  function challengeSeedForTier(dateStr: string, level: number): number {
    const base = dailySeedFromDate(dateStr);
    if (level === 5) return ((base ^ 0x13579bdf) & 0x3fffffff) || 555555;
    if (level === 9) return ((base ^ 0x2468ace1) & 0x3fffffff) || 999999;
    return base;
  }

  app.get('/api/challenges/today', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const dateStr = todayDateStr();
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    const leaderboardStmt = db.prepare(
      `SELECT username, MAX(score) as bestScore, remaining_sec as remainingSec, kills, created_at as createdAt
       FROM challenge_runs
       WHERE challenge_date = ? AND challenge_level = ? AND is_ranked = 1 AND success = 1
       GROUP BY user_id
       ORDER BY bestScore DESC, remainingSec DESC, MIN(id) ASC
       LIMIT 25`
    );
    const rankedRunStmt = db.prepare(
      'SELECT * FROM challenge_runs WHERE challenge_date = ? AND challenge_level = ? AND user_id = ? AND is_ranked = 1 LIMIT 1'
    );

    const challenges = CHALLENGE_TIERS.map((tier) => {
      const seed = challengeSeedForTier(dateStr, tier.level);
      const mdata = generateMission(bundle, tier.level, seed, true);
      const leaderboard = leaderboardStmt.all(dateStr, tier.level);
      const playerRankedRun = rankedRunStmt.get(dateStr, tier.level, userId);
      return {
        level: tier.level,
        difficulty: tier.difficulty,
        rewardMoney: tier.rewardMoney,
        rewardXp: tier.rewardXp,
        seed,
        corp: mdata.corp,
        colorHex: mdata.colorHex,
        short: mdata.short,
        details: mdata.details,
        hasPlayedRanked: Boolean(playerRankedRun),
        playerRankedRun: playerRankedRun ?? null,
        leaderboard,
      };
    });

    const defaultTier = challenges.find((ch) => ch.level === 7) ?? challenges[0];

    return c.json({
      date: dateStr,
      challenges,
      // Backward-compatible top-level summary (Level 7 Medium)
      seed: defaultTier.seed,
      level: defaultTier.level,
      corp: defaultTier.corp,
      colorHex: defaultTier.colorHex,
      short: defaultTier.short,
      details: defaultTier.details,
      hasPlayedRanked: defaultTier.hasPlayedRanked,
      playerRankedRun: defaultTier.playerRankedRun,
      leaderboard: defaultTier.leaderboard,
    });
  });

  app.put('/api/challenges/loadout/:level', zValidator('json', SaveChallengeLoadoutSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const level = Number(c.req.param('level'));
    const tier = CHALLENGE_TIERS.find((t) => t.level === level);
    if (!tier) {
      return c.json({ error: 'Niveau de challenge invalide (5, 7 ou 9 attendu).' }, 400);
    }

    const body = c.req.valid('json');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);
    const maxSlots = getChallengeMaxSlots(player.decks);

    if (body.content.length > maxSlots) {
      return c.json(
        { error: `Capacité maximale dépassée (${maxSlots} emplacements autorisés).` },
        400
      );
    }

    const normalizedChipset =
      !body.chipsetId || body.chipsetId === 'none' ? null : body.chipsetId.toLowerCase();
    if (normalizedChipset) {
      if (!player.chipsets.includes(normalizedChipset)) {
        return c.json({ error: 'Chipset non possédé.' }, 400);
      }
      const chipDef = bundle.chipsets.get(normalizedChipset);
      if (!isChipsetAllowedInChallenge(chipDef, level)) {
        return c.json(
          { error: `Ce chipset n'est pas autorisé en Challenge Niveau ${level}.` },
          400
        );
      }
    }

    const ownedCounts = new Map<string, number>();
    for (const vid of player.viruses) {
      ownedCounts.set(vid, (ownedCounts.get(vid) ?? 0) + 1);
    }

    const requestedCounts = new Map<string, number>();
    const validatedContent: string[] = [];
    for (const rawVid of body.content) {
      const vid = rawVid.toLowerCase();
      if (FORBIDDEN_CHALLENGE_VIRUSES.has(vid)) {
        return c.json(
          { error: 'Les virus de changement de deck sont interdits en Challenge.' },
          400
        );
      }
      const vDef = bundle.viruses.get(vid);
      if (!vDef || vDef.cat === 'hidden' || vDef.cat === 'specials') {
        return c.json({ error: `Programme ${vid} interdit dans un deck Challenge.` }, 400);
      }
      if (!isVirusAllowedInChallenge(vDef, level)) {
        return c.json(
          {
            error: `Programme ${vDef.name} interdit en Challenge Niveau ${level} (niveau ${vDef.level} requis).`,
          },
          400
        );
      }
      const owned = ownedCounts.get(vid) ?? 0;
      if (owned <= 0) {
        return c.json({ error: `Programme ${vDef.name} non possédé.` }, 400);
      }
      const nextReq = (requestedCounts.get(vid) ?? 0) + 1;
      if (nextReq > owned) {
        return c.json(
          { error: `Exemplaires insuffisants pour ${vDef.name} (${owned} possédé(s)).` },
          400
        );
      }
      requestedCounts.set(vid, nextReq);
      validatedContent.push(vid);
    }

    db.prepare(
      `INSERT INTO challenge_loadouts (user_id, challenge_level, chipset_id, content_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, challenge_level) DO UPDATE SET
         chipset_id = excluded.chipset_id,
         content_json = excluded.content_json`
    ).run(userId, level, normalizedChipset, JSON.stringify(validatedContent));

    return c.json({ player: toPlayerDto(userId) });
  });

  app.post('/api/challenges/today/start', async (c) => {
    const player = c.get('player');
    const dateStr = todayDateStr();

    let requestedLevel = 7;
    const queryLvl = c.req.query('level');
    if (queryLvl !== undefined) {
      requestedLevel = Number(queryLvl);
    } else {
      const body = await c.req.json().catch(() => null);
      if (body && typeof body.level === 'number') {
        requestedLevel = body.level;
      }
    }

    const tier = CHALLENGE_TIERS.find((t) => t.level === requestedLevel);
    if (!tier) {
      return c.json({ error: 'Niveau de challenge invalide (5, 7 ou 9 attendu).' }, 400);
    }

    const gl = tier.level;
    const tierLoadout = player.challengeLoadouts[String(gl) as '5' | '7' | '9'];
    if (!tierLoadout || tierLoadout.content.length === 0) {
      return c.json(
        { error: 'Votre deck Challenge est vide : sélectionnez au moins un virus avant de lancer.' },
        400
      );
    }

    const userId = c.get('userId');
    db.prepare(
      `INSERT INTO challenge_active_runs (user_id, challenge_date, challenge_level, scout_run)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, challenge_date, challenge_level) DO UPDATE SET scout_run = excluded.scout_run`
    ).run(userId, dateStr, gl, tierLoadout.chipsetId === 'scout' ? 1 : 0);

    const seed = challengeSeedForTier(dateStr, gl);
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);
    const mdata = generateMission(bundle, gl, seed, true);
    const maxSlots = getChallengeMaxSlots(player.decks);

    const init: MissionInitParams = {
      missionKey: `challenge_${dateStr}_${gl}`,
      seed,
      gl,
      mission: mdata,
      decks: [
        {
          id: `challenge_deck_${gl}`,
          name: `Challenge Niv. ${gl}`,
          capacity: maxSlots,
          isFavorite: true,
          content: tierLoadout.content,
        },
      ],
      ownedViruses: buildOwnedVirusCounts(player),
      chipset: tierLoadout.chipsetId,
      isChallenge: true,
      biosLevel: player.biosLevel,
      tries: 0,
      profile: {
        username: player.username,
        level: player.level,
        leet: player.settings.leet,
        adult: true,
        cfg: player.settings.cfg,
        sfx: player.settings.sfx,
        ambiant: player.settings.ambiant,
        beat: player.settings.beat,
        lang: player.settings.lang,
      },
    };
    return c.json({ init });
  });

  app.post('/api/challenges/today/end', zValidator('json', MissionEndPayloadSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const dateStr = todayDateStr();
    const end = c.req.valid('json');

    const keyMatch = /^challenge_\d{4}-\d{2}-\d{2}_(5|7|9)$/.exec(end.missionKey);
    const parsedKeyLvl = keyMatch ? Number(keyMatch[1]) : null;
    const tier =
      CHALLENGE_TIERS.find((t) => t.level === (parsedKeyLvl ?? end.gl)) ??
      CHALLENGE_TIERS.find((t) => t.level === 7)!;

    const tierLoadout = player.challengeLoadouts[String(tier.level) as '5' | '7' | '9'];
    const activeChalRow = db
      .prepare(
        'SELECT scout_run FROM challenge_active_runs WHERE user_id = ? AND challenge_date = ? AND challenge_level = ?'
      )
      .get(userId, dateStr, tier.level) as { scout_run: number } | undefined;
    if (activeChalRow) {
      db.prepare(
        'DELETE FROM challenge_active_runs WHERE user_id = ? AND challenge_date = ? AND challenge_level = ?'
      ).run(userId, dateStr, tier.level);
    }
    const isChallengeScout = activeChalRow
      ? activeChalRow.scout_run === 1
      : Boolean(end.scoutRun && tierLoadout?.chipsetId === 'scout');
    if (isChallengeScout) {
      return c.json({
        isRanked: false,
        level: tier.level,
        rewardMoney: 0,
        rewardXp: 0,
        score: 0,
        scoutRun: true,
        player: toPlayerDto(userId),
      });
    }

    const clampedRemSec = Math.min(600, Math.max(0, end.remainingSec));
    const clampedKills = Math.min(100, Math.max(0, end.kills));
    const clampedValCount = Math.min(30, end.valuables.length);
    const computedScore = end.success
      ? 1000 + clampedRemSec * 5 + clampedKills * 40 + clampedValCount * 100
      : clampedKills * 15;

    let isRanked = 0;
    let rewardMoney = 0;
    let rewardXp = 0;

    db.exec('BEGIN IMMEDIATE');
    try {
      const alreadyRanked = db
        .prepare(
          'SELECT id FROM challenge_runs WHERE challenge_date = ? AND challenge_level = ? AND user_id = ? AND is_ranked = 1'
        )
        .get(dateStr, tier.level, userId);

      isRanked = alreadyRanked ? 0 : 1;
      db.prepare(
        `INSERT INTO challenge_runs (challenge_date, challenge_level, user_id, username, score, success, remaining_sec, kills, is_ranked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        dateStr,
        tier.level,
        userId,
        player.username,
        computedScore,
        end.success ? 1 : 0,
        clampedRemSec,
        clampedKills,
        isRanked
      );

      if (isRanked === 1 && end.success) {
        rewardMoney = tier.rewardMoney;
        rewardXp = tier.rewardXp;
        db.prepare('UPDATE users SET money = money + ?, xp = xp + ? WHERE id = ?').run(
          rewardMoney,
          rewardXp,
          userId
        );
        db.prepare(`
          INSERT INTO user_goals (user_id, goal_id, value) VALUES (?, ?, 1)
          ON CONFLICT(user_id, goal_id) DO UPDATE SET value = value + 1
        `).run(userId, `challenge_pass_${tier.level}`);
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }

    return c.json({
      isRanked: isRanked === 1,
      level: tier.level,
      rewardMoney,
      rewardXp,
      score: computedScore,
      scoutRun: false,
      player: toPlayerDto(userId),
    });
  });

  // --- Decks & Chipset Routes ---
  app.put('/api/decks/:deckId', zValidator('json', SaveDeckSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const deckId = c.req.param('deckId');
    const body = c.req.valid('json');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    const deck = player.decks.find((d) => d.id === deckId);
    if (!deck) return c.json({ error: 'Deck introuvable.' }, 404);

    // Ensure all viruses in content are owned and shared pool across all decks is respected
    if (body.content.length > deck.capacity) {
      return c.json({ error: `Capacité maximale dépassée (${deck.capacity} slots).` }, 400);
    }

    const ownedCounts = new Map<string, number>();
    for (const vid of player.viruses) {
      ownedCounts.set(vid, (ownedCounts.get(vid) ?? 0) + 1);
    }

    const otherUsedCounts = new Map<string, number>();
    for (const otherDeck of player.decks) {
      if (otherDeck.id === deckId) continue;
      for (const vid of otherDeck.content) {
        otherUsedCounts.set(vid, (otherUsedCounts.get(vid) ?? 0) + 1);
      }
    }

    const requestedCounts = new Map<string, number>();
    const validatedContent: string[] = [];
    for (const vid of body.content) {
      const vDef = bundle.viruses.get(vid);
      if (!vDef || vDef.cat === 'hidden' || vDef.cat === 'specials') {
        return c.json({ error: `Programme ${vid} interdit dans un deck.` }, 400);
      }
      const owned = ownedCounts.get(vid) ?? 0;
      if (owned <= 0) {
        return c.json({ error: `Programme ${vid} non possédé.` }, 400);
      }
      const nextReq = (requestedCounts.get(vid) ?? 0) + 1;
      const otherUsed = otherUsedCounts.get(vid) ?? 0;
      if (otherUsed + nextReq > owned) {
        return c.json(
          { error: `Exemplaires insuffisants pour ${vid} (${owned} possédé(s), partagé(s) entre vos decks).` },
          400
        );
      }
      requestedCounts.set(vid, nextReq);
      validatedContent.push(vid);
    }

    if (body.isFavorite) {
      db.prepare('UPDATE decks SET is_favorite = 0 WHERE user_id = ?').run(userId);
    }

    db.prepare(
      'UPDATE decks SET name = ?, content_json = ?, is_favorite = ? WHERE id = ? AND user_id = ?'
    ).run(
      body.name,
      JSON.stringify(validatedContent),
      body.isFavorite !== undefined ? (body.isFavorite ? 1 : 0) : deck.isFavorite ? 1 : 0,
      deckId,
      userId
    );

    return c.json({ player: toPlayerDto(userId) });
  });

  app.post('/api/decks/chipset', zValidator('json', SetChipsetSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const { chipsetId } = c.req.valid('json');

    const normalized = !chipsetId || chipsetId === 'none' ? null : chipsetId;
    if (normalized && !player.chipsets.includes(normalized)) {
      return c.json({ error: 'Chipset non possédé.' }, 400);
    }

    db.prepare('UPDATE users SET active_chipset = ? WHERE id = ?').run(normalized, userId);
    return c.json({ player: toPlayerDto(userId) });
  });

  // --- Store & Upgrades (Viruses, Chipsets, BIOS, Deck Slots, New Decks) ---
  app.post('/api/store/buy', zValidator('json', BuyItemSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const req = c.req.valid('json');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    if (req.kind === 'virus') {
      const v = bundle.viruses.get(req.id);
      if (!v || v.price <= 0 || v.cat === 'hidden' || v.cat === 'specials') {
        return c.json({ error: 'Programme indisponible.' }, 400);
      }
      if (player.level < v.level) return c.json({ error: `Niveau ${v.level} requis.` }, 400);
      if (player.money < v.price) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(v.price, userId);
      db.prepare(
        `INSERT INTO user_items (user_id, item_type, item_id, quantity)
         VALUES (?, 'virus', ?, 1)
         ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET quantity = quantity + 1`
      ).run(userId, v.id);
    } else if (req.kind === 'chipset') {
      const chip = bundle.chipsets.get(req.id);
      if (!chip || chip.price <= 0) return c.json({ error: 'Chipset indisponible.' }, 400);
      if (player.chipsets.includes(chip.id)) return c.json({ error: 'Déjà acquis.' }, 400);
      if (player.level < chip.level) return c.json({ error: `Niveau ${chip.level} requis.` }, 400);
      if (player.money < chip.price) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(chip.price, userId);
      db.prepare('INSERT INTO user_items (user_id, item_type, item_id) VALUES (?, ?, ?)').run(
        userId,
        'chipset',
        chip.id
      );
    } else if (req.kind === 'bios') {
      if (player.biosLevel >= 4) return c.json({ error: 'BIOS déjà au niveau maximum.' }, 400);
      const nextBios = player.biosLevel + 1;
      const cost = BIOS_COSTS[nextBios] ?? 999999;
      if (player.money < cost) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ?, bios_level = ? WHERE id = ?').run(
        cost,
        nextBios,
        userId
      );
    } else if (req.kind === 'new_deck') {
      if (player.decks.length >= 4) return c.json({ error: 'Maximum de 4 decks atteint.' }, 400);
      const nextIdx = player.decks.length;
      const cost = ADD_DECK_COST[nextIdx] ?? 999999;
      if (player.money < cost) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(cost, userId);
      db.prepare(
        'INSERT INTO decks (id, user_id, slot_index, name, capacity, is_favorite, content_json) VALUES (?, ?, ?, ?, 3, 0, ?)'
      ).run(`deck_${userId}_${nextIdx}`, userId, nextIdx, `Deck #${nextIdx + 1}`, '[]');
    } else if (req.kind === 'deck_slot') {
      const deck = player.decks.find((d) => d.id === req.deckId);
      if (!deck) return c.json({ error: 'Deck introuvable.' }, 404);
      if (deck.capacity >= 9) return c.json({ error: 'Capacité maximale atteinte (9 slots).' }, 400);
      const cost = ADD_SLOT_COST[deck.capacity] ?? 999999;
      if (player.money < cost) return c.json({ error: 'Crédits insuffisants.' }, 400);

      db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(cost, userId);
      db.prepare('UPDATE decks SET capacity = capacity + 1 WHERE id = ? AND user_id = ?').run(
        deck.id,
        userId
      );
    }

    return c.json({ player: toPlayerDto(userId) });
  });

  // --- Hard Drive & Black Market Storage Routes ---
  app.get('/api/storage', (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const dateStr = todayDateStr();
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);

    const valIds = Array.from(bundle.valuables.keys());
    const multipliers = getDailyMarketMultipliers(dateStr, valIds);

    const saleRow = db
      .prepare('SELECT sold_count FROM market_sales WHERE user_id = ? AND sale_date = ?')
      .get(userId, dateStr) as { sold_count: number } | undefined;
    const soldToday = saleRow?.sold_count ?? 0;

    const files = db
      .prepare('SELECT id, name, content, embed, copied_at as copiedAt FROM stolen_files WHERE user_id = ? ORDER BY rowid DESC')
      .all(userId);

    const cards = db
      .prepare(
        'SELECT id, holder, card_number as number, amount, redeemed, captured_at as capturedAt FROM stolen_cards WHERE user_id = ? ORDER BY rowid DESC'
      )
      .all(userId);

    return c.json({
      date: dateStr,
      dailyQuota: DAILY_PACK_QUOTA,
      soldToday,
      remainingQuota: Math.max(0, DAILY_PACK_QUOTA - soldToday),
      marketMultipliers: multipliers,
      files,
      cards,
    });
  });

  app.post('/api/storage/sell-pack', zValidator('json', SellPackSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const { valuableId, count } = c.req.valid('json');
    const bundle = getCatalog(opts.assetsDir, player.settings.lang);
    const valDef = bundle.valuables.get(valuableId);
    if (!valDef) return c.json({ error: 'Pack inconnu.' }, 400);

    const owned = player.valuables[valuableId] ?? 0;
    if (owned <= 0) return c.json({ error: 'Aucun pack en stock.' }, 400);

    const dateStr = todayDateStr();
    const saleRow = db
      .prepare('SELECT sold_count FROM market_sales WHERE user_id = ? AND sale_date = ?')
      .get(userId, dateStr) as { sold_count: number } | undefined;
    const soldToday = saleRow?.sold_count ?? 0;
    const remainingQuota = Math.max(0, DAILY_PACK_QUOTA - soldToday);
    if (remainingQuota <= 0) return c.json({ error: 'Quota quotidien atteint (20/jour).' }, 400);

    const sellQty = Math.min(count, owned, remainingQuota);
    const valIds = Array.from(bundle.valuables.keys());
    const mult = getDailyMarketMultipliers(dateStr, valIds)[valuableId] ?? 1.0;
    const unitPrice = Math.round(valDef.price * mult);
    const totalEarned = sellQty * unitPrice;

    db.prepare('UPDATE user_valuables SET quantity = quantity - ? WHERE user_id = ? AND valuable_id = ?').run(
      sellQty,
      userId,
      valuableId
    );
    db.prepare('UPDATE users SET money = money + ? WHERE id = ?').run(totalEarned, userId);
    db.prepare(`
      INSERT INTO market_sales (user_id, sale_date, sold_count) VALUES (?, ?, ?)
      ON CONFLICT(user_id, sale_date) DO UPDATE SET sold_count = sold_count + excluded.sold_count
    `).run(userId, dateStr, sellQty);

    return c.json({
      soldQty: sellQty,
      totalEarned,
      remainingQuota: remainingQuota - sellQty,
      player: toPlayerDto(userId),
    });
  });

  app.post('/api/storage/redeem-card', zValidator('json', RedeemCardSchema), (c) => {
    const userId = c.get('userId');
    const { cardId } = c.req.valid('json');
    const row = db
      .prepare('SELECT amount, redeemed FROM stolen_cards WHERE user_id = ? AND id = ?')
      .get(userId, cardId) as { amount: number; redeemed: number } | undefined;
    if (!row) return c.json({ error: 'Carte introuvable.' }, 404);
    if (row.redeemed === 1) return c.json({ error: 'Carte déjà encaissée.' }, 400);

    db.prepare('UPDATE stolen_cards SET redeemed = 1 WHERE user_id = ? AND id = ?').run(userId, cardId);
    db.prepare('UPDATE users SET money = money + ? WHERE id = ?').run(row.amount, userId);
    db.prepare(`
      INSERT INTO user_goals (user_id, goal_id, value) VALUES (?, 'cards_redeemed', 1)
      ON CONFLICT(user_id, goal_id) DO UPDATE SET value = value + 1
    `).run(userId);

    return c.json({
      earned: row.amount,
      player: toPlayerDto(userId),
    });
  });

  app.post('/api/storage/redeem-card-number', zValidator('json', RedeemCardByNumberSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const { number } = c.req.valid('json');
    const normalizedInput = number.replace(/[\s-]+/g, '').toUpperCase();

    const rows = db
      .prepare('SELECT id, card_number, amount, redeemed FROM stolen_cards WHERE user_id = ?')
      .all(userId) as Array<{ id: string; card_number: string; amount: number; redeemed: number }>;

    let match = rows.find(
      (r) => r.card_number.replace(/[\s-]+/g, '').toUpperCase() === normalizedInput
    );

    if (!match) {
      // Also validate against cards embedded in any mission the user has started or completed (including Scout/failed/Classic runs)
      const bundle = getCatalog(opts.assetsDir, player.settings.lang);
      const userMissions = db
        .prepare(
          "SELECT seed, level FROM missions WHERE user_id = ? AND status IN ('active', 'completed') AND level >= 4"
        )
        .all(userId) as Array<{ seed: number; level: number }>;

      for (const mRow of userMissions) {
        const mdata = generateMission(bundle, mRow.level, mRow.seed, player.settings.adult);
        const missionCards = buildMissionCards(mRow.seed, mRow.level, mdata.corp);
        const found = missionCards.find(
          (mc) => mc.number.replace(/[\s-]+/g, '').toUpperCase() === normalizedInput
        );
        if (found) {
          const clampedAmt = Math.min(5000, Math.max(0, found.amount));
          db.prepare(
            'INSERT OR IGNORE INTO stolen_cards (id, user_id, holder, card_number, amount, redeemed) VALUES (?, ?, ?, ?, ?, 0)'
          ).run(found.id, userId, found.holder, found.number, clampedAmt);
          match = {
            id: found.id,
            card_number: found.number,
            amount: clampedAmt,
            redeemed: 0,
          };
          break;
        }
      }
    }

    if (!match) {
      return c.json({ error: 'Numéro de carte bancaire invalide ou introuvable.' }, 404);
    }
    if (match.redeemed === 1) {
      return c.json({ error: 'Cette carte bancaire a déjà été encaissée.' }, 400);
    }

    db.prepare('UPDATE stolen_cards SET redeemed = 1 WHERE user_id = ? AND id = ?').run(
      userId,
      match.id
    );
    db.prepare('UPDATE users SET money = money + ? WHERE id = ?').run(match.amount, userId);
    db.prepare(`
      INSERT INTO user_goals (user_id, goal_id, value) VALUES (?, 'cards_redeemed', 1)
      ON CONFLICT(user_id, goal_id) DO UPDATE SET value = value + 1
    `).run(userId);

    return c.json({
      earned: match.amount,
      cardNumber: match.card_number,
      player: toPlayerDto(userId),
    });
  });

  app.delete('/api/storage/files/:fileId', (c) => {
    const userId = c.get('userId');
    const fileId = c.req.param('fileId');
    db.prepare('DELETE FROM stolen_files WHERE user_id = ? AND id = ?').run(userId, fileId);
    return c.json({ ok: true });
  });

  // --- Profile & .hackrc Settings ---
  app.patch('/api/profile', zValidator('json', UpdateProfileSchema), (c) => {
    const userId = c.get('userId');
    const player = c.get('player');
    const patch = c.req.valid('json');

    let normalizedCfg: string | undefined = undefined;
    if (patch.cfg !== undefined) {
      // Replace non-breaking spaces with ASCII space and validate strict .hackrc syntax
      const sanitizedRaw = patch.cfg.replace(/\u00A0/g, ' ');
      const normalizedLines: string[] = [];
      for (const rawLine of sanitizedRaw.split(/\r?\n/)) {
        const commentIdx = rawLine.indexOf('#');
        const codePartRaw = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
        const commentPart = commentIdx >= 0 ? rawLine.slice(commentIdx).replace(/^[ \t]+/, '') : '';

        // Reject exotic Unicode whitespace / vertical tabs / form feeds that break Classic engine
        if (/[\v\f\u0085\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000]/.test(codePartRaw)) {
          return c.json({ error: `Erreur de syntaxe .hackrc : "${rawLine}"` }, 400);
        }

        const clean = codePartRaw.replace(/^[ \t]+|[ \t]+$/g, '');
        if (!clean) {
          normalizedLines.push(commentPart ? commentPart : '');
          continue;
        }

        const m = /^alias[ \t]+([a-zA-Z0-9_-]+)[ \t]*=[ \t]*([^=\r\n]+)$/i.exec(clean);
        if (!m) {
          return c.json({ error: `Erreur de syntaxe .hackrc : "${rawLine}"` }, 400);
        }
        const aliasKey = m[1].toLowerCase();
        const aliasTarget = m[2].replace(/^[ \t]+|[ \t]+$/g, '');
        if (!aliasTarget) {
          return c.json({ error: `Erreur de syntaxe .hackrc : "${rawLine}"` }, 400);
        }
        normalizedLines.push(
          `alias ${aliasKey} = ${aliasTarget}${commentPart ? ` ${commentPart}` : ''}`
        );
      }
      normalizedCfg = normalizedLines.join('\n');
    }

    const updatedSettings = {
      ...player.settings,
      ...patch,
      ...(normalizedCfg !== undefined ? { cfg: normalizedCfg } : {}),
    };
    db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(
      JSON.stringify(updatedSettings),
      userId
    );
    return c.json({ player: toPlayerDto(userId) });
  });

  // --- Static Assets (/assets/*) ---
  const assetsRoot = path.resolve(opts.assetsDir);
  app.get('/assets/*', async (c, next) => {
    const rel = c.req.path.replace(/^\/assets\/?/, '');
    const resolved = path.resolve(assetsRoot, rel);
    if (
      (resolved !== assetsRoot && !resolved.startsWith(assetsRoot + path.sep)) ||
      !fs.existsSync(resolved) ||
      fs.statSync(resolved).isDirectory()
    ) {
      return next();
    }
    const ext = path.extname(resolved).toLowerCase();
    const buf = fs.readFileSync(resolved);
    return c.body(buf, 200, {
      'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    });
  });

  // --- Classic Intrusion Static Web & Engine Assets (assets/www/*) ---
  const classicWwwDir = path.resolve(opts.assetsDir, 'www');
  if (fs.existsSync(classicWwwDir)) {
    app.use('*', async (c, next) => {
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
      if (c.req.path === '/' || c.req.path.startsWith('/api/')) return next();
      const rel = c.req.path.replace(/^\/+/, '');
      if (!rel || rel === 'index.html') return next();
      const resolved = path.resolve(classicWwwDir, rel);
      if (
        (resolved !== classicWwwDir && !resolved.startsWith(classicWwwDir + path.sep)) ||
        !fs.existsSync(resolved) ||
        fs.statSync(resolved).isDirectory()
      ) {
        return next();
      }
      const ext = path.extname(resolved).toLowerCase();
      const buf = fs.readFileSync(resolved);
      return c.body(buf, 200, {
        'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
        'Cache-Control': ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400',
      });
    });
  }

  // --- Production SPA Client Static Serving ---
  if (opts.clientDistDir && fs.existsSync(opts.clientDistDir)) {
    const distRoot = path.resolve(opts.clientDistDir);
    app.get('*', (c) => {
      const reqRel = c.req.path === '/' ? 'index.html' : c.req.path.replace(/^\//, '');
      const candidate = path.resolve(distRoot, reqRel);
      const isSafeCandidate =
        (candidate === distRoot || candidate.startsWith(distRoot + path.sep)) &&
        fs.existsSync(candidate) &&
        !fs.statSync(candidate).isDirectory();
      const targetFile = isSafeCandidate ? candidate : path.join(distRoot, 'index.html');

      if (!fs.existsSync(targetFile)) return c.notFound();
      const ext = path.extname(targetFile).toLowerCase();
      return c.body(fs.readFileSync(targetFile), 200, {
        'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
      });
    });
  }

  return { app, db };
}
