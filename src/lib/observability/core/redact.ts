// The privacy layer every log record passes through. Two lines of defence, because a developer
// passing the wrong thing to a logger must not be able to leak it:
//  1. by KEY — password, token, authorization, cookie, secret, card number, cvv … are replaced
//     wholesale, whatever the value; money amounts and user-authored text (titles, notes) too;
//  2. by VALUE — inside any string: JWTs, "Bearer …", credentials in URLs, "password=…" pairs, card
//     numbers (Luhn-checked, Persian digits included), Sheba numbers and e-mail addresses.
// It also makes the result safe to serialise: cycles, BigInt, Symbols, throwing getters, binary
// data, huge strings and arrays can never reach a sink in a form that could throw or explode.
import type { SerializedError } from "./schema";

export const REDACTED = "[REDACTED]";
export const REDACTED_MONEY = "[REDACTED_MONEY]";
export const REDACTED_CONTENT = "[REDACTED_CONTENT]";

export type KeyClass = "secret" | "money" | "content" | "email" | "pii";

const SECRET_EXACT = new Set([
  "password", "passwd", "pwd", "pass", "passphrase", "passwordhash",
  "token", "jwt", "bearer", "authorization", "auth", "cookie", "cookies", "setcookie",
  "secret", "apikey", "credential", "credentials", "privatekey", "secretkey", "clientsecret", "csrf",
  "cardnumber", "cardno", "pan", "cvv", "cvv2", "cvc", "pin", "otp",
  "sheba", "iban", "accountnumber", "routingnumber", "ssn", "nationalid", "nationalcode",
]);
const SECRET_SUFFIXES = ["token", "secret", "password", "apikey", "authorization", "cookie"];

const MONEY_EXACT = new Set([
  "amount", "amounts", "totalamount", "installmentamount", "balance", "initialbalance", "purchaseprice",
  "currentvalue", "directcost", "incomeamount", "estimatedcost", "monthlyincome", "hourlyvalueoverride",
  "valueperhour", "totalvalue", "virtualassetvalue", "virtualassetvalueperhour", "virtualassetvaluepercheckin",
  "price", "cost", "salary", "income",
]);
const MONEY_SUFFIXES = ["amount", "balance", "price", "cost"];

const CONTENT_EXACT = new Set(["title", "description", "notes", "note", "text", "comment", "comments", "memo", "body", "content", "snippet"]);
const EMAIL_EXACT = new Set(["email", "useremail", "remoteemail", "mail", "emailaddress"]);
const PII_EXACT = new Set([
  "phone", "phonenumber", "mobile", "mobilenumber", "address", "streetaddress", "birthdate", "dob",
  "firstname", "lastname", "fullname", "displayname",
]);

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const keyCache = new Map<string, KeyClass | null>();

/** What kind of sensitive data a key name announces, if any (null = an ordinary key). */
export function classifyKey(key: string, extraSecretKeys?: ReadonlySet<string>): KeyClass | null {
  const cached = keyCache.get(key);
  let result: KeyClass | null | undefined = cached;
  if (result === undefined) {
    const k = normalizeKey(key);
    if (!k) result = null;
    else if (SECRET_EXACT.has(k) || SECRET_SUFFIXES.some((suffix) => k.endsWith(suffix))) result = "secret";
    else if (MONEY_EXACT.has(k) || MONEY_SUFFIXES.some((suffix) => k.endsWith(suffix))) result = "money";
    else if (CONTENT_EXACT.has(k)) result = "content";
    else if (EMAIL_EXACT.has(k)) result = "email";
    else if (PII_EXACT.has(k)) result = "pii";
    else result = null;
    if (keyCache.size < 2000) keyCache.set(key, result);
  }
  if (result === null && extraSecretKeys && extraSecretKeys.has(normalizeKey(key))) return "secret";
  return result;
}

// ---------------------------------------------------------------------------------------------
// Value scrubbing (inside strings)
// ---------------------------------------------------------------------------------------------

const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi;
const SECRET_PAIR = /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|cookie)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&"'}]+)/gi;
const SHEBA = /\bIR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const CARD_CANDIDATE = /\b(?:\d[ -]?){14,18}\d\b/g;

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII, one code unit each so string indexes line up. */
export function normalizeDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum > 0 && sum % 10 === 0;
}

/** m.gh.hut@gmail.com → m***@g***.com */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return REDACTED;
  const local = email.slice(0, at);
  const labels = email.slice(at + 1).split(".");
  const head = labels[0] ?? "";
  const tld = labels.length > 1 ? labels[labels.length - 1] : "";
  return `${local[0]}***@${head[0] ?? ""}***${tld ? `.${tld}` : ""}`;
}

