import { describe, expect, it } from "vitest";
import { buildDayItems } from "./dayItems";
import { fromJalali } from "./jalali";
import { installmentOccurrences, type InstallmentPlanLike } from "./installmentCalendar";

const plan: InstallmentPlanLike = {
  id: "car",
  title: "ماشین",
  numberOfInstallments: 12,
  installments: [
    { id: "i3", index: 3, dueDate: fromJalali(1405, 8, 10), amount: 8_000_000, status: "PENDING" },
    { id: "i2", index: 2, dueDate: fromJalali(1405, 7, 10), amount: 8_000_000, status: "PAID" },
  ],
};

const timedEvent = {
  occurrenceId: "e1",
  startAt: "2026-11-01T09:00:00.000Z",
  endAt: "2026-11-01T10:00:00.000Z",
  isDone: false,
  event: { id: "ev", title: "جلسه", allDay: false, directCost: 0, incomeAmount: 0, category: null },
};

describe("buildDayItems", () => {
  const [paid, unpaid] = installmentOccurrences([plan]);

  it("turns an installment into a day-level item: no clock time, a cost, a link to the installments tab", () => {
    const items = buildDayItems(undefined, undefined, [unpaid]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "installment-i3",
      kind: "INSTALLMENT",
      id: "i3",
      title: "ماشین — قسط ۳ از ۱۲",
      start: null,
      end: null,
      isDone: false,
      amount: 8_000_000,
      isIncome: false,
      href: "/finance?tab=installments&plan=car",
    });
  });

  it("marks a paid installment as done", () => {
    expect(buildDayItems(undefined, undefined, [paid])[0]).toMatchObject({ kind: "INSTALLMENT", isDone: true, overdue: false });
  });

  it("flags an unpaid installment whose day has passed", () => {
    // Due in 1405 (autumn 2026) and never paid; compared with the real clock, so use a day long gone.
    const old = installmentOccurrences([{ ...plan, installments: [{ id: "old", index: 1, dueDate: new Date(2020, 0, 10), amount: 1, status: "PENDING" }] }]);
    expect(buildDayItems(undefined, undefined, old)[0].overdue).toBe(true);
  });

  it("lists a day-level installment before the day's timed items", () => {
    const items = buildDayItems({ occurrences: [timedEvent] }, undefined, [unpaid]);
    expect(items.map((item) => item.kind)).toEqual(["INSTALLMENT", "EVENT"]);
  });

  it("leaves a day exactly as it was when no installments are passed (Home does not pass any)", () => {
    expect(buildDayItems({ occurrences: [timedEvent] }, undefined).map((item) => item.kind)).toEqual(["EVENT"]);
    expect(buildDayItems({ occurrences: [timedEvent] }, undefined, []).map((item) => item.kind)).toEqual(["EVENT"]);
  });
});
