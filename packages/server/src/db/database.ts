import fs from 'node:fs';
import path from 'node:path';
import pg, { type PoolConfig } from 'pg';

// Parse PostgreSQL INT8 / BIGINT (OID 20) into JS number (safe up to Number.MAX_SAFE_INTEGER = 9e15, covers epoch ms & counts)
pg.types.setTypeParser(20, (val: string) => Number(val));

export interface DbQueryResult<TRow = Record<string, any>> {
  rows: TRow[];
  rowCount: number;
}

export interface DbExecutor {
  query<TRow = Record<string, any>>(
    text: string,
    params?: unknown[]
  ): Promise<DbQueryResult<TRow>>;
}

export interface AppDatabase extends DbExecutor {
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function sanitizePgConnectionString(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    // Strip Doctrine/Symfony-specific query params injected by Katal (?version=17&charset=utf8)
    const charset = parsed.searchParams.get('charset');
    parsed.searchParams.delete('version');
    parsed.searchParams.delete('serverVersion');
    parsed.searchParams.delete('charset');
    if (charset && !parsed.searchParams.has('client_encoding')) {
      parsed.searchParams.set('client_encoding', charset);
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function resolvePgPoolConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const max = Math.max(1, parseInt(env.DB_POOL_MAX ?? '10', 10) || 10);
  const rawSsl = (env.DATABASE_SSL ?? env.DB_SSL ?? env.PGSSLMODE ?? '').trim().toLowerCase();
  const ssl =
    rawSsl === 'true' || rawSsl === '1' || rawSsl === 'require' || rawSsl === 'no-verify'
      ? { rejectUnauthorized: rawSsl !== 'no-verify' }
      : undefined;

  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl && !databaseUrl.startsWith('pglite://')) {
    return {
      connectionString: sanitizePgConnectionString(databaseUrl),
      max,
      ...(ssl ? { ssl } : {}),
    };
  }

  const host = (env.DATABASE_HOST ?? env.DB_HOST ?? env.PGHOST ?? '127.0.0.1').trim();
  const port =
    parseInt(env.DATABASE_PORT ?? env.DB_PORT ?? env.PGPORT ?? '5432', 10) || 5432;
  const database = (env.DATABASE_NAME ?? env.DB_NAME ?? env.PGDATABASE ?? 'intrusion').trim();
  const user = (
    env.DATABASE_USERNAME ??
    env.DATABASE_USER ??
    env.DB_USER ??
    env.PGUSER ??
    'intrusion'
  ).trim();
  const password = env.DATABASE_PASSWORD ?? env.DB_PASSWORD ?? env.PGPASSWORD ?? '';

  return {
    host,
    port,
    database,
    user,
    password,
    max,
    ...(ssl ? { ssl } : {}),
  };
}

export function createPgPoolDatabase(poolConfig: PoolConfig): AppDatabase {
  const pool = new pg.Pool(poolConfig);

  return {
    async query<TRow = Record<string, any>>(
      text: string,
      params?: unknown[]
    ): Promise<DbQueryResult<TRow>> {
      const res = await pool.query(text, params as any[] | undefined);
      return {
        rows: res.rows as TRow[],
        rowCount: res.rowCount ?? 0,
      };
    },

    async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txExecutor: DbExecutor = {
          async query<TRow = Record<string, any>>(
            text: string,
            params?: unknown[]
          ): Promise<DbQueryResult<TRow>> {
            const res = await client.query(text, params as any[] | undefined);
            return {
              rows: res.rows as TRow[],
              rowCount: res.rowCount ?? 0,
            };
          },
        };
        const result = await fn(txExecutor);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}

/**
 * Embedded PostgreSQL (PGlite WASM) adapter strictly for automated tests and optional
 * offline local development (`NODE_ENV !== 'production'`).
 * Dynamically imported so production deployments only depend on `pg`.
 */
export async function createPgliteDatabase(dataDir?: string): Promise<AppDatabase> {
  if (dataDir) {
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  }

  const pgliteMod = (await import('@electric-sql/pglite' as string)) as {
    PGlite: new (
      dataDir?: string,
      options?: Record<string, unknown>
    ) => {
      query: (
        text: string,
        params?: unknown[]
      ) => Promise<{ rows: any[]; affectedRows?: number }>;
      close: () => Promise<void>;
    };
  };

  const instance = new pgliteMod.PGlite(dataDir, {
    parsers: {
      20: (val: string) => Number(val),
    },
  });

  // Serialize top-level operations & transactions on single-connection PGlite
  let queue: Promise<void> = Promise.resolve();
  function runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const prev = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    return prev.then(work).finally(() => release());
  }

  const rawQuery = async <TRow = Record<string, any>>(
    text: string,
    params?: unknown[]
  ): Promise<DbQueryResult<TRow>> => {
    const res = await instance.query(text, params);
    return {
      rows: res.rows as TRow[],
      rowCount: res.affectedRows ?? res.rows.length,
    };
  };

  return {
    query<TRow = Record<string, any>>(
      text: string,
      params?: unknown[]
    ): Promise<DbQueryResult<TRow>> {
      return runExclusive(() => rawQuery<TRow>(text, params));
    },

    transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
      return runExclusive(async () => {
        await instance.query('BEGIN');
        try {
          const out = await fn({ query: rawQuery });
          await instance.query('COMMIT');
          return out;
        } catch (err) {
          await instance.query('ROLLBACK').catch(() => {});
          throw err;
        }
      });
    },

    async close(): Promise<void> {
      await runExclusive(() => instance.close());
    },
  };
}

