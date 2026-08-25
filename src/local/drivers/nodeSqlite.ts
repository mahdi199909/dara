// Test/dev-only LocalDb driver backed by better-sqlite3 — same SQL dialect (SQLite) as the
// real Capacitor plugin that replaces this in Phase 6, so repository logic developed and
// tested against this driver carries over unchanged. Never import this from src/local/db.ts,
// src/lib/localDispatcher.ts, or anything else apiClient.ts can reach — better-sqlite3 is a
// native Node addon that must not end up in a browser bundle. Only test files should import
// this directly.
import Database from "better-sqlite3";
import type { LocalDb } from "../db";

export function createNodeSqliteDriver(path: string): LocalDb {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

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
