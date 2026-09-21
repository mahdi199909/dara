import { describe, expect, it, vi } from "vitest";
import type { LogRecord } from "../core/schema";
import { BatchingSink } from "../core/sink";
import { canGzip, gunzip, utf8Text } from "./bytes";
import { ACTIVE_LOG_FILE, DeviceLogFileSink, type DeviceLogFileSinkOptions } from "./fileSink";
import { MemoryLogFileStore } from "./logFileStore";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 8, 21, 4, 0, 0);

function record(n: number, extra: Partial<LogRecord> = {}): LogRecord {
  return {
    timestamp: new Date(START + n).toISOString(),
    level: "INFO",
    event: "TASK_CREATE_SUCCESS",
    message: `record ${n}`,
    service: "parva-android",
    environment: "production",
    platform: "android",
    metadata: { n },
    ...extra,
  };
}

function setup(options: Partial<DeviceLogFileSinkOptions> = {}) {
  const clock = { now: START };
  const store = new MemoryLogFileStore(() => clock.now);
  const problems: Array<{ kind: string; file?: string }> = [];
  const sink = new DeviceLogFileSink({
    store,
    now: () => clock.now,
    onProblem: (problem) => problems.push({ kind: problem.kind, file: problem.file }),
    ...options,
  });
  return { clock, store, sink, problems };
}

const names = (store: MemoryLogFileStore) => [...store.files.keys()].sort();
const eventsOf = async (sink: DeviceLogFileSink, max = 10_000) => (await sink.readRecent(max)).map((r) => (r.metadata as { n: number }).n);

describe("DeviceLogFileSink: writing", () => {
  it("appends a batch as JSON lines with one write, and reads them back in order", async () => {
    const { sink, store } = setup();
    await sink.writeBatch([record(1), record(2), record(3)]);
    expect(store.calls.filter((call) => call === "append")).toHaveLength(1);
    const text = utf8Text(store.files.get(ACTIVE_LOG_FILE)!.data);
    expect(text.trimEnd().split("\n").map((line) => JSON.parse(line).message)).toEqual(["record 1", "record 2", "record 3"]);
    expect(await eventsOf(sink)).toEqual([1, 2, 3]);
  });

  it("counts bytes, not characters: Persian text takes two bytes a letter", async () => {
    const { sink, store } = setup({ compress: false });
    await sink.write(record(1, { message: "خرید نان و شیر" }));
    const bytes = store.files.get(ACTIVE_LOG_FILE)!.data.length;
    expect(sink.stats().activeBytes).toBe(bytes);
    expect(bytes).toBeGreaterThan(JSON.stringify(record(1, { message: "خرید نان و شیر" })).length); // more bytes than UTF-16 units
  });

  it("carries on appending to a file that was already there when the app started", async () => {
    const { sink, store } = setup();
    await store.append(ACTIVE_LOG_FILE, `${JSON.stringify(record(0))}\n`);
    await sink.writeBatch([record(1)]);
    expect(await eventsOf(sink)).toEqual([0, 1]);
  });

  it("keeps the order of two batches written at the same moment", async () => {
    const { sink } = setup();
    await Promise.all([sink.writeBatch([record(1), record(2)]), sink.writeBatch([record(3)]), sink.writeBatch([record(4)])]);
    expect(await eventsOf(sink)).toEqual([1, 2, 3, 4]);
  });
});

