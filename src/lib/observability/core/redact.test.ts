import { describe, expect, it } from "vitest";
import {
  REDACTED,
  REDACTED_CONTENT,
  REDACTED_MONEY,
  classifyKey,
  luhnValid,
  maskEmail,
  normalizeDigits,
  redactRecord,
  redactValue,
  scrubString,
  serializeError,
} from "./redact";

/** Appends the Luhn check digit to 15 digits, giving a number a card validator would accept. */
function withLuhn(prefix: string): string {
  for (let check = 0; check < 10; check++) if (luhnValid(prefix + check)) return prefix + check;
  throw new Error("unreachable");
}

const CARD = withLuhn("453914880343646");
const toPersian = (digits: string) => digits.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));

describe("sensitive keys", () => {
  it("replaces secrets wholesale whatever the casing, punctuation or nesting", () => {
    const out = redactValue({
      password: "hunter2",
      Password: "x",
      PASSWORD_HASH: "$2a$10$abc",
      token: "t",
      accessToken: "a",
      "x-api-key": "k",
      apiKey: "k2",
      Authorization: "Bearer abc",
      "Set-Cookie": "sid=1",
      cookie: "c",
      clientSecret: "s",
      card_number: "4111111111111111",
      cardNumber: "4111111111111111",
      CVV: "123",
      nested: { deeper: [{ jwt: "eyJ.x.y", pin: "1234" }] },
    }) as Record<string, any>;

    for (const key of ["password", "Password", "PASSWORD_HASH", "token", "accessToken", "x-api-key", "apiKey", "Authorization", "Set-Cookie", "cookie", "clientSecret", "card_number", "cardNumber", "CVV"]) {
      expect(out[key], key).toBe(REDACTED);
    }
    expect(out.nested.deeper[0]).toEqual({ jwt: REDACTED, pin: REDACTED });
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  it("leaves ordinary keys alone, including ones that merely look similar", () => {
    const input = { requestId: "req_1", sessionId: "sess_1", taskId: "t1", table: "Task", recordCount: 4, payloadSize: 1024, tokenCount: 7, authorName: "x", status: 201 };
    expect(redactValue(input)).toEqual(input);
  });

  it("masks money, user-authored text, e-mail and personal details by key", () => {
    const out = redactValue({
      amount: 250000,
      totalAmount: "1,200,000",
      directCost: 5,
      purchasePrice: 9,
      balance: 1,
      monthlyIncome: 30_000_000,
      title: "خرید لپ‌تاپ",
      description: "private",
      notes: "n",
      email: "m.gh.hut@gmail.com",
      phone: "0912",
      address: "somewhere",
      count: 3,
    }) as Record<string, unknown>;
    expect(out).toMatchObject({
      amount: REDACTED_MONEY,
      totalAmount: REDACTED_MONEY,
      directCost: REDACTED_MONEY,
      purchasePrice: REDACTED_MONEY,
      balance: REDACTED_MONEY,
      monthlyIncome: REDACTED_MONEY,
      title: REDACTED_CONTENT,
      description: REDACTED_CONTENT,
      notes: REDACTED_CONTENT,
      email: "m***@g***.com",
      phone: REDACTED,
      address: REDACTED,
      count: 3,
    });
  });

  it("can keep money readable for the owner's own audit history", () => {
    const out = redactValue({ amount: 250000, password: "x" }, { moneyMode: "keep" }) as Record<string, unknown>;
    expect(out.amount).toBe(250000);
    expect(out.password).toBe(REDACTED);
  });

  it("does not redact empty values (there is nothing to hide) and honours extra secret keys", () => {
    expect(redactValue({ token: null, password: undefined })).toEqual({ token: null });
    expect(redactValue({ tenantKey: "abc", other: 1 }, { extraSecretKeys: ["tenant-key"] })).toEqual({ tenantKey: REDACTED, other: 1 });
  });

  it("classifies keys", () => {
    expect(classifyKey("authorization")).toBe("secret");
    expect(classifyKey("amount")).toBe("money");
    expect(classifyKey("title")).toBe("content");
    expect(classifyKey("email")).toBe("email");
    expect(classifyKey("phone")).toBe("pii");
    expect(classifyKey("entityId")).toBeNull();
    expect(classifyKey("")).toBeNull();
    expect(classifyKey("کلید")).toBeNull();
  });
});

describe("secrets inside text", () => {
  it("removes JWTs and bearer tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c3JfMSJ9.abcDEF123_-xyz";
    expect(scrubString(`token was ${jwt} ok`)).toBe("token was [REDACTED_JWT] ok");
    expect(scrubString("Authorization: Bearer abcdefghij1234567890")).not.toContain("abcdefghij");
    expect(scrubString("bearer   AAAAAAAAAAAA")).toBe("bearer [REDACTED]");
  });

  it("removes credentials from URLs (a connection string in an error message)", () => {
    expect(scrubString("Can't reach postgresql://hesabkon:s3cret@postgres:5432/hesabkon")).toBe("Can't reach postgresql://[REDACTED]@postgres:5432/hesabkon");
    expect(scrubString("https://user@example.com/path")).toBe("https://[REDACTED]@example.com/path");
  });

  it("removes key=value and key: value secrets", () => {
    expect(scrubString("connect failed password=abc123 host=x")).toBe("connect failed password=[REDACTED] host=x");
    expect(scrubString('{"token":"abc","ok":1}')).not.toContain("abc");
    expect(scrubString("api_key: AKIAXXXX")).not.toContain("AKIAXXXX");
    expect(scrubString("SECRET='top secret'")).not.toContain("top secret");
  });

  it("removes card numbers that pass the Luhn check, in ASCII or Persian digits, with separators", () => {
    expect(scrubString(`paid with ${CARD} today`)).toBe("paid with [REDACTED_CARD] today");
    const spaced = CARD.replace(/(\d{4})(?=\d)/g, "$1 ");
    expect(scrubString(`card ${spaced}.`)).toBe("card [REDACTED_CARD].");
    expect(scrubString(`کارت ${toPersian(CARD)} است`)).toBe("کارت [REDACTED_CARD] است");
  });

  it("does not mistake other digit runs for cards", () => {
    const notLuhn = "1234567890123456"; // fails Luhn
    expect(luhnValid(notLuhn)).toBe(false);
    expect(scrubString(`id ${notLuhn}`)).toBe(`id ${notLuhn}`);
    expect(scrubString("epoch 1789909226512 ms")).toBe("epoch 1789909226512 ms"); // 13 digits: never a card
    expect(scrubString("order 0000000000000000")).toBe("order 0000000000000000");
  });

  it("removes Sheba numbers and masks e-mail addresses", () => {
    expect(scrubString("to IR062960000000100324200001 done")).toBe("to [REDACTED_IBAN] done");
    expect(scrubString("mail m.gh.hut@gmail.com failed")).toBe("mail m***@g***.com failed");
  });

  it("leaves harmless text untouched (Persian included)", () => {
    for (const text of ["short", "خطایی رخ داد. دوباره تلاش کنید.", "Task not found for id t_123", "Prisma P2002 unique constraint failed"]) {
      expect(scrubString(text)).toBe(text);
    }
  });

  it("normalises Persian and Arabic-Indic digits one-for-one", () => {
    expect(normalizeDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(normalizeDigits("a۱b")).toBe("a1b");
  });

  it("masks e-mail addresses in a stable shape", () => {
    expect(maskEmail("m.gh.hut@gmail.com")).toBe("m***@g***.com");
    expect(maskEmail("a@b.co.ir")).toBe("a***@b***.ir");
    expect(maskEmail("nobody")).toBe(REDACTED);
    expect(maskEmail("@x.com")).toBe(REDACTED);
  });
});

describe("safe serialisation", () => {
  it("survives cycles, BigInt, Symbols, functions and odd numbers", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    a.list = [a, { deep: a }];
    const out = redactValue({ a, big: 10n ** 20n, sym: Symbol("s"), fn: function named() {}, nan: NaN, inf: Infinity, negZero: -0 }) as Record<string, any>;
    expect(out.a.self).toBe("[Circular]");
    expect(out.a.list[0]).toBe("[Circular]");
    expect(out.a.list[1].deep).toBe("[Circular]");
    expect(out.big).toBe("100000000000000000000");
    expect(out.sym).toBe("Symbol(s)");
    expect(out.fn).toBe("[Function named]");
    expect(out.nan).toBe("NaN");
    expect(out.inf).toBe("Infinity");
    expect(out.negZero).toBe(0);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("does not call it a cycle when the same object is merely used twice", () => {
    const shared = { x: 1 };
    expect(redactValue({ a: shared, b: shared })).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });

  it("turns dates, errors, maps, sets and binary data into JSON-safe values", () => {
    const out = redactValue({
      when: new Date("2026-09-20T12:44:23.000Z"),
      bad: new Date("nope"),
      err: new TypeError("Failed to fetch"),
      map: new Map([["k", 1]]),
      set: new Set([1, 2]),
      bytes: new Uint8Array(16),
      buffer: new ArrayBuffer(8),
    }) as Record<string, any>;
    expect(out.when).toBe("2026-09-20T12:44:23.000Z");
    expect(out.bad).toBe("Invalid Date");
    expect(out.err).toEqual({ type: "TypeError", message: "Failed to fetch" });
    expect(out.map).toEqual({ k: 1 });
    expect(out.set).toEqual([1, 2]);
    expect(out.bytes).toBe("[Binary 16 bytes]");
    expect(out.buffer).toBe("[Binary 8 bytes]");
  });

  it("drops undefined properties, turns undefined array items into null", () => {
    expect(redactValue({ a: undefined, b: [undefined, 1] })).toEqual({ b: [null, 1] });
  });

  it("bounds depth, array length, key count and string length", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 12; i++) deep = { child: deep };
    expect(JSON.stringify(redactValue(deep))).toContain("[MaxDepth]");

    const list = redactValue(Array.from({ length: 500 }, (_, i) => i)) as unknown[];
    expect(list).toHaveLength(51);
    expect(list[50]).toBe("…+450 more");

    const many = redactValue(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]))) as Record<string, unknown>;
    expect(Object.keys(many)).toHaveLength(51);
    expect(many["…"]).toBe("+150 more keys");

    const long = redactValue("x".repeat(10_000)) as string;
    expect(long.length).toBeLessThan(600);
    expect(long).toContain("[+9500 chars]");
  });

  it("caps the total work one record can cause", () => {
    const wide = Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => ({ a: 1, b: { c: 2 } })));
    const out = JSON.stringify(redactValue(wide, { maxArrayLength: 100, maxNodes: 300 }));
    expect(out).toContain("[Truncated]");
  });

  it("copes with hostile objects: throwing getters, throwing proxies, null prototypes", () => {
    const hostile = {
      get boom(): string {
        throw new Error("getter exploded");
      },
      ok: 1,
    };
    expect(redactValue(hostile)).toEqual({ ok: 1 });

    const proxy = new Proxy({}, { ownKeys: () => { throw new Error("no keys for you"); } });
    expect(redactValue({ p: proxy })).toEqual({ p: "[Unreadable]" });

    const bare = Object.create(null) as Record<string, unknown>;
    bare.password = "x";
    bare.fine = "y";
    expect(redactValue(bare)).toEqual({ password: REDACTED, fine: "y" });
  });

  it("redactRecord always returns a plain record", () => {
    expect(redactRecord({ a: 1, password: "p" })).toEqual({ a: 1, password: REDACTED });
    expect(redactRecord({})).toEqual({});
  });
});

