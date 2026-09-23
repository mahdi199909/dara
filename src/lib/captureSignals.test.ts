import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CAPTURE_GRAMMAR, extractEntrySignals, extractSignals } from "./captureSignals";

const day = (offset: number) => ({ type: "REL", offset });

describe("amounts", () => {
  it("reads «X میلیونی» / «تومانی» as the amount and leaves no stray ی in the title", () => {
    expect(extractSignals("شکلات یک میلیونی")).toMatchObject({ kind: "ENTRY", title: "شکلات", amount: 1_000_000 });
    expect(extractSignals("شکلات ۱ میلیون تومانی")).toMatchObject({ title: "شکلات", amount: 1_000_000 });
    expect(extractSignals("شکلات ۵۰۰ هزار تومنی")).toMatchObject({ title: "شکلات", amount: 500_000 });
    expect(extractSignals("قهوه ۸۵۰۰ تومنی")).toMatchObject({ title: "قهوه", amount: 8_500 });
  });

  it("reads a plain number of five digits or more as money, but never a year or a short count", () => {
    expect(extractSignals("قبض برق 450000")).toMatchObject({ title: "قبض برق", amount: 450_000 });
    expect(extractSignals("قبض برق ۴۵۰٬۰۰۰")).toMatchObject({ title: "قبض برق", amount: 450_000 });
    expect(extractSignals("گزارش 1405")).toMatchObject({ title: "گزارش 1405", amount: null });
    expect(extractSignals("مطالعه فصل ۳")).toMatchObject({ title: "مطالعه فصل 3", amount: null });
  });

  it("keeps the amounts the parser already understood", () => {
    expect(extractSignals("یک میلیون شکلات")).toMatchObject({ amount: 1_000_000, title: "شکلات" });
    expect(extractSignals("پنج هزار تومن آب")).toMatchObject({ amount: 5_000, title: "آب" });
    expect(extractSignals("خرید مولتی متر 3h 2,500,000")).toMatchObject({ title: "مولتی متر", durationMinutes: 180, amount: 2_500_000 });
  });

  it("a keyword of income marks money that came in", () => {
    expect(extractSignals("حقوق ۲۰ میلیون")).toMatchObject({ kind: "ENTRY", amount: 20_000_000, income: true, title: "حقوق" });
    expect(extractSignals("درآمد ۵ میلیون از پروژه سایت")).toMatchObject({ amount: 5_000_000, income: true, title: "درآمد", projectHint: "سایت" });
    expect(extractSignals("فروختم ۳ میلیون")).toMatchObject({ income: true });
    // «گرفتم» and «واریز» can as easily be money going out
    expect(extractSignals("بلیط گرفتم ۲ میلیون")).toMatchObject({ income: false });
    expect(extractSignals("ناهار ۲۰۰ هزار")).toMatchObject({ income: false });
  });
});

describe("durations", () => {
  it("reads spoken lengths of time", () => {
    expect(extractSignals("دو ساعت مطالعه")).toMatchObject({ durationMinutes: 120, title: "مطالعه" });
    expect(extractSignals("نیم ساعت ورزش")).toMatchObject({ durationMinutes: 30, title: "ورزش" });
    expect(extractSignals("ربع ساعت پیاده‌روی")).toMatchObject({ durationMinutes: 15 });
    expect(extractSignals("ده دقیقه مدیتیشن")).toMatchObject({ durationMinutes: 10 });
    expect(extractSignals("دو ساعت و نیم کار")).toMatchObject({ durationMinutes: 150 });
    expect(extractSignals("۲ ساعت و ربع کار")).toMatchObject({ durationMinutes: 135 });
    expect(extractSignals("۱ ساعت و ۱۵ دقیقه کار")).toMatchObject({ durationMinutes: 75 });
  });

  it("does not take «ساعت ۵» (five o'clock) for a length of time", () => {
    expect(extractSignals("جلسه ساعت ۵")).toMatchObject({ durationMinutes: null, time: { h: 5, m: 0 } });
  });
});

