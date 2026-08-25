// On-device SQLite access, abstracted behind an interface shaped like
// @capacitor-community/sqlite's own API (execute/run/query) so that swapping the Node-based
// driver below for the real Capacitor plugin in Phase 6 is a driver swap, not a rewrite of
// every repository. Until Phase 6 wires up Capacitor, this runs on better-sqlite3 — same SQL
// dialect (SQLite), so repository logic developed/tested now carries over unchanged.
import Database from "better-sqlite3";
import { LOCAL_SCHEMA_MIGRATIONS, LOCAL_SCHEMA_SQL } from "./generatedSchema";

export interface LocalDb {
  run(sql: string, params?: unknown[]): { changes: number };
  get<T = unknown>(sql: string, params?: unknown[]): T | undefined;
  all<T = unknown>(sql: string, params?: unknown[]): T[];
  execute(sql: string): void;
}

function wrap(sqlite: Database.Database): LocalDb {
  return {
    run(sql, params = []) {
      const info = sqlite.prepare(sql).run(...(params as any[]));
      return { changes: info.changes };
    },
    get(sql, params = []) {
      return sqlite.prepare(sql).get(...(params as any[])) as any;
    },
    all(sql, params = []) {
      return sqlite.prepare(sql).all(...(params as any[])) as any[];
    },
    execute(sql) {
      sqlite.exec(sql);
    },
  };
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

/** Opens (or returns the cached handle to) the local database at `path` — pass ":memory:" in tests. */
export function openLocalDb(path: string): LocalDb {
  if (instance) return instance;
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = wrap(sqlite);
  bootstrap(db);
  instance = db;
  return db;
}

/** Test-only: forces the next openLocalDb() call to open a fresh handle instead of reusing the cached one. */
export function resetLocalDbForTests() {
  instance = null;
}
