// Trace identity in the W3C Trace Context shape, so OpenTelemetry (or anything that reads the
// `traceparent` header) can be attached later without changing a single log call: the ids logged
// today are already the ids it would use. No spans are exported anywhere yet — this is only the
// propagation and the id bookkeeping.
import { newSpanId, newTraceId } from "./ids";

export interface TraceContext {
  /** 32 lowercase hex chars. */
  traceId: string;
  /** 16 lowercase hex chars — this unit of work. */
  spanId: string;
  /** The caller's span, when this one was started inside another. */
  parentSpanId?: string;
  sampled: boolean;
}

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX2 = /^[0-9a-f]{2}$/;

/**
 * Parses `traceparent: 00-<trace-id>-<parent-id>-<flags>`. Anything malformed is null (a bad header
 * from a client must never break a request — the caller just starts a fresh trace). The remote's
 * span becomes our parent.
 */
export function parseTraceparent(header: string | null | undefined): TraceContext | null {
  if (typeof header !== "string") return null;
  const parts = header.trim().split("-");
  if (parts.length < 4) return null;
  const [version, traceId, parentId, flags] = parts;
  if (!HEX2.test(version) || version === "ff") return null;
  // Version 00 has exactly four fields; a later version may append more, which we ignore.
  if (version === "00" && parts.length !== 4) return null;
  if (!HEX32.test(traceId) || /^0+$/.test(traceId)) return null;
  if (!HEX16.test(parentId) || /^0+$/.test(parentId)) return null;
  if (!HEX2.test(flags)) return null;
  return { traceId, spanId: newSpanId(), parentSpanId: parentId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

export function formatTraceparent(context: Pick<TraceContext, "traceId" | "spanId" | "sampled">): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

/** A new span inside `parent`'s trace, or the root of a new trace when there is no parent. */
export function newTraceContext(parent?: TraceContext | null): TraceContext {
  if (!parent) return { traceId: newTraceId(), spanId: newSpanId(), sampled: true };
  return { traceId: parent.traceId, spanId: newSpanId(), parentSpanId: parent.spanId, sampled: parent.sampled };
}

export interface Span {
  context: TraceContext;
  /** Milliseconds since the span started. */
  end(): number;
}

export function startSpan(parent?: TraceContext | null, clock: () => number = () => performance.now()): Span {
  const started = clock();
  return { context: newTraceContext(parent), end: () => Math.round((clock() - started) * 100) / 100 };
}