describe("days", () => {
  it("reads every weekday as itself — «یکشنبه» is not Saturday", () => {
    const weekday = (text: string) => extractSignals(`جلسه ${text}`).day;
    expect(weekday("شنبه")).toEqual({ type: "WEEKDAY", day: 6 });
    expect(weekday("یکشنبه")).toEqual({ type: "WEEKDAY", day: 0 });
    expect(weekday("دوشنبه")).toEqual({ type: "WEEKDAY", day: 1 });
    expect(weekday("سه‌شنبه")).toEqual({ type: "WEEKDAY", day: 2 });
    expect(weekday("سه شنبه")).toEqual({ type: "WEEKDAY", day: 2 });
    expect(weekday("چهارشنبه")).toEqual({ type: "WEEKDAY", day: 3 });
    expect(weekday("پنجشنبه")).toEqual({ type: "WEEKDAY", day: 4 });
    expect(weekday("جمعه")).toEqual({ type: "WEEKDAY", day: 5 });
    // and none of them leaves a piece of the word behind
    expect(extractSignals("جلسه یکشنبه ساعت ۱۰").title).toBe("جلسه");
    expect(extractSignals("جلسه چهارشنبه").title).toBe("جلسه");
  });

  it("reads relative days", () => {
    expect(extractSignals("امروز نان").day).toEqual(day(0));
    expect(extractSignals("فردا نان").day).toEqual(day(1));
    expect(extractSignals("پس‌فردا نان").day).toEqual(day(2));
    expect(extractSignals("پس فردا نان").day).toEqual(day(2));
    expect(extractSignals("دیروز نان").day).toEqual(day(-1));
    expect(extractSignals("پریروز نان").day).toEqual(day(-2));
  });

  it("reads a Jalali date, with or without the year", () => {
    expect(extractSignals("قرار ۲۵ مهر ساعت ۱۰")).toMatchObject({ day: { type: "JALALI", jy: null, jm: 7, jd: 25 }, time: { h: 10, m: 0 } });
    expect(extractSignals("قرار ۲۵ مهر ۱۴۰۶").day).toEqual({ type: "JALALI", jy: 1406, jm: 7, jd: 25 });
    expect(extractSignals("۵ اسفند دکتر").day).toEqual({ type: "JALALI", jy: null, jm: 12, jd: 5 });
    expect(extractSignals("قرار ۱۴۰۵/۰۷/۲۵").day).toEqual({ type: "JALALI", jy: 1405, jm: 7, jd: 25 });
    expect(extractSignals("قرار 1405-7-5").day).toEqual({ type: "JALALI", jy: 1405, jm: 7, jd: 5 });
    // «دی» is a month only right after a day number, not the start of «دیروز»
    expect(extractSignals("۲ دی ماه").day).toEqual({ type: "JALALI", jy: null, jm: 10, jd: 2 });
    expect(extractSignals("دیروز").day).toEqual(day(-1));
  });
});

describe("times of day", () => {
  const time = (text: string) => extractSignals(`جلسه ${text}`).time;

  it("reads the clock", () => {
    expect(time("ساعت ۱۰")).toEqual({ h: 10, m: 0 });
    expect(time("ساعت ۱۰:۳۰")).toEqual({ h: 10, m: 30 });
    expect(time("۱۰:۳۰")).toEqual({ h: 10, m: 30 });
    expect(time("ساعت ۵ و نیم")).toEqual({ h: 5, m: 30 });
    expect(time("ساعت ۵ و ربع")).toEqual({ h: 5, m: 15 });
    expect(time("ساعت ده")).toEqual({ h: 10, m: 0 });
    expect(time("ساعت دوازده و نیم")).toEqual({ h: 12, m: 30 });
    expect(time("ساعت یازده")).toEqual({ h: 11, m: 0 });
  });

  it("moves the hour into the period of the day that was named", () => {
    expect(time("ساعت ۵ عصر")).toEqual({ h: 17, m: 0 });
    expect(time("عصر ساعت ۵")).toEqual({ h: 17, m: 0 });
    expect(time("ساعت ۱۱ شب")).toEqual({ h: 23, m: 0 });
    expect(time("ساعت ۱۲ شب")).toEqual({ h: 0, m: 0 });
    expect(time("ساعت ۸ صبح")).toEqual({ h: 8, m: 0 });
    expect(time("ساعت ۱ ظهر")).toEqual({ h: 13, m: 0 });
    expect(time("۵ عصر")).toEqual({ h: 17, m: 0 });
    expect(time("۹ شب")).toEqual({ h: 21, m: 0 });
  });

  it("takes the period word out of the title", () => {
    expect(extractSignals("فردا ساعت ۵ عصر دندان‌پزشک")).toMatchObject({ title: "دندان‌پزشک", day: day(1), time: { h: 17, m: 0 } });
  });
});

