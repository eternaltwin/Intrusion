import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppDatabase, DbExecutor } from '../db/database.js';
import {
  CHALLENGE_LEVELS,
  FORBIDDEN_CHALLENGE_VIRUSES,
  getChallengeMaxSlots,
  getGameLevel,
  getXpForLevel,
  isChipsetAllowedInChallenge,
  isVirusAllowedInChallenge,
  type GameDataBundle,
  type PlayerDto,
} from '@intrusion/shared';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

export interface EternaltwinOauthConfig {
  internalUrl: string;
  externalUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scope?: string;
}

export type EtwinOauthConfig = EternaltwinOauthConfig;

export interface EternaltwinIdentity {
  eternaltwinUserId: string;
  displayName: string;
}

export const DEFAULT_USER_SETTINGS: PlayerDto['settings'] = {
  leet: false,
  adult: true,
  sfx: true,
  ambiant: true,
  beat: true,
  crtEffect: true,
  lang: 'fr',
  cfg: '# .hackrc — Alias CLI Uber-Eleet\nalias d = dmgs\nalias s = scan1\nalias up = cd ..',
  keybinds: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
};

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function createOauthState(): string {
  return randomBytes(32).toString('hex');
}

export function verifyOauthState(
  expectedCookieState: string | undefined,
  receivedQueryState: string | undefined
): boolean {
  if (!expectedCookieState || !receivedQueryState) return false;
  const a = Buffer.from(expectedCookieState, 'utf8');
  const b = Buffer.from(receivedQueryState, 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildEternaltwinAuthorizationUrl(
  config: EternaltwinOauthConfig,
  state: string
): string {
  const base = config.externalUrl.replace(/\/+$/, '');
  const authUrl = new URL(`${base}/oauth/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', config.callbackUrl);
  authUrl.searchParams.set('scope', config.scope || 'base');
  authUrl.searchParams.set('state', state);
  return authUrl.toString();
}

const ALLOWED_ETERNALTWIN_AUTH_CONTEXT_TYPES = new Set([
  'user',
  'accesstoken',
  'access_token',
  'oauthaccesstoken',
  'oauth_access_token',
]);

export function parseEternaltwinSelfIdentity(payload: unknown): EternaltwinIdentity {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Profil Eternaltwin invalide.');
  }
  const root = payload as Record<string, any>;
  if (
    typeof root.type === 'string' &&
    !ALLOWED_ETERNALTWIN_AUTH_CONTEXT_TYPES.has(root.type.trim().toLowerCase())
  ) {
    throw new Error('Contexte Eternaltwin non-utilisateur refusé.');
  }
  const hasNestedUser = Boolean(root.user && typeof root.user === 'object');
  if (
    typeof root.type === 'string' &&
    root.type.trim().toLowerCase() !== 'user' &&
    !hasNestedUser
  ) {
    throw new Error('Contexte Eternaltwin non-utilisateur refusé.');
  }
  const userObj: Record<string, any> = hasNestedUser ? root.user : root;
  if (typeof userObj.type === 'string' && userObj.type.trim().toLowerCase() !== 'user') {
    throw new Error('Contexte Eternaltwin non-utilisateur refusé.');
  }

  const rawId = typeof userObj.id === 'string' ? userObj.id.trim() : '';
  if (!rawId || rawId.length > 128) {
    throw new Error('Identifiant utilisateur Eternaltwin manquant.');
  }

  const rawDisplay =
    (typeof userObj.display_name?.current?.value === 'string'
      ? userObj.display_name.current.value
      : undefined) ??
    (typeof userObj.displayName?.current?.value === 'string'
      ? userObj.displayName.current.value
      : undefined) ??
    (typeof userObj.profile?.display_name === 'string'
      ? userObj.profile.display_name
      : undefined) ??
    (typeof userObj.profile?.displayName === 'string'
      ? userObj.profile.displayName
      : undefined) ??
    (typeof userObj.display_name === 'string' ? userObj.display_name : undefined) ??
    (typeof userObj.displayName === 'string' ? userObj.displayName : undefined) ??
    (typeof userObj.username === 'string' ? userObj.username : undefined) ??
    '';

  const cleanDisplay = rawDisplay.replace(/[\u0000-\u001F\u007F]+/g, '').trim().slice(0, 32);
  if (!cleanDisplay) {
    throw new Error('Pseudonyme Eternaltwin manquant.');
  }

  return {
    eternaltwinUserId: rawId,
    displayName: cleanDisplay,
  };
}

export const parseEtwinSelfIdentity = parseEternaltwinSelfIdentity;

/**
 * Exchanges an Eternaltwin authorization code for an access token over HTTP,
 * queries `/api/v1/auth/self` in memory, and discards `access_token` immediately
 * without ever persisting or logging it (Charte Eternaltwin — Article 4).
 */
export async function exchangeEternaltwinCodeForIdentity(
  config: EternaltwinOauthConfig,
  code: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<EternaltwinIdentity> {
  const apiBase = config.internalUrl.replace(/\/+$/, '');
  const basicCredentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
    'utf8'
  ).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.callbackUrl,
    client_id: config.clientId,
  });

  const tokenRes = await fetchImpl(`${apiBase}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicCredentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenRes.ok) {
    let oauthErrCode = '';
    try {
      const errBody = (await tokenRes.json()) as { error?: unknown };
      if (typeof errBody?.error === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(errBody.error)) {
        oauthErrCode = ` [${errBody.error}]`;
      }
    } catch {
      // Ignore non-JSON error body
    }
    throw new Error(
      `Échec de l'échange OAuth Eternaltwin (HTTP ${tokenRes.status}${oauthErrCode}).`
    );
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: unknown };
  const accessToken =
    typeof tokenJson?.access_token === 'string' ? tokenJson.access_token.trim() : '';
  if (!accessToken) {
    throw new Error('Jeton OAuth Eternaltwin absent de la réponse.');
  }

  const selfRes = await fetchImpl(`${apiBase}/api/v1/auth/self`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!selfRes.ok) {
    throw new Error(`Impossible de vérifier l'identité Eternaltwin (HTTP ${selfRes.status}).`);
  }

  const selfJson = await selfRes.json();
  return parseEternaltwinSelfIdentity(selfJson);
}

export async function createSession(db: DbExecutor, userId: number): Promise<string> {
  const now = Date.now();
  await db.query('DELETE FROM sessions WHERE expires_at < $1', [now]);
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = now + SESSION_TTL_MS;
  await db.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash, userId, expiresAt]
  );
  return rawToken;
}

