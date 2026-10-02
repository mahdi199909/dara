// The number a respondent sees (computed in their browser by doc/landing/site/checkup/calc.js) must be the
// number the owner's dashboard counts (computed on the server by checkup.ts). Both run here on the same
// fixtures; any drift between the two copies fails this test.
import { describe, expect, it } from "vitest";
import * as server from "./checkup";
// @ts-ignore — a plain ES module served as-is by the static site; its JSDoc is the only typing it has.
import * as browser from "../../doc/landing/site/checkup/calc.js";

const DIGITS = ["", "۱۲۳", "٤٥٦", "۱٫۵", "1.5", "۲/۵", "۲۰۰٬۰۰۰", "1,250,000", " ۷ ", "abc", "۲۵", "24.5", ".5", "۱۰۰۰۰۰۰۰۰۰۰۰۰۰", "۱۲‌۰۰۰"];

const ANSWERS: server.CheckupAnswers[] = [
  {},
  { wake: "08:00", sleep: "01:00", tasks: [{ title: "کار", hours: 7 }] },
  { wake: "07:30", sleep: "23:30", tasks: [{ title: "a", hours: 10 }, { title: "b", hours: 5 }, { title: "c", hours: 4 }] },
  { wake: "09:00", sleep: "09:00", tasks: [{ title: "a", hours: 3 }] },
  { wake: "06:00", sleep: "22:00", tasks: [] },
  { tasks: [{ title: "  فقط   کار  ", hours: 2.5 }, { title: "", hours: null }] },
  {
    wake: "08:00",
    sleep: "00:00",
    tasks: [{ title: "x", hours: 6 }],
    rest: ["phone", "forgot", "phone"],
    hourly: 200000,
    hourlyNever: false,
    tools: ["paper", "none", "sheet"],
    toolLastOpened: "stopped",
    toolWhyLeft: "  ولش کردم  ",
    paid: "never",
    paidWhat: "چیزی",
    built: "",
    builtNone: false,
    builtHours: "approx",
    contactTelegram: "@someone_1",
    contactBale: "۰۹۱۲ ۳۴۵ ۶۷۸۹",
    contactEmail: " A@B.CO ",
  },
  {
    tools: ["iranApp", "foreignApp"],
    toolIran: " حساب ",
    toolForeign: "x",
    toolLastOpened: "week",
    toolWhyLeft: "should go",
    paid: "once",
    paidWhat: "یک اپ\r\n\r\n\r\n۵۰ هزار",
    built: "عکاسی",
    builtHours: "guess",
    regret: "گوشی",
    regretNone: true,
    hourly: 5000,
    hourlyNever: true,
  },
];

describe("browser and server calculations agree", () => {
  it("use the same option keys and the kit's exact wording", () => {
    expect(browser.OPTIONS).toEqual(server.OPTIONS);
    expect(browser.FORGOT_KEYS).toEqual([...server.FORGOT_KEYS]);
    expect(browser.ABANDONED_KEYS).toEqual([...server.ABANDONED_KEYS]);
  });

  it("read typed numbers the same way", () => {
    for (const input of DIGITS) {
      expect(browser.normalizeDigits(input), input).toBe(server.normalizeDigits(input));
      expect(browser.parseAmount(input), input).toBe(server.parseAmount(input));
      expect(browser.parseHours(input), input).toBe(server.parseHours(input));
    }
  });

  it("compute the same day and the same Toman value", () => {
    for (const answers of ANSWERS) {
      const day = server.dayNumbers(answers);
      expect(browser.dayNumbers(answers), JSON.stringify(answers)).toEqual(day);
      for (const hourly of [null, 0, 150000, 1234567]) expect(browser.hiddenValueToman(day.hidden, hourly)).toBe(server.hiddenValueToman(day.hidden, hourly));
    }
  });

  it("apply the kit's conditions the same way", () => {
    for (const answers of ANSWERS) expect(browser.normalizeAnswers(answers), JSON.stringify(answers)).toEqual(server.normalizeAnswers(answers));
  });

  it("clean and group sources the same way", () => {
    for (const src of [null, "", "IG-Shanbe", "ig-filter", "grp-a", "tg-poll", "tg-channel", "site", "<script>", "x".repeat(80), "direct", "fb-1"]) {
      const s = server.sanitizeSource(src);
      expect(browser.sanitizeSource(src)).toBe(s);
      expect(browser.sourceGroup(s)).toBe(server.sourceGroup(s));
    }
  });
});
