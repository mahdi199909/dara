import { describe, expect, it } from "vitest";
import { phraseSpend, phraseBuild, phraseHidden, phraseCapital } from "./phrasing";

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
