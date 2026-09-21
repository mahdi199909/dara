// The real filesystem: the store on its own, and the rotating sink on top of it (rotation, gzip, retention, search).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gunzip, utf8Text } from "../core/bytes";
import { RotatingFileSink } from "../core/rotatingFileSink";
import type { LogRecord } from "../core/schema";
import { createNodeLogFileStore } from "./nodeLogFileStore";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "parva-log-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
// The files' own modification times come from the real clock, and the sink compares them with its clock: start there.
const START = Date.now();
const record = (n: number, extra: Partial<LogRecord> = {}): LogRecord => ({
  timestamp: new Date(START + n * 1000).toISOString(),
  level: "INFO",
  event: "HTTP_REQUEST_COMPLETED",
  message: `record ${n}`,
  service: "parva-api",
  environment: "production",
  platform: "server",
  metadata: { n },
  ...extra,
});
const numbers = (records: LogRecord[]) => records.map((r) => (r.metadata as { n: number }).n);

describe("the store", () => {
  it("creates its folder, appends, lists with sizes, reads back, renames and removes", async () => {
    const nested = path.join(dir, "deep", "logs");
    const store = createNodeLogFileStore(nested);
    await store.ensure();
    await store.ensure(); // already there is not an error
    await store.append("a.jsonl", "one\n");
    await store.append("a.jsonl", "two\n");
    expect(utf8Text(await store.read("a.jsonl"))).toBe("one\ntwo\n");
    expect((await store.list()).map((f) => [f.name, f.size])).toEqual([["a.jsonl", 8]]);

    await store.write("b.bin", new Uint8Array([1, 2, 3]));
    await store.rename("b.bin", "c.bin");
    expect((await store.list()).map((f) => f.name).sort()).toEqual(["a.jsonl", "c.bin"]);
    await store.remove("a.jsonl");
    expect(readdirSync(nested)).toEqual(["c.bin"]);
    expect((await store.list())[0].modifiedAt).toBeGreaterThan(0);
  });

  it("does not list folders", async () => {
    const store = createNodeLogFileStore(dir);
    await store.ensure();
    writeFileSync(path.join(dir, "x.jsonl"), "x\n");
    mkdirSync(path.join(dir, "sub"));
    expect((await store.list()).map((f) => f.name)).toEqual(["x.jsonl"]);
  });

  it("refuses a file name that would leave the folder", async () => {
    const store = createNodeLogFileStore(dir);
    for (const name of ["../escape.jsonl", "a/b.jsonl", "a\\b.jsonl", "", "..", "x\0y"]) {
      await expect(store.append(name, "x"), JSON.stringify(name)).rejects.toThrow(/refusing/);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reports a missing file as an error, as the sink expects", async () => {
    const store = createNodeLogFileStore(dir);
    await expect(store.read("nope.jsonl")).rejects.toThrow();
    await expect(store.remove("nope.jsonl")).rejects.toThrow();
  });
});

describe("the rotating sink on a real folder", () => {
  it("rotates, gzips, keeps order, finds records again and deletes what has expired", async () => {
    const clock = { now: START };
    const sink = new RotatingFileSink({ store: createNodeLogFileStore(dir), now: () => clock.now, maxFileBytes: 2048, retentionMs: 7 * DAY });
    for (let i = 0; i < 60; i++) await sink.writeBatch([record(i, { user_id: i % 2 ? "u-odd" : "u-even" })]);

    const files = readdirSync(dir).sort();
    expect(files).toContain("current.jsonl");
    const gz = files.filter((name) => name.endsWith(".jsonl.gz"));
    expect(gz.length).toBeGreaterThan(2);
    expect(files.filter((name) => name.startsWith("parva-") && name.endsWith(".jsonl"))).toEqual([]); // no plain copy beside a compressed one
    expect(utf8Text(await gunzip(new Uint8Array(readFileSync(path.join(dir, gz[0])))))).toContain('"event":"HTTP_REQUEST_COMPLETED"');

    expect(numbers(await sink.readRecent())).toEqual(Array.from({ length: 60 }, (_, i) => i));
    const odd = await sink.search({ match: (r) => r.user_id === "u-odd" });
    expect(odd.records).toHaveLength(30);

    clock.now += 8 * DAY; // more than the retention later, with nothing logged: the daily job applies it
    expect(await sink.pruneNow()).toBe(gz.length + 1); // every archive and the file nobody has written to
    expect(readdirSync(dir)).toEqual([]);
  });

  it("picks up where the last run stopped: a restarted server appends to the file that was there", async () => {
    const first = new RotatingFileSink({ store: createNodeLogFileStore(dir) });
    await first.writeBatch([record(1), record(2)]);
    const second = new RotatingFileSink({ store: createNodeLogFileStore(dir) });
    await second.writeBatch([record(3)]);
    expect(numbers(await second.readRecent())).toEqual([1, 2, 3]);
  });
});