describe("event cue", () => {
  it("a meeting or an appointment is an event even with no date", () => {
    expect(extractSignals("جلسه با علی")).toMatchObject({ eventCue: true });
    expect(extractSignals("وقت دکتر")).toMatchObject({ eventCue: true });
    expect(extractSignals("مطالعه مقاله")).toMatchObject({ eventCue: false });
  });
});

describe("installments", () => {
  it("a count and an amount make a plan; the amount is per installment when the line prices an installment", () => {
    expect(extractSignals("قسط ماشین ۱۲ ماهه ۵ میلیونی")).toMatchObject({
      kind: "INSTALLMENT_PLAN",
      title: "قسط ماشین",
      count: 12,
      amount: 5_000_000,
      perInstallment: true,
    });
    expect(extractSignals("ماشین ۱۲ قسط ۵ میلیون")).toMatchObject({ kind: "INSTALLMENT_PLAN", title: "ماشین", count: 12, amount: 5_000_000, perInstallment: true });
    expect(extractSignals("قسط وام ۵ میلیون ۱۲ ماهه")).toMatchObject({ kind: "INSTALLMENT_PLAN", count: 12, amount: 5_000_000, perInstallment: true });
    expect(extractSignals("۱۲ قسطی هر ماه ۵۰۰ هزار تومان")).toMatchObject({ kind: "INSTALLMENT_PLAN", count: 12, amount: 500_000, perInstallment: true });
  });

  it("is the whole amount when the line calls it the loan, or gives only the length of the plan", () => {
    expect(extractSignals("وام ۶۰ میلیون ۱۲ ماهه")).toMatchObject({ kind: "INSTALLMENT_PLAN", title: "وام", count: 12, amount: 60_000_000, perInstallment: false });
    expect(extractSignals("وام ماشین ۶۰ میلیون ۱۲ قسط")).toMatchObject({ kind: "INSTALLMENT_PLAN", title: "وام ماشین", perInstallment: false });
    expect(extractSignals("لپ‌تاپ ۳۶ میلیون ۱۲ ماهه")).toMatchObject({ kind: "INSTALLMENT_PLAN", title: "لپ‌تاپ", count: 12, amount: 36_000_000, perInstallment: false });
  });

  it("reads the day of the month it falls on", () => {
    expect(extractSignals("قسط ماشین ۱۲ ماهه ۵ میلیونی روز ۵ هر ماه")).toMatchObject({ kind: "INSTALLMENT_PLAN", title: "قسط ماشین", dueDay: 5 });
    expect(extractSignals("قسط ماشین ۱۲ ماهه ۵ میلیونی").dueDay).toBeNull();
  });

  it("«روز ۵ هر ماه» is a day, not a price per month", () => {
    // without this the «هر ماه» made the whole loan look like one installment
    expect(extractSignals("وام ۶۰ میلیون ۱۲ ماهه روز ۵ هر ماه")).toMatchObject({
      kind: "INSTALLMENT_PLAN",
      title: "وام",
      count: 12,
      amount: 60_000_000,
      perInstallment: false,
      dueDay: 5,
    });
    expect(extractSignals("وام ۶۰ میلیون ۱۲ ماهه سررسید ۱۰")).toMatchObject({ perInstallment: false, dueDay: 10 });
    // a price per month still is one
    expect(extractSignals("۱۲ قسطی هر ماه ۵۰۰ هزار تومان")).toMatchObject({ perInstallment: true, dueDay: null });
    expect(extractSignals("وام ۱۲ ماهه هر ماه ۵ میلیون روز ۵")).toMatchObject({ perInstallment: true, dueDay: 5, amount: 5_000_000 });
  });

  it("paying one is «قسط» with a verb of payment", () => {
    expect(extractSignals("قسط ماشین رو دادم")).toMatchObject({ kind: "INSTALLMENT_PAY", hint: "ماشین" });
    expect(extractSignals("پرداخت قسط وام")).toMatchObject({ kind: "INSTALLMENT_PAY", hint: "وام" });
    expect(extractSignals("قسط ماشین ۵ میلیون پرداخت کردم")).toMatchObject({ kind: "INSTALLMENT_PAY", hint: "ماشین" });
    expect(extractSignals("قسط رو دادم")).toMatchObject({ kind: "INSTALLMENT_PAY", hint: "" });
  });

  it("«قسط» alone, or with nothing to act on, stays an ordinary entry", () => {
    expect(extractSignals("قسط ماشین")).toMatchObject({ kind: "ENTRY", title: "قسط ماشین" });
    expect(extractSignals("قسط ماشین ۵ میلیون")).toMatchObject({ kind: "ENTRY", amount: 5_000_000 });
    expect(extractSignals("۱۲ قسط ماشین")).toMatchObject({ kind: "ENTRY" });
  });
});

