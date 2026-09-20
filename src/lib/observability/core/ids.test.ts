import { describe, expect, it } from "vitest";
import { isId, newId, newSpanId, newTraceId, ulid } from "./ids";
import { formatTraceparent, newTraceContext, parseTraceparent, startSpan } from "./trace";

describe("ids", () => {
  it("makes 26-character Crockford ULIDs that sort by time", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    const c = ulid(1_800_000_000_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
    expect(b.slice(0, 10) < c.slice(0, 10)).toBe(true);
  });

  it("encodes the timestamp in the first ten characters", () => {
    expect(ulid(0).slice(0, 10)).toBe("0000000000");
    expect(ulid(31).slice(0, 10)).toBe("000000000Z");
    expect(ulid(32).slice(0, 10)).toBe("0000000010");
  });

  it("is unique across many ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(ulid());
    expect(seen.size).toBe(20_000);
  });

  it("prefixes ids by kind and recognises them again", () => {
    for (const prefix of ["req", "sync", "lev", "sess", "dev", "job"] as const) {
      const id = newId(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(isId(id)).toBe(true);
      expect(isId(id, prefix)).toBe(true);
      expect(isId(id, prefix === "req" ? "sync" : "req")).toBe(false);
    }
    expect(isId("req_short")).toBe(false);
    expect(isId("nonsense")).toBe(false);
    expect(isId(42)).toBe(false);
    expect(isId(`req_${"i".repeat(26)}`)).toBe(false); // I is not in the Crockford alphabet
  });

  it("makes W3C-shaped trace and span ids, never all zero", () => {
    for (let i = 0; i < 500; i++) {
      expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
      expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(newTraceId()).not.toMatch(/^0+$/);
  });
});

describe("trace context", () => {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const parentId = "00f067aa0ba902b7";

  it("parses a valid traceparent and makes the caller's span our parent", () => {
    const parsed = parseTraceparent(`00-${traceId}-${parentId}-01`)!;
    expect(parsed.traceId).toBe(traceId);
    expect(parsed.parentSpanId).toBe(parentId);
    expect(parsed.sampled).toBe(true);
    expect(parsed.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(parsed.spanId).not.toBe(parentId);
    expect(parseTraceparent(`00-${traceId}-${parentId}-00`)!.sampled).toBe(false);
  });

  it("rejects anything malformed instead of throwing — a bad header must not break a request", () => {
    const bad = [
      undefined,
      null,
      "",
      "garbage",
      `00-${traceId}-${parentId}`, // missing flags
      `00-${traceId.toUpperCase()}-${parentId}-01`, // uppercase hex is invalid
      `00-${"0".repeat(32)}-${parentId}-01`, // all-zero trace id
      `00-${traceId}-${"0".repeat(16)}-01`, // all-zero span id
      `ff-${traceId}-${parentId}-01`, // version ff is invalid
      `00-${traceId}-${parentId}-01-extra`, // version 00 has exactly four fields
      `00-${traceId.slice(1)}-${parentId}-01`, // wrong length
      `0-${traceId}-${parentId}-01`,
    ];
    for (const header of bad) expect(parseTraceparent(header as string), String(header)).toBeNull();
  });

  it("tolerates extra fields from a newer version", () => {
    expect(parseTraceparent(`01-${traceId}-${parentId}-01-more`)?.traceId).toBe(traceId);
  });

  it("formats and round-trips", () => {
    const ctx = { traceId, spanId: parentId, sampled: true };
    expect(formatTraceparent(ctx)).toBe(`00-${traceId}-${parentId}-01`);
    expect(formatTraceparent({ ...ctx, sampled: false })).toBe(`00-${traceId}-${parentId}-00`);
    const parsed = parseTraceparent(formatTraceparent(ctx))!;
    expect(parsed.traceId).toBe(traceId);
    expect(parsed.parentSpanId).toBe(parentId);
  });

  it("starts a new trace, or a child span inside an existing one", () => {
    const root = newTraceContext();
    expect(root.parentSpanId).toBeUndefined();
    expect(root.sampled).toBe(true);
    const child = newTraceContext(root);
    expect(child.traceId).toBe(root.traceId);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(child.spanId).not.toBe(root.spanId);
  });

  it("times a span with an injectable clock", () => {
    let now = 100;
    const span = startSpan(null, () => now);
    now = 142.567;
    expect(span.end()).toBe(42.57);
    expect(span.context.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});