/** Removes secrets from free text. Cheap pre-checks keep the common case (no match possible) fast. */
export function scrubString(input: string): string {
  if (input.length < 6) return input;
  let out = input;
  if (out.includes("eyJ")) out = out.replace(JWT, "[REDACTED_JWT]");
  if (/bearer/i.test(out)) out = out.replace(BEARER, "$1 [REDACTED]");
  if (out.includes("@") && out.includes("://")) out = out.replace(URL_CREDENTIALS, "$1[REDACTED]@");
  if (/[=:]/.test(out)) out = out.replace(SECRET_PAIR, `$1$2${REDACTED}`);
  if (/ir\d\d/i.test(out)) out = out.replace(SHEBA, "[REDACTED_IBAN]");
  if (out.includes("@")) out = out.replace(EMAIL, (match) => maskEmail(match));

  const digits = normalizeDigits(out);
  if (/\d{4}/.test(digits) && /\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d[ -]?\d/.test(digits)) {
    let result = "";
    let last = 0;
    for (const match of digits.matchAll(CARD_CANDIDATE)) {
      if (match.index === undefined) continue;
      const digitsOnly = match[0].replace(/[ -]/g, "");
      if (digitsOnly.length >= 15 && digitsOnly.length <= 19 && luhnValid(digitsOnly)) {
        result += out.slice(last, match.index) + "[REDACTED_CARD]";
        last = match.index + match[0].length;
      }
    }
    if (last > 0) out = result + out.slice(last);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Structured values
// ---------------------------------------------------------------------------------------------

export interface RedactOptions {
  /** "keep" leaves money amounts readable (the owner's own audit history); the default masks them. */
  moneyMode?: "redact" | "keep";
  maxDepth?: number;
  maxStringLength?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  /** Total values visited in one call — a hard bound on the work a single log record can cause. */
  maxNodes?: number;
  /** Additional key names (any casing/punctuation) to treat as secrets. */
  extraSecretKeys?: readonly string[];
}

const DEFAULTS = { maxDepth: 6, maxStringLength: 500, maxArrayLength: 50, maxObjectKeys: 50, maxNodes: 2000 };

interface Walk {
  limits: typeof DEFAULTS;
  moneyMode: "redact" | "keep";
  extraSecretKeys?: ReadonlySet<string>;
  nodes: number;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[+${text.length - max} chars]`;
}

function safeGet(object: unknown, key: string): unknown {
  try {
    return (object as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function isErrorLike(value: object): boolean {
  return value instanceof Error || (typeof safeGet(value, "message") === "string" && typeof safeGet(value, "name") === "string" && "stack" in value);
}

function redactByClass(cls: KeyClass, value: unknown, moneyMode: "redact" | "keep"): { replace: boolean; value?: unknown } {
  switch (cls) {
    case "secret":
      return { replace: true, value: REDACTED };
    case "pii":
      return { replace: true, value: REDACTED };
    case "content":
      return { replace: true, value: REDACTED_CONTENT };
    case "email":
      return { replace: true, value: typeof value === "string" ? maskEmail(value) : REDACTED };
    case "money":
      return moneyMode === "keep" ? { replace: false } : { replace: true, value: REDACTED_MONEY };
  }
}

function walk(value: unknown, depth: number, ancestors: Set<object>, state: Walk): unknown {
  if (++state.nodes > state.limits.maxNodes) return "[Truncated]";

  switch (typeof value) {
    case "string":
      return truncate(scrubString(value), state.limits.maxStringLength);
    case "number":
      return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : String(value);
    case "boolean":
      return value;
    case "undefined":
      return undefined;
    case "bigint":
      return value.toString();
    case "symbol":
      return value.toString();
    case "function":
      return `[Function ${(value as { name?: string }).name || "anonymous"}]`;
  }
  if (value === null) return null;

  const object = value as object;
  if (depth >= state.limits.maxDepth) return "[MaxDepth]";
  if (ancestors.has(object)) return "[Circular]";

  if (object instanceof Date) return Number.isNaN(object.getTime()) ? "Invalid Date" : object.toISOString();
  if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer) return `[Binary ${(object as { byteLength: number }).byteLength} bytes]`;
  if (isErrorLike(object)) return serializeError(object, { includeStack: false });

  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      const cap = state.limits.maxArrayLength;
      const items: unknown[] = [];
      for (let i = 0; i < Math.min(object.length, cap); i++) {
        const item = walk(safeGet(object, String(i)), depth + 1, ancestors, state);
        items.push(item === undefined ? null : item);
      }
      if (object.length > cap) items.push(`…+${object.length - cap} more`);
      return items;
    }

    if (object instanceof Set) return walk(Array.from(object), depth, ancestors, state);
    if (object instanceof Map) {
      const record: Record<string, unknown> = {};
      for (const [k, v] of Array.from(object.entries()).slice(0, state.limits.maxObjectKeys)) record[String(k)] = v;
      return walk(record, depth, ancestors, state);
    }

    let keys: string[];
    try {
      keys = Object.keys(object);
    } catch {
      return "[Unreadable]";
    }
    const out: Record<string, unknown> = {};
    let taken = 0;
    for (const key of keys) {
      if (taken >= state.limits.maxObjectKeys) {
        out["…"] = `+${keys.length - taken} more keys`;
        break;
      }
      taken++;
      const raw = safeGet(object, key);
      const cls = classifyKey(key, state.extraSecretKeys);
      if (cls && raw !== undefined && raw !== null) {
        const decision = redactByClass(cls, raw, state.moneyMode);
        if (decision.replace) {
          out[key] = decision.value;
          continue;
        }
      }
      const cleaned = walk(raw, depth + 1, ancestors, state);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  } finally {
    ancestors.delete(object);
  }
}

/** A JSON-safe, size-bounded copy of `value` with sensitive keys and text patterns removed. Never throws. */
export function redactValue(value: unknown, options: RedactOptions = {}): unknown {
  try {
    const state: Walk = {
      limits: {
        maxDepth: options.maxDepth ?? DEFAULTS.maxDepth,
        maxStringLength: options.maxStringLength ?? DEFAULTS.maxStringLength,
        maxArrayLength: options.maxArrayLength ?? DEFAULTS.maxArrayLength,
        maxObjectKeys: options.maxObjectKeys ?? DEFAULTS.maxObjectKeys,
        maxNodes: options.maxNodes ?? DEFAULTS.maxNodes,
      },
      moneyMode: options.moneyMode ?? "redact",
      extraSecretKeys: options.extraSecretKeys?.length ? new Set(options.extraSecretKeys.map(normalizeKey)) : undefined,
      nodes: 0,
    };
    return walk(value, 0, new Set(), state);
  } catch {
    return "[Unserializable]";
  }
}

/** Redacts a whole fields object into a plain record (the `metadata` of a log record). */
export function redactRecord(fields: Record<string, unknown>, options: RedactOptions = {}): Record<string, unknown> {
  const result = redactValue(fields, options);
  return result !== null && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export interface ErrorSerializeOptions {
  includeStack?: boolean;
  maxStackFrames?: number;
  maxStackChars?: number;
  maxMessageChars?: number;
  /** How many `cause` links to follow. */
  maxCauseDepth?: number;
  /** How many members of an AggregateError to keep. */
  maxAggregate?: number;
}

const ERROR_DEFAULTS = { maxStackFrames: 25, maxStackChars: 4000, maxMessageChars: 1000, maxCauseDepth: 3, maxAggregate: 5 };

function primitiveOrUndefined(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

/**
 * A structured, size-bounded, secret-free description of any thrown value. The message and stack
 * go through scrubString (a Prisma or fetch error can carry a connection string or a token), and a
 * stack is kept only when asked for — it belongs in server logs and the on-device log file, never in
 * anything shown to a person.
 */
export function serializeError(err: unknown, options: ErrorSerializeOptions = {}, depth = 0): SerializedError {
  const opts = { ...ERROR_DEFAULTS, ...options };
  try {
    if (typeof err === "object" && err !== null && isErrorLike(err)) {
      const name = safeGet(err, "name");
      const rawMessage = safeGet(err, "message");
      const serialized: SerializedError = {
        type: typeof name === "string" && name ? name : (safeGet(safeGet(err, "constructor"), "name") as string) || "Error",
        message: truncate(scrubString(typeof rawMessage === "string" ? rawMessage : String(rawMessage ?? "")), opts.maxMessageChars),
      };
      const code = primitiveOrUndefined(safeGet(err, "code"));
      if (code !== undefined) serialized.code = code;
      const status = safeGet(err, "status") ?? safeGet(err, "statusCode");
      if (typeof status === "number") serialized.status = status;

      if (opts.includeStack) {
        const stack = safeGet(err, "stack");
        if (typeof stack === "string" && stack) {
          const lines = stack.split("\n").slice(0, opts.maxStackFrames + 1);
          serialized.stack = truncate(scrubString(lines.join("\n")), opts.maxStackChars);
        }
      }

      const cause = safeGet(err, "cause");
      if (cause !== undefined && cause !== null && depth < opts.maxCauseDepth) serialized.cause = serializeError(cause, options, depth + 1);

      const members = safeGet(err, "errors");
      if (Array.isArray(members) && members.length > 0 && depth < opts.maxCauseDepth) {
        serialized.errors = members.slice(0, opts.maxAggregate).map((member) => serializeError(member, options, depth + 1));
      }
      return serialized;
    }

    if (typeof err === "string") return { type: "string", message: truncate(scrubString(err), opts.maxMessageChars) };
    if (typeof err === "object" && err !== null) {
      let text: string;
      try {
        text = JSON.stringify(redactValue(err)) ?? "";
      } catch {
        text = "[unserializable object]";
      }
      return { type: "object", message: truncate(text, opts.maxMessageChars) };
    }
    return { type: typeof err, message: truncate(String(err), opts.maxMessageChars) };
  } catch {
    return { type: "Unserializable", message: "[error could not be serialized]" };
  }
}
