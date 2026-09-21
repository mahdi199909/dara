// The phone's own log file: JSON lines in the app's private storage, rotated by size, kept for a week,
// compressed once rotated, and never allowed to grow without bound.
//
//   current.jsonl                 the file being written
//   parva-20260921T042500123Z.jsonl.gz   a rotated one (plain .jsonl when the WebView cannot gzip); its name says when
//
// It is a LogSink and is meant to sit behind a BatchingSink: records are queued in memory and written a batch
// at a time (one append for many lines), so logging costs no I/O on the person's action path. A write that
// fails (disk full, filesystem error) throws to the BatchingSink, which keeps the records, backs off and lets the
// application carry on — LOGGING FAILURE MUST NOT BECOME APPLICATION FAILURE. Rotation and clean-up problems
// never stop appends; they are reported and the next opportunity tries again.
//
// The log is NOT kept in the SQLite database: that database is written out as one whole file on every debounced
// save, so log lines there would rewrite the person's data on every log line and make it grow.
import type { LogRecord } from "../core/schema";
import type { LogSink } from "../core/sink";
import { canGzip, gunzip, gzip, utf8Bytes, utf8Text } from "./bytes";
import type { LogFileInfo, LogFileStore } from "./logFileStore";

export const ACTIVE_LOG_FILE = "current.jsonl";
const ARCHIVE_NAME = /^parva-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z(?:-(\d+))?\.jsonl(\.gz)?$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEVICE_LOG_DEFAULTS = {
  /** A file is rotated when the next batch would take it past this. */
  maxFileBytes: 256 * 1024,
  /** Everything on disk together (the active file and every archive). Oldest archives go first. */
  maxTotalBytes: 2 * 1024 * 1024,
  retentionMs: 7 * DAY_MS,
  /**
   * A file is also rotated once it has been in use this long, so that "kept for seven days" means about that:
   * an app that logs a few lines a day would otherwise keep writing to one file for months.
   */
  maxActiveAgeMs: DAY_MS,
  /** A ceiling on the number of archives, so a listing stays cheap however small the archives compress to. */
  maxArchives: 60,
  /** No single line is allowed to be larger than this. */
  maxLineBytes: 32 * 1024,
} as const;

export interface DeviceLogFileSinkOptions {
  store: LogFileStore;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  retentionMs?: number;
  maxActiveAgeMs?: number;
  maxArchives?: number;
  maxLineBytes?: number;
  /** Compress rotated files. Default: yes when this runtime can gzip. */
  compress?: boolean;
  now?: () => number;
  /** Something went wrong that the sink handled itself (a failed rotation, an unreadable archive). */
  onProblem?: (problem: { kind: "rotate" | "compress" | "prune" | "read" | "init"; error: unknown; file?: string }) => void;
}

export interface DeviceLogStats {
  activeBytes: number;
  archives: number;
  archiveBytes: number;
  rotations: number;
  compressed: number;
  pruned: number;
  linesWritten: number;
  linesTruncated: number;
  /** True when rotated files are being compressed. */
  compressing: boolean;
}

interface Archive {
  name: string;
  size: number;
  /** When it was rotated (from its name; UTC, to the millisecond). */
  at: number;
  /** Which of several archives made in the same millisecond it is (0 when alone). */
  seq: number;
}

