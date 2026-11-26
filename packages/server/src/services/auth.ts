import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
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

export interface EtwinOauthConfig {
  internalUrl: string;
  externalUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scope?: string;
}

export interface EtwinIdentity {
  etwinUserId: string;
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

export function buildEtwinAuthorizationUrl(config: EtwinOauthConfig, state: string): string {
  const base = config.externalUrl.replace(/\/+$/, '');
  const authUrl = new URL(`${base}/oauth/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', config.callbackUrl);
  authUrl.searchParams.set('scope', config.scope || 'base');
  authUrl.searchParams.set('state', state);
  return authUrl.toString();
}

const ALLOWED_ETWIN_AUTH_CONTEXT_TYPES = new Set([
  'user',
  'accesstoken',
  'access_token',
  'oauthaccesstoken',
  'oauth_access_token',
]);

export function parseEtwinSelfIdentity(payload: unknown): EtwinIdentity {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Profil Eternaltwin invalide.');
  }
  const root = payload as Record<string, any>;
  if (
    typeof root.type === 'string' &&
    !ALLOWED_ETWIN_AUTH_CONTEXT_TYPES.has(root.type.trim().toLowerCase())
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
    etwinUserId: rawId,
    displayName: cleanDisplay,
  };
}

/**
 * Exchanges an Eternaltwin authorization code for an access token over HTTP,
 * queries `/api/v1/auth/self` in memory, and discards `access_token` immediately
 * without ever persisting or logging it (Charte Eternaltwin — Article 4).
 */
export async function exchangeEtwinCodeForIdentity(
  config: EtwinOauthConfig,
  code: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<EtwinIdentity> {
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
    throw new Error(`Échec de l'échange OAuth Eternaltwin (HTTP ${tokenRes.status}${oauthErrCode}).`);
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
  return parseEtwinSelfIdentity(selfJson);
}

export function createSession(db: DatabaseSync, userId: number): string {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    tokenHash,
    userId,
    expiresAt
  );
  return rawToken;
}

export function deleteSession(db: DatabaseSync, rawToken: string): void {
  const tokenHash = hashSessionToken(rawToken);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function getUserIdFromSession(
  db: DatabaseSync,
  rawToken: string | undefined
): number | null {
  if (!rawToken) return null;
  const tokenHash = hashSessionToken(rawToken);
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: number; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return row.user_id;
}

export function upsertEtwinUser(
  db: DatabaseSync,
  catalog: GameDataBundle,
  etwinUserId: string,
  displayName: string
): number {
  const cleanName = displayName.trim().slice(0, 32) || 'Operateur';
  const existing = db
    .prepare('SELECT id, username FROM users WHERE etwin_user_id = ?')
    .get(etwinUserId) as { id: number; username: string } | undefined;

  if (existing) {
    if (existing.username !== cleanName) {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(cleanName, existing.id);
    }
    return existing.id;
  }

  const startingViruses = Array.from(catalog.viruses.values())
    .filter((v) => v.start)
    .map((v) => v.id);

  const res = db
    .prepare(
      'INSERT INTO users (etwin_user_id, username, money, xp, bios_level, active_chipset, settings_json) VALUES (?, ?, 10000, 3, 1, NULL, ?)'
    )
    .run(etwinUserId, cleanName, JSON.stringify(DEFAULT_USER_SETTINGS));

  const userId = Number(res.lastInsertRowid);
  const insertItem = db.prepare(
    'INSERT INTO user_items (user_id, item_type, item_id) VALUES (?, ?, ?)'
  );
  for (const vid of startingViruses) {
    insertItem.run(userId, 'virus', vid);
  }

  db.prepare(
    'INSERT INTO decks (id, user_id, slot_index, name, capacity, is_favorite, content_json) VALUES (?, ?, 0, ?, 3, 1, ?)'
  ).run(`deck_${userId}_0`, userId, 'Deck Principal', JSON.stringify(startingViruses.slice(0, 3)));

  return userId;
}

function localTodayDateStr(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function syncUserChallengeGoals(
  db: DatabaseSync,
  userId: number,
  todayStr = localTodayDateStr()
): void {
  // 1) First-try ranked wins per difficulty (immediate)
  db.prepare(
    `INSERT INTO user_goals (user_id, goal_id, value)
     SELECT user_id, 'challenge_pass_' || challenge_level, COUNT(*)
     FROM challenge_runs
     WHERE user_id = ? AND is_ranked = 1 AND success = 1 AND challenge_level IN (5, 7, 9)
     GROUP BY user_id, challenge_level
     ON CONFLICT(user_id, goal_id) DO UPDATE SET
       value = MAX(user_goals.value, excluded.value)`
  ).run(userId);

  // 2) End-of-day Top 3 podiums per difficulty (awarded once challenge_date < todayStr)
  db.prepare(
    `WITH ranked AS (
       SELECT
         user_id,
         challenge_level,
         ROW_NUMBER() OVER (
           PARTITION BY challenge_date, challenge_level
           ORDER BY score DESC, remaining_sec DESC, id ASC
         ) AS rn
       FROM challenge_runs
       WHERE is_ranked = 1 AND success = 1 AND challenge_date < ? AND challenge_level IN (5, 7, 9)
     )
     INSERT INTO user_goals (user_id, goal_id, value)
     SELECT user_id, 'challenge_top3_' || challenge_level, COUNT(*)
     FROM ranked
     WHERE user_id = ? AND rn <= 3
     GROUP BY user_id, challenge_level
     ON CONFLICT(user_id, goal_id) DO UPDATE SET
       value = MAX(user_goals.value, excluded.value)`
  ).run(todayStr, userId);
}

export function buildPlayerDto(
  db: DatabaseSync,
  userId: number,
  bundle?: GameDataBundle
): PlayerDto | null {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | {
        id: number;
        username: string;
        money: number;
        xp: number;
        bios_level: number;
        active_chipset: string | null;
        settings_json: string;
      }
    | undefined;
  if (!user) return null;

  syncUserChallengeGoals(db, userId);

  const items = db
    .prepare('SELECT item_type, item_id, quantity FROM user_items WHERE user_id = ?')
    .all(userId) as Array<{ item_type: string; item_id: string; quantity: number }>;

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

  const deckRows = db
    .prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY slot_index ASC')
    .all(userId) as Array<{
    id: string;
    slot_index: number;
    name: string;
    capacity: number;
    is_favorite: number;
    content_json: string;
  }>;

  const decks = deckRows.map((d) => ({
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

  const loadoutRows = db
    .prepare(
      'SELECT challenge_level, chipset_id, content_json FROM challenge_loadouts WHERE user_id = ?'
    )
    .all(userId) as Array<{
    challenge_level: number;
    chipset_id: string | null;
    content_json: string;
  }>;
  const savedByTier = new Map<number, { chipsetId: string | null; content: string[] }>();
  for (const row of loadoutRows) {
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

  const valRows = db
    .prepare('SELECT valuable_id, quantity FROM user_valuables WHERE user_id = ? AND quantity > 0')
    .all(userId) as Array<{ valuable_id: string; quantity: number }>;
  const valuables: Record<string, number> = {};
  for (const r of valRows) valuables[r.valuable_id] = r.quantity;

  const goalRows = db
    .prepare('SELECT goal_id, value FROM user_goals WHERE user_id = ?')
    .all(userId) as Array<{ goal_id: string; value: number }>;
  const goals: Record<string, number> = {};
  for (const r of goalRows) goals[r.goal_id] = r.value;

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
