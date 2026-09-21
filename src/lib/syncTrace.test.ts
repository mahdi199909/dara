import { describe, expect, it } from "vitest";
import { isId } from "./observability";
import { createSyncTrace, isRoutineTrigger, moreInformativeTrigger } from "./syncTrace";

describe("createSyncTrace", () => {
  it("makes a sync id and a W3C trace id, different every time", () => {
    const a = createSyncTrace({ trigger: "resume", deep: true });
    const b = createSyncTrace({ trigger: "resume", deep: true });
    expect(isId(a.syncId, "sync")).toBe(true);
    expect(a.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.syncId).not.toBe(b.syncId);
    expect(a.traceId).not.toBe(b.traceId);
    expect(a).toMatchObject({ trigger: "resume", deep: true });
  });

  it("defaults to an unknown trigger and a shallow cycle", () => {
    expect(createSyncTrace()).toMatchObject({ trigger: "unknown", deep: false });
  });
});

describe("triggers", () => {
  it("treats the timer and background writes as routine, and everything a person can see as not", () => {
    expect(isRoutineTrigger("poll")).toBe(true);
    expect(isRoutineTrigger("local-write")).toBe(true);
    for (const trigger of ["boot", "resume", "manual", "first-run", "logout"] as const) expect(isRoutineTrigger(trigger)).toBe(false);
  });

  it("keeps the trigger that says the most when several callers share one run", () => {
    expect(moreInformativeTrigger(undefined, "poll")).toBe("poll");
    expect(moreInformativeTrigger("poll", "resume")).toBe("resume");
    expect(moreInformativeTrigger("resume", "poll")).toBe("resume");
    expect(moreInformativeTrigger("boot", "manual")).toBe("boot"); // both informative: the first one asked wins
    expect(moreInformativeTrigger("poll", undefined)).toBe("poll");
  });
});
