import fs from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from './database.js';

const MIGRATION_KEY = 'local_sqlite_import_v1';

interface SqliteMigrationStats {
  importedUsers: number;
  importedSessions: number;
  importedCards: number;
}

/**
 * Imports a legacy local SQLite file (`node:sqlite`, dev-only) into PostgreSQL / PGlite.
 * Preserves users, active sessions (`intrusion_sid`), decks, items, valuables, goals,
 * missions, stolen files/cards, market sales, and challenge history.
 */
export async function importLegacySqliteDatabase(
  db: AppDatabase,
  sqlitePath: string
): Promise<SqliteMigrationStats> {
  if (!fs.existsSync(sqlitePath)) {
    return { importedUsers: 0, importedSessions: 0, importedCards: 0 };
  }

  const sqliteMod = (await import('node:sqlite')) as {
    DatabaseSync: new (p: string) => {
      prepare: (sql: string) => {
        all: (...params: unknown[]) => Array<Record<string, any>>;
      };
      close: () => void;
    };
  };

  const sqlite = new sqliteMod.DatabaseSync(sqlitePath);
  const stats: SqliteMigrationStats = {
    importedUsers: 0,
    importedSessions: 0,
    importedCards: 0,
  };

  try {
    const existingTables = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => String(r.name))
    );
    if (!existingTables.has('users')) {
      return stats;
    }

    const sqliteUsers = sqlite.prepare('SELECT * FROM users ORDER BY id ASC').all();
    if (sqliteUsers.length === 0) {
      return stats;
    }

    const readTable = (table: string, orderBy = ''): Array<Record<string, any>> => {
      if (!existingTables.has(table)) return [];
      return sqlite.prepare(`SELECT * FROM "${table}"${orderBy ? ` ${orderBy}` : ''}`).all();
    };

    const sessions = readTable('sessions');
    const userItems = readTable('user_items');
    const userValuables = readTable('user_valuables');
    const userGoals = readTable('user_goals');
    const decks = readTable('decks', 'ORDER BY slot_index ASC');
    const missions = readTable('missions');
    const stolenFiles = readTable('stolen_files', 'ORDER BY rowid ASC');
    const stolenCards = readTable('stolen_cards', 'ORDER BY rowid ASC');
    const marketSales = readTable('market_sales');
    const challengeRuns = readTable('challenge_runs', 'ORDER BY id ASC');
    const challengeLoadouts = readTable('challenge_loadouts');

    await db.transaction(async (tx) => {
      const userIdMap = new Map<number, number>();
      const richUserIds = new Set<number>();

      for (const u of sqliteUsers) {
        const oldUserId = Number(u.id);
        const eternaltwinId = String(
          u.eternaltwin_user_id ?? u.etwin_user_id ?? `dev:${String(u.username).toLowerCase()}`
        );
        const username = String(u.username ?? 'Operateur');
        const money = Number(u.money ?? 10000);
        const xp = Number(u.xp ?? 3);
        const biosLevel = Number(u.bios_level ?? 1);
        const activeChipset =
          u.active_chipset !== null && u.active_chipset !== undefined
            ? String(u.active_chipset)
            : null;
        const settingsJson = String(u.settings_json ?? '{}');

        const existingRes = await tx.query<{
          id: number;
          money: number;
          xp: number;
          bios_level: number;
        }>('SELECT id, money, xp, bios_level FROM users WHERE eternaltwin_user_id = $1', [
          eternaltwinId,
        ]);
        const existing = existingRes.rows[0];

        if (!existing) {
          const ins = await tx.query<{ id: number }>(
            `INSERT INTO users (eternaltwin_user_id, username, money, xp, bios_level, active_chipset, settings_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [eternaltwinId, username, money, xp, biosLevel, activeChipset, settingsJson]
          );
          const pgUserId = ins.rows[0].id;
          userIdMap.set(oldUserId, pgUserId);
          richUserIds.add(oldUserId);
          stats.importedUsers += 1;
        } else {
          const pgUserId = existing.id;
          userIdMap.set(oldUserId, pgUserId);

          const existingIsFreshDefault =
            existing.xp <= 3 && existing.bios_level === 1 && existing.money === 10000;
          const sqliteIsRicher =
            xp > existing.xp || biosLevel > existing.bios_level || existingIsFreshDefault;

          if (sqliteIsRicher) {
            await tx.query(
              `UPDATE users
               SET username = $1, money = $2, xp = $3, bios_level = $4, active_chipset = $5, settings_json = $6
               WHERE id = $7`,
              [username, money, xp, biosLevel, activeChipset, settingsJson, pgUserId]
            );
            // Clear blank starter rows so migrated SQLite decks/items/missions take precedence cleanly
            await tx.query('DELETE FROM decks WHERE user_id = $1', [pgUserId]);
            await tx.query('DELETE FROM user_items WHERE user_id = $1', [pgUserId]);
            await tx.query('DELETE FROM missions WHERE user_id = $1', [pgUserId]);
            richUserIds.add(oldUserId);
            stats.importedUsers += 1;
          }
        }
      }

      for (const s of sessions) {
        const pgUid = userIdMap.get(Number(s.user_id));
        if (!pgUid || !s.token_hash) continue;
        await tx.query(
          `INSERT INTO sessions (token_hash, user_id, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (token_hash) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             expires_at = GREATEST(sessions.expires_at, EXCLUDED.expires_at)`,
          [String(s.token_hash), pgUid, Number(s.expires_at)]
        );
        stats.importedSessions += 1;
      }

      for (const item of userItems) {
        const oldUid = Number(item.user_id);
        const pgUid = userIdMap.get(oldUid);
        if (!pgUid || !richUserIds.has(oldUid)) continue;
        await tx.query(
          `INSERT INTO user_items (user_id, item_type, item_id, quantity)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET
             quantity = GREATEST(user_items.quantity, EXCLUDED.quantity)`,
          [
            pgUid,
            String(item.item_type),
            String(item.item_id),
            Math.max(1, Number(item.quantity ?? 1)),
          ]
        );
      }

      for (const val of userValuables) {
        const pgUid = userIdMap.get(Number(val.user_id));
        if (!pgUid) continue;
        await tx.query(
          `INSERT INTO user_valuables (user_id, valuable_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, valuable_id) DO UPDATE SET
             quantity = GREATEST(user_valuables.quantity, EXCLUDED.quantity)`,
          [pgUid, String(val.valuable_id), Number(val.quantity ?? 0)]
        );
      }

      for (const goal of userGoals) {
        const pgUid = userIdMap.get(Number(goal.user_id));
        if (!pgUid) continue;
        await tx.query(
          `INSERT INTO user_goals (user_id, goal_id, value)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, goal_id) DO UPDATE SET
             value = GREATEST(user_goals.value, EXCLUDED.value)`,
          [pgUid, String(goal.goal_id), Number(goal.value ?? 0)]
        );
      }

      for (const d of decks) {
        const oldUid = Number(d.user_id);
        const pgUid = userIdMap.get(oldUid);
        if (!pgUid || !richUserIds.has(oldUid)) continue;
        const slotIndex = Number(d.slot_index ?? 0);
        const deckId = pgUid === oldUid ? String(d.id) : `deck_${pgUid}_${slotIndex}`;
        await tx.query(
          `INSERT INTO decks (id, user_id, slot_index, name, capacity, is_favorite, content_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             capacity = EXCLUDED.capacity,
             is_favorite = EXCLUDED.is_favorite,
             content_json = EXCLUDED.content_json`,
          [
            deckId,
            pgUid,
            slotIndex,
            String(d.name ?? 'Deck Principal'),
            Number(d.capacity ?? 3),
            Number(d.is_favorite ?? 0),
            String(d.content_json ?? '[]'),
          ]
        );
      }

      for (const m of missions) {
        const oldUid = Number(m.user_id);
        const pgUid = userIdMap.get(oldUid);
        if (!pgUid || !richUserIds.has(oldUid)) continue;
        await tx.query(
          `INSERT INTO missions (mission_key, user_id, seed, level, prime, status, tries, scout_run, created_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (user_id, mission_key) DO NOTHING`,
          [
            String(m.mission_key),
            pgUid,
            Number(m.seed),
            Number(m.level),
            Number(m.prime),
            String(m.status),
            Number(m.tries ?? 0),
            Number(m.scout_run ?? 0),
            Number(m.created_at),
            m.completed_at !== null && m.completed_at !== undefined
              ? Number(m.completed_at)
              : null,
          ]
        );
      }

      for (const f of stolenFiles) {
        const pgUid = userIdMap.get(Number(f.user_id));
        if (!pgUid) continue;
        await tx.query(
          `INSERT INTO stolen_files (id, user_id, name, content, embed, copied_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [
            String(f.id),
            pgUid,
            String(f.name),
            String(f.content),
            f.embed !== null && f.embed !== undefined ? String(f.embed) : null,
            String(f.copied_at ?? new Date().toISOString()),
          ]
        );
      }

      for (const c of stolenCards) {
        const pgUid = userIdMap.get(Number(c.user_id));
        if (!pgUid) continue;
        await tx.query(
          `INSERT INTO stolen_cards (id, user_id, holder, card_number, amount, redeemed, captured_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, id) DO UPDATE SET
             redeemed = GREATEST(stolen_cards.redeemed, EXCLUDED.redeemed)`,
          [
            String(c.id),
            pgUid,
            String(c.holder),
            String(c.card_number),
            Number(c.amount ?? 0),
            Number(c.redeemed ?? 0),
            String(c.captured_at ?? new Date().toISOString()),
          ]
        );
        stats.importedCards += 1;
      }

      for (const ms of marketSales) {
        const pgUid = userIdMap.get(Number(ms.user_id));
        if (!pgUid) continue;
        await tx.query(
          `INSERT INTO market_sales (user_id, sale_date, sold_count)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, sale_date) DO UPDATE SET
             sold_count = GREATEST(market_sales.sold_count, EXCLUDED.sold_count)`,
          [pgUid, String(ms.sale_date), Number(ms.sold_count ?? 0)]
        );
      }

      for (const cr of challengeRuns) {
        const pgUid = userIdMap.get(Number(cr.user_id));
        if (!pgUid) continue;
        const cDate = String(cr.challenge_date);
        const cLvl = Number(cr.challenge_level ?? 7);
        const cScore = Number(cr.score ?? 0);
        const cCreated = String(cr.created_at ?? '');
        const dup = await tx.query<{ id: number }>(
          `SELECT id FROM challenge_runs
           WHERE challenge_date = $1 AND challenge_level = $2 AND user_id = $3 AND score = $4 AND created_at = $5
           LIMIT 1`,
          [cDate, cLvl, pgUid, cScore, cCreated]
        );
        if (dup.rows.length === 0) {
          await tx.query(
            `INSERT INTO challenge_runs (challenge_date, challenge_level, user_id, username, score, success, remaining_sec, kills, is_ranked, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              cDate,
              cLvl,
              pgUid,
              String(cr.username ?? 'Operateur'),
              cScore,
              Number(cr.success ?? 0),
              Number(cr.remaining_sec ?? 0),
              Number(cr.kills ?? 0),
              Number(cr.is_ranked ?? 1),
              cCreated,
            ]
          );
        }
      }

      for (const cl of challengeLoadouts) {
        const pgUid = userIdMap.get(Number(cl.user_id));
        if (!pgUid) continue;
        await tx.query(
          `INSERT INTO challenge_loadouts (user_id, challenge_level, chipset_id, content_json)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, challenge_level) DO UPDATE SET
             chipset_id = EXCLUDED.chipset_id,
             content_json = EXCLUDED.content_json`,
          [
            pgUid,
            Number(cl.challenge_level),
            cl.chipset_id !== null && cl.chipset_id !== undefined ? String(cl.chipset_id) : null,
            String(cl.content_json ?? '[]'),
          ]
        );
      }

      await tx.query(
        "SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1), true)"
      );
      await tx.query(
        "SELECT setval(pg_get_serial_sequence('challenge_runs', 'id'), COALESCE((SELECT MAX(id) FROM challenge_runs), 1), true)"
      );
    });

    return stats;
  } finally {
    sqlite.close();
  }
}

export async function migrateLocalSqliteIfNeeded(
  db: AppDatabase,
  repoRoot: string,
  force = false
): Promise<void> {
  // Store migration state INSIDE PostgreSQL itself (immune to multi-process PGlite flush races)
  await db.query(`
    CREATE TABLE IF NOT EXISTS _local_migrations (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  if (!force) {
    const doneRes = await db.query<{ key: string }>(
      'SELECT key FROM _local_migrations WHERE key = $1',
      [MIGRATION_KEY]
    );
    if (doneRes.rows.length > 0) {
      return;
    }
  }

  const candidatePaths = [
    path.join(repoRoot, 'data', 'intrusion.sqlite'),
    path.join(repoRoot, 'packages', 'server', 'data', 'intrusion.sqlite'),
  ].filter((p) => fs.existsSync(p));

  if (candidatePaths.length === 0) {
    return;
  }

  let totalUsers = 0;
  let totalSessions = 0;
  let totalCards = 0;

  for (const sqliteFile of candidatePaths) {
    const res = await importLegacySqliteDatabase(db, sqliteFile);
    totalUsers += res.importedUsers;
    totalSessions += res.importedSessions;
    totalCards += res.importedCards;
  }

  await db.query(
    `INSERT INTO _local_migrations (key) VALUES ($1)
     ON CONFLICT (key) DO UPDATE SET applied_at = NOW()`,
    [MIGRATION_KEY]
  );

  // Clean up obsolete external file marker if present
  const oldMarker = path.join(repoRoot, 'data', '.sqlite-migrated-v1.json');
  if (fs.existsSync(oldMarker)) {
    fs.rmSync(oldMarker, { force: true });
  }

  console.log(
    `[Intrusion Local Migration] Données locales SQLite importées vers PostgreSQL (${totalUsers} compte(s), ${totalSessions} session(s), ${totalCards} carte(s)).`
  );
}
