import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      money INTEGER NOT NULL DEFAULT 10000,
      xp INTEGER NOT NULL DEFAULT 3,
      bios_level INTEGER NOT NULL DEFAULT 1,
      active_chipset TEXT DEFAULT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_items (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('virus', 'chipset')),
      item_id TEXT NOT NULL,
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
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      score INTEGER NOT NULL,
      success INTEGER NOT NULL,
      remaining_sec INTEGER NOT NULL,
      kills INTEGER NOT NULL,
      is_ranked INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}
