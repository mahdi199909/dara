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
  if (applied.size !== LOCAL_SCHEMA_MIGRATIONS.length) {
    db.execute("PRAGMA foreign_keys = OFF;"); // migration.sql files aren't written in FK-safe order for a single-shot replay
    db.execute(LOCAL_SCHEMA_SQL);
    db.execute("PRAGMA foreign_keys = ON;");
    for (const name of LOCAL_SCHEMA_MIGRATIONS) {
      db.run(`INSERT OR IGNORE INTO "_local_migrations" ("name") VALUES (?)`, [name]);
    }
  }

  // Local-only infrastructure table, deliberately NOT derived from prisma/schema.prisma like
  // everything else here — it caches the one-time remote login+license check (see
  // src/lib/nativeOnboarding.ts) and has no web-side equivalent to stay in sync with, unlike
  // every other table in this database.
  db.execute(
    `CREATE TABLE IF NOT EXISTS "_local_license_cache" (
       "id" TEXT NOT NULL PRIMARY KEY,
       "status" TEXT NOT NULL,
       "trialDaysRemaining" INTEGER,
       "trialEndsAt" TEXT,
       "currentPeriodEnd" TEXT,
       "remoteUserId" TEXT NOT NULL,
       "remoteEmail" TEXT NOT NULL,
       "cachedAt" TEXT NOT NULL
     );`
  );
  // Added after this table already shipped to real devices, so CREATE TABLE IF NOT EXISTS above
  // won't retroactively add it to an install that already has the table — ALTER TABLE is the
  // only way to backfill a column onto an existing SQLite table. SQLite has no "ADD COLUMN IF
  // NOT EXISTS", so this throws (harmlessly) on every run after the first; swallow that.
  try {
    db.execute(`ALTER TABLE "_local_license_cache" ADD COLUMN "token" TEXT;`);
  } catch {
    // column already exists
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

/** The already-initialized driver, or null before FirstRunGate's bootstrap has run — see
 * src/components/native/WidgetQueueDrainer.tsx, which needs the live instance on app resume
 * rather than opening (and re-bootstrapping against) a new one. */
export function getLocalDbInstance(): LocalDb | null {
  return instance;
}
