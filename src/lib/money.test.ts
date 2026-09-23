import { describe, it, expect } from "vitest";
import { formatToman, formatDuration, shortDuration, formatMoney, parseAmount, toPersianDigits, toAsciiDigits, tomanToUnit, unitToToman, signed, LRM } from "./money";

describe("digit conversion", () => {
  it("converts ascii to persian and back", () => {
    expect(toPersianDigits(1500000)).toBe("۱۵۰۰۰۰۰");
    expect(toAsciiDigits("۱۵۰۰۰۰۰")).toBe("1500000");
  });
});

describe("signs stay on the left of the digits", () => {
  it("puts a left-to-right mark in front of a sign, so right-to-left text cannot pull it to the number's right", () => {
    expect(signed("+", "۱۲")).toBe(`${LRM}+۱۲`);
    expect(signed("-", "۱۲")).toBe(`${LRM}-۱۲`);
    expect(signed("", "۱۲")).toBe("۱۲");
  });

  it("writes a negative amount with its minus on the left of the digits", () => {
    expect(formatToman(-1_500_000)).toBe(`${LRM}-۱,۵۰۰,۰۰۰`);
    expect(formatToman(-1_500_000, { withSuffix: true })).toBe(`${LRM}-۱,۵۰۰,۰۰۰ تومان`);
    expect(formatMoney(-1_500_000, "TOMAN", { withSuffix: true })).toBe(`${LRM}-۱,۵۰۰,۰۰۰ تومان`);
    expect(formatMoney(-1_500_000, "TOMAN", { persianDigits: false })).toBe(`${LRM}-1,500,000`);
    expect(formatMoney(-1_500, "THOUSAND_TOMAN")).toBe(`${LRM}-۱.۵`);
  });

  it("never prints a negative zero, and leaves positive amounts unmarked", () => {
    expect(formatToman(-0.4)).toBe("۰");
    expect(formatMoney(-0.04, "THOUSAND_TOMAN")).toBe("۰");
    expect(formatToman(1_500_000)).toBe("۱,۵۰۰,۰۰۰");
  });

  it("keeps the minus of a negative number on the left when only its digits are converted", () => {
    expect(toPersianDigits(-12)).toBe(`${LRM}-۱۲`);
    expect(toPersianDigits(12)).toBe("۱۲");
    expect(toPersianDigits("۱۲-۳")).toBe("۱۲-۳");
  });
});

describe("formatToman", () => {
  it("adds thousands separators and persian digits", () => {
    expect(formatToman(1500000)).toBe("۱,۵۰۰,۰۰۰");
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes together", () => {
    expect(formatDuration(105)).toBe("۱ ساعت و ۴۵ دقیقه");
  });
  it("formats minutes only", () => {
    expect(formatDuration(45)).toBe("۴۵ دقیقه");
  });
  it("formats hours only", () => {
    expect(formatDuration(120)).toBe("۲ ساعت");
  });
});

describe("currency unit conversion", () => {
  it("1 Toman is worth 10 Rial", () => {
    expect(tomanToUnit(1_500_000, "RIAL")).toBe(15_000_000);
    expect(unitToToman(15_000_000, "RIAL")).toBe(1_500_000);
  });

  it("Toman unit is the identity conversion", () => {
    expect(tomanToUnit(1_500_000, "TOMAN")).toBe(1_500_000);
    expect(unitToToman(1_500_000, "TOMAN")).toBe(1_500_000);
  });

  it("1 thousand-Toman is worth 1000 Toman", () => {
    expect(tomanToUnit(1_500_000, "THOUSAND_TOMAN")).toBe(1500);
    expect(unitToToman(1500, "THOUSAND_TOMAN")).toBe(1_500_000);
  });

  it("round-trips a non-round thousand-Toman amount by rounding to the nearest Toman", () => {
    // 1,234 Toman = 1.234 thousand-Toman — entering "1.234" back must recover 1,234 Toman exactly.
    expect(tomanToUnit(1_234, "THOUSAND_TOMAN")).toBeCloseTo(1.234, 6);
    expect(unitToToman(1.234, "THOUSAND_TOMAN")).toBe(1_234);
  });
});

describe("formatMoney", () => {
  it("formats a Toman amount in Rial with thousands separators", () => {
    expect(formatMoney(1_500_000, "RIAL")).toBe("۱۵,۰۰۰,۰۰۰");
  });
  it("formats a Toman amount in Toman unchanged (aside from digit style)", () => {
    expect(formatMoney(1_500_000, "TOMAN")).toBe("۱,۵۰۰,۰۰۰");
  });
  it("formats a Toman amount in thousand-Toman, dropping the decimal when whole", () => {
    expect(formatMoney(1_500_000, "THOUSAND_TOMAN")).toBe("۱,۵۰۰");
  });
  it("keeps a single decimal place for a fractional thousand-Toman amount", () => {
    expect(formatMoney(1_500, "THOUSAND_TOMAN")).toBe("۱.۵");
  });
  it("appends the unit label when withSuffix is set", () => {
    expect(formatMoney(1_500_000, "TOMAN", { withSuffix: true })).toBe("۱,۵۰۰,۰۰۰ تومان");
    expect(formatMoney(1_500_000, "THOUSAND_TOMAN", { withSuffix: true })).toBe("۱,۵۰۰ هزار تومان");
  });
});

describe("parseAmount", () => {
  it("parses millions with a decimal point: 1.5 میلیون", () => {
    expect(parseAmount("1.5 میلیون")).toBe(1_500_000);
  });
  it("parses thousands: 800 هزار", () => {
    expect(parseAmount("800 هزار")).toBe(800_000);
  });
  it("parses comma-separated numbers", () => {
    expect(parseAmount("2,500,000")).toBe(2_500_000);
  });
  it("parses persian digits", () => {
    expect(parseAmount("۱۵۰۰۰۰۰")).toBe(1500000);
  });
});

describe("shortDuration", () => {
  it("writes hours and minutes in two short units", () => {
    expect(shortDuration(280)).toBe("۴س ۴۰د");
  });
  it("drops the empty unit", () => {
    expect(shortDuration(360)).toBe("۶س");
    expect(shortDuration(40)).toBe("۴۰د");
    expect(shortDuration(0)).toBe("۰د");
  });
  it("never shows negative or fractional minutes", () => {
    expect(shortDuration(-5)).toBe("۰د");
    expect(shortDuration(59.6)).toBe("۱س");
  });
});
