// Test/dev-only LocalDb driver backed by sql.js — a WASM build of SQLite with ZERO native
// compilation step, unlike the better-sqlite3 driver this replaced. That native addon needed a
// full C++ toolchain (Visual Studio Build Tools on Windows, python3/make/g++ on Railway's Alpine
// image) to compile on every fresh `npm install`, and kept breaking wherever a prebuilt binary
// wasn't available for the local Node version — twice in one afternoon. sql.js only needs its
// .wasm file loaded once, which works identically on every platform/Node version/CI runner.
// Same SQL dialect (SQLite) as the real Capacitor plugin that replaces this in Phase 6, so
// repository logic developed and tested against this driver carries over unchanged. Never
// import this from src/local/db.ts, src/lib/localDispatcher.ts, or anything else apiClient.ts
// can reach — only test files should import this directly.
import { createRequire } from "node:module";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { LocalDb } from "../db";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    sqlJsPromise = initSqlJs({ locateFile: () => wasmPath });
  }
  return sqlJsPromise;
}

// Typed `any[]`, not `unknown[]`: sql.js's own BindParams type is narrower than LocalDb's
// generic `unknown[]` params (it wants SqlValue = string | number | Uint8Array | null), and
// every value actually flowing through here already satisfies that at runtime — the repositories
// calling into this driver are what the LocalDb interface's own `unknown[]` protects.
function toParams(params: unknown[]): any[] {
  // sql.js binds positional "?" placeholders from a plain array — but chokes on `undefined`
  // (unlike better-sqlite3, which accepted it as a stand-in for SQL NULL), so normalize here
  // rather than adjusting every call site across every repository.
  return params.map((p) => (p === undefined ? null : p));
}

/** `path` is accepted for interface parity with a real file-backed driver, but sql.js in this
 * codebase is always used as an in-memory database (tests never need the file to persist). */
export async function createNodeSqliteDriver(_path: string): Promise<LocalDb> {
  const SQL = await loadSqlJs();
  const db: Database = new SQL.Database();

  return {
    run(sql, params = []) {
      db.run(sql, toParams(params));
      return { changes: db.getRowsModified() };
    },
    get<T>(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(toParams(params));
        if (!stmt.step()) return undefined;
        return stmt.getAsObject() as T;
      } finally {
        stmt.free();
      }
    },
    all<T>(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(toParams(params));
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    execute(sql) {
      db.run(sql);
    },
  };
}
