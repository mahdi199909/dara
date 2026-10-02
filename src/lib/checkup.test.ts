import { describe, expect, it } from "vitest";
import {
  CHECKUP_THRESHOLDS,
  answersSchema,
  awakeMinutes,
  computeCheckupMetrics,
  dayNumbers,
  deriveColumns,
  hiddenValueToman,
  normalizeAnswers,
  parseAmount,
  parseHours,
  sanitizeSource,
  sourceGroup,
  submissionSchema,
  suspiciousIds,
  type MetricRow,
} from "./checkup";

describe("the day's numbers", () => {
  it("wraps a bedtime after midnight: woke 8, slept 1 → 17 hours awake", () => {
    expect(awakeMinutes("08:00", "01:00")).toBe(17 * 60);
    expect(awakeMinutes("07:30", "23:30")).toBe(16 * 60);
    expect(awakeMinutes("09:00", "09:00")).toBeNull();
    expect(awakeMinutes(null, "23:00")).toBeNull();
  });

  it("never reports negative hidden hours when the three tasks add up to more than the day", () => {
    const day = dayNumbers({ wake: "08:00", sleep: "20:00", tasks: [{ title: "a", hours: 10 }, { title: "b", hours: 5 }] });
    expect(day).toEqual({ awake: 720, named: 900, hidden: 0, overflow: true, hasTasks: true });
  });

  it("reads Persian and Arabic digits and the Persian decimal mark", () => {
    expect(parseAmount("۲۰۰٬۰۰۰")).toBe(200000);
    expect(parseAmount("٢٥٠٠٠٠")).toBe(250000);
    expect(parseAmount("1,250,000")).toBe(1250000);
    expect(parseAmount("تومان")).toBeNull();
    expect(parseHours("۱٫۵")).toBe(1.5);
    expect(parseHours("۲/۵")).toBe(2.5);
    expect(parseHours("25")).toBeNull();
  });

  it("gives no Toman figure without the person's own hourly value — never an invented one", () => {
    expect(hiddenValueToman(540, null)).toBeNull();
    expect(hiddenValueToman(540, 0)).toBeNull();
    expect(hiddenValueToman(540, 200000)).toBe(1800000);
    expect(hiddenValueToman(null, 200000)).toBeNull();
  });
});

describe("sources", () => {
  it("are cleaned to [a-z0-9-], 40 characters, 'direct' by default", () => {
    expect(sanitizeSource("IG-Shanbe")).toBe("ig-shanbe");
    expect(sanitizeSource('"><script>')).toBe("script");
    expect(sanitizeSource(null)).toBe("direct");
    expect(sanitizeSource("a".repeat(60))).toHaveLength(40);
  });

  it("are grouped blind / branded / unknown", () => {
    expect(sourceGroup("grp-b")).toBe("blind");
    expect(sourceGroup("tg-poll")).toBe("blind");
    expect(sourceGroup("ig-filter")).toBe("branded");
    expect(sourceGroup("tg-channel")).toBe("branded");
    expect(sourceGroup("site")).toBe("branded");
    expect(sourceGroup("direct")).toBe("unknown");
  });
});

describe("the wire format", () => {
  const id = "3f2a8c1e-1b2c-4d3e-8f90-123456789abc";
  it("refuses unknown fields, unknown options and out-of-range numbers", () => {
    expect(submissionSchema.safeParse({ id, page: 1, answers: {} }).success).toBe(true);
    expect(submissionSchema.safeParse({ id, page: 1, answers: {}, extra: 1 }).success).toBe(false);
    expect(answersSchema.safeParse({ monthSpend: "lots" }).success).toBe(false);
    expect(answersSchema.safeParse({ __proto__: { x: 1 }, admin: true }).success).toBe(false);
    expect(answersSchema.safeParse({ hourly: 2_000_000_000 }).success).toBe(false);
    expect(answersSchema.safeParse({ tasks: [{ title: "a", hours: 30 }] }).success).toBe(false);
    expect(answersSchema.safeParse({ regret: "x".repeat(1001) }).success).toBe(false);
    expect(submissionSchema.safeParse({ id: "not-a-uuid", page: 1, answers: {} }).success).toBe(false);
    expect(submissionSchema.safeParse({ id, page: 6, answers: {} }).success).toBe(false);
  });

  it("drops answers to questions the kit's conditions skipped", () => {
    const a = normalizeAnswers({ tools: ["none"], toolLastOpened: "stopped", toolWhyLeft: "x", paid: "never", paidWhat: "y", built: "", builtHours: "approx" });
    expect(a.toolLastOpened).toBeNull();
    expect(a.toolWhyLeft).toBe("");
    expect(a.paidWhat).toBe("");
    expect(a.builtHours).toBeNull();
  });

  it("derives the queryable columns, keeping only contacts that look like contacts", () => {
    const cols = deriveColumns(
      normalizeAnswers({
        wake: "08:00",
        sleep: "01:00",
        tasks: [{ title: "x", hours: 7 }],
        rest: ["unsure"],
        contactTelegram: "@ok_name",
        contactBale: "۰۹۱۲۳۴۵۶۷۸۹",
        contactEmail: "not an email",
        interview: "yes",
      })
    );
    expect(cols).toMatchObject({ awakeMinutes: 1020, namedMinutes: 420, hiddenMinutes: 600, restOfDayForgot: true, contactTelegram: "ok_name", contactPhone: "09123456789", contactEmail: null, interviewOk: true });
  });
});

