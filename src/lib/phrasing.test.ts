import { describe, expect, it } from "vitest";
import {
  phraseSpend,
  phraseBuild,
  phraseBuildAdded,
  phraseHidden,
  phraseCapital,
  phraseMilestoneProgress,
  phraseDeltaPride,
  phraseSamePeriodTasksCompleted,
  phraseSamePeriodVirtualAsset,
} from "./phrasing";

describe("phraseSpend", () => {
  it("includes the Toman-equivalent clause when there's a real cost", () => {
    const result = phraseSpend(130, 180000, "اینستاگرام");
    expect(result).toContain("۲ ساعت و ۱۰ دقیقه");
    expect(result).toContain("«اینستاگرام»");
    expect(result).toContain("پرداخت کردی");
    expect(result).toContain("۱۸۰,۰۰۰ تومان");
  });

  it("omits the Toman clause entirely when tomans is 0 (no hourly rate configured) rather than showing a fabricated zero", () => {
    const result = phraseSpend(60, 0, "مطالعه");
    expect(result).not.toContain("تومان");
    expect(result).not.toContain("۰");
    expect(result).toBe("۱ ساعت بابت «مطالعه» پرداخت کردی.");
  });

  it("never uses «پنهان» — that word is reserved for phraseHidden/phraseBuild", () => {
    expect(phraseSpend(60, 50000, "کار")).not.toContain("پنهان");
  });
});

describe("phraseBuildAdded", () => {
  it("is exactly phraseBuild's first sentence, with no running-total clause", () => {
    const added = phraseBuildAdded(180, "زبان انگلیسی");
    expect(added).toBe("۳ ساعت به دارایی پنهانت در «زبان انگلیسی» اضافه شد.");
    expect(phraseBuild(180, "زبان انگلیسی", 2820)).toBe(`${added} جمعش الان ۴۷ ساعت است.`);
  });
});

describe("phraseMilestoneProgress", () => {
  it("reports the total and the remaining time to the next milestone", () => {
    const result = phraseMilestoneProgress(2820, 50, 180);
    expect(result).toBe("جمع: ۴۷ ساعت — ۳ ساعت تا مایل‌استون ۵۰ ساعت.");
  });

  it("reports just the total, with no invented claim, once there's no next milestone", () => {
    const result = phraseMilestoneProgress(30_600, null, null);
    expect(result).toBe("جمع: ۵۱۰ ساعت.");
    expect(result).not.toContain("مایل‌استون");
  });
});

describe("phraseBuild", () => {
  it("reports the added amount and the running total, using «پنهان» (one of its two sanctioned moments)", () => {
    const result = phraseBuild(180, "زبان انگلیسی", 2820);
    expect(result).toContain("۳ ساعت");
    expect(result).toContain("«زبان انگلیسی»");
    expect(result).toContain("پنهان");
    expect(result).toContain("۴۷ ساعت");
  });
});

describe("phraseHidden", () => {
  it("names the item and its real cost, using «پنهان» (its other sanctioned moment)", () => {
    const result = phraseHidden(240000, "این جلسه");
    expect(result).toContain("«این جلسه»");
    expect(result).toContain("صفر ثبت شده بود");
    expect(result).toContain("پنهان");
    expect(result).toContain("۲۴۰,۰۰۰ تومان");
  });
});

describe("phraseCapital", () => {
  it("reports hours since day one with no counts tail when every count is zero", () => {
    const result = phraseCapital(74400, { skillCount: 0, projectCount: 0, assetCount: 0 });
    expect(result).toBe("از روز اول، ۱,۲۴۰ ساعت روی خودت سرمایه‌گذاری کرده‌ای.");
  });

  it("appends only the non-zero counts", () => {
    const result = phraseCapital(60, { skillCount: 2, projectCount: 0, assetCount: 3 });
    expect(result).toContain("۲ مهارت");
    expect(result).not.toContain("پروژه");
    expect(result).toContain("۳ دارایی");
  });

  it("never uses «پنهان» — that word is reserved for phraseHidden/phraseBuild", () => {
    expect(phraseCapital(600, { skillCount: 1, projectCount: 1, assetCount: 1 })).not.toContain("پنهان");
  });
});

describe("phraseDeltaPride", () => {
  it("describes an increase with a growth verb", () => {
    const result = phraseDeltaPride("زمان مفید", 20, "increased");
    expect(result).toBe("در همین بازه، «زمان مفید» نسبت به بازه قبل ۲۰٪ رشد کرد.");
  });

  it("describes a decrease with its own verb, not 'grew'", () => {
    const result = phraseDeltaPride("هزینه", -15, "decreased");
    expect(result).toBe("در همین بازه، «هزینه» نسبت به بازه قبل ۱۵٪ کاهش یافت.");
    expect(result).not.toContain("رشد");
  });

  it("never uses «پنهان»", () => {
    expect(phraseDeltaPride("هزینه", 10, "increased")).not.toContain("پنهان");
  });
});

describe("phraseSamePeriodTasksCompleted", () => {
  it("states the real count with no comparison", () => {
    expect(phraseSamePeriodTasksCompleted(5)).toBe("در همین بازه ۵ کار را تمام کردی.");
  });
});

describe("phraseSamePeriodVirtualAsset", () => {
  it("states the real amount built this period", () => {
    const result = phraseSamePeriodVirtualAsset(120000);
    expect(result).toContain("۱۲۰,۰۰۰ تومان");
    expect(result).toContain("در همین بازه");
  });
});
