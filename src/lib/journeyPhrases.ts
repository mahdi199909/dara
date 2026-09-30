// How «مسیر» says an everyday entry the way a person would, instead of as a to-do that got ticked off.
//
//   «حرکت از تهران به قم» (رفت و آمد)  →  «از تهران به قم حرکت کردم»      not  ««حرکت از تهران به قم» را تمام کردم»
//   «خرید نان»                          →  «نان خریدم»
//   «تماس با بانک»                      →  «با بانک تماس گرفتم»
//   «ورزش»                              →  «ورزش کردم»
//
// Two sources of meaning, in this order: the words the title itself opens with (a small fixed lexicon of
// the verbal nouns people actually type), then the entry's category when it is one of the default ones that
// implies a verb (رفت و آمد، خرید). Anything else returns null and is told the usual way — nothing is guessed.
//
// Pure and deterministic, like the rest of the journey engine: same title and category, same words.

import { tidy } from "./journeySpoken";

export interface NaturalPhrase {
  /** A first-person clause that ends in its verb, without a full stop: «از تهران به قم حرکت کردم». */
  text: string;
  /** The entry was a trip: its duration is told as time on the road, not as time «worked». */
  travel: boolean;
}

/** «رفت و آمد»، «رفت‌وآمد» and «رفت وآمد» are one category. */
const ZWNJ = String.fromCharCode(0x200c); // spelled out: an invisible character inside a regex literal is a trap
const squash = (s: string) => s.replace(new RegExp("[\\s" + ZWNJ + "]+", "g"), "");

const TRAVEL_CATEGORIES = new Set(["رفتوآمد", "سفر", "حملونقل"]);
const SHOPPING_CATEGORIES = new Set(["خرید"]);

/** Whole titles that are an activity in themselves. */
const WHOLE: Record<string, string> = {
  ورزش: "ورزش کردم",
  باشگاه: "باشگاه رفتم",
  پیادهروی: "پیاده‌روی کردم",
  دویدن: "دویدم",
  شنا: "شنا کردم",
  یوگا: "یوگا کردم",
  مدیتیشن: "مدیتیشن کردم",
  مطالعه: "مطالعه کردم",
  استراحت: "استراحت کردم",
  آشپزی: "آشپزی کردم",
  نظافت: "نظافت کردم",
  خرید: "خرید کردم",
};

interface Opener {
  /** The word(s) the title opens with (an ezafe — «مطالعهٔ»، «مطالعه‌ی» — is accepted after them). */
  words: string[];
  /** Builds the clause from what follows the opener. */
  say: (rest: string) => string;
  travel?: boolean;
  /** What must follow the opener for the rule to apply (a trip needs «از …» or «به …»). */
  needs?: RegExp;
}

const PLACE = /^(از|به)\s/;

const OPENERS: Opener[] = [
  { words: ["حرکت"], needs: PLACE, travel: true, say: (r) => `${r} حرکت کردم` },
  { words: ["رفتن", "رفت"], needs: PLACE, travel: true, say: (r) => `${r} رفتم` },
  { words: ["برگشتن", "برگشت", "بازگشت"], needs: PLACE, travel: true, say: (r) => `${r} برگشتم` },
  { words: ["سفر"], needs: PLACE, travel: true, say: (r) => `${r} سفر کردم` },
  { words: ["خرید"], say: (r) => `${r} خریدم` },
  { words: ["مطالعه"], say: (r) => `${r} را مطالعه کردم` },
  { words: ["خواندن"], say: (r) => `${r} را خواندم` },
  { words: ["نوشتن"], say: (r) => `${r} را نوشتم` },
  { words: ["تماشای", "تماشا"], say: (r) => `${r} را تماشا کردم` },
  { words: ["دیدن"], say: (r) => `${r} را دیدم` },
  { words: ["پرداخت"], say: (r) => `${r} را پرداخت کردم` },
  { words: ["تماس"], needs: /^با\s/, say: (r) => `${r} تماس گرفتم` },
  { words: ["جلسه"], needs: /^با\s/, say: (r) => `${r} جلسه داشتم` },
  { words: ["دیدار", "ملاقات"], needs: /^با\s/, say: (r) => `${r} دیدار کردم` },
];

/** «مطالعهٔ کتاب»، «مطالعه‌ی کتاب»، «مطالعه کتاب» → «کتاب». */
function after(title: string, word: string): string | null {
  if (!title.startsWith(word)) return null;
  const tail = title.slice(word.length);
  const m = tail.match(new RegExp("^(?:" + ZWNJ + "?ی|ٔ|ۀ)?\\s+(.+)$"));
  return m ? m[1].trim() : null;
}

export function naturalPhrase(rawTitle: string, category: string | null): NaturalPhrase | null {
  const title = tidy(rawTitle);
  if (!title) return null;

  const whole = WHOLE[squash(title)];
  if (whole) return { text: whole, travel: false };

  for (const opener of OPENERS) {
    for (const word of opener.words) {
      const rest = after(title, word);
      if (!rest) continue;
      if (opener.needs && !opener.needs.test(rest)) continue;
      return { text: opener.say(rest), travel: !!opener.travel };
    }
  }

  const cat = category ? squash(tidy(category)) : "";
  if (TRAVEL_CATEGORIES.has(cat)) {
    if (PLACE.test(title)) return { text: `${title} رفتم`, travel: true };
    // «تهران به قم»: a from-to pair without the «از».
    if (/^\S+(\s\S+)?\sبه\s\S+/.test(title)) return { text: `از ${title} رفتم`, travel: true };
    return null;
  }
  if (SHOPPING_CATEGORIES.has(cat)) return { text: `«${title}» خریدم`, travel: false };

  return null;
}
