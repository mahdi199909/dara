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

describe("serializeError — Prisma errors", () => {
  /** What Prisma 5 really produces: the failing call, with its arguments, ahead of the explanation. */
  const knownRequestMessage = [
    "",
    "Invalid `prisma.user.create()` invocation in",
    "/app/.next/server/app/api/auth/register/route.js:1:2345",
    "",
    "  38 ",
    "  39 const user = await prisma.user.create({",
    "  40   data: {",
    '→ 41     email: "ali@example.com",',
    '         name: "Ali Rezaei",',
    '         passwordHash: "$2a$12$abcdefghijklmnopqrstuv"',
    "       }",
    "     })",
    "",
    "Unique constraint failed on the fields: (`email`)",
  ].join("\n");

  function prismaError(name: string, message: string, extra: Record<string, unknown> = {}): Error {
    const err = Object.assign(new Error(message), { name, clientVersion: "5.19.1", ...extra });
    err.stack = `${name}: ${message}\n    at RequestHandler.handleRequestError (node_modules/@prisma/client/runtime/library.js:1:1)\n    at POST (route.ts:41:22)`;
    return err;
  }

  it("keeps the operation and the explanation but none of the arguments", () => {
    const out = serializeError(prismaError("PrismaClientKnownRequestError", knownRequestMessage, { code: "P2002", meta: { target: ["email"] } }));
    expect(out.type).toBe("PrismaClientKnownRequestError");
    expect(out.code).toBe("P2002");
    expect(out.message).toContain("prisma.user.create()");
    expect(out.message).toContain("Unique constraint failed on the fields");
    expect(out.message).toContain("target=email");
    expect(out.message).not.toContain("ali@example.com");
    expect(out.message).not.toContain("Ali Rezaei");
    expect(out.message).not.toContain("passwordHash");
    expect(out.message).not.toContain("/app/.next");
  });

  it("does not let the arguments reach the stack either", () => {
    const out = serializeError(prismaError("PrismaClientKnownRequestError", knownRequestMessage, { code: "P2002" }), { includeStack: true });
    const stack = out.stack!;
    expect(stack).not.toContain("ali@example.com");
    expect(stack).not.toContain("Ali Rezaei");
    expect(stack).not.toContain("passwordHash");
    expect(stack.split("\n")[0]).toMatch(/^PrismaClientKnownRequestError: /);
    expect(stack).toContain("    at POST (route.ts:41:22)");
  });

  it("recognises a validation error and blanks any quoted value in its explanation", () => {
    const message = ["", "Invalid `prisma.task.create()` invocation:", "", "{", "  data: {", '    title: "Buy a gift for Sara",', "  }", "}", "", 'Argument `where`: Got invalid value "Sara-secret" on prisma.task.create. Provided String, expected Int.'].join("\n");
    const out = serializeError(prismaError("PrismaClientValidationError", message));
    expect(out.message).toContain("prisma.task.create()");
    expect(out.message).toContain("Argument `where`");
    expect(out.message).not.toContain("Sara");
    expect(out.message).not.toContain("gift");
  });

  it("reads the explanation from the real shape of a query error, where the excerpt runs straight into it", () => {
    const message = [
      "",
      "Invalid `server.prisma.user.create()` invocation in",
      "C:\\repo\\src\\thing.test.ts:14:34",
      "",
      '  11 it("debug", async () => {',
      "  12   const { email } = await server.registerUser();",
      "→ 14   try { await server.prisma.user.create(",
      "Unique constraint failed on the fields: (`email`)",
    ].join("\n");
    const out = serializeError(prismaError("PrismaClientKnownRequestError", message, { code: "P2002", meta: { target: ["email"] } }));
    expect(out.message).toBe("Invalid `server.prisma.user.create()` invocation: Unique constraint failed on the fields: (`email`): (target=email)");
    expect(out.message).not.toContain("registerUser");
    expect(out.message).not.toContain("C:");
  });

  it("keeps a multi-line explanation but stops at the first indented or numbered line", () => {
    const message = ["", "Invalid `prisma.task.update()` invocation:", "", "  {", '    where: { id: "secret-id" }', "  }", "Argument `data` is missing.", "Available options are listed in green."].join("\n");
    const out = serializeError(prismaError("PrismaClientValidationError", message));
    expect(out.message).toBe("Invalid `prisma.task.update()` invocation: Argument `data` is missing. Available options are listed in green.");
    expect(out.message).not.toContain("secret-id");
  });

  it("blanks long numbers in the explanation — an amount that did not fit a column, an id", () => {
    const message = ["", "Invalid `prisma.transaction.create()` invocation:", "", "Unable to fit integer value 3000000000 into an INT4, or account 1234567890 not found"].join("\n");
    const out = serializeError(prismaError("PrismaClientKnownRequestError", message));
    expect(out.message).not.toContain("3000000000");
    expect(out.message).not.toContain("1234567890");
    expect(out.message).toContain("#");
  });

  it("does not depend on what the call was written as: prisma.…, tx.…, this.db.…", () => {
    for (const callee of ["tx.user.create()", "this.db.user.create()", "server.prisma.user.create()"]) {
      const message = knownRequestMessage.replace("prisma.user.create()", callee);
      const out = serializeError(new Error(message));
      expect(out.message, callee).toContain(callee);
      expect(out.message, callee).toContain("Unique constraint failed on the fields");
      expect(out.message, callee).not.toContain("ali@example.com");
    }
  });

  it("recognises a Prisma message even when the error is not named like one", () => {
    const out = serializeError(new Error(knownRequestMessage));
    expect(out.message).not.toContain("ali@example.com");
    expect(out.message).toContain("prisma.user.create()");
  });

  it("drops a last paragraph that is source code rather than an explanation", () => {
    const message = ["", "Invalid `prisma.user.update()` invocation in", "/app/route.js:1:1", "", "  12 await prisma.user.update({", '→ 13   data: { email: "x@y.z" }', "  14 })"].join("\n");
    const out = serializeError(new Error(message));
    expect(out.message).toBe("Invalid `prisma.user.update()` invocation");
  });

  it("keeps only the schema names from meta, never a value or a driver message", () => {
    const err = prismaError("PrismaClientKnownRequestError", "\nInvalid `prisma.task.update()` invocation:\n\n\nForeign key constraint failed on the field: `projectId`", {
      code: "P2003",
      meta: { field_name: "projectId", modelName: "Task", message: 'Key (email)=(ali@example.com) is not present in table "User"', target: ["a", "b"] },
    });
    const out = serializeError(err);
    expect(out.message).toContain("field_name=projectId");
    expect(out.message).toContain("modelName=Task");
    expect(out.message).toContain("target=a,b");
    expect(out.message).not.toContain("ali@example.com");
  });

  it("describes an initialisation failure without echoing anything but the host", () => {
    const err = prismaError("PrismaClientInitializationError", "Can't reach database server at `db`:`5432`\n\nPlease make sure your database server is running at `db`:`5432`.");
    const out = serializeError(err);
    expect(out.message).toBe("Can't reach database server at `db`:`5432`");
  });

  it("falls back to a generic label when there is nothing safe to say", () => {
    expect(serializeError(prismaError("PrismaClientRustPanicError", "")).message).toBe("Prisma error");
  });

  it("leaves the message of an ordinary error alone but still rebuilds its stack from frames", () => {
    const err = new Error("first line\nsecond line with a secret note");
    err.stack = "Error: first line\nsecond line with a secret note\n    at a (x.ts:1:1)\n    at b (x.ts:2:1)";
    const out = serializeError(err, { includeStack: true });
    expect(out.message).toBe("first line\nsecond line with a secret note");
    expect(out.stack).toBe("Error: first line\n    at a (x.ts:1:1)\n    at b (x.ts:2:1)");
  });

  it("copes with a stack that has no V8-style frames", () => {
    const err = new Error("boom");
    err.stack = "boom\nfn@file.js:1:1\nother@file.js:2:2";
    // (the e-mail scrubber may blur "fn@file.js" — the point is the message line is not duplicated)
    const lines = serializeError(err, { includeStack: true }).stack!.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Error: boom");
  });
});