export async function openDatabaseFromEnv(
  env: NodeJS.ProcessEnv,
  isProduction: boolean,
  repoRoot: string
): Promise<AppDatabase> {
  const rawUrl = env.DATABASE_URL?.trim() ?? '';

  if (rawUrl.startsWith('pglite://')) {
    if (isProduction) {
      throw new Error(
        '[Intrusion DB] pglite:// est interdit en production (NODE_ENV=production). Configurez PostgreSQL via DATABASE_URL ou DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.'
      );
    }
    const target = rawUrl.slice('pglite://'.length).trim();
    const isInMemory = !target || target === 'memory' || target === ':memory:';
    const dataDir = isInMemory ? undefined : path.resolve(repoRoot, target);
    const db = await createPgliteDatabase(dataDir);
    await initDatabaseSchema(db);
    if (!isInMemory && !env.VITEST) {
      const { migrateLocalSqliteIfNeeded } = await import('./localSqliteMigration.js');
      await migrateLocalSqliteIfNeeded(db, repoRoot);
    }
    return db;
  }

  const poolConfig = resolvePgPoolConfig(env);
  const db = createPgPoolDatabase(poolConfig);
  await initDatabaseSchema(db);
  if (!isProduction && !env.VITEST) {
    const { migrateLocalSqliteIfNeeded } = await import('./localSqliteMigration.js');
    await migrateLocalSqliteIfNeeded(db, repoRoot);
  }
  return db;
}