describe("serializeError", () => {
  it("captures type, message, code and status", () => {
    const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002", status: 409 });
    expect(serializeError(err)).toEqual({ type: "Error", message: "Unique constraint failed", code: "P2002", status: 409 });
  });

  it("keeps a stack only when asked, capped in frames and characters", () => {
    const err = new Error("boom");
    err.stack = ["Error: boom", ...Array.from({ length: 200 }, (_, i) => `    at fn${i} (file.ts:${i}:1)`)].join("\n");
    expect(serializeError(err).stack).toBeUndefined();
    const withStack = serializeError(err, { includeStack: true, maxStackFrames: 10 });
    expect(withStack.stack!.split("\n")).toHaveLength(11);
    const short = serializeError(err, { includeStack: true, maxStackChars: 100 });
    expect(short.stack!.length).toBeLessThan(140);
  });

  it("scrubs secrets out of messages and stacks", () => {
    const err = new Error("Can't reach postgresql://u:pw@db:5432/x with password=hunter2");
    err.stack = `Error: token eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1In0.sig12345\n    at f (a.ts:1:1)`;
    const out = serializeError(err, { includeStack: true });
    expect(out.message).not.toContain("hunter2");
    expect(out.message).not.toContain("pw@");
    expect(out.stack).not.toContain("eyJhbGci");
  });

  it("follows a cause chain to a bounded depth", () => {
    let err: Error = new Error("level 0");
    for (let i = 1; i <= 10; i++) err = new Error(`level ${i}`, { cause: err });
    let depth = 0;
    for (let node = serializeError(err) as { cause?: unknown }; node.cause; node = node.cause as { cause?: unknown }) depth++;
    expect(depth).toBe(3);
  });

  it("survives a self-referencing cause", () => {
    const err = new Error("loop") as Error & { cause?: unknown };
    err.cause = err;
    expect(() => serializeError(err)).not.toThrow();
  });

  it("keeps a few members of an AggregateError", () => {
    const aggregate = new AggregateError(Array.from({ length: 50 }, (_, i) => new Error(`e${i}`)), "many");
    expect(serializeError(aggregate).errors).toHaveLength(5);
  });

  it("describes non-Error values without throwing", () => {
    expect(serializeError("plain text")).toEqual({ type: "string", message: "plain text" });
    expect(serializeError(42)).toEqual({ type: "number", message: "42" });
    expect(serializeError(null)).toEqual({ type: "object", message: "null" });
    expect(serializeError(undefined)).toEqual({ type: "undefined", message: "undefined" });
    expect(serializeError({ status: 500, token: "abc" }).message).not.toContain("abc");
  });

  it("truncates a gigantic message", () => {
    const out = serializeError(new Error("m".repeat(1_000_000)));
    expect(out.message.length).toBeLessThan(1100);
  });

  it("never throws for a hostile error object", () => {
    const hostile = {
      name: "Hostile",
      get message(): string {
        throw new Error("no message for you");
      },
      stack: "x",
    };
    expect(() => serializeError(hostile)).not.toThrow();
  });
});