describe("rotation", () => {
  it("moves the full file aside and starts a new one, without losing or reordering a line", async () => {
    const { sink, store } = setup({ maxFileBytes: 2048, compress: false });
    for (let i = 0; i < 40; i++) await sink.writeBatch([record(i)]);
    const archives = names(store).filter((name) => name.startsWith("parva-"));
    expect(archives.length).toBeGreaterThan(1);
    expect(sink.stats().rotations).toBe(archives.length);
    for (const name of [...archives, ACTIVE_LOG_FILE]) expect(store.files.get(name)!.data.length).toBeLessThanOrEqual(2048);
    expect(await eventsOf(sink)).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it.skipIf(!canGzip())("compresses a rotated file, and the compressed file is what is read back", async () => {
    const { sink, store } = setup({ maxFileBytes: 2048 });
    for (let i = 0; i < 40; i++) await sink.writeBatch([record(i)]);
    const gz = names(store).filter((name) => name.endsWith(".jsonl.gz"));
    expect(gz.length).toBeGreaterThan(1);
    expect(names(store).filter((name) => name.endsWith(".jsonl") && name.startsWith("parva-"))).toEqual([]); // no plain copy is left beside it
    const plain = utf8Text(await gunzip(store.files.get(gz[0])!.data));
    expect(plain.split("\n")[0]).toContain('"event":"TASK_CREATE_SUCCESS"');
    expect(store.files.get(gz[0])!.data.length).toBeLessThan(plain.length); // it really is smaller
    expect(await eventsOf(sink)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(sink.stats().compressed).toBe(gz.length);
  });

  it("splits a batch that is bigger than a whole file across files", async () => {
    const { sink, store } = setup({ maxFileBytes: 2048, compress: false });
    await sink.writeBatch(Array.from({ length: 30 }, (_, i) => record(i)));
    for (const file of store.files.values()) expect(file.data.length).toBeLessThanOrEqual(2048);
    expect(await eventsOf(sink)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it("gives archives made in the same second different names", async () => {
    const { sink, store } = setup({ maxFileBytes: 1024, compress: false });
    for (let i = 0; i < 30; i++) await sink.writeBatch([record(i)]); // the clock does not move
    const archives = names(store).filter((name) => name.startsWith("parva-"));
    expect(new Set(archives).size).toBe(archives.length);
    expect(archives.length).toBeGreaterThan(2);
  });
});

describe("retention and the size ceiling", () => {
  it("deletes archives older than the retention period, and keeps newer ones", async () => {
    const { sink, store, clock } = setup({ maxFileBytes: 1024, retentionMs: 7 * DAY, compress: false });
    for (let i = 0; i < 24; i++) await sink.writeBatch([record(i)]);
    const before = names(store).filter((name) => name.startsWith("parva-")).length;
    expect(before).toBeGreaterThan(2);

    clock.now += 8 * DAY; // everything so far is now too old
    for (let i = 100; i < 108; i++) await sink.writeBatch([record(i)]); // forces at least one more rotation and prune
    const remaining = await eventsOf(sink);
    expect(remaining.every((n) => n >= 100)).toBe(true);
    expect(remaining).toContain(107);
    expect(sink.stats().pruned).toBeGreaterThan(0);
  });

  it("rotates a file that has been in use for a day, so that seven days of retention means about seven days", async () => {
    const { sink, store, clock } = setup({ compress: false });
    for (let day = 0; day < 10; day++) {
      await sink.writeBatch([record(day * 10), record(day * 10 + 1)]);
      clock.now += DAY + 60_000;
    }
    const archives = names(store).filter((name) => name.startsWith("parva-"));
    // one a day, not one for the whole period — and ten days on, only the last week's are still on disk
    expect(archives.length).toBeGreaterThanOrEqual(5);
    expect(archives.length).toBeLessThanOrEqual(8);
    const kept = await eventsOf(sink);
    expect(kept.includes(0)).toBe(false);
    expect(kept.includes(90)).toBe(true);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
  });

  it("names a rotated file after the time of its last record, not the time it was closed", async () => {
    const { sink, store, clock } = setup({ compress: false });
    await sink.writeBatch([record(1)]);
    clock.now += 30 * DAY; // the app was closed for a month
    await sink.writeBatch([record(2)]);
    const archives = names(store).filter((name) => name.startsWith("parva-"));
    // the first record's file is not an archive of "now": it is gone, because its content is a month old
    expect(archives).toEqual([]);
    expect(await eventsOf(sink)).toEqual([2]);
  });

  it("drops an active file nobody has written to for longer than the retention period", async () => {
    const { store, clock } = setup();
    await store.append(ACTIVE_LOG_FILE, `${JSON.stringify(record(0))}\n`);
    clock.now += 9 * DAY;
    const fresh = new DeviceLogFileSink({ store, now: () => clock.now, retentionMs: 7 * DAY });
    await fresh.writeBatch([record(1)]);
    expect(await eventsOf(fresh)).toEqual([1]);
  });

  it("stays under the total size ceiling however much is logged, dropping the oldest first", async () => {
    const { sink, store } = setup({ maxFileBytes: 2048, maxTotalBytes: 8 * 1024, compress: false });
    for (let i = 0; i < 400; i++) await sink.writeBatch([record(i)]);
    expect(store.totalBytes()).toBeLessThanOrEqual(8 * 1024 + 2048); // the ceiling, plus the file being written
    const kept = await eventsOf(sink);
    expect(kept[kept.length - 1]).toBe(399); // the newest is always there
    expect(kept[0]).toBeGreaterThan(0); // the oldest are gone
    expect(kept).toEqual([...kept].sort((a, b) => a - b)); // and what is left is in order
  });

  it("never keeps more archives than the cap", async () => {
    const { sink, store } = setup({ maxFileBytes: 1024, maxArchives: 3, compress: false });
    for (let i = 0; i < 60; i++) await sink.writeBatch([record(i)]);
    expect(names(store).filter((name) => name.startsWith("parva-")).length).toBeLessThanOrEqual(3);
  });
});

describe("when the disk misbehaves", () => {
  it("throws when the append fails, so the batching layer keeps the records — and writes them once the disk recovers", async () => {
    const { sink, store } = setup();
    const batching = new BatchingSink(sink, { flushIntervalMs: 10_000, baseBackoffMs: 1, failureThreshold: 100 });
    store.faults.once = { append: new Error("No space left on device") };
    batching.write(record(1));
    batching.write(record(2));
    await batching.flush(); // the first attempt fails and the records stay queued
    expect(await eventsOf(sink)).toEqual([]);
    expect(batching.stats().queued).toBe(2);
    await batching.flush();
    expect(await eventsOf(sink)).toEqual([1, 2]);
    expect(batching.stats().queued).toBe(0);
  });

  it("never lets a full disk reach the caller of the logger: the queue is bounded and the circuit opens", async () => {
    const { sink, store } = setup();
    store.faults.always = { append: new Error("No space left on device") };
    const seen: string[] = [];
    const batching = new BatchingSink(sink, {
      capacity: 50,
      maxBatch: 10,
      flushIntervalMs: 1_000_000,
      failureThreshold: 2,
      baseBackoffMs: 60_000,
      onEvent: (event) => seen.push(event.type),
    });
    for (let i = 0; i < 500; i++) expect(() => batching.write(record(i))).not.toThrow();
    await batching.flush();
    await batching.flush();
    expect(seen).toContain("circuit_open");
    expect(batching.stats().queued).toBeLessThanOrEqual(50);
    expect(batching.stats().dropped).toBeGreaterThan(0);
  });

  it("looks at the real size of the file again after a failed append", async () => {
    const { sink, store } = setup({ compress: false });
    await sink.writeBatch([record(1)]);
    store.faults.once = { append: new Error("I/O error") };
    await expect(sink.writeBatch([record(2)])).rejects.toThrow("I/O error");
    await sink.writeBatch([record(3)]);
    expect(sink.stats().activeBytes).toBe(store.files.get(ACTIVE_LOG_FILE)!.data.length);
  });

  it("keeps appending when a rotation fails, reports it, and tries again later", async () => {
    const { sink, store, problems } = setup({ maxFileBytes: 1024, compress: false });
    for (let i = 0; i < 6; i++) await sink.writeBatch([record(i)]);
    store.faults.always = { rename: new Error("rename refused") };
    for (let i = 6; i < 12; i++) await sink.writeBatch([record(i)]);
    expect(problems.some((problem) => problem.kind === "rotate")).toBe(true);
    delete store.faults.always;
    for (let i = 12; i < 18; i++) await sink.writeBatch([record(i)]);
    expect(await eventsOf(sink)).toEqual(Array.from({ length: 18 }, (_, i) => i)); // nothing was lost through any of it
  });

  it.skipIf(!canGzip())("keeps the plain archive, with no compressed twin, when compressing fails", async () => {
    const { sink, store, problems } = setup({ maxFileBytes: 1024 });
    store.faults.always = { write: new Error("disk full") };
    for (let i = 0; i < 12; i++) await sink.writeBatch([record(i)]);
    expect(problems.some((problem) => problem.kind === "compress")).toBe(true);
    expect(names(store).filter((name) => name.endsWith(".gz"))).toEqual([]);
    expect(await eventsOf(sink)).toEqual(Array.from({ length: 12 }, (_, i) => i)); // read once, not twice
  });

  it("does not fail because a clean-up could not delete something", async () => {
    const { sink, store, problems } = setup({ maxFileBytes: 1024, maxArchives: 1, compress: false });
    store.faults.always = { remove: new Error("permission denied") };
    for (let i = 0; i < 20; i++) await expect(sink.writeBatch([record(i)])).resolves.toBeUndefined();
    expect(problems.some((problem) => problem.kind === "prune")).toBe(true);
  });

  it("fails the write when the folder cannot even be created, and starts working when it can", async () => {
    const { sink, store } = setup();
    store.faults.once = { ensure: new Error("no such folder") };
    await expect(sink.writeBatch([record(1)])).rejects.toThrow("no such folder");
    await sink.writeBatch([record(2)]);
    expect(await eventsOf(sink)).toEqual([2]);
  });
});

describe("hostile and huge records", () => {
  it("replaces a record too large for a line by a short marker that says how large it was", async () => {
    const { sink, store } = setup({ maxLineBytes: 2048 });
    await sink.writeBatch([record(1, { metadata: { blob: "x".repeat(50_000) } })]);
    const line = JSON.parse(utf8Text(store.files.get(ACTIVE_LOG_FILE)!.data).trim());
    expect(line).toMatchObject({ event: "TASK_CREATE_SUCCESS", truncated: true });
    expect(line.original_bytes).toBeGreaterThan(50_000);
    expect(sink.stats().linesTruncated).toBe(1);
  });

  it("writes a marker for a record that cannot be serialised at all", async () => {
    const { sink } = setup();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await sink.writeBatch([record(1, { metadata: circular }), record(2)]);
    const records = await sink.readRecent();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ truncated: true, reason: "unserializable" });
    expect(records[1].message).toBe("record 2");
  });
});

describe("reading", () => {
  it("skips a half-written last line, as left by a crash in the middle of an append", async () => {
    const { sink, store } = setup();
    await store.append(ACTIVE_LOG_FILE, `${JSON.stringify(record(1))}\n{"timestamp":"2026-09-21T04:00:00.0`);
    await sink.writeBatch([record(2)]); // (the crashed line has no newline, so this lands on the same line: that line is lost, this one is not)
    const kept = (await sink.readRecent()).map((r) => r.metadata);
    expect(kept[0]).toEqual({ n: 1 });
  });

  it("returns only the newest records asked for", async () => {
    const { sink } = setup({ maxFileBytes: 2048, compress: false });
    for (let i = 0; i < 50; i++) await sink.writeBatch([record(i)]);
    expect(await eventsOf(sink, 5)).toEqual([45, 46, 47, 48, 49]);
  });

  it("skips an archive that cannot be read and says so", async () => {
    const { sink, store, problems } = setup({ maxFileBytes: 1024, compress: false });
    for (let i = 0; i < 12; i++) await sink.writeBatch([record(i)]);
    const first = names(store).find((name) => name.startsWith("parva-"))!;
    store.files.set(first, { data: new Uint8Array([0x1f, 0x8b, 0x00]), modifiedAt: START });
    store.files.set(first.replace(/\.jsonl$/, ".jsonl.gz"), store.files.get(first)!);
    store.files.delete(first);
    const kept = await eventsOf(sink);
    expect(kept.length).toBeGreaterThan(0);
    expect(problems.some((problem) => problem.kind === "read")).toBe(true);
  });
});

describe("cost", () => {
  it("makes one append per batch however many records it holds", async () => {
    const { sink, store } = setup();
    await sink.writeBatch(Array.from({ length: 100 }, (_, i) => record(i)));
    expect(store.calls.filter((call) => call === "append")).toHaveLength(1);
  });

  it("keeps a flood of logging inside its storage budget", async () => {
    // 20 000 records at INFO-typical size, a 256 KB file and a 2 MB ceiling: the disk never holds more than the ceiling.
    const { sink, store } = setup({ maxFileBytes: 256 * 1024, maxTotalBytes: 2 * 1024 * 1024 });
    const batch = (from: number) => Array.from({ length: 100 }, (_, i) => record(from + i, { metadata: { note: "a typical amount of metadata for a sync line", counts: { Task: 3, Habit: 1 } } }));
    for (let i = 0; i < 200; i++) await sink.writeBatch(batch(i * 100));
    expect(store.totalBytes()).toBeLessThanOrEqual(2 * 1024 * 1024 + 256 * 1024);
    expect(sink.stats().linesWritten).toBe(20_000);
  });

  it("does nothing at all for an empty batch", async () => {
    const { sink, store } = setup();
    await sink.writeBatch([]);
    expect(store.calls).toEqual([]);
  });
});

describe("through the BatchingSink, the way the phone uses it", () => {
  it("writes what was logged once it is flushed, and a protected record is written soon without waiting for the interval", async () => {
    vi.useFakeTimers();
    try {
      const { sink } = setup();
      const batching = new BatchingSink(sink, { flushIntervalMs: 30_000, urgentFlushMs: 500 });
      batching.write(record(1));
      await vi.advanceTimersByTimeAsync(1000);
      expect(await eventsOf(sink)).toEqual([]); // an ordinary record waits for the interval
      batching.write(record(2, { level: "ERROR", event: "SYNC_FAILED" }));
      await vi.advanceTimersByTimeAsync(600);
      expect(await eventsOf(sink)).toEqual([1, 2]); // an error brings the write forward, and takes the waiting record with it
    } finally {
      vi.useRealTimers();
    }
  });
});
