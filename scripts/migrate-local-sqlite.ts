import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabaseFromEnv } from '../packages/server/src/db/database.js';
import { migrateLocalSqliteIfNeeded } from '../packages/server/src/db/localSqliteMigration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env');

if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const isProduction =
  process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';

if (isProduction) {
  console.error('Migration locale SQLite désactivée en mode production.');
  process.exit(1);
}

const db = await openDatabaseFromEnv(process.env, false, repoRoot);
await migrateLocalSqliteIfNeeded(db, repoRoot, true);
await db.close();
