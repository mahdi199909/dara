// Identifiers that tie one thing to another across the phone, the web and the server: request ids,
// sync-session ids, per-write local event ids, W3C trace/span ids. ULID-based so they sort by time
// (a request id read out of a log line also says roughly when it happened) and need no coordination.
// Uses only crypto.getRandomValues, which exists in Node 20, browsers and the Android WebView.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type IdPrefix = "req" | "sync" | "lev" | "sess" | "dev" | "job";

function fillRandom(bytes: Uint8Array): Uint8Array {
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (webCrypto?.getRandomValues) return webCrypto.getRandomValues(bytes);
  // No CSPRNG available (very old WebView): ids only need to be unlikely to collide, not secret.
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** 26 chars: 10 of millisecond time (sortable) + 16 random. 256 is divisible by 32, so `% 32` is unbiased. */
export function ulid(time: number = Date.now()): string {
  let remaining = Math.max(0, Math.floor(time));
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[remaining % 32] + timePart;
    remaining = Math.floor(remaining / 32);
  }
  const random = fillRandom(new Uint8Array(16));
  let randomPart = "";
  for (let i = 0; i < 16; i++) randomPart += CROCKFORD[random[i] % 32];
  return timePart + randomPart;
}

export function newId(prefix: IdPrefix, time?: number): string {
  return `${prefix}_${ulid(time)}`;
}

const ID_PATTERN = /^([a-z]{2,5})_[0-9A-HJKMNP-TV-Z]{26}$/;

/** True for a well-formed id, optionally of one specific kind. */
export function isId(value: unknown, prefix?: IdPrefix): boolean {
  if (typeof value !== "string") return false;
  const match = ID_PATTERN.exec(value);
  return match !== null && (prefix === undefined || match[1] === prefix);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function nonZeroHex(byteLength: number): string {
  for (;;) {
    const hex = toHex(fillRandom(new Uint8Array(byteLength)));
    if (/[1-9a-f]/.test(hex)) return hex; // W3C: an all-zero id is invalid
  }
}

/** 32 lowercase hex chars (16 bytes) — the W3C trace-context / OpenTelemetry trace id shape. */
export function newTraceId(): string {
  return nonZeroHex(16);
}

/** 16 lowercase hex chars (8 bytes) — the W3C span id shape. */
export function newSpanId(): string {
  return nonZeroHex(8);
}
