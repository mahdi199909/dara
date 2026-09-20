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
import { getLogger } from "../../lib/observability";

const log = getLogger("database", "sql-js-driver");

const DB_FILE = "dara.sqlite3";
const DB_TMP_FILE = "dara.sqlite3.tmp";
const DB_BAK_FILE = "dara.sqlite3.bak";
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

async function readBytesFrom(path: string): Promise<Uint8Array | null> {
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
    return base64ToBytes(data as string);
  } catch (err) {
    // Capacitor's Filesystem plugin reports a genuinely missing file (first launch, or no
    // backup exists yet) with a message that varies by platform/version — Android has been
    // observed as both the bare "File does not exist" and the more verbose "'readFile' failed
    // because file at '<path>' does not exist." (the latter is what a real device actually
    // throws, confirmed from a user bootError report) — so match on the "does not exist"
    // substring rather than a fixed string. Anything else (a read/decode failure against a file
    // that does exist) is a real problem and must not be silently treated as "no data yet".
    if (err instanceof Error && /does not exist/i.test(err.message)) return null;
    throw err;
  }
}

/**
 * Writes the new bytes atomically: to a throwaway .tmp file first, then swaps it into place via
 * rename after moving the current file to .bak. A rename is a directory-entry update, not a
 * byte-by-byte copy, so there is no meaningful window left where a kill/crash/out-of-storage
 * mid-write could leave dara.sqlite3 itself half-written and unparseable — the OLD direct
 * overwrite (`Filesystem.writeFile` straight onto dara.sqlite3) had exactly that window open for
 * as long as the whole multi-KB/MB write took, and a device dying inside it is precisely what
 * "database disk image is malformed" on next launch looks like. Keeping the previous version as
 * .bak (see loadBrowserSqliteDriver's read-side recovery) is defense in depth on top of that, in
 * case some other, not-yet-understood corruption path ever reappears.
 */
async function writePersistedBytes(bytes: Uint8Array): Promise<void> {
  await Filesystem.writeFile({ path: DB_TMP_FILE, directory: Directory.Data, data: bytesToBase64(bytes) });

  try {
    await Filesystem.deleteFile({ path: DB_BAK_FILE, directory: Directory.Data });
  } catch {
    // no previous backup yet — fine
  }
  try {
    await Filesystem.rename({ from: DB_FILE, to: DB_BAK_FILE, directory: Directory.Data });
  } catch {
    // dara.sqlite3 doesn't exist yet (very first flush ever) — nothing to back up
  }

  // dara.sqlite3 is guaranteed gone at this point (just moved to .bak, or never existed), so
  // this rename can't collide with an existing destination.
  await Filesystem.rename({ from: DB_TMP_FILE, to: DB_FILE, directory: Directory.Data });
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

export interface LoadedBrowserSqliteDriver {
  driver: LocalDb;
  /** True if dara.sqlite3 itself couldn't be parsed and dara.sqlite3.bak had to be used instead
   * — see writePersistedBytes. The caller should tell the user, since anything written after the
   * last successful flush before the backup was taken is gone even though this recovered. */
  recoveredFromBackup: boolean;
}

export interface BrowserSqliteDriverOptions {
  /** Called each time the database has been written to disk. The home-screen widgets read that
   * file, so this is the moment they can show what just changed (see src/local/widgetRefresh.ts). */
  onFlushed?: () => void;
}

export async function loadBrowserSqliteDriver(options: BrowserSqliteDriverOptions = {}): Promise<LoadedBrowserSqliteDriver> {
  const wasmBinary = await fetchWasmBinary();
  const SQL: SqlJsStatic = await initSqlJs({ wasmBinary });

  let db: Database;
  let recoveredFromBackup = false;
  const primary = await readBytesFrom(DB_FILE);
  if (!primary) {
    db = new SQL.Database();
  } else {
    try {
      db = new SQL.Database(primary);
    } catch (primaryErr) {
      // dara.sqlite3 exists but sql.js can't parse it as a valid SQLite file — try the last
      // known-good backup (see writePersistedBytes) before giving up entirely. This turns "the
      // file somehow got corrupted" into "lose whatever changed since the last flush before
      // that" instead of losing everything ever recorded on this device.
      const backup = await readBytesFrom(DB_BAK_FILE).catch(() => null);
      if (!backup) throw primaryErr;
      try {
        db = new SQL.Database(backup);
        recoveredFromBackup = true;
        log.error("DB_LOCAL_RECOVERED", { error: primaryErr, errorCode: "DB-008", layer: "local", message: "dara.sqlite3 was corrupt; recovered from dara.sqlite3.bak instead" });
      } catch {
        throw primaryErr; // the backup is ALSO unreadable — surface the original error, nothing left to try
      }
    }
  }

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
    // An earlier write that failed must not stop every later one: chaining straight onto a
    // rejected promise would skip this write silently, forever.
    const write = pendingWrite.catch(() => undefined).then(() => writePersistedBytes(db.export()));
    pendingWrite = write.then(
      () => {
        try {
          options.onFlushed?.();
        } catch (err) {
          log.error("DB_LOCAL_FLUSH_CALLBACK_FAILED", { error: err, layer: "local" });
        }
      },
      (err) => {
        dirty = true; // try again with the next flush
        throw err;
      }
    );
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

  const driver: LocalDb = {
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

  // Get the recovered content safely back onto dara.sqlite3 right away, rather than leaving it
  // sitting corrupt on disk until whatever the next incidental write happens to be.
  if (recoveredFromBackup) {
    dirty = true;
    await flushNow();
  }

  return { driver, recoveredFromBackup };
}