describe("keyword-led lines", () => {
  it("a note keeps what was typed, digits included", () => {
    expect(extractSignals("یادداشت: امروز خیلی خوب بود ۳ تا کار کردم")).toMatchObject({ kind: "NOTE", title: "امروز خیلی خوب بود ۳ تا کار کردم", day: null });
    expect(extractSignals("یادداشت دیروز: دیر خوابیدم")).toMatchObject({ kind: "NOTE", title: "دیر خوابیدم", day: day(-1) });
    expect(extractSignals("نوت خرید نان فراموش نشه")).toMatchObject({ kind: "NOTE", title: "خرید نان فراموش نشه" });
  });

  it("a habit is ticked off, or created", () => {
    expect(extractSignals("عادت ورزش صبحگاهی انجام شد")).toMatchObject({ kind: "HABIT_CHECKIN", hint: "ورزش صبحگاهی" });
    expect(extractSignals("عادت: مطالعه")).toMatchObject({ kind: "HABIT_CHECKIN", hint: "مطالعه" });
    expect(extractSignals("عادت مدیتیشن ✓")).toMatchObject({ kind: "HABIT_CHECKIN", hint: "مدیتیشن" });
    expect(extractSignals("عادت جدید مطالعه")).toMatchObject({ kind: "HABIT_CREATE", title: "مطالعه" });
    expect(extractSignals("عادت تازه: ورزش")).toMatchObject({ kind: "HABIT_CREATE", title: "ورزش" });
  });

  it("only today can be ticked off", () => {
    expect(extractSignals("عادت ورزش دیروز انجام شد").kind).toBe("ENTRY");
  });

  it("a goal, a project and a budget", () => {
    expect(extractSignals("هدف ماشین ۲۰۰ میلیون")).toMatchObject({ kind: "SAVINGS_GOAL", title: "ماشین", amount: 200_000_000 });
    expect(extractSignals("هدف پس‌انداز سفر ۵۰ میلیون تومان")).toMatchObject({ kind: "SAVINGS_GOAL", title: "سفر", amount: 50_000_000 });
    expect(extractSignals("هدف ۱۰ میلیون")).toMatchObject({ kind: "SAVINGS_GOAL", title: "هدف پس‌انداز", amount: 10_000_000 });
    expect(extractSignals("پروژه جدید بازسازی اتاق")).toMatchObject({ kind: "PROJECT_CREATE", title: "بازسازی اتاق" });
    expect(extractSignals("پروژه‌ی جدید: سایت")).toMatchObject({ kind: "PROJECT_CREATE", title: "سایت" });
    expect(extractSignals("بودجه خوراک ماهانه ۵ میلیون")).toMatchObject({ kind: "BUDGET", hint: "خوراک", amount: 5_000_000 });
    expect(extractSignals("بودجه ۵ میلیون خوراک")).toMatchObject({ kind: "BUDGET", hint: "خوراک", amount: 5_000_000 });
  });

  it("a reminder is a dated entry with its own kind", () => {
    expect(extractSignals("یادآوری فردا ساعت ۸ صبح قرص")).toMatchObject({ kind: "REMINDER", title: "قرص", day: day(1), time: { h: 8, m: 0 } });
    expect(extractSignals("یادم باشه زنگ بزنم به مامان")).toMatchObject({ kind: "REMINDER", title: "زنگ بزنم به مامان" });
    expect(extractSignals("یادآوری")).toMatchObject({ kind: "REMINDER", title: "یادآوری" });
  });

  it("a keyword with nothing after it (or nothing it needs) is just an entry", () => {
    for (const line of ["یادداشت", "عادت", "بودجه", "بودجه خوراک", "هدف", "هدف ماشین", "پروژه جدید"]) {
      expect(extractSignals(line).kind, line).toBe("ENTRY");
    }
  });

  it("the keyword must start the line", () => {
    expect(extractSignals("خرید کتاب عادت").kind).toBe("ENTRY");
    expect(extractSignals("امروز یادداشت نوشتم").kind).toBe("ENTRY");
  });
});