function row(i: number, over: Partial<MetricRow> = {}): MetricRow {
  return {
    id: `r${i}`,
    createdAt: new Date(2026, 9, 1),
    completedAt: new Date(2026, 9, 1, 0, i),
    lastPage: 5,
    durationSec: 300,
    ipHash: `ip${i}`,
    sourceGroup: "blind",
    restOfDayForgot: false,
    hourlyValue: 100000,
    hourlyNeverThought: false,
    monthSpendAnswer: "memory",
    toolsUsed: "paper",
    toolLastOpened: "today",
    paidBefore: "never",
    lastEmptyMonth: "months",
    incomeShape: "project",
    reportViewedAt: new Date(),
    sharedAt: null,
    downloadedAt: null,
    inviteTelegramAt: null,
    inviteAppAt: null,
    answeredRest: true,
    ...over,
  };
}

describe("the dashboard's metrics", () => {
  it("withhold every percentage below 80 completed answers («فقط کیفی بخوان»)", () => {
    const rows = Array.from({ length: 79 }, (_, i) => row(i, { restOfDayForgot: true }));
    rows.push(row(999, { completedAt: null, lastPage: 2 }));
    const m = computeCheckupMetrics(rows);
    expect(m.qualitativeOnly).toBe(true);
    expect(m.t1.forgot).toEqual({ count: 79, base: 79, pct: null });
    expect(m.t1.status).toBeNull();
    const pcts = JSON.stringify(m).match(/"pct":[^n]/g);
    expect(pcts).toBeNull();
    expect(m.funnel).toMatchObject({ started: 80, completed: 79, reachedPage: [80, 80, 79, 79, 79] });
  });

  it("read ت۱ against the locked thresholds once there are 80", () => {
    const at = (forgotCount: number) => computeCheckupMetrics(Array.from({ length: 100 }, (_, i) => row(i, { restOfDayForgot: i < forgotCount })));
    expect(at(55).t1.status).toBe("confirmed");
    expect(at(54).t1.status).toBe("mild");
    expect(at(35).t1.status).toBe("mild");
    expect(at(34).t1.status).toBe("weak");
    expect(at(55).qualitativeOnly).toBe(false);
    expect(at(55).decisionReady).toBe(false);
    expect(CHECKUP_THRESHOLDS.decisionSample).toBe(120);
  });

  it("reads ت۳ from tools and when they were last opened, and flags a report nobody reacts to", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      row(i, i < 50 ? { toolLastOpened: "stopped" } : i < 80 ? { toolsUsed: "none", toolLastOpened: null } : { sharedAt: new Date() })
    );
    const m = computeCheckupMetrics(rows);
    expect(m.t3.abandoned.pct).toBeCloseTo(0.5);
    expect(m.t3.never.pct).toBeCloseTo(0.3);
    expect(m.t3.active.pct).toBeCloseTo(0.2);
    expect(m.report.reacted.pct).toBeCloseTo(0.2);
    expect(m.report.reactionAlarm).toBe(true);
  });

  it("flag answers that were too fast or came in bulk from one address", () => {
    const rows = [
      row(1, { durationSec: 20 }),
      ...Array.from({ length: 6 }, (_, i) => row(10 + i, { ipHash: "same" })),
      ...Array.from({ length: 5 }, (_, i) => row(20 + i, { ipHash: "five" })),
    ];
    const flagged = suspiciousIds(rows);
    expect(flagged.has("r1")).toBe(true);
    expect([...flagged].filter((id) => ["r10", "r11", "r12", "r13", "r14", "r15"].includes(id))).toHaveLength(6);
    expect([...flagged].some((id) => id.startsWith("r2"))).toBe(false);
  });
});