export async function deleteSession(db: DbExecutor, rawToken: string): Promise<void> {
  const tokenHash = hashSessionToken(rawToken);
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

export async function getUserIdFromSession(
  db: DbExecutor,
  rawToken: string | undefined
): Promise<number | null> {
  if (!rawToken) return null;
  const tokenHash = hashSessionToken(rawToken);
  const res = await db.query<{ user_id: number; expires_at: number }>(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = $1',
    [tokenHash]
  );
  const row = res.rows[0];
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    return null;
  }
  return row.user_id;
}

export async function upsertEternaltwinUser(
  db: AppDatabase,
  catalog: GameDataBundle,
  eternaltwinUserId: string,
  displayName: string
): Promise<number> {
  const cleanName = displayName.trim().slice(0, 32) || 'Operateur';
  const existingRes = await db.query<{ id: number; username: string }>(
    'SELECT id, username FROM users WHERE eternaltwin_user_id = $1',
    [eternaltwinUserId]
  );
  const existing = existingRes.rows[0];

  if (existing) {
    if (existing.username !== cleanName) {
      await db.query('UPDATE users SET username = $1 WHERE id = $2', [cleanName, existing.id]);
    }
    return existing.id;
  }

  const startingViruses = Array.from(catalog.viruses.values())
    .filter((v) => v.start)
    .map((v) => v.id);

  return db.transaction(async (tx) => {
    const recheck = await tx.query<{ id: number }>(
      'SELECT id FROM users WHERE eternaltwin_user_id = $1',
      [eternaltwinUserId]
    );
    if (recheck.rows[0]) {
      return recheck.rows[0].id;
    }

    const ins = await tx.query<{ id: number }>(
      `INSERT INTO users (eternaltwin_user_id, username, money, xp, bios_level, active_chipset, settings_json)
       VALUES ($1, $2, 10000, 3, 1, NULL, $3)
       RETURNING id`,
      [eternaltwinUserId, cleanName, JSON.stringify(DEFAULT_USER_SETTINGS)]
    );
    const userId = ins.rows[0].id;

    for (const vid of startingViruses) {
      await tx.query(
        'INSERT INTO user_items (user_id, item_type, item_id) VALUES ($1, $2, $3)',
        [userId, 'virus', vid]
      );
    }

    await tx.query(
      'INSERT INTO decks (id, user_id, slot_index, name, capacity, is_favorite, content_json) VALUES ($1, $2, 0, $3, 3, 1, $4)',
      [`deck_${userId}_0`, userId, 'Deck Principal', JSON.stringify(startingViruses.slice(0, 3))]
    );

    return userId;
  });
}