describe("plain entries keep working", () => {
  it("reads a title, a length, a price, a day and the «خرید» and project hints", () => {
    expect(extractSignals("خرید هویه ۲ ساعت ۱.۵ میلیون")).toMatchObject({ kind: "ENTRY", title: "هویه", durationMinutes: 120, amount: 1_500_000, categoryHint: "خرید" });
    expect(extractSignals("خرید رنگ برای پروژه اتاق")).toMatchObject({ title: "رنگ", categoryHint: "خرید", projectHint: "اتاق" });
    expect(extractSignals("خرید رنگ از پروژه اتاق")).toMatchObject({ title: "رنگ", projectHint: "اتاق" });
    expect(extractSignals("اینستاگرام ۲ ساعت")).toMatchObject({ durationMinutes: 120, categoryHint: "شبکه‌های اجتماعی" });
    expect(extractSignals("مطالعه مقاله SNN")).toMatchObject({ title: "مطالعه مقاله SNN", durationMinutes: null, amount: null });
  });

  it("trims what a finished sentence leaves behind", () => {
    expect(extractSignals("۲ ساعت مطالعه کردم").title).toBe("مطالعه");
    expect(extractSignals("ناهار ۲۰۰ هزار تومان از").title).toBe("ناهار");
  });

  it("an empty line has the placeholder title", () => {
    expect(extractSignals("  ").title).toBe("بدون عنوان");
  });

  it("extractEntrySignals ignores the keywords", () => {
    expect(extractEntrySignals("یادداشت: نان").kind).toBe("ENTRY");
    expect(extractEntrySignals("عادت ورزش").kind).toBe("ENTRY");
    expect(extractEntrySignals("قسط ماشین ۱۲ ماهه ۵ میلیونی")).toMatchObject({ kind: "ENTRY", amount: 5_000_000 });
  });
});

describe("what a keyboard or a paste brings along", () => {
  it("ignores a direction mark before the line and takes Arabic letters for Persian ones", () => {
    const rlm = String.fromCharCode(0x200f);
    const lrm = String.fromCharCode(0x200e);
    expect(extractSignals(`${rlm}یادداشت: سلام`).kind).toBe("NOTE");
    expect(extractSignals(`${lrm}${rlm}  عادت ورزش`).kind).toBe("HABIT_CHECKIN");
    expect(extractSignals("كتاب ۲ ساعت")).toMatchObject({ title: "کتاب", durationMinutes: 120 });
  });

  it("takes an exotic space for a plain one", () => {
    const nbsp = String.fromCharCode(0xa0);
    expect(extractSignals(`شکلات${nbsp}۵۰۰ هزار`)).toMatchObject({ title: "شکلات", amount: 500_000 });
  });

  it("takes Persian and Arabic-Indic digits alike", () => {
    expect(extractSignals("شکلات ٥٠٠ هزار")).toMatchObject({ amount: 500_000 });
    expect(extractSignals("شکلات ۵۰۰ هزار")).toMatchObject({ amount: 500_000 });
  });
});

// The widget's own parser is a port of this file; the patterns must not drift apart.
describe("the Android widget's parser", () => {
  const java = readFileSync("android/app/src/main/java/ir/mganic/dara/QuickTextParser.java", "utf8");

  // A Java string literal's value: \\ is one backslash, \" a quote, \uXXXX the character.
  function javaString(literal: string): string {
    return literal.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_all, code: string) => (code.startsWith("u") ? String.fromCharCode(parseInt(code.slice(1), 16)) : code));
  }

  it.each(Object.entries(CAPTURE_GRAMMAR))("spells %s the same as this file does", (name, pattern) => {
    const declared = java.match(new RegExp(`static final String ${name} = "((?:[^"\\\\]|\\\\.)*)";`));
    expect(declared, `QuickTextParser.java must declare ${name}`).not.toBeNull();
    expect(javaString(declared![1])).toBe(pattern);
  });
});