/** A name that sorts in the order the archives were made: the time to the millisecond, then a counter for ties. */
function archiveNameFor(at: number, taken: Set<string>): string {
  const d = new Date(at);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${pad(d.getUTCMilliseconds(), 3)}Z`;
  let name = `parva-${stamp}.jsonl`;
  for (let n = 1; taken.has(name) || taken.has(`${name}.gz`); n++) name = `parva-${stamp}-${n}.jsonl`;
  return name;
}

function parseArchive(file: LogFileInfo): Archive | null {
  const match = ARCHIVE_NAME.exec(file.name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, ms, seq] = match;
  return {
    name: file.name,
    size: file.size,
    at: Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms)),
    seq: seq ? Number(seq) : 0,
  };
}

/** Oldest first. */
function byAge(a: Archive, b: Archive): number {
  return a.at - b.at || a.seq - b.seq;
}

/** One line for one record; a record that will not serialise, or is huge, becomes a short marker instead. */
function toLine(record: LogRecord, maxLineBytes: number): { line: string; truncated: boolean } {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    return { line: JSON.stringify({ timestamp: record.timestamp, level: record.level, event: record.event, truncated: true, reason: "unserializable" }), truncated: true };
  }
  if (line.length <= maxLineBytes / 4 || utf8Bytes(line).length <= maxLineBytes) return { line, truncated: false };
  return {
    line: JSON.stringify({
      timestamp: record.timestamp,
      level: record.level,
      event: record.event,
      message: record.message?.slice(0, 200),
      service: record.service,
      platform: record.platform,
      truncated: true,
      original_bytes: utf8Bytes(line).length,
      metadata: {},
    }),
    truncated: true,
  };
}

export class DeviceLogFileSink implements LogSink {
  readonly name = "device-file";

  private readonly store: LogFileStore;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly retentionMs: number;
  private readonly maxActiveAgeMs: number;
  private readonly maxArchives: number;
  private readonly maxLineBytes: number;
  private readonly compress: boolean;
  private readonly now: () => number;
  private readonly onProblem: NonNullable<DeviceLogFileSinkOptions["onProblem"]>;

  /** Every operation runs after the one before it, so an append never overlaps a rotation or a read. */
  private tail: Promise<unknown> = Promise.resolve();
  private initialised = false;
  private activeBytes = 0;
  /** When the first record of the active file was written, and the last (null while it is empty). */
  private activeSince: number | null = null;
  private activeLastAt: number | null = null;
  private needsResync = false;
  private counters = { rotations: 0, compressed: 0, pruned: 0, linesWritten: 0, linesTruncated: 0 };
  private lastKnown = { archives: 0, archiveBytes: 0 };

  constructor(options: DeviceLogFileSinkOptions) {
    this.store = options.store;
    this.maxFileBytes = Math.max(1024, options.maxFileBytes ?? DEVICE_LOG_DEFAULTS.maxFileBytes);
    this.maxTotalBytes = Math.max(this.maxFileBytes * 2, options.maxTotalBytes ?? DEVICE_LOG_DEFAULTS.maxTotalBytes);
    this.retentionMs = options.retentionMs ?? DEVICE_LOG_DEFAULTS.retentionMs;
    this.maxActiveAgeMs = options.maxActiveAgeMs ?? DEVICE_LOG_DEFAULTS.maxActiveAgeMs;
    this.maxArchives = options.maxArchives ?? DEVICE_LOG_DEFAULTS.maxArchives;
    this.maxLineBytes = options.maxLineBytes ?? DEVICE_LOG_DEFAULTS.maxLineBytes;
    this.compress = options.compress ?? canGzip();
    this.now = options.now ?? Date.now;
    this.onProblem = options.onProblem ?? (() => undefined);
  }

  write(record: LogRecord): Promise<void> {
    return this.writeBatch([record]);
  }

  /** Appends the records as JSON lines, rotating first when they would not fit. Throws when the append itself fails. */
  writeBatch(records: LogRecord[]): Promise<void> {
    if (records.length === 0) return Promise.resolve();
    return this.enqueue(async () => {
      await this.ensureReady();
      if (this.needsResync) await this.resync();

      const lines: string[] = [];
      for (const record of records) {
        const { line, truncated } = toLine(record, this.maxLineBytes);
        if (truncated) this.counters.linesTruncated++;
        lines.push(line);
      }

      // Group the lines so that no single append is larger than a whole file.
      let group: string[] = [];
      let groupBytes = 0;
      const groups: Array<{ text: string; bytes: number; lines: number }> = [];
      const flushGroup = () => {
        if (group.length === 0) return;
        const text = `${group.join("\n")}\n`;
        groups.push({ text, bytes: utf8Bytes(text).length, lines: group.length });
        group = [];
        groupBytes = 0;
      };
      for (const line of lines) {
        const bytes = utf8Bytes(line).length + 1;
        if (groupBytes > 0 && groupBytes + bytes > this.maxFileBytes) flushGroup();
        group.push(line);
        groupBytes += bytes;
      }
      flushGroup();

      for (const piece of groups) {
        if (this.activeBytes > 0 && (this.activeBytes + piece.bytes > this.maxFileBytes || this.activeIsOld())) await this.rotate();
        try {
          await this.store.append(ACTIVE_LOG_FILE, piece.text);
        } catch (error) {
          this.needsResync = true; // the file may or may not have taken part of it: look at the real size next time
          throw error;
        }
        const at = this.now();
        this.activeBytes += piece.bytes;
        this.activeSince ??= at;
        this.activeLastAt = at;
        this.counters.linesWritten += piece.lines;
      }
    });
  }

  /** Waits for everything queued so far. */
  async flush(): Promise<void> {
    await this.enqueue(async () => undefined).catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.flush();
  }

  /**
   * The newest records still on disk, oldest first, at most `maxRecords`. Lines that do not parse (a
   * half-written last line after a crash) are skipped. Archives that cannot be read are skipped and reported.
   */
  readRecent(maxRecords = 2000): Promise<LogRecord[]> {
    return this.enqueue(async () => {
      await this.ensureReady();
      const files = await this.store.list();
      const archives = files.map(parseArchive).filter((a): a is Archive => a !== null).sort(byAge);
      const names = [...archives.map((a) => a.name)];
      if (files.some((f) => f.name === ACTIVE_LOG_FILE)) names.push(ACTIVE_LOG_FILE);

      const collected: LogRecord[][] = [];
      let count = 0;
      for (let i = names.length - 1; i >= 0 && count < maxRecords; i--) {
        const parsed = await this.readFile(names[i]);
        collected.unshift(parsed);
        count += parsed.length;
      }
      return collected.flat().slice(-maxRecords);
    });
  }

  stats(): DeviceLogStats {
    return {
      activeBytes: this.activeBytes,
      archives: this.lastKnown.archives,
      archiveBytes: this.lastKnown.archiveBytes,
      ...this.counters,
      compressing: this.compress,
    };
  }

  // ------------------------------------------------------------------------------------------

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async ensureReady(): Promise<void> {
    if (this.initialised) return;
    await this.store.ensure();
    await this.resync();
    // A file nobody has written to for longer than the retention period is not a recent log: drop it.
    const active = (await this.store.list()).find((file) => file.name === ACTIVE_LOG_FILE);
    if (active && active.modifiedAt > 0 && this.now() - active.modifiedAt > this.retentionMs) {
      try {
        await this.store.remove(ACTIVE_LOG_FILE);
        this.activeBytes = 0;
      } catch (error) {
        this.onProblem({ kind: "init", error, file: ACTIVE_LOG_FILE });
      }
    }
    await this.prune();
    this.initialised = true;
  }

  private activeIsOld(): boolean {
    return this.activeSince !== null && this.now() - this.activeSince >= this.maxActiveAgeMs;
  }

  /** Re-reads how big the active file really is, and how old it is. */
  private async resync(): Promise<void> {
    const files = await this.store.list();
    const active = files.find((file) => file.name === ACTIVE_LOG_FILE);
    this.activeBytes = active?.size ?? 0;
    if (!active || active.size === 0) {
      this.activeSince = null;
      this.activeLastAt = null;
    } else {
      this.activeLastAt = active.modifiedAt > 0 ? active.modifiedAt : this.activeLastAt ?? this.now();
      if (this.activeSince === null) this.activeSince = (await this.firstRecordTime()) ?? this.activeLastAt;
    }
    this.needsResync = false;
  }

  /** The time of the first record in the active file, or undefined when it cannot be told. */
  private async firstRecordTime(): Promise<number | undefined> {
    try {
      const text = utf8Text(await this.store.read(ACTIVE_LOG_FILE));
      const first = text.slice(0, text.indexOf("\n") === -1 ? undefined : text.indexOf("\n"));
      const stamp = Date.parse((JSON.parse(first) as { timestamp?: string }).timestamp ?? "");
      return Number.isFinite(stamp) ? stamp : undefined;
    } catch {
      return undefined;
    }
  }

  /** Moves the active file aside, compresses it when possible, and enforces retention and the size ceiling. */
  private async rotate(): Promise<void> {
    try {
      const files = await this.store.list();
      const taken = new Set(files.map((file) => file.name));
      // Named after the LAST record in it, so that retention counts from when its content is from, not from when it was closed.
      const plain = archiveNameFor(this.activeLastAt ?? this.now(), taken);
      await this.store.rename(ACTIVE_LOG_FILE, plain);
      this.activeBytes = 0;
      this.activeSince = null;
      this.activeLastAt = null;
      this.counters.rotations++;
      if (this.compress) await this.compressArchive(plain);
    } catch (error) {
      this.onProblem({ kind: "rotate", error, file: ACTIVE_LOG_FILE });
      // If the rename did not happen the file is still there and keeps growing; the ceiling below still applies on the next rotation.
      this.needsResync = true;
    }
    await this.prune();
  }

  private async compressArchive(plainName: string): Promise<void> {
    try {
      const bytes = await this.store.read(plainName);
      const packed = await gzip(bytes);
      const packedName = `${plainName}.gz`;
      await this.store.write(packedName, packed);
      await this.store.remove(plainName);
      this.counters.compressed++;
    } catch (error) {
      // The plain archive is still there and readable; it just takes more room. A half-made compressed copy must
      // not stay beside it, or the same lines would be read twice.
      await this.store.remove(`${plainName}.gz`).catch(() => undefined);
      this.onProblem({ kind: "compress", error, file: plainName });
    }
  }

  /** Deletes archives older than the retention period, then the oldest ones until everything fits. */
  private async prune(): Promise<void> {
    try {
      const files = await this.store.list();
      const archives = files.map(parseArchive).filter((a): a is Archive => a !== null).sort(byAge);
      const active = files.find((file) => file.name === ACTIVE_LOG_FILE)?.size ?? 0;
      const cutoff = this.now() - this.retentionMs;

      const keep: Archive[] = [];
      for (const archive of archives) {
        if (archive.at < cutoff) await this.removeArchive(archive);
        else keep.push(archive);
      }
      let total = active + keep.reduce((sum, archive) => sum + archive.size, 0);
      while (keep.length > 0 && (total > this.maxTotalBytes || keep.length > this.maxArchives)) {
        const oldest = keep.shift()!;
        total -= oldest.size;
        await this.removeArchive(oldest);
      }
      this.lastKnown = { archives: keep.length, archiveBytes: keep.reduce((sum, archive) => sum + archive.size, 0) };
    } catch (error) {
      this.onProblem({ kind: "prune", error });
    }
  }

  private async removeArchive(archive: Archive): Promise<void> {
    try {
      await this.store.remove(archive.name);
      this.counters.pruned++;
    } catch (error) {
      this.onProblem({ kind: "prune", error, file: archive.name });
    }
  }

  private async readFile(name: string): Promise<LogRecord[]> {
    try {
      const raw = await this.store.read(name);
      const text = name.endsWith(".gz") ? utf8Text(await gunzip(raw)) : utf8Text(raw);
      const records: LogRecord[] = [];
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as LogRecord;
          if (parsed && typeof parsed === "object" && typeof parsed.event === "string") records.push(parsed);
        } catch {
          // a half-written line (the app was killed mid-append): skip it
        }
      }
      return records;
    } catch (error) {
      this.onProblem({ kind: "read", error, file: name });
      return [];
    }
  }
}
