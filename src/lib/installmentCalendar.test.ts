import { describe, expect, it } from "vitest";
import { fromJalali, toJalali } from "./jalali";
import { dayKeyIso } from "./calendarGrid";
import {
  installmentOccurrences,
  installmentsInRange,
  installmentsOnDay,
  installmentTitle,
  isOverdue,
  monthInstallments,
  type InstallmentPlanLike,
} from "./installmentCalendar";

// Due dates are made the way the app makes them: the local midnight of a Jalali day.
const due = (jy: number, jm: number, jd: number) => fromJalali(jy, jm, jd);

const car: InstallmentPlanLike = {
  id: "car",
  title: "ماشین",
  numberOfInstallments: 3,
  installments: [
    { id: "car-1", index: 1, dueDate: due(1405, 8, 10), amount: 8_000_000, status: "PAID" },
    { id: "car-2", index: 2, dueDate: due(1405, 9, 10), amount: 8_000_000, status: "PENDING" },
    { id: "car-3", index: 3, dueDate: due(1405, 10, 10), amount: 8_000_000, status: "PENDING" },
  ],
};
const phone: InstallmentPlanLike = {
  id: "phone",
  title: "گوشی",
  numberOfInstallments: 2,
  installments: [
    { id: "phone-1", index: 1, dueDate: due(1405, 8, 10), amount: 2_500_000, status: "PENDING" },
    { id: "phone-2", index: 2, dueDate: due(1405, 8, 25), amount: 2_500_000, status: "PENDING" },
  ],
};

describe("installmentOccurrences", () => {
  const all = installmentOccurrences([car, phone]);

  it("lists every installment of every plan, by due day, then plan title, then number", () => {
    // Aban 10 holds two (ordered by the plans' titles as plain text, so the order is the same on every machine), then Aban 25, Azar 10, Dey 10.
    expect(all.map((o) => o.id)).toEqual(["car-1", "phone-1", "phone-2", "car-2", "car-3"]);
  });

  it("carries the plan's title and size and the Jalali day each falls on", () => {
    const first = all.find((o) => o.id === "car-1")!;
    expect(first).toMatchObject({ planId: "car", planTitle: "ماشین", index: 1, count: 3, jy: 1405, jm: 8, jd: 10, amount: 8_000_000, paid: true });
    expect(first.dayKey).toBe(dayKeyIso(due(1405, 8, 10)));
    expect(dayKeyIso(first.day)).toBe(first.dayKey);
  });

  it("puts a due date on the same day whichever time zone made it", () => {
    // The local midnight of Aban 1 in Tehran is 20:30 UTC the evening before; a server in UTC stores 00:00 UTC.
    const aban1 = toJalali(new Date(2026, 9, 23));
    const plan: InstallmentPlanLike = {
      id: "p",
      title: "طرح",
      numberOfInstallments: 3,
      installments: [
        { id: "tehran", index: 1, dueDate: new Date(Date.UTC(2026, 9, 22, 20, 30)), amount: 1, status: "PENDING" },
        { id: "utc", index: 2, dueDate: new Date(Date.UTC(2026, 9, 23, 0, 0)), amount: 1, status: "PENDING" },
        { id: "string", index: 3, dueDate: "2026-10-23T00:00:00.000Z", amount: 1, status: "PENDING" },
      ],
    };
    for (const occurrence of installmentOccurrences([plan])) expect([occurrence.jy, occurrence.jm, occurrence.jd]).toEqual([aban1.jy, aban1.jm, aban1.jd]);
  });

  it("names an installment by its plan and place in it", () => {
    expect(installmentTitle(all[0])).toBe("ماشین — قسط ۱ از ۳");
  });

  it("is empty for no plans, and for a plan with no installments", () => {
    expect(installmentOccurrences([])).toEqual([]);
    expect(installmentOccurrences([{ id: "x", title: "x", numberOfInstallments: 0, installments: [] }])).toEqual([]);
  });
});

describe("a day and a range of days", () => {
  const all = installmentOccurrences([car, phone]);

  it("finds what falls due on one day, whatever the time of day of the Date asked about", () => {
    const day = due(1405, 8, 10);
    expect(installmentsOnDay(all, day).map((o) => o.id).sort()).toEqual(["car-1", "phone-1"]);
    expect(installmentsOnDay(all, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59)).map((o) => o.id).sort()).toEqual(["car-1", "phone-1"]);
    expect(installmentsOnDay(all, due(1405, 8, 11))).toEqual([]);
  });

  it("includes both ends of a range", () => {
    const ids = installmentsInRange(all, due(1405, 8, 10), due(1405, 8, 25)).map((o) => o.id).sort();
    expect(ids).toEqual(["car-1", "phone-1", "phone-2"]);
    expect(installmentsInRange(all, due(1405, 8, 11), due(1405, 8, 24))).toEqual([]);
  });
});

describe("monthInstallments", () => {
  const all = installmentOccurrences([car, phone]);

  it("adds up what falls due in a Jalali month: total, paid and what is left", () => {
    const aban = monthInstallments(all, 1405, 8);
    expect(aban.count).toBe(3);
    expect(aban.paidCount).toBe(1);
    expect(aban.total).toBe(8_000_000 + 2_500_000 + 2_500_000);
    expect(aban.paid).toBe(8_000_000);
    expect(aban.remaining).toBe(5_000_000);
    expect(aban.items.map((o) => o.id)).toEqual(["car-1", "phone-1", "phone-2"]);
  });

  it("says nothing is due in a month with no installments, and does not mix up years", () => {
    expect(monthInstallments(all, 1405, 12)).toMatchObject({ count: 0, total: 0, paid: 0, remaining: 0, items: [] });
    expect(monthInstallments(all, 1406, 8).count).toBe(0);
  });

  it("counts a fully paid month as nothing remaining", () => {
    const paid = installmentOccurrences([{ ...car, installments: car.installments.map((i) => ({ ...i, status: "PAID" })) }]);
    expect(monthInstallments(paid, 1405, 9)).toMatchObject({ count: 1, paidCount: 1, total: 8_000_000, remaining: 0 });
  });
});

describe("isOverdue", () => {
  const today = new Date(2026, 10, 2, 15, 0, 0);
  const at = (offsetDays: number, paid: boolean) => {
    const day = new Date(2026, 10, 2 + offsetDays);
    return { paid, dayKey: dayKeyIso(day) };
  };

  it("is true only for an unpaid installment whose day has passed", () => {
    expect(isOverdue(at(-1, false), today)).toBe(true);
    expect(isOverdue(at(-30, false), today)).toBe(true);
    expect(isOverdue(at(-1, true), today)).toBe(false);
    expect(isOverdue(at(0, false), today)).toBe(false); // due today is not late yet
    expect(isOverdue(at(1, false), today)).toBe(false);
  });
});
