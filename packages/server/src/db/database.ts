import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');

  // Migrate legacy local-password `users` table if present so zero password hashes remain stored (Charte ET Art. 4)
  const existingUsersCols = db.prepare("PRAGMA table_info('users')").all() as Array<{ name: string }>;
  const hasLegacyPasswordCol = existingUsersCols.some((c) => c.name === 'password_hash');
  const hasEtwinCol = existingUsersCols.some((c) => c.name === 'etwin_user_id');

  if (existingUsersCols.length > 0 && (hasLegacyPasswordCol || !hasEtwinCol)) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        CREATE TABLE users_etwin_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          etwin_user_id TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL COLLATE NOCASE,
          money INTEGER NOT NULL DEFAULT 10000,
          xp INTEGER NOT NULL DEFAULT 3,
          bios_level INTEGER NOT NULL DEFAULT 1,
          active_chipset TEXT DEFAULT NULL,
          settings_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      if (hasEtwinCol) {
        db.exec(`
          INSERT INTO users_etwin_new (id, etwin_user_id, username, money, xp, bios_level, active_chipset, settings_json, created_at)
          SELECT id, COALESCE(etwin_user_id, 'legacy:' || id), username, money, xp, bios_level, active_chipset, settings_json, created_at
          FROM users;
        `);
      } else {
        db.exec(`
          INSERT INTO users_etwin_new (id, etwin_user_id, username, money, xp, bios_level, active_chipset, settings_json, created_at)
          SELECT id, 'dev:' || lower(username), username, money, xp, bios_level, active_chipset, settings_json, created_at
          FROM users;
        `);
      }
      db.exec('DROP TABLE users;');
      db.exec('ALTER TABLE users_etwin_new RENAME TO users;');
      db.exec('COMMIT;');
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }

  // Migrate legacy plaintext `sessions(token)` table to `sessions(token_hash)` (SHA-256 only, zero cleartext tokens)
  const existingSessionCols = db.prepare("PRAGMA table_info('sessions')").all() as Array<{ name: string }>;
  if (existingSessionCols.length > 0 && !existingSessionCols.some((c) => c.name === 'token_hash')) {
    db.exec('DROP TABLE sessions;');
  }

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      etwin_user_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL COLLATE NOCASE,
      money INTEGER NOT NULL DEFAULT 10000,
      xp INTEGER NOT NULL DEFAULT 3,
      bios_level INTEGER NOT NULL DEFAULT 1,
      active_chipset TEXT DEFAULT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_items (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('virus', 'chipset')),
      item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, item_type, item_id)
    );

    CREATE TABLE IF NOT EXISTS user_valuables (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      valuable_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, valuable_id)
    );

    CREATE TABLE IF NOT EXISTS user_goals (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      goal_id TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, goal_id)
    );

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slot_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 3,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      content_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS missions (
      mission_key TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seed INTEGER NOT NULL,
      level INTEGER NOT NULL,
      prime INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('available', 'active', 'completed')),
      tries INTEGER NOT NULL DEFAULT 0,
      scout_run INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      completed_at INTEGER DEFAULT NULL,
      PRIMARY KEY (user_id, mission_key)
    );

    CREATE TABLE IF NOT EXISTS stolen_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      embed TEXT DEFAULT NULL,
      copied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stolen_cards (
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      holder TEXT NOT NULL,
      card_number TEXT NOT NULL,
      amount INTEGER NOT NULL,
      redeemed INTEGER NOT NULL DEFAULT 0,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS market_sales (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sale_date TEXT NOT NULL,
      sold_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, sale_date)
    );

    CREATE TABLE IF NOT EXISTS challenge_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_date TEXT NOT NULL,
      challenge_level INTEGER NOT NULL DEFAULT 7,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      score INTEGER NOT NULL,
      success INTEGER NOT NULL,
      remaining_sec INTEGER NOT NULL,
      kills INTEGER NOT NULL,
      is_ranked INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS challenge_loadouts (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_level INTEGER NOT NULL CHECK(challenge_level IN (5, 7, 9)),
      chipset_id TEXT DEFAULT NULL,
      content_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (user_id, challenge_level)
    );

    CREATE TABLE IF NOT EXISTS challenge_active_runs (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_date TEXT NOT NULL,
      challenge_level INTEGER NOT NULL,
      scout_run INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, challenge_date, challenge_level)
    );
  `);

  // Safe schema migration: add quantity column to user_items if missing on existing DBs
  const userItemsCols = db.prepare("PRAGMA table_info('user_items')").all() as Array<{ name: string }>;
  if (!userItemsCols.some((c) => c.name === 'quantity')) {
    db.exec('ALTER TABLE user_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;');
  }

  // Safe schema migration: add scout_run column to missions if missing on existing DBs
  const missionCols = db.prepare("PRAGMA table_info('missions')").all() as Array<{ name: string }>;
  if (!missionCols.some((c) => c.name === 'scout_run')) {
    db.exec('ALTER TABLE missions ADD COLUMN scout_run INTEGER NOT NULL DEFAULT 0;');
  }

  // Safe schema migration: add challenge_level column to challenge_runs if missing on existing DBs
  const challengeCols = db.prepare("PRAGMA table_info('challenge_runs')").all() as Array<{ name: string }>;
  if (!challengeCols.some((c) => c.name === 'challenge_level')) {
    db.exec('ALTER TABLE challenge_runs ADD COLUMN challenge_level INTEGER NOT NULL DEFAULT 7;');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_challenge_runs_leaderboard
      ON challenge_runs (is_ranked, success, challenge_date, challenge_level, score DESC, remaining_sec DESC, id ASC);
  `);

  // Backfill first-try challenge completions (challenge_pass_5 / 7 / 9) from challenge_runs
  db.exec(`
    INSERT INTO user_goals (user_id, goal_id, value)
    SELECT user_id, 'challenge_pass_' || challenge_level, COUNT(*)
    FROM challenge_runs
    WHERE is_ranked = 1 AND success = 1 AND challenge_level IN (5, 7, 9)
    GROUP BY user_id, challenge_level
    ON CONFLICT(user_id, goal_id) DO UPDATE SET
      value = MAX(user_goals.value, excluded.value);
  `);

  // Backfill cards_redeemed goal from already-redeemed stolen_cards rows
  db.exec(`
    INSERT INTO user_goals (user_id, goal_id, value)
    SELECT user_id, 'cards_redeemed', COUNT(*)
    FROM stolen_cards
    WHERE redeemed = 1
    GROUP BY user_id
    ON CONFLICT(user_id, goal_id) DO UPDATE SET
      value = MAX(user_goals.value, excluded.value);
  `);

  // Ensure existing decks do not exceed owned virus quantities across a user's decks
  const usersRows = db.prepare('SELECT id FROM users').all() as Array<{ id: number }>;
  for (const u of usersRows) {
    const ownedRows = db
      .prepare("SELECT item_id, quantity FROM user_items WHERE user_id = ? AND item_type = 'virus'")
      .all(u.id) as Array<{ item_id: string; quantity: number }>;
    const remaining = new Map<string, number>();
    for (const r of ownedRows) remaining.set(r.item_id, Math.max(1, r.quantity ?? 1));

    const deckRows = db
      .prepare('SELECT id, content_json FROM decks WHERE user_id = ? ORDER BY is_favorite DESC, slot_index ASC')
      .all(u.id) as Array<{ id: string; content_json: string }>;
    for (const d of deckRows) {
      const content: string[] = JSON.parse(d.content_json || '[]');
      const filtered: string[] = [];
      let changed = false;
      for (const vid of content) {
        const left = remaining.get(vid) ?? 0;
        if (left > 0) {
          filtered.push(vid);
          remaining.set(vid, left - 1);
        } else {
          changed = true;
        }
      }
      if (changed) {
        db.prepare('UPDATE decks SET content_json = ? WHERE id = ?').run(JSON.stringify(filtered), d.id);
      }
    }
  }

  return db;
}
