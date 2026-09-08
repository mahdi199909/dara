// The real on-device driver for the Android app: sql.js (the same WASM SQLite build the
// Node/test driver in nodeSqlite.ts uses) running directly inside the Capacitor WebView, with
// its bytes persisted to the device's private app-data directory via @capacitor/filesystem.
//
// Why sql.js-in-WebView instead of the native @capacitor-community/sqlite plugin: that plugin's
// bridge calls are all async, which would force every repository in src/local/repositories/*
// (and every route in src/lib/localDispatcher.ts) to become async — the exact rewrite
// src/local/db.ts's own comment says a driver swap should avoid. sql.js exposes a synchronous
// JS API (same shape this codebase already relies on), so this driver is a drop-in LocalDb the
// same way nodeSqlite.ts is — no repository code changes at all. The only new work is loading
// the WASM module in a browser context and persisting its bytes ourselves, since sql.js itself
// is a pure in-memory engine.
//
// Only import this from src/components/native/FirstRunGate.tsx (via dynamic import, so it never
// enters the web bundle) — see that file for the one call site.
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { Filesystem, Directory } from "@capacitor/filesystem";
import type { LocalDb } from "../db";

const DB_FILE = "dara.sqlite3";
const FLUSH_DEBOUNCE_MS = 300;

function toParams(params: unknown[]): any[] {
  return params.map((p) => (p === undefined ? null : p));
}

// btoa/atob only handle one UTF-16 code unit at a time, so build the string in chunks to avoid
// blowing the call stack on a multi-megabyte database.
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readPersistedBytes(): Promise<Uint8Array | null> {
  try {
    const { data } = await Filesystem.readFile({ path: DB_FILE, directory: Directory.Data });
    return base64ToBytes(data as string);
  } catch (err) {
    // Capacitor's Filesystem plugin throws this exact message for a genuinely missing file
    // (first launch) — anything else (a read/decode failure against a file that does exist,
    // e.g. left truncated by an interrupted flush) is a real problem, not a fresh install, and
    // must not be silently treated as "no data yet": that would make loadBrowserSqliteDriver
    // below construct a brand-new *empty* database instead of surfacing the failure, which looks
    // to the user exactly like all their data vanished. Let it throw instead — FirstRunGate's
    // own catch already turns this into a visible bootError.
    if (err instanceof Error && err.message === "File does not exist") return null;
    throw err;
  }
}

async function writePersistedBytes(bytes: Uint8Array): Promise<void> {
  await Filesystem.writeFile({
    path: DB_FILE,
    directory: Directory.Data,
    data: bytesToBase64(bytes),
  });
}

async function fetchWasmBinary(): Promise<ArrayBuffer> {
  // sql.js's own internal loader (locateFile + its built-in fetch) has no fallback at all once
  // that fetch fails — it swallows the real error and always throws the same generic "both
  // async and sync fetching of the wasm failed", which is exactly what showed up testing this on
  // a real device with no way to see why. Fetching the bytes ourselves and handing them to
  // initSqlJs via `wasmBinary` skips that internal loader path entirely (it only re-fetches if
  // `wasmBinary` wasn't already supplied) and — just as importantly — lets an actual failure here
  // surface a real status code or network error instead of that one fixed string.
  let res: Response;
  try {
    res = await fetch("/sql-wasm.wasm");
  } catch (err) {
    throw new Error(`Failed to fetch /sql-wasm.wasm: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`Failed to fetch /sql-wasm.wasm: HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function loadBrowserSqliteDriver(): Promise<LocalDb> {
  const wasmBinary = await fetchWasmBinary();
  const SQL: SqlJsStatic = await initSqlJs({ wasmBinary });
  const existing = await readPersistedBytes();
  const db: Database = existing ? new SQL.Database(existing) : new SQL.Database();

  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  // Chained onto so a caller that awaits flush() while a write is already in flight (e.g. the
  // debounced timer just fired) waits for *that* write too, instead of racing it — two
  // overlapping writePersistedBytes() calls could otherwise interleave and corrupt the file.
  let pendingWrite: Promise<void> = Promise.resolve();

  function scheduleFlush() {
    dirty = true;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      void flushNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  function flushNow(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!dirty) return pendingWrite;
    dirty = false;
    pendingWrite = pendingWrite.then(() => writePersistedBytes(db.export()));
    return pendingWrite;
  }

  // Safety net for the debounce window above: flush immediately if the app is backgrounded or
  // the WebView is torn down before the debounced timer fires. Best-effort only — a handler
  // reacting to pagehide/visibilitychange has no way to actually block the page from unloading
  // while its async write finishes, unlike a caller that explicitly awaits flush() beforehand
  // (see BottomNav.tsx's native logout, which does exactly that before navigating).
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushNow();
    });
    window.addEventListener("pagehide", () => void flushNow());
  }

  return {
    run(sql, params = []) {
      db.run(sql, toParams(params));
      scheduleFlush();
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
      scheduleFlush();
    },
    flush() {
      return flushNow();
    },
  };
}
