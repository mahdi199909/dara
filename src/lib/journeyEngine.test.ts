import { describe, expect, it } from "vitest";
import { buildChapter, dayLabel, isBeforeMonth, isNotableStreak, jalaliMonthOf, monthKey, monthRangeIso, previousJalaliMonth } from "./journeyEngine";
import { EMPTY_JOURNEY_ROWS, type JourneyDay, type JourneyEntry, type JourneyRows } from "./journeyTypes";

// Everything is built with local-time constructors: the story tells the reader's own days.
const NOW = new Date(2026, 8, 26, 15, 0); // شنبه ۴ مهر ۱۴۰۵، ۱۵:۰۰
const MEHR = { jy: 1405, jm: 7 }; // مهر ۱۴۰۵ starts on 23 September 2026 (its 30 days end on 22 October)
const at = (day: number, hour = 0, minute = 0, month = 8) => new Date(2026, month, day, hour, minute).toISOString();
const dayKey = (day: number, month = 8) => `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function rows(partial: Partial<JourneyRows>): JourneyRows {
  return { ...EMPTY_JOURNEY_ROWS, earliestDay: dayKey(23), ...partial };
}

const days = (entries: JourneyEntry[]) => entries.filter((e): e is JourneyDay => e.kind === "day");
const dayOf = (entries: JourneyEntry[], key: string) => days(entries).find((d) => d.key === key)!;
const textOf = (d: JourneyDay) => d.paragraphs.join("\n");

const event = (over: Partial<JourneyRows["events"][number]> = {}): JourneyRows["events"][number] => ({
  id: "e1",
  title: "جلسه‌ی بازبینی طرح",
  startAt: at(24, 10),
  endAt: at(24, 11),
  allDay: false,
  location: null,
  project: null,
  category: null,
  done: false,
  ...over,
});

describe("months", () => {
  it("finds the Jalali month, the one before it, and its key", () => {
    expect(jalaliMonthOf(NOW)).toEqual(MEHR);
    expect(previousJalaliMonth(MEHR)).toEqual({ jy: 1405, jm: 6 });
    expect(previousJalaliMonth({ jy: 1405, jm: 1 })).toEqual({ jy: 1404, jm: 12 });
    expect(monthKey(MEHR)).toBe("1405-07");
    expect(monthKey({ jy: 1405, jm: 1 })).toBe("1405-01");
  });

  it("asks the loaders for local midnight of the first day through the end of the last", () => {
    const { from, to } = monthRangeIso(MEHR);
    expect(new Date(from).getTime()).toBe(new Date(2026, 8, 23, 0, 0, 0, 0).getTime());
    expect(new Date(to).getTime()).toBe(new Date(2026, 9, 22, 23, 59, 59, 999).getTime()); // مهر has 30 days
  });

  it("knows when a day lies before a month", () => {
    expect(isBeforeMonth("2026-09-22", MEHR)).toBe(true);
    expect(isBeforeMonth("2026-09-23", MEHR)).toBe(false);
    expect(isBeforeMonth("not-a-day", MEHR)).toBe(false);
  });

  it("labels a day with its weekday, day and Jalali month", () => {
    expect(dayLabel(new Date(2026, 8, 26))).toBe("شنبه ۴ مهر");
  });
});

describe("an empty journey", () => {
  it("is an empty chapter — no wall of «no records» for a story that has not begun", () => {
    const chapter = buildChapter({ month: MEHR, rows: { ...EMPTY_JOURNEY_ROWS }, now: NOW });
    expect(chapter.entries).toEqual([]);
    expect(chapter.hasContent).toBe(false);
    expect(chapter.summary).toBeNull();
    expect(chapter.title).toBe("مهر ۱۴۰۵");
  });
});

describe("a day's events", () => {
  it("names the event, says when it was, and how long it took", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ events: [event()] }), now: NOW });
    const day = dayOf(chapter.entries, dayKey(24));
    const text = textOf(day);
    expect(text).toContain("«جلسه‌ی بازبینی طرح»");
    expect(text).toMatch(/۱۰ صبح|صبح/);
    expect(text).toContain("یک ساعت");
    expect(day.label).toBe("پنجشنبه ۲ مهر");
  });

  it("tells them in the order they happened", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({ events: [event({ id: "late", title: "قرار شام", startAt: at(24, 20), endAt: at(24, 22) }), event({ id: "early", title: "تماس صبحگاهی", startAt: at(24, 8, 30), endAt: at(24, 9) })] }),
      now: NOW,
    });
    const text = textOf(dayOf(chapter.entries, dayKey(24)));
    expect(text.indexOf("«تماس صبحگاهی»")).toBeGreaterThan(-1);
    expect(text.indexOf("«تماس صبحگاهی»")).toBeLessThan(text.indexOf("«قرار شام»"));
  });

  it("puts the place in brackets", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ events: [event({ location: "کافه‌ی هشت" })] }), now: NOW });
    expect(textOf(dayOf(chapter.entries, dayKey(24)))).toContain("(کافه‌ی هشت)");
  });

  it("says an all-day event covered the whole day", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ events: [event({ title: "سفر شیراز", allDay: true })] }), now: NOW });
    expect(textOf(dayOf(chapter.entries, dayKey(24)))).toMatch(/تمام روز|تمام‌روز/);
  });

  it("speaks of something later today in the future tense", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ events: [event({ title: "جلسه‌ی عصر", startAt: at(26, 18), endAt: at(26, 19) })] }), now: NOW });
    const day = dayOf(chapter.entries, dayKey(26));
    expect(day.relative).toBe("امروز");
    expect(textOf(day)).toMatch(/دارم|در برنامه‌ام است|در پیش دارم/);
    expect(textOf(day)).not.toContain("داشتم");
  });
});

describe("work and tasks", () => {
  it("tells tracked time against its project", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({
        work: [
          { id: "w1", title: "طراحی صفحه‌ی اول", startAt: at(24, 9), minutes: 120, project: "سایت آتلیه", category: null },
          { id: "w2", title: "تنظیم ریسپانسیو", startAt: at(24, 14), minutes: 60, project: "سایت آتلیه", category: null },
        ],
      }),
      now: NOW,
    });
    const text = textOf(dayOf(chapter.entries, dayKey(24)));
    expect(text).toContain("«سایت آتلیه»");
    expect(text).toContain("سه ساعت");
  });

  it("names the biggest project first when time went to several", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({
        work: [
          { id: "a", title: "الف", startAt: at(24, 9), minutes: 60, project: "پروژه‌ی کوچک", category: null },
          { id: "b", title: "ب", startAt: at(24, 11), minutes: 180, project: "پروژه‌ی بزرگ", category: null },
        ],
      }),
      now: NOW,
    });
    const text = textOf(dayOf(chapter.entries, dayKey(24)));
    expect(text.indexOf("«پروژه‌ی بزرگ»")).toBeLessThan(text.indexOf("«پروژه‌ی کوچک»"));
  });

  it("names one, several, and «and N more» tasks", () => {
    const task = (i: number) => ({ id: `t${i}`, title: `کار شماره ${i}`, at: at(24, 12), minutes: null, project: null, category: null });
    const one = textOf(dayOf(buildChapter({ month: MEHR, rows: rows({ tasks: [task(1)] }), now: NOW }).entries, dayKey(24)));
    expect(one).toContain("«کار شماره 1»");

    const three = textOf(dayOf(buildChapter({ month: MEHR, rows: rows({ tasks: [task(1), task(2), task(3)] }), now: NOW }).entries, dayKey(24)));
    for (const i of [1, 2, 3]) expect(three).toContain(`«کار شماره ${i}»`);
    expect(three).toContain("«کار شماره 1»، «کار شماره 2» و «کار شماره 3»");

    const seven = textOf(dayOf(buildChapter({ month: MEHR, rows: rows({ tasks: [1, 2, 3, 4, 5, 6, 7].map(task) }), now: NOW }).entries, dayKey(24)));
    expect(seven).toContain("«کار شماره 3»");
    expect(seven).not.toContain("«کار شماره 4»");
    expect(seven).toContain("چهار کار کوچک‌تر دیگر");
  });

  it("does not repeat a task title twice in a day", () => {
    const t = { id: "x", title: "ارسال فاکتور", at: at(24, 12), minutes: null, project: null, category: null };
    const text = textOf(dayOf(buildChapter({ month: MEHR, rows: rows({ tasks: [t, { ...t, id: "y" }] }), now: NOW }).entries, dayKey(24)));
    expect(text.match(/ارسال فاکتور/g)).toHaveLength(1);
  });
});

describe("habits", () => {
  const habit = (title: string, streak: number, hour = 7, id = title) => ({ id: `c-${id}`, habitId: id, title, date: at(24), at: at(24, hour), minutes: null, streak });

  it("lists the habits that were done", () => {
    const text = textOf(dayOf(buildChapter({ month: MEHR, rows: rows({ habits: [habit("مطالعه", 1, 22), habit("ورزش", 2, 7)] }), now: NOW }).entries, dayKey(24)));
    // In the order the day went: the morning one first.
    expect(text).toContain("«ورزش» و «مطالعه»");
  });

  it("mentions a streak only at a length worth saying aloud", () => {
    const seven = textOf(dayOf(buildChapter({ month: MEHR, rows: rows({ habits: [habit("ورزش", 7)] }), now: NOW }).entries, dayKey(24)));
    expect(seven).toMatch(/هفت روز/);
    // The streak rides in the same sentence as the habit instead of a second sentence naming it again.
    expect(seven.split(".").filter((sentence) => sentence.includes("«ورزش»"))).toHaveLength(1);
    const eight = textOf(dayOf(buildChapter({ month: MEHR, rows: rows({ habits: [habit("ورزش", 8)] }), now: NOW }).entries, dayKey(24)));
    expect(eight).not.toMatch(/هشت روز/);
    expect([3, 5, 7, 10, 14, 21, 30, 60, 100].every(isNotableStreak)).toBe(true);
    expect([1, 2, 4, 6, 8, 15, 29].some(isNotableStreak)).toBe(false);
  });

  it("puts a habit checked in for a day on that day, whatever hour the row says", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ habits: [habit("ورزش", 1)] }), now: NOW });
    expect(days(chapter.entries).map((d) => d.key)).toEqual([dayKey(24)]);
  });
});

describe("notes", () => {
  const note = (over: Partial<JourneyRows["notes"][number]> = {}) => ({ id: "n1", day: dayKey(24), text: "امروز خیلی خسته بودم،\nولی تمام شد.", createdAt: at(24, 23), ...over });

  it("keeps the person's words exactly, line breaks included", () => {
    const day = dayOf(buildChapter({ month: MEHR, rows: rows({ notes: [note()] }), now: NOW }).entries, dayKey(24));
    expect(day.notes).toHaveLength(1);
    expect(day.notes[0].text).toBe("امروز خیلی خسته بودم،\nولی تمام شد.");
  });

  it("introduces a late-night note as one written at night, and a morning one as a morning's", () => {
    const night = dayOf(buildChapter({ month: MEHR, rows: rows({ notes: [note({ createdAt: at(24, 23, 30) })] }), now: NOW }).entries, dayKey(24));
    expect(night.notes[0].lead).toMatch(/شب|شبانه/);
    const morning = dayOf(buildChapter({ month: MEHR, rows: rows({ notes: [note({ createdAt: at(24, 7) })] }), now: NOW }).entries, dayKey(24));
    expect(morning.notes[0].lead).toContain("صبح");
  });

  it("orders several notes by when they were written and marks the later ones as continuing", () => {
    const day = dayOf(
      buildChapter({ month: MEHR, rows: rows({ notes: [note({ id: "b", text: "دوم", createdAt: at(24, 22) }), note({ id: "a", text: "اول", createdAt: at(24, 9) })] }), now: NOW }).entries,
      dayKey(24)
    );
    expect(day.notes.map((n) => n.text)).toEqual(["اول", "دوم"]);
    expect(day.notes[1].lead).toMatch(/دیگر|باز/);
  });

  it("makes a day out of a note alone", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ notes: [note()] }), now: NOW });
    expect(days(chapter.entries)).toHaveLength(1);
  });
});

describe("landmarks", () => {
  it("says a project began or ended, and marks the day", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({ milestones: [{ id: "p1", kind: "STARTED", name: "سایت آتلیه", at: at(24, 9) }, { id: "p2", kind: "COMPLETED", name: "لندینگ پرواز", at: at(25, 16) }] }),
      now: NOW,
    });
    const started = dayOf(chapter.entries, dayKey(24));
    const ended = dayOf(chapter.entries, dayKey(25));
    expect(textOf(started)).toContain("«سایت آتلیه»");
    expect(textOf(ended)).toContain("«لندینگ پرواز»");
    expect(started.landmark).toBe(true);
    expect(ended.landmark).toBe(true);
  });

  it("marks the very first recorded day as where the path began", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ earliestDay: dayKey(24), events: [event()] }), now: NOW });
    const first = dayOf(chapter.entries, dayKey(24));
    expect(textOf(first)).toContain("مسیر از همین‌جا شروع شد");
    expect(first.landmark).toBe(true);
  });
});

describe("silence", () => {
  it("folds consecutive empty days into one quiet line", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({ earliestDay: dayKey(23), events: [event({ startAt: at(23, 10), endAt: at(23, 11) }), event({ id: "e2", startAt: at(26, 9), endAt: at(26, 10) })] }),
      now: NOW,
    });
    const kinds = chapter.entries.map((e) => e.kind);
    expect(kinds).toEqual(["day", "gap", "day"]);
    const gap = chapter.entries[1];
    expect(gap.kind === "gap" && gap.days).toBe(2);
    expect(gap.kind === "gap" && gap.text).toContain("دو روز بدون ثبت");
    expect(gap.kind === "gap" && gap.text).toContain("۲ تا ۳ مهر");
  });

  it("says «one day» for a single empty day", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({ events: [event({ startAt: at(23, 10), endAt: at(23, 11) }), event({ id: "e2", startAt: at(25, 9), endAt: at(25, 10) })] }),
      now: NOW,
    });
    const gap = chapter.entries.find((e) => e.kind === "gap");
    expect(gap && gap.kind === "gap" && gap.text).toContain("یک روز بدون ثبت");
  });

  it("does not count today, which is still going, as a silence", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ events: [event({ startAt: at(24, 10), endAt: at(24, 11) })] }), now: NOW });
    // 23 is silent (after the earliest day), 24 has the event, 25 is silent, 26 (today) is empty and not a silence.
    expect(chapter.entries.map((e) => e.kind)).toEqual(["gap", "day", "gap"]);
    const last = chapter.entries[2];
    expect(last.kind === "gap" && last.to).toBe(dayKey(25));
  });

  it("does not invent silence before the first thing ever recorded", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ earliestDay: dayKey(25), events: [event({ startAt: at(25, 10), endAt: at(25, 11) })] }), now: NOW });
    expect(chapter.entries.map((e) => e.kind)).toEqual(["day"]);
  });

  it("shows a month of silence after the path began as one line", () => {
    const chapter = buildChapter({ month: previousOf(MEHR), rows: rows({ earliestDay: dayKey(1, 7) }), now: NOW });
    expect(chapter.hasContent).toBe(false);
    expect(chapter.entries).toHaveLength(1);
    expect(chapter.entries[0].kind).toBe("gap");
  });
});

function previousOf(m: { jy: number; jm: number }) {
  return previousJalaliMonth(m);
}

describe("the chapter as a whole", () => {
  const busyRows = () =>
    rows({
      earliestDay: dayKey(23),
      work: [
        { id: "w1", title: "طراحی", startAt: at(23, 9), minutes: 300, project: "سایت آتلیه", category: null },
        { id: "w2", title: "کدنویسی", startAt: at(24, 9), minutes: 360, project: "سایت آتلیه", category: null },
        { id: "w3", title: "جلسه", startAt: at(25, 9), minutes: 60, project: "لندینگ", category: null },
      ],
      tasks: [
        { id: "t1", title: "الف", at: at(23, 12), minutes: null, project: null, category: null },
        { id: "t2", title: "ب", at: at(24, 12), minutes: null, project: null, category: null },
      ],
      habits: [
        { id: "h1", habitId: "h", title: "ورزش", date: at(23), at: at(23, 7), minutes: null, streak: 1 },
        { id: "h2", habitId: "h", title: "ورزش", date: at(24), at: at(24, 7), minutes: null, streak: 2 },
      ],
      notes: [{ id: "n1", day: dayKey(24), text: "یادداشت", createdAt: at(24, 22) }],
      events: [event({ id: "e1", startAt: at(23, 10), endAt: at(23, 11) }), event({ id: "e2", startAt: at(24, 10), endAt: at(24, 11) }), event({ id: "e3", startAt: at(25, 10), endAt: at(25, 11) })],
    });

  it("summarises the month: days, tasks, tracked time, top project, habit, notes", () => {
    const chapter = buildChapter({ month: MEHR, rows: busyRows(), now: NOW });
    expect(chapter.hasContent).toBe(true);
    const summary = chapter.summary!;
    expect(summary).toContain("مهر");
    expect(summary).toContain("تا امروز"); // the month is not over
    expect(summary).toContain("سه روز چیزی ثبت کردم");
    expect(summary).toContain("دو کار را تمام کردم");
    expect(summary).toContain("«سایت آتلیه»");
    expect(summary).toContain("«ورزش» دو بار انجام شد");
    expect(summary).toContain("یک یادداشت");
  });

  it("gives the month a subtitle when one project filled it", () => {
    expect(buildChapter({ month: MEHR, rows: busyRows(), now: NOW }).subtitle).toBe("ماهِ «سایت آتلیه»");
  });

  it("gives no subtitle when the time was spread thin", () => {
    const spread = rows({ work: ["الف", "ب", "ج", "د"].map((p, i) => ({ id: `w${i}`, title: p, startAt: at(23 + (i % 3), 9), minutes: 200, project: p, category: null })) });
    expect(buildChapter({ month: MEHR, rows: spread, now: NOW }).subtitle).toBeNull();
  });

  it("tells a finished month without «until today»", () => {
    const shahrivar = { jy: 1405, jm: 6 };
    const chapter = buildChapter({ month: shahrivar, rows: rows({ earliestDay: dayKey(1, 7), tasks: [{ id: "t", title: "الف", at: at(5, 12, 0, 8), minutes: null, project: null, category: null }] }), now: NOW });
    expect(chapter.summary).not.toContain("تا امروز");
    expect(chapter.title).toBe("شهریور ۱۴۰۵");
  });
});

describe("what reads naturally", () => {
  it("never nests a quotation inside a quotation", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({ work: [{ id: "w", title: "طراحی", startAt: at(24, 9), minutes: 120, project: "کیت رابط کاربری «نی»", category: null }] }),
      now: NOW,
    });
    const text = textOf(dayOf(chapter.entries, dayKey(24)));
    expect(text).toContain("«کیت رابط کاربری نی»");
    expect(text).not.toContain("«نی»»");
  });

  it("does not call two equal stretches of work «the most»", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({
        work: [
          { id: "a", title: "الف", startAt: at(24, 9), minutes: 105, project: "پروژه‌ی اول", category: null },
          { id: "b", title: "ب", startAt: at(24, 13), minutes: 105, project: "پروژه‌ی دوم", category: null },
        ],
      }),
      now: NOW,
    });
    const text = textOf(dayOf(chapter.entries, dayKey(24)));
    expect(text).not.toContain("بیشترین وقتم");
    expect(text).toContain("«پروژه‌ی اول»");
    expect(text).toContain("«پروژه‌ی دوم»");
  });

  it("names work that belongs to no project by what it was, not as «scattered»", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({
        work: [
          { id: "a", title: "طراحی", startAt: at(24, 9), minutes: 240, project: "سایت", category: null },
          { id: "b", title: "پاسخ به ایمیل‌ها", startAt: at(24, 15), minutes: 45, project: null, category: null },
        ],
      }),
      now: NOW,
    });
    const text = textOf(dayOf(chapter.entries, dayKey(24)));
    expect(text).toContain("«پاسخ به ایمیل‌ها»");
    expect(text).not.toContain("پراکنده");
  });

  it("does not say a family dinner was something the person set time aside for", () => {
    for (const d of [23, 24, 25, 26]) {
      const chapter = buildChapter({ month: MEHR, rows: rows({ events: [event({ id: `s${d}`, title: "شام تولد کامران", category: "تفریح", startAt: at(d, 19), endAt: at(d, 21) })] }), now: NOW });
      expect(textOf(dayOf(chapter.entries, dayKey(d)))).not.toContain("وقت گذاشتم");
    }
  });

  it("says a routine is the same as the day before rather than listing it word for word again", () => {
    const habit = (id: string, day: number) => ({ id, habitId: "h", title: "ورزش", date: at(day), at: at(day, 7), minutes: null, streak: 1 });
    const chapter = buildChapter({ month: MEHR, rows: rows({ habits: [habit("a", 23), habit("b", 24)] }), now: NOW });
    expect(textOf(dayOf(chapter.entries, dayKey(24)))).toMatch(/مثل دیروز|امروز هم/);
    expect(textOf(dayOf(chapter.entries, dayKey(23)))).not.toMatch(/مثل دیروز|امروز هم/);
  });

  it("marks the busiest day of the month once", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({
        work: [
          { id: "a", title: "الف", startAt: at(23, 9), minutes: 300, project: "سایت", category: null },
          { id: "b", title: "ب", startAt: at(24, 9), minutes: 480, project: "سایت", category: null },
          { id: "c", title: "ج", startAt: at(25, 9), minutes: 420, project: "سایت", category: null },
        ],
      }),
      now: NOW,
    });
    const mentions = days(chapter.entries)
      .filter((d) => textOf(d).includes("پرکارترین روز"))
      .map((d) => d.key);
    expect(mentions).toEqual([dayKey(24)]);
    expect(textOf(dayOf(chapter.entries, dayKey(24)))).toContain("تا اینجا"); // the month is not over
  });

  it("says nothing about a busiest day when no day was long", () => {
    const chapter = buildChapter({ month: MEHR, rows: rows({ work: [{ id: "a", title: "الف", startAt: at(24, 9), minutes: 120, project: "سایت", category: null }] }), now: NOW });
    expect(textOf(dayOf(chapter.entries, dayKey(24)))).not.toContain("پرکارترین");
  });

  it("gathers a short day into one paragraph and keeps the habits in their own", () => {
    const chapter = buildChapter({
      month: MEHR,
      rows: rows({
        events: [event()],
        work: [{ id: "a", title: "الف", startAt: at(24, 13), minutes: 120, project: "سایت", category: null }],
        habits: [{ id: "h", habitId: "h", title: "ورزش", date: at(24), at: at(24, 7), minutes: null, streak: 1 }],
      }),
      now: NOW,
    });
    expect(dayOf(chapter.entries, dayKey(24)).paragraphs).toHaveLength(2);
  });
});

describe("small grammar points", () => {
  it("does not name a habit twice in the sentence that gives its streak", () => {
    const habit = { id: "c", habitId: "h", title: "ورزش", date: at(24), at: at(24, 7), minutes: null, streak: 7 };
    for (const d of [23, 24, 25, 26]) {
      const chapter = buildChapter({ month: MEHR, rows: rows({ habits: [{ ...habit, id: `c${d}`, date: at(d), at: at(d, 7) }] }), now: NOW });
      const text = textOf(dayOf(chapter.entries, dayKey(d)));
      expect(text.match(/«ورزش»/g)).toHaveLength(1);
    }
  });

  it("says «in between» only when there is something on both sides", () => {
    for (const d of [23, 24, 25, 26]) {
      const one = buildChapter({
        month: MEHR,
        rows: rows({ events: [event({ id: `e${d}`, startAt: at(d, 10), endAt: at(d, 11) })], work: [{ id: `w${d}`, title: "الف", startAt: at(d, 13), minutes: 120, project: "سایت", category: null }] }),
        now: NOW,
      });
      expect(textOf(dayOf(one.entries, dayKey(d)))).not.toContain("در فاصله‌ی این‌ها");
    }
  });
});

describe("the writing itself", () => {
  it("is the same every time the same day is opened", () => {
    const input = rows({ events: [event(), event({ id: "e2", startAt: at(24, 15), endAt: at(24, 16) })], tasks: [{ id: "t", title: "الف", at: at(24, 12), minutes: null, project: null, category: null }] });
    const a = JSON.stringify(buildChapter({ month: MEHR, rows: input, now: NOW }));
    const b = JSON.stringify(buildChapter({ month: MEHR, rows: input, now: NOW }));
    expect(a).toBe(b);
  });

  it("varies its wording from one day to the next", () => {
    const sameEveryDay = [23, 24, 25, 26].map((d) => event({ id: `e${d}`, startAt: at(d, 9), endAt: at(d, 10) }));
    const chapter = buildChapter({ month: MEHR, rows: rows({ events: sameEveryDay }), now: NOW });
    const shapes = new Set(days(chapter.entries).map((d) => textOf(d).replace(/«[^»]*»/g, "«»").replace(/[۰-۹]+/g, "N")));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it("never leaks a broken value into a sentence", () => {
    // A few hundred generated days: whatever is in the rows, no «undefined», «NaN», «null» or object dump reaches the reader.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let round = 0; round < 60; round++) {
      const day = 23 + Math.floor(rnd() * 4);
      const built = buildChapter({
        month: MEHR,
        rows: rows({
          events: rnd() < 0.7 ? [event({ id: `e${round}`, title: rnd() < 0.2 ? "  " : "قرار", startAt: at(day, Math.floor(rnd() * 24), Math.floor(rnd() * 60)), endAt: at(day, 23, 59), allDay: rnd() < 0.15, location: rnd() < 0.3 ? "  " : null })] : [],
          tasks: rnd() < 0.7 ? [{ id: `t${round}`, title: "", at: at(day, 12), minutes: rnd() < 0.5 ? Math.floor(rnd() * 240) : null, project: rnd() < 0.5 ? "پروژه" : null, category: null }] : [],
          work: rnd() < 0.7 ? [{ id: `w${round}`, title: "کار", startAt: at(day, 9), minutes: Math.floor(rnd() * 600), project: rnd() < 0.5 ? "پروژه" : null, category: null }] : [],
          habits: rnd() < 0.7 ? [{ id: `h${round}`, habitId: "h", title: "عادت", date: at(day), at: at(day, 7), minutes: null, streak: 1 + Math.floor(rnd() * 40) }] : [],
        }),
        now: NOW,
      });
      const everything = JSON.stringify(built);
      expect(everything).not.toMatch(/undefined|NaN|null"|\[object|Invalid/);
    }
  });
});
