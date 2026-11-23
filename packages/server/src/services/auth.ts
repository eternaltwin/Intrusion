import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  getGameLevel,
  getXpForLevel,
  type GameDataBundle,
  type PlayerDto,
} from '@intrusion/shared';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 365; // 1 year

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

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function createSession(db: DatabaseSync, userId: number): string {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  );
  return token;
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getUserIdFromSession(db: DatabaseSync, token: string | undefined): number | null {
  if (!token) return null;
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { user_id: number; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(db, token);
    return null;
  }
  return row.user_id;
}

export function registerNewUser(
  db: DatabaseSync,
  catalog: GameDataBundle,
  username: string,
  password: string
): number {
  const startingViruses = Array.from(catalog.viruses.values())
    .filter((v) => v.start)
    .map((v) => v.id);

  const hash = hashPassword(password);
  const res = db
    .prepare(
      'INSERT INTO users (username, password_hash, money, xp, bios_level, active_chipset, settings_json) VALUES (?, ?, 10000, 3, 1, NULL, ?)'
    )
    .run(username, hash, JSON.stringify(DEFAULT_USER_SETTINGS));

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

export function buildPlayerDto(db: DatabaseSync, userId: number): PlayerDto | null {
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
  for (const i of items) {
    if (i.item_type === 'virus') {
      const qty = Math.max(1, i.quantity ?? 1);
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
    decks: deckRows.map((d) => ({
      id: d.id,
      slotIndex: d.slot_index,
      name: d.name,
      capacity: d.capacity,
      isFavorite: d.is_favorite === 1,
      content: JSON.parse(d.content_json || '[]'),
    })),
    valuables,
    goals,
    settings,
  };
}
