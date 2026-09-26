import { describe, expect, it } from "vitest";
import { faCount, hash32, joinFa, partOfDay, pickBySeed, quote, spokenDuration, spokenTime, spokenTimeShort, tidy } from "./journeySpoken";

// Local-time constructors on purpose: the words describe the reader's own clock.
const at = (h: number, m = 0) => new Date(2026, 8, 15, h, m, 0, 0);

describe("faCount", () => {
  it("says small numbers in words and larger ones in Persian digits", () => {
    expect(faCount(0)).toBe("صفر");
    expect(faCount(3)).toBe("سه");
    expect(faCount(12)).toBe("دوازده");
    expect(faCount(13)).toBe("۱۳");
    expect(faCount(120)).toBe("۱۲۰");
  });
});

describe("joinFa", () => {
  it("joins the way a sentence does", () => {
    expect(joinFa([])).toBe("");
    expect(joinFa(["الف"])).toBe("الف");
    expect(joinFa(["الف", "ب"])).toBe("الف و ب");
    expect(joinFa(["الف", "ب", "ج"])).toBe("الف، ب و ج");
    expect(joinFa(["الف", "ب", "ج", "د"])).toBe("الف، ب، ج و د");
  });
});

describe("text helpers", () => {
  it("quotes in guillemets and tidies whitespace", () => {
    expect(quote("طراحی")).toBe("«طراحی»");
    expect(quote("کیت رابط کاربری «نی»")).toBe("«کیت رابط کاربری نی»"); // no quotation inside a quotation
    expect(tidy("  چند   کلمه\nدر چند\tخط ")).toBe("چند کلمه در چند خط");
  });

  it("hashes stably, and picks the same option for the same seed", () => {
    expect(hash32("2026-09-15|open")).toBe(hash32("2026-09-15|open"));
    expect(hash32("a")).not.toBe(hash32("b"));
    const options = ["الف", "ب", "ج", "د"] as const;
    expect(pickBySeed(options, "x")).toBe(pickBySeed(options, "x"));
    // Different seeds spread over the options rather than always landing on one.
    const seen = new Set(Array.from({ length: 40 }, (_, i) => pickBySeed(options, `seed-${i}`)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("partOfDay", () => {
  it("cuts the day the way it is spoken", () => {
    expect(partOfDay(2)).toBe("بامداد");
    expect(partOfDay(5)).toBe("صبح");
    expect(partOfDay(11)).toBe("صبح");
    expect(partOfDay(12)).toBe("ظهر");
    expect(partOfDay(15)).toBe("بعدازظهر");
    expect(partOfDay(18)).toBe("عصر");
    expect(partOfDay(21)).toBe("شب");
  });
});

describe("spokenTime", () => {
  it("says the hour with its part of the day", () => {
    expect(spokenTime(at(9))).toBe("۹ صبح");
    expect(spokenTime(at(12))).toBe("۱۲ ظهر");
    expect(spokenTime(at(14))).toBe("۲ بعدازظهر");
    expect(spokenTime(at(18))).toBe("۶ عصر");
    expect(spokenTime(at(21))).toBe("۹ شب");
  });

  it("says a quarter, a half and a quarter-to", () => {
    expect(spokenTime(at(9, 15))).toBe("۹ و ربع صبح");
    expect(spokenTime(at(9, 30))).toBe("۹ و نیم صبح");
    expect(spokenTime(at(9, 45))).toBe("یک ربع به ۱۰ صبح");
    expect(spokenTime(at(11, 45))).toBe("یک ربع به ۱۲ ظهر");
    expect(spokenTime(at(16, 30))).toBe("۴ و نیم بعدازظهر");
  });

  it("says other minutes exactly", () => {
    expect(spokenTime(at(10, 20))).toBe("۱۰ و ۲۰ دقیقه صبح");
    expect(spokenTime(at(20, 5))).toBe("۸ و ۵ دقیقه شب");
  });

  it("says midnight as midnight", () => {
    expect(spokenTime(at(0, 0))).toBe("نیمه‌شب");
    expect(spokenTime(at(0, 40))).toBe("۱۲ و ۴۰ دقیقه بامداد");
  });
});

describe("spokenTimeShort", () => {
  it("drops the part of the day", () => {
    expect(spokenTimeShort(at(9, 30))).toBe("۹ و نیم");
    expect(spokenTimeShort(at(14, 0))).toBe("۲");
    expect(spokenTimeShort(at(11, 45))).toBe("یک ربع به ۱۲");
    expect(spokenTimeShort(at(12, 45))).toBe("یک ربع به ۱");
  });
});

describe("spokenDuration", () => {
  it("says nothing for no time, and «a few minutes» for very little", () => {
    expect(spokenDuration(0)).toBe("");
    expect(spokenDuration(-5)).toBe("");
    expect(spokenDuration(4)).toBe("چند دقیقه");
  });

  it("says minutes below an hour, with the everyday fractions", () => {
    expect(spokenDuration(15)).toBe("ربع ساعت");
    expect(spokenDuration(20)).toBe("۲۰ دقیقه");
    expect(spokenDuration(30)).toBe("نیم ساعت");
    expect(spokenDuration(45)).toBe("۴۵ دقیقه");
  });

  it("says hours, half hours and quarters", () => {
    expect(spokenDuration(60)).toBe("یک ساعت");
    expect(spokenDuration(75)).toBe("یک ساعت و ربع");
    expect(spokenDuration(90)).toBe("یک ساعت و نیم");
    expect(spokenDuration(120)).toBe("دو ساعت");
    expect(spokenDuration(150)).toBe("دو ساعت و نیم");
    expect(spokenDuration(13 * 60)).toBe("۱۳ ساعت");
  });

  it("marks a noticeably rounded figure as approximate", () => {
    expect(spokenDuration(140)).toBe("حدود دو ساعت و ربع"); // 140 → 135, five minutes off
    expect(spokenDuration(137)).toBe("دو ساعت و ربع"); // 2 minutes off is not worth «حدود»
    expect(spokenDuration(52)).toBe("۵۰ دقیقه");
    expect(spokenDuration(112)).toBe("حدود یک ساعت و ۴۵ دقیقه"); // 112 → 105
  });
});