function localTodayDateStr(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function syncUserChallengeGoals(
  db: DbExecutor,
  userId: number,
  todayStr = localTodayDateStr()
): Promise<void> {
  // 1) First-try ranked wins per difficulty (immediate)
  await db.query(
    `INSERT INTO user_goals (user_id, goal_id, value)
     SELECT user_id, 'challenge_pass_' || challenge_level::text, COUNT(*)::int
     FROM challenge_runs
     WHERE user_id = $1 AND is_ranked = 1 AND success = 1 AND challenge_level IN (5, 7, 9)
     GROUP BY user_id, challenge_level
     ON CONFLICT (user_id, goal_id) DO UPDATE SET
       value = GREATEST(user_goals.value, EXCLUDED.value)`,
    [userId]
  );

  // 2) End-of-day Top 3 podiums per difficulty (awarded once challenge_date < todayStr)
  await db.query(
    `WITH ranked AS (
       SELECT
         user_id,
         challenge_level,
         ROW_NUMBER() OVER (
           PARTITION BY challenge_date, challenge_level
           ORDER BY score DESC, remaining_sec DESC, id ASC
         ) AS rn
       FROM challenge_runs
       WHERE is_ranked = 1 AND success = 1 AND challenge_date < $1 AND challenge_level IN (5, 7, 9)
     )
     INSERT INTO user_goals (user_id, goal_id, value)
     SELECT user_id, 'challenge_top3_' || challenge_level::text, COUNT(*)::int
     FROM ranked
     WHERE user_id = $2 AND rn <= 3
     GROUP BY user_id, challenge_level
     ON CONFLICT (user_id, goal_id) DO UPDATE SET
       value = GREATEST(user_goals.value, EXCLUDED.value)`,
    [todayStr, userId]
  );
}

export async function buildPlayerDto(
  db: DbExecutor,
  userId: number,
  bundle?: GameDataBundle
): Promise<PlayerDto | null> {
  const userRes = await db.query<{
    id: number;
    username: string;
    money: number;
    xp: number;
    bios_level: number;
    active_chipset: string | null;
    settings_json: string;
  }>('SELECT * FROM users WHERE id = $1', [userId]);
  const user = userRes.rows[0];
  if (!user) return null;

  await syncUserChallengeGoals(db, userId);

  const itemsRes = await db.query<{ item_type: string; item_id: string; quantity: number }>(
    'SELECT item_type, item_id, quantity FROM user_items WHERE user_id = $1',
    [userId]
  );
  const items = itemsRes.rows;

  const viruses: string[] = [];
  const ownedCounts = new Map<string, number>();
  for (const i of items) {
    if (i.item_type === 'virus') {
      const qty = Math.max(1, i.quantity ?? 1);
      ownedCounts.set(i.item_id, (ownedCounts.get(i.item_id) ?? 0) + qty);
      for (let k = 0; k < qty; k++) viruses.push(i.item_id);
    }
  }
  const chipsets = items.filter((i) => i.item_type === 'chipset').map((i) => i.item_id);

  const deckRes = await db.query<{
    id: string;
    slot_index: number;
    name: string;
    capacity: number;
    is_favorite: number;
    content_json: string;
  }>('SELECT * FROM decks WHERE user_id = $1 ORDER BY slot_index ASC', [userId]);

  const decks = deckRes.rows.map((d) => ({
    id: d.id,
    slotIndex: d.slot_index,
    name: d.name,
    capacity: d.capacity,
    isFavorite: d.is_favorite === 1,
    content: JSON.parse(d.content_json || '[]') as string[],
  }));

  const maxChallengeSlots = getChallengeMaxSlots(decks);

  const sanitizeTierContent = (rawList: string[], tierLvl: number): string[] => {
    const used = new Map<string, number>();
    const out: string[] = [];
    for (const vid of rawList) {
      if (out.length >= maxChallengeSlots) break;
      if (FORBIDDEN_CHALLENGE_VIRUSES.has(vid)) continue;
      if (bundle && !isVirusAllowedInChallenge(bundle.viruses.get(vid), tierLvl)) continue;
      const owned = ownedCounts.get(vid) ?? 0;
      const cur = used.get(vid) ?? 0;
      if (cur >= owned) continue;
      used.set(vid, cur + 1);
      out.push(vid);
    }
    return out;
  };

  const sanitizeTierChipset = (rawChip: string | null, tierLvl: number): string | null => {
    if (!rawChip || !chipsets.includes(rawChip)) return null;
    if (bundle && !isChipsetAllowedInChallenge(bundle.chipsets.get(rawChip), tierLvl)) {
      return null;
    }
    return rawChip;
  };

  const loadoutRes = await db.query<{
    challenge_level: number;
    chipset_id: string | null;
    content_json: string;
  }>('SELECT challenge_level, chipset_id, content_json FROM challenge_loadouts WHERE user_id = $1', [
    userId,
  ]);
  const savedByTier = new Map<number, { chipsetId: string | null; content: string[] }>();
  for (const row of loadoutRes.rows) {
    savedByTier.set(row.challenge_level, {
      chipsetId: row.chipset_id,
      content: JSON.parse(row.content_json || '[]') as string[],
    });
  }

  const favDeck = decks.find((d) => d.isFavorite) ?? decks[0];
  const challengeLoadouts = {} as PlayerDto['challengeLoadouts'];
  for (const tierLvl of CHALLENGE_LEVELS) {
    const key = String(tierLvl) as '5' | '7' | '9';
    const saved = savedByTier.get(tierLvl);
    if (saved) {
      challengeLoadouts[key] = {
        chipsetId: sanitizeTierChipset(saved.chipsetId, tierLvl),
        content: sanitizeTierContent(saved.content, tierLvl),
      };
    } else {
      let defaultContent = sanitizeTierContent(favDeck?.content ?? [], tierLvl);
      if (defaultContent.length === 0) {
        defaultContent = sanitizeTierContent(viruses, tierLvl).slice(0, 3);
      }
      challengeLoadouts[key] = {
        chipsetId: sanitizeTierChipset(user.active_chipset, tierLvl),
        content: defaultContent,
      };
    }
  }

  const valRes = await db.query<{ valuable_id: string; quantity: number }>(
    'SELECT valuable_id, quantity FROM user_valuables WHERE user_id = $1 AND quantity > 0',
    [userId]
  );
  const valuables: Record<string, number> = {};
  for (const r of valRes.rows) valuables[r.valuable_id] = r.quantity;

  const goalRes = await db.query<{ goal_id: string; value: number }>(
    'SELECT goal_id, value FROM user_goals WHERE user_id = $1',
    [userId]
  );
  const goals: Record<string, number> = {};
  for (const r of goalRes.rows) goals[r.goal_id] = r.value;

  const parsedSettings = JSON.parse(user.settings_json || '{}');
  const settings: PlayerDto['settings'] = {
    ...DEFAULT_USER_SETTINGS,
    ...parsedSettings,
  };

  const level = getGameLevel(user.xp);
  const nextLevelXp = getXpForLevel(level + 1);

  return {
    id: user.id,
    username: user.username,
    money: user.money,
    xp: user.xp,
    level,
    nextLevelXp,
    biosLevel: user.bios_level,
    activeChipset: user.active_chipset,
    viruses,
    chipsets,
    decks,
    challengeLoadouts,
    valuables,
    goals,
    settings,
  };
}