export async function initDatabaseSchema(db: AppDatabase): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      eternaltwin_user_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      money INTEGER NOT NULL DEFAULT 10000,
      xp INTEGER NOT NULL DEFAULT 3,
      bios_level INTEGER NOT NULL DEFAULT 1,
      active_chipset TEXT DEFAULT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Safe column rename if an earlier dev schema used `etwin_user_id`
  const legacyColCheck = await db.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'etwin_user_id'`
  );
  if (legacyColCheck.rows.length > 0) {
    await db.query('ALTER TABLE users RENAME COLUMN etwin_user_id TO eternaltwin_user_id');
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_items (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK (item_type IN ('virus', 'chipset')),
      item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, item_type, item_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_valuables (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      valuable_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, valuable_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_goals (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      goal_id TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, goal_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slot_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 3,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      content_json TEXT NOT NULL DEFAULT '[]'
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS missions (
      mission_key TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seed INTEGER NOT NULL,
      level INTEGER NOT NULL,
      prime INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('available', 'active', 'completed')),
      tries INTEGER NOT NULL DEFAULT 0,
      scout_run INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      completed_at BIGINT DEFAULT NULL,
      PRIMARY KEY (user_id, mission_key)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stolen_files (
      seq BIGSERIAL UNIQUE,
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      embed TEXT DEFAULT NULL,
      copied_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stolen_cards (
      seq BIGSERIAL UNIQUE,
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      holder TEXT NOT NULL,
      card_number TEXT NOT NULL,
      amount INTEGER NOT NULL,
      redeemed INTEGER NOT NULL DEFAULT 0,
      captured_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      PRIMARY KEY (user_id, id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS market_sales (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sale_date TEXT NOT NULL,
      sold_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, sale_date)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS challenge_runs (
      id SERIAL PRIMARY KEY,
      challenge_date TEXT NOT NULL,
      challenge_level INTEGER NOT NULL DEFAULT 7,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      score INTEGER NOT NULL,
      success INTEGER NOT NULL,
      remaining_sec INTEGER NOT NULL,
      kills INTEGER NOT NULL,
      is_ranked INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS challenge_loadouts (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_level INTEGER NOT NULL CHECK (challenge_level IN (5, 7, 9)),
      chipset_id TEXT DEFAULT NULL,
      content_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (user_id, challenge_level)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS challenge_active_runs (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_date TEXT NOT NULL,
      challenge_level INTEGER NOT NULL,
      scout_run INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, challenge_date, challenge_level)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_challenge_runs_leaderboard
      ON challenge_runs (is_ranked, success, challenge_date, challenge_level, score DESC, remaining_sec DESC, id ASC)
  `);

  // Backfill first-try challenge completions (challenge_pass_5 / 7 / 9) from challenge_runs
  await db.query(`
    INSERT INTO user_goals (user_id, goal_id, value)
    SELECT user_id, 'challenge_pass_' || challenge_level::text, COUNT(*)::int
    FROM challenge_runs
    WHERE is_ranked = 1 AND success = 1 AND challenge_level IN (5, 7, 9)
    GROUP BY user_id, challenge_level
    ON CONFLICT (user_id, goal_id) DO UPDATE SET
      value = GREATEST(user_goals.value, EXCLUDED.value)
  `);

  // Backfill cards_redeemed goal from already-redeemed stolen_cards rows
  await db.query(`
    INSERT INTO user_goals (user_id, goal_id, value)
    SELECT user_id, 'cards_redeemed', COUNT(*)::int
    FROM stolen_cards
    WHERE redeemed = 1
    GROUP BY user_id
    ON CONFLICT (user_id, goal_id) DO UPDATE SET
      value = GREATEST(user_goals.value, EXCLUDED.value)
  `);

  // Ensure existing decks do not exceed owned virus quantities across a user's decks
  const usersRes = await db.query<{ id: number }>('SELECT id FROM users');
  for (const u of usersRes.rows) {
    const ownedRes = await db.query<{ item_id: string; quantity: number }>(
      "SELECT item_id, quantity FROM user_items WHERE user_id = $1 AND item_type = 'virus'",
      [u.id]
    );
    const remaining = new Map<string, number>();
    for (const r of ownedRes.rows) {
      remaining.set(r.item_id, Math.max(1, r.quantity ?? 1));
    }

    const deckRes = await db.query<{ id: string; content_json: string }>(
      'SELECT id, content_json FROM decks WHERE user_id = $1 ORDER BY is_favorite DESC, slot_index ASC',
      [u.id]
    );
    for (const d of deckRes.rows) {
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
        await db.query('UPDATE decks SET content_json = $1 WHERE id = $2', [
          JSON.stringify(filtered),
          d.id,
        ]);
      }
    }
  }
}
