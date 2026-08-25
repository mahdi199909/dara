// On-device SQLite access, abstracted behind an interface shaped like
// @capacitor-community/sqlite's own API (execute/run/query) so swapping in the real Capacitor
// plugin (Phase 6) is a driver swap, not a rewrite of every repository.
//
// This file intentionally takes a pre-built driver rather than importing one itself — the
// better-sqlite3-backed test driver (src/local/drivers/nodeSqlite.ts) is a Node native addon
// that must never end up in the browser bundle apiClient.ts ships on the web build, and this
// module sits on the import chain apiClient.ts -> localDispatcher.ts -> here. Only test files
// import the Node driver directly; production (Phase 6) will do the same with a Capacitor
// driver instead.
import { LOCAL_SCHEMA_MIGRATIONS, LOCAL_SCHEMA_SQL } from "./generatedSchema";

export interface LocalDb {
  run(sql: string, params?: unknown[]): { changes: number };
  get<T = unknown>(sql: string, params?: unknown[]): T | undefined;
  all<T = unknown>(sql: string, params?: unknown[]): T[];
  execute(sql: string): void;
}

/** Bootstraps a fresh database (or no-ops if already bootstrapped) by replaying every Prisma migration in order — see scripts/generate-local-schema.ts. */
function bootstrap(db: LocalDb) {
  db.execute(`CREATE TABLE IF NOT EXISTS "_local_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  const applied = new Set(db.all<{ name: string }>(`SELECT "name" FROM "_local_migrations"`).map((r) => r.name));
  if (applied.size === LOCAL_SCHEMA_MIGRATIONS.length) return; // already fully bootstrapped

  db.execute("PRAGMA foreign_keys = OFF;"); // migration.sql files aren't written in FK-safe order for a single-shot replay
  db.execute(LOCAL_SCHEMA_SQL);
  db.execute("PRAGMA foreign_keys = ON;");
  for (const name of LOCAL_SCHEMA_MIGRATIONS) {
    db.run(`INSERT OR IGNORE INTO "_local_migrations" ("name") VALUES (?)`, [name]);
  }
}

let instance: LocalDb | null = null;

/** Bootstraps (if needed) and caches `driver` as the local database handle. */
export function openLocalDb(driver: LocalDb): LocalDb {
  if (instance) return instance;
  bootstrap(driver);
  instance = driver;
  return instance;
}

/** Test-only: forces the next openLocalDb() call to bootstrap the given driver fresh instead of reusing the cached one. */
export function resetLocalDbForTests() {
  instance = null;
}
