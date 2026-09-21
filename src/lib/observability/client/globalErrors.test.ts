import { describe, expect, it } from "vitest";
import { createTestLogger } from "../testing";
import { installGlobalErrorCapture, reportRenderError, sourceFileName, type ErrorTarget } from "./globalErrors";

/** A window that can be told things happened. */
function fakeWindow() {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const target: ErrorTarget & { fire(type: string, event: object): void; count(type: string): number } = {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
    },
    fire(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    count(type) {
      return (listeners.get(type) ?? []).length;
    },
  };
  return target;
}

function setup(options: { now?: () => number } = {}) {
  const test = createTestLogger();
  const target = fakeWindow();
  const remove = installGlobalErrorCapture({ target, log: test.logger, ...options });
  return { ...test, target, remove };
}

describe("uncaught exceptions", () => {
  it("writes one CRITICAL event with the stack, the error code and where it came from — without the path or the query", () => {
    const { target, sink } = setup();
    const error = new TypeError("Cannot read properties of undefined (reading 'title')");
    target.fire("error", { error, message: error.message, filename: "https://localhost/_next/static/chunks/app/page-4f3a.js?v=12", lineno: 10, colno: 42 });

    expect(sink.records).toHaveLength(1);
    const record = sink.records[0];
    expect(record).toMatchObject({ level: "CRITICAL", event: "SYSTEM_UNHANDLED_ERROR", error_code: "SYS-001", layer: "local", error: { type: "TypeError" } });
    expect(record.error?.stack).toContain("TypeError");
    expect(record.metadata).toMatchObject({ kind: "window.onerror", source: "page-4f3a.js", line: 10, column: 42 });
    expect(JSON.stringify(record)).not.toContain("localhost");
    expect(JSON.stringify(record)).not.toContain("v=12");
  });

  it("makes an error out of a bare message when the browser gives no error object", () => {
    const { target, sink } = setup();
    target.fire("error", { message: "Script error." });
    expect(sink.records[0].error).toMatchObject({ message: "Script error." });
  });

  it("ignores the layout timing notice that browsers raise and that means nothing is wrong", () => {
    const { target, sink } = setup();
    target.fire("error", { message: "ResizeObserver loop completed with undelivered notifications." });
    expect(sink.records).toEqual([]);
  });

  it("does not put an e-mail address that ended up in an error message into the log", () => {
    const { target, sink } = setup();
    target.fire("error", { error: new Error("could not load the profile of sara@example.com"), message: "" });
    expect(JSON.stringify(sink.records)).not.toContain("sara@example.com");
  });
});

describe("unhandled promise rejections", () => {
  it("writes an ERROR event for a rejected promise nobody handled", () => {
    const { target, sink } = setup();
    target.fire("unhandledrejection", { reason: new Error("sync blew up") });
    expect(sink.records[0]).toMatchObject({ level: "ERROR", event: "SYSTEM_UNHANDLED_ERROR", metadata: { kind: "unhandledrejection" }, error: { message: "sync blew up" } });
  });

  it("copes with a reason that is not an Error, or missing altogether", () => {
    const { target, sink } = setup();
    target.fire("unhandledrejection", { reason: "just a string" });
    target.fire("unhandledrejection", {});
    expect(sink.records).toHaveLength(2);
    expect(sink.records[0].error?.message).toContain("just a string");
  });
});

describe("a failure that repeats", () => {
  it("writes the same error a few times a minute and counts the rest, then says how many it held back", () => {
    const clock = { now: 1_000_000 };
    const { target, sink } = setup({ now: () => clock.now });
    const error = new Error("render loop");
    for (let i = 0; i < 100; i++) target.fire("error", { error, message: error.message });
    expect(sink.records).toHaveLength(5);

    clock.now += 61_000;
    target.fire("error", { error, message: error.message });
    expect(sink.records).toHaveLength(6);
    expect(sink.records[5].metadata).toMatchObject({ suppressedSince: 95 });
  });

  it("keeps different errors apart, and caps everything together", () => {
    const { target, sink } = setup();
    for (let i = 0; i < 100; i++) target.fire("error", { error: new Error(`distinct failure ${i}`), message: "x" });
    expect(sink.records).toHaveLength(30);
  });
});

describe("lifecycle", () => {
  it("removes its listeners when asked", () => {
    const { target, remove, sink } = setup();
    expect(target.count("error")).toBe(1);
    expect(target.count("unhandledrejection")).toBe(1);
    remove();
    expect(target.count("error") + target.count("unhandledrejection")).toBe(0);
    target.fire("error", { error: new Error("late"), message: "late" });
    expect(sink.records).toEqual([]);
  });

  it("never raises an error of its own when the log misbehaves", () => {
    const target = fakeWindow();
    const broken = { log: () => { throw new Error("logger broke"); } } as never;
    installGlobalErrorCapture({ target, log: broken });
    expect(() => target.fire("error", { error: new Error("x"), message: "x" })).not.toThrow();
  });

  it("does nothing where there is no window to listen on", () => {
    const remove = installGlobalErrorCapture({ target: undefined });
    expect(typeof remove).toBe("function");
    expect(() => remove()).not.toThrow();
  });
});

describe("a screen that failed to render", () => {
  it("writes UI_RENDER_ERROR with the boundary and the digest, and the stack", () => {
    const { logger, sink } = createTestLogger();
    const error = Object.assign(new Error("Minified React error #310"), { digest: "1234567890" });
    reportRenderError(error, "segment", logger);
    expect(sink.records[0]).toMatchObject({ level: "ERROR", event: "UI_RENDER_ERROR", metadata: { boundary: "segment", digest: "1234567890" } });
    expect(sink.records[0].error?.stack).toBeTruthy();
  });

  it("does not raise when the log misbehaves", () => {
    const broken = { error: () => { throw new Error("logger broke"); } } as never;
    expect(() => reportRenderError(new Error("x"), "global", broken)).not.toThrow();
  });
});

describe("sourceFileName", () => {
  it("keeps only the file name", () => {
    expect(sourceFileName("https://localhost/_next/static/chunks/abc.js?x=1#y")).toBe("abc.js");
    expect(sourceFileName("capacitor://localhost/_next/app.js")).toBe("app.js");
    expect(sourceFileName("")).toBeUndefined();
    expect(sourceFileName(undefined)).toBeUndefined();
  });
});
