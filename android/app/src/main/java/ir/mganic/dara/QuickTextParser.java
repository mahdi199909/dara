package ir.mganic.dara;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * One typed line ("شکلات یک میلیونی", "فردا ساعت ۵ عصر دندان‌پزشک", "قسط ماشین ۱۲ ماهه ۵ میلیونی",
 * "عادت ورزش انجام شد") read into signals — what kind of thing it is (a task/event/expense/income entry,
 * an installment plan, paying an installment, a habit check-in, a new habit, a note, a savings goal, a
 * project, a budget or a reminder) and the words that say which: title, length, amount, day, time, hints.
 *
 * This is a port of src/lib/captureSignals.ts, step for step, and it has to stay one: what this class
 * understands is what the widget's preview shows, and the very same signals are what the app saves when
 * it drains the queue (src/local/widgetQueue.ts) — so a line means the same here as in the app's own
 * «ثبت...» field. The patterns in the grammar block below are checked against that file's
 * CAPTURE_GRAMMAR by src/lib/captureSignals.test.ts; change one and the test says where the other is.
 * Nothing here knows the clock: «فردا» leaves as a signal and the app turns it into a date, using the
 * moment the line was typed. (This native popup has no route to the JS runtime, hence a second copy of
 * this logic rather than a shared one.)
 */
final class QuickTextParser {

    // ---- grammar: the same patterns as CAPTURE_GRAMMAR in src/lib/captureSignals.ts (checked by its test) ----
    private static final String SP = "[\\s\\u200c]";
    private static final String SEP = "[\\s\\u200c:：\\-،,]";
    private static final String SCALE = "میلیارد|میلیون|هزار";
    private static final String TOMAN = "توم[ا]?ن";
    private static final String KW_NOTE = "یادداشت|نوت";
    private static final String KW_PROJECT_NEW = "پروژه(?:[\\s\\u200c]*ی)?[\\s\\u200c]*(?:جدید|تازه)";
    private static final String KW_HABIT_NEW = "عادت[\\s\\u200c]*(?:جدید|تازه)";
    private static final String KW_HABIT = "عادت";
    private static final String KW_BUDGET = "بودجه";
    private static final String KW_GOAL = "هدف(?:[\\s\\u200c]*گذاری)?";
    private static final String KW_REMINDER = "یادآوری|یادآور|یادم[\\s\\u200c]*(?:باشه|باشد|بنداز)|به[\\s\\u200c]*یادم[\\s\\u200c]*(?:بنداز|بیار)";
    private static final String KW_INSTALLMENT = "اقساط|قسط";
    private static final String KW_PAY = "پرداخت|پرداختم|دادم|زدم|واریز|کارسازی|تسویه";
    private static final String KW_INCOME = "درآمد|دریافت|دریافتی|حقوق|فروختم|فروش|عیدی|پاداش|سود";
    private static final String KW_EVENT = "جلسه|رویداد|قرار[\\s\\u200c]*ملاقات|وقت[\\s\\u200c]*(?:دکتر|دندان|آرایشگاه)";
    private static final String KW_DONE = "انجام[\\s\\u200c]*(?:شد|دادم)|کردم|زدم|شد|✓|✔|✅|تیک";
    private static final String KW_TOTAL = "وام|کل|جمعا|جمعاً|مجموع|قیمت|ارزش";
    private static final String KW_PER_INSTALLMENT = "هر[\\s\\u200c]*ماه|ماهانه|ماهیانه|ماهی|قسطی";
    private static final String KW_PERIOD_LATE = "بعدازظهر|بعد[\\s\\u200c]*از[\\s\\u200c]*ظهر|عصر|شب";
    private static final String KW_PERIOD_ALL = "صبح|ظهر|بعدازظهر|بعد[\\s\\u200c]*از[\\s\\u200c]*ظهر|عصر|شب";
    private static final String MONTHS = "فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند";

    // A word starts here: the beginning of the text, or after whitespace / a zero-width joiner. Captured as
    // group 1 of every pattern that uses it, so a match can be trimmed back to the word itself.
    private static final String WORD_START = "(^|[\\s\\u200c])";
    // «میلیونی», «تومانی»: the possessive ی glued to an amount — part of the amount, never of the title.
    private static final String YA = "(ی(?=[\\s.,،؛:!?؟)]|$))?";
    private static final String END_OF_WORD = "(?=" + SP + "|[.,،؛:!?؟)]|$)";
    private static final String PERIOD = "(" + KW_PERIOD_ALL + ")";

    static final class Signals {
        String kind;
        String title = "";
        Integer durationMinutes;
        Long amount;
        boolean income;
        String dayType; // "REL", "WEEKDAY", "JALALI", or null when the line named no day
        int dayValue; // REL: -2..2 days from today; WEEKDAY: 0 (Sunday) .. 6 (Saturday)
        Integer jalaliYear; // JALALI: null = this Jalali year
        int jalaliMonth;
        int jalaliDay;
        Integer timeHour; // null when the line named no time
        int timeMinute;
        String categoryHint;
        String projectHint;
        boolean eventCue;
        Integer count;
        boolean perInstallment;
        Integer dueDay;
        String hint;

        Signals(String kind) {
            this.kind = kind;
        }

        /** The shape src/lib/captureSignalsSchema.ts reads: only what was found; anything left out is blank. */
        JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("v", 2);
            o.put("kind", kind);
            o.put("title", title);
            if (durationMinutes != null) o.put("durationMinutes", durationMinutes.intValue());
            if (amount != null) o.put("amount", amount.longValue());
            if (income) o.put("income", true);
            if (dayType != null) {
                JSONObject day = new JSONObject();
                day.put("type", dayType);
                if ("REL".equals(dayType)) {
                    day.put("offset", dayValue);
                } else if ("WEEKDAY".equals(dayType)) {
                    day.put("day", dayValue);
                } else {
                    day.put("jy", jalaliYear == null ? JSONObject.NULL : (Object) jalaliYear);
                    day.put("jm", jalaliMonth);
                    day.put("jd", jalaliDay);
                }
                o.put("day", day);
            }
            if (timeHour != null) {
                JSONObject time = new JSONObject();
                time.put("h", timeHour.intValue());
                time.put("m", timeMinute);
                o.put("time", time);
            }
            if (categoryHint != null) o.put("categoryHint", categoryHint);
            if (projectHint != null) o.put("projectHint", projectHint);
            if (eventCue) o.put("eventCue", true);
            if (count != null) o.put("count", count.intValue());
            if (perInstallment) o.put("perInstallment", true);
            if (dueDay != null) o.put("dueDay", dueDay.intValue());
            if (hint != null) o.put("hint", hint);
            return o;
        }
    }

    // Same set as captureSignals.ts's WASTE_CATEGORY_KEYWORDS — kept in sync by hand.
    private static final Map<String, String> WASTE_CATEGORY_KEYWORDS = new LinkedHashMap<>();
    static {
        WASTE_CATEGORY_KEYWORDS.put("اینستاگرام", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("instagram", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("یوتیوب", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("youtube", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("تلگرام", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("telegram", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("توییتر", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("twitter", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("ایکس", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("تیک تاک", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("تیک‌تاک", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("tiktok", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("فیسبوک", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("facebook", "شبکه‌های اجتماعی");
        WASTE_CATEGORY_KEYWORDS.put("گیم", "سرگرمی");
        WASTE_CATEGORY_KEYWORDS.put("گیمینگ", "سرگرمی");
        WASTE_CATEGORY_KEYWORDS.put("gaming", "سرگرمی");
    }

    // Same as captureSignals.ts's NUMBER_WORDS — deliberately no teens (یازده..نوزده): several share a leading
    // substring with a smaller word here ("دو" inside "دوازده"), and a spoken amount almost never needs one.
    private static final Map<String, Integer> NUMBER_WORDS = new LinkedHashMap<>();
    static {
        NUMBER_WORDS.put("یک", 1);
        NUMBER_WORDS.put("دو", 2);
        NUMBER_WORDS.put("سه", 3);
        NUMBER_WORDS.put("چهار", 4);
        NUMBER_WORDS.put("پنج", 5);
        NUMBER_WORDS.put("شش", 6);
        NUMBER_WORDS.put("هفت", 7);
        NUMBER_WORDS.put("هشت", 8);
        NUMBER_WORDS.put("نه", 9);
        NUMBER_WORDS.put("ده", 10);
        NUMBER_WORDS.put("بیست", 20);
        NUMBER_WORDS.put("سی", 30);
        NUMBER_WORDS.put("چهل", 40);
        NUMBER_WORDS.put("پنجاه", 50);
        NUMBER_WORDS.put("شصت", 60);
        NUMBER_WORDS.put("هفتاد", 70);
        NUMBER_WORDS.put("هشتاد", 80);
        NUMBER_WORDS.put("نود", 90);
        NUMBER_WORDS.put("صد", 100);
    }

    // The hours of the clock, said aloud («ساعت یازده») — the teens are fine here.
    private static final Map<String, Integer> HOUR_WORDS = new LinkedHashMap<>();
    static {
        HOUR_WORDS.put("یک", 1);
        HOUR_WORDS.put("دو", 2);
        HOUR_WORDS.put("سه", 3);
        HOUR_WORDS.put("چهار", 4);
        HOUR_WORDS.put("پنج", 5);
        HOUR_WORDS.put("شش", 6);
        HOUR_WORDS.put("هفت", 7);
        HOUR_WORDS.put("هشت", 8);
        HOUR_WORDS.put("نه", 9);
        HOUR_WORDS.put("ده", 10);
        HOUR_WORDS.put("یازده", 11);
        HOUR_WORDS.put("دوازده", 12);
    }

    // Longest word first — so «دوازده» is tried before the «دو» it starts with.
    private static String joinByLength(Map<String, Integer> words) {
        List<String> keys = new ArrayList<>(words.keySet());
        Collections.sort(keys, new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                return b.length() - a.length();
            }
        });
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < keys.size(); i++) {
            if (i > 0) sb.append('|');
            sb.append(keys.get(i));
        }
        return sb.toString();
    }

    private static final String NUMBER_WORD_PATTERN = joinByLength(NUMBER_WORDS);
    private static final String HOUR_WORD_PATTERN = joinByLength(HOUR_WORDS);

    // -- durations ---------------------------------------------------------------------------------
    private static final Pattern DUR_HALF_QUARTER = Pattern.compile(WORD_START + "(نیم|ربع)" + SP + "*ساعت");
    private static final Pattern DUR_HOURS = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*ساعت(?:\\s*و\\s*(نیم|ربع|\\d+\\s*دقیقه))?");
    private static final Pattern DUR_WORD_HOURS =
        Pattern.compile(WORD_START + "(" + NUMBER_WORD_PATTERN + ")" + SP + "*ساعت(?:" + SP + "*و" + SP + "*(نیم|ربع))?");
    private static final Pattern DUR_WORD_MINUTES = Pattern.compile(WORD_START + "(" + NUMBER_WORD_PATTERN + ")" + SP + "*دقیقه");
    private static final Pattern DUR_HOURS_LATIN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*h\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern DUR_MINUTES = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*دقیقه");
    private static final Pattern DUR_MINUTES_LATIN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*m\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern DUR_DAYS = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*روز");
    private static final Pattern DUR_DAYS_LATIN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*d\\b", Pattern.CASE_INSENSITIVE);

    // -- amounts -----------------------------------------------------------------------------------
    private static final Pattern AMT_SCALE = Pattern.compile("(\\d+(?:[.,]\\d+)*)\\s*(" + SCALE + ")\\s*(" + TOMAN + ")?" + YA);
    private static final Pattern AMT_WORD_SCALE =
        Pattern.compile(WORD_START + "(" + NUMBER_WORD_PATTERN + ")\\s*(" + SCALE + ")\\s*(" + TOMAN + ")?" + YA);
    private static final Pattern AMT_GROUPED = Pattern.compile("(\\d{1,3}(?:,\\d{3})+)\\s*(" + TOMAN + ")?" + YA);
    private static final Pattern AMT_TOMAN = Pattern.compile("(\\d+)\\s*" + TOMAN + YA);
    private static final Pattern AMT_BARE = Pattern.compile(WORD_START + "(\\d{5,})(?=[\\s]|$)");
    private static final Pattern AMT_PREFIX = Pattern.compile("^([\\d,.]+)\\s*(" + SCALE + ")?");

    // -- days --------------------------------------------------------------------------------------
    private static final String[] REL_WORDS = { "پس[\\s\\u200c]*فردا", "فردا", "دیروز", "پریروز", "امروز" };
    private static final int[] REL_OFFSETS = { 2, 1, -1, -2, 0 };
    private static final Pattern[] REL_PATTERNS = new Pattern[REL_WORDS.length];
    static {
        for (int i = 0; i < REL_WORDS.length; i++) {
            REL_PATTERNS[i] = Pattern.compile(WORD_START + "(?:" + REL_WORDS[i] + ")" + END_OF_WORD);
        }
    }
    private static final Pattern DAY_JALALI_NUMERIC = Pattern.compile("(^|[^\\d])(1[34]\\d\\d)[/-](\\d{1,2})[/-](\\d{1,2})(?![\\d])");
    private static final Pattern DAY_JALALI_NAMED = Pattern.compile(
        WORD_START + "(\\d{1,2})" + SP + "*(?:ام" + SP + "+)?(" + MONTHS + ")(?:" + SP + "+ماه)?(?:" + SP + "+(1[34]\\d\\d))?" + END_OF_WORD);
    // Longest first, for the same reason as captureSignals.ts's WEEKDAYS.
    private static final String[] WEEKDAY_WORDS = {
        "چهارشنبه", "پنج[\\s\\u200c]*شنبه", "سه[\\s\\u200c]*شنبه", "یک[\\s\\u200c]*شنبه", "دو[\\s\\u200c]*شنبه", "جمعه", "شنبه"
    };
    private static final int[] WEEKDAY_NUMBERS = { 3, 4, 2, 0, 1, 5, 6 };
    private static final Pattern[] WEEKDAY_PATTERNS = new Pattern[WEEKDAY_WORDS.length];
    static {
        for (int i = 0; i < WEEKDAY_WORDS.length; i++) {
            WEEKDAY_PATTERNS[i] = Pattern.compile(WORD_START + "(?:" + WEEKDAY_WORDS[i] + ")" + END_OF_WORD);
        }
    }
    private static final String[] MONTH_NAMES = {
        "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
    };

    // -- times of day ------------------------------------------------------------------------------
    private static final Pattern TIME_DIGITS = Pattern.compile(
        "(?:" + PERIOD + SP + "*)?ساعت" + SP + "*(\\d{1,2})(?![\\d])(?::(\\d{2}))?(?:" + SP + "*و" + SP + "*(نیم|ربع))?(?:" + SP + "*" + PERIOD + ")?");
    private static final Pattern TIME_WORDS = Pattern.compile(
        "(?:" + PERIOD + SP + "*)?ساعت" + SP + "*(" + HOUR_WORD_PATTERN + ")(?:" + SP + "*و" + SP + "*(نیم|ربع))?(?:" + SP + "*" + PERIOD + ")?");
    private static final Pattern TIME_COLON = Pattern.compile("\\b(\\d{1,2}):(\\d{2})\\b");
    private static final Pattern TIME_TAIL_PERIOD = Pattern.compile("^" + SP + "*" + PERIOD);
    private static final Pattern TIME_HOUR_PERIOD = Pattern.compile(WORD_START + "(\\d{1,2})" + SP + "*" + PERIOD);
    private static final Pattern PERIOD_LATE = Pattern.compile("^(?:" + KW_PERIOD_LATE + ")$");

    // -- everything else ---------------------------------------------------------------------------
    private static final Pattern PROJECT_HINT = Pattern.compile(
        "(?:" + WORD_START + "(?:برای|از|توی|در|واسه)" + SP + "+)?پروژه[ی\\u0650\\u200c]?" + SP + "+([^,،]+?)\\s*$");
    private static final Pattern PURCHASE = Pattern.compile("خرید");
    private static final Pattern NOTE_DAY = Pattern.compile("^(دیروز|پریروز)\\s*[:：]\\s*");
    private static final Pattern INSTALLMENT_COUNT = Pattern.compile(
        "(\\d{1,3})" + SP + "*(?:تا" + SP + "*)?(?:قسط(?:ی)?|ماهه|ماه)" + END_OF_WORD);
    private static final Pattern INSTALLMENT_DUE_DAY = Pattern.compile(
        "(?:روز|سررسید)" + SP + "*(\\d{1,2})(?:" + SP + "*ام)?(?:" + SP + "*هر" + SP + "*ماه)?");
    private static final Pattern TRAILING_PREPOSITION = Pattern.compile("(?:" + SP + "+(?:از|برای|به|در|توی|واسه|با))+$");
    private static final Pattern TRAILING_DONE = Pattern.compile("(?:" + SP + "+(?:انجام" + SP + "+دادم|انجام" + SP + "+شد|کردم))+$");
    private static final Pattern EXTRA_WHITESPACE = Pattern.compile("\\s{2,}");
    private static final Pattern AND_WORD = Pattern.compile("\\s+و\\s+");
    private static final Pattern COMMAS = Pattern.compile("[،,]+");
    private static final Pattern HINT_PUNCTUATION = Pattern.compile("[،,:：\\-]+");

    private static final String[] FILLER = { "رو", "را", "این", "امروز", "دیروز", "فردا", "هم", "ام", "کردم", "شد" };

    private static final String PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
    private static final String ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

    private QuickTextParser() {}

    // ---- small helpers ---------------------------------------------------------------------------

    /** The text with [start, end) taken out and a single space left in its place, ends trimmed — captureSignals.ts's strip. */
    private static String strip(String text, int start, int end) {
        return (text.substring(0, start) + " " + text.substring(end)).trim();
    }

    private static String collapse(String text) {
        return EXTRA_WHITESPACE.matcher(text).replaceAll(" ").trim();
    }

    /** Digits to ASCII, look-alike Arabic letters to Persian, exotic spaces to a plain one — one character in, one out. */
    private static String normalize(String text) {
        StringBuilder sb = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            int p = PERSIAN_DIGITS.indexOf(c);
            if (p >= 0) {
                sb.append((char) ('0' + p));
                continue;
            }
            int a = ARABIC_INDIC_DIGITS.indexOf(c);
            if (a >= 0) {
                sb.append((char) ('0' + a));
                continue;
            }
            if (c == 0x00A0 || (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF) {
                sb.append(' ');
            } else if (c == 0x064A) {
                sb.append((char) 0x06CC); // ي -> ی
            } else if (c == 0x0643) {
                sb.append((char) 0x06A9); // ك -> ک
            } else if (c == 0x066C) {
                sb.append(','); // the Arabic thousands separator
            } else if (c == 0x066B) {
                sb.append('.'); // the Arabic decimal separator
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /** Direction marks and spaces a keyboard or a paste can put in front of a line. */
    private static String stripLeadingMarks(String text) {
        int i = 0;
        while (i < text.length()) {
            char c = text.charAt(i);
            boolean mark = c == 0x200E || c == 0x200F || (c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069);
            boolean space = Character.isWhitespace(c) || Character.isSpaceChar(c) || c == 0xFEFF;
            if (!mark && !space) break;
            i++;
        }
        return text.substring(i);
    }

    private static boolean has(String text, String pattern) {
        return Pattern.compile(WORD_START + "(?:" + pattern + ")" + END_OF_WORD).matcher(text).find();
    }

    /** The words of `text` with the filler a hint should not carry (the verbs, «رو», «را») taken out. */
    private static String hintFrom(String text, String... patterns) {
        String out = text;
        for (String p : patterns) {
            out = Pattern.compile(WORD_START + "(?:" + p + ")" + END_OF_WORD).matcher(out).replaceAll("$1 ");
        }
        out = HINT_PUNCTUATION.matcher(out).replaceAll(" ");
        return collapse(out);
    }

    private static String[] withFiller(String... first) {
        String[] all = new String[first.length + FILLER.length];
        System.arraycopy(first, 0, all, 0, first.length);
        System.arraycopy(FILLER, 0, all, first.length, FILLER.length);
        return all;
    }

    /** Where the content of a line that starts with `keyword` begins, or -1 when it does not start with it. */
    private static int leading(String text, String keyword) {
        Matcher m = Pattern.compile("^(?:" + keyword + ")(?=" + SEP + "|$)").matcher(text);
        if (!m.find()) return -1;
        Matcher rest = Pattern.compile("^" + SEP + "*").matcher(text.substring(m.end()));
        return m.end() + (rest.find() ? rest.end() : 0);
    }

    // ---- durations -------------------------------------------------------------------------------

    private static final class DurationMatch {
        final int minutes;
        final String remaining;

        DurationMatch(int minutes, String remaining) {
            this.minutes = minutes;
            this.remaining = remaining;
        }
    }

    private static int roundedMinutes(String number, double perUnit) {
        return (int) Math.round(Double.parseDouble(number) * perUnit);
    }

    private static DurationMatch extractDuration(String text) {
        Matcher m = DUR_HALF_QUARTER.matcher(text);
        if (m.find()) {
            return new DurationMatch("نیم".equals(m.group(2)) ? 30 : 15, strip(text, m.start() + m.group(1).length(), m.end()));
        }

        m = DUR_HOURS.matcher(text);
        if (m.find()) {
            int minutes = roundedMinutes(m.group(1), 60);
            String extra = m.group(2);
            if ("نیم".equals(extra)) {
                minutes += 30;
            } else if ("ربع".equals(extra)) {
                minutes += 15;
            } else if (extra != null) {
                Matcher digits = Pattern.compile("\\d+").matcher(extra);
                if (digits.find()) minutes += Integer.parseInt(digits.group());
            }
            return new DurationMatch(minutes, strip(text, m.start(), m.end()));
        }

        m = DUR_WORD_HOURS.matcher(text);
        if (m.find()) {
            int minutes = NUMBER_WORDS.get(m.group(2)) * 60;
            if ("نیم".equals(m.group(3))) {
                minutes += 30;
            } else if ("ربع".equals(m.group(3))) {
                minutes += 15;
            }
            return new DurationMatch(minutes, strip(text, m.start() + m.group(1).length(), m.end()));
        }
        m = DUR_WORD_MINUTES.matcher(text);
        if (m.find()) {
            return new DurationMatch(NUMBER_WORDS.get(m.group(2)), strip(text, m.start() + m.group(1).length(), m.end()));
        }

        m = DUR_HOURS_LATIN.matcher(text);
        if (m.find()) return new DurationMatch(roundedMinutes(m.group(1), 60), strip(text, m.start(), m.end()));

        m = DUR_MINUTES.matcher(text);
        if (m.find()) return new DurationMatch(roundedMinutes(m.group(1), 1), strip(text, m.start(), m.end()));

        m = DUR_MINUTES_LATIN.matcher(text);
        if (m.find()) return new DurationMatch(roundedMinutes(m.group(1), 1), strip(text, m.start(), m.end()));

        m = DUR_DAYS.matcher(text);
        if (m.find()) return new DurationMatch(roundedMinutes(m.group(1), 24 * 60), strip(text, m.start(), m.end()));

        m = DUR_DAYS_LATIN.matcher(text);
        if (m.find()) return new DurationMatch(roundedMinutes(m.group(1), 24 * 60), strip(text, m.start(), m.end()));

        return null;
    }

    // ---- amounts ---------------------------------------------------------------------------------

    private static final class AmountMatch {
        final long amount;
        final String remaining;
        /** Written «X ی» — «یک میلیونی»: what ONE of something costs. */
        final boolean possessive;

        AmountMatch(long amount, String remaining, boolean possessive) {
            this.amount = amount;
            this.remaining = remaining;
            this.possessive = possessive;
        }
    }

    /** Same as money.ts's parseAmount — "۱.۵ میلیون" -> 1,500,000, a bare "۸۰۰" -> 800. `raw` is already ASCII digits. */
    private static Long parseAmount(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return null;
        Matcher m = AMT_PREFIX.matcher(s);
        if (!m.find()) return null;

        double num;
        try {
            num = Double.parseDouble(m.group(1).replace(",", ""));
        } catch (NumberFormatException e) {
            return null;
        }

        String suffix = m.group(2);
        long multiplier = 1;
        if ("هزار".equals(suffix)) multiplier = 1_000L;
        else if ("میلیون".equals(suffix)) multiplier = 1_000_000L;
        else if ("میلیارد".equals(suffix)) multiplier = 1_000_000_000L;

        return Math.round(num * multiplier);
    }

    // Money always has a mark that says so — a scale word, the currency word, a comma-grouped number, or a
    // plain number of five digits or more — so it never collides with a bare length or count like the «۲» in
    // «۲ ساعت». Tried in the same order as captureSignals.ts's extractAmount.
    private static AmountMatch extractAmount(String text) {
        Matcher m = AMT_SCALE.matcher(text);
        if (m.find()) {
            Long amount = parseAmount(m.group(1) + " " + m.group(2));
            if (amount != null) return new AmountMatch(amount.longValue(), strip(text, m.start(), m.end()), m.group(4) != null);
        }

        m = AMT_WORD_SCALE.matcher(text);
        if (m.find()) {
            Integer word = NUMBER_WORDS.get(m.group(2));
            Long amount = word == null ? null : parseAmount(word + " " + m.group(3));
            if (amount != null) return new AmountMatch(amount.longValue(), strip(text, m.start() + m.group(1).length(), m.end()), m.group(5) != null);
        }

        m = AMT_GROUPED.matcher(text);
        if (m.find()) {
            Long amount = parseAmount(m.group(1));
            if (amount != null) return new AmountMatch(amount.longValue(), strip(text, m.start(), m.end()), m.group(3) != null);
        }

        m = AMT_TOMAN.matcher(text);
        if (m.find()) {
            Long amount = parseAmount(m.group(1));
            if (amount != null) return new AmountMatch(amount.longValue(), strip(text, m.start(), m.end()), m.group(2) != null);
        }

        m = AMT_BARE.matcher(text);
        if (m.find()) {
            Long amount = parseAmount(m.group(2));
            if (amount != null) return new AmountMatch(amount.longValue(), strip(text, m.start() + m.group(1).length(), m.end()), false);
        }

        return null;
    }

    // ---- days and times --------------------------------------------------------------------------

    private static final class DayMatch {
        final String type;
        final int value;
        final Integer year;
        final int month;
        final int day;
        final String remaining;

        DayMatch(String type, int value, Integer year, int month, int day, String remaining) {
            this.type = type;
            this.value = value;
            this.year = year;
            this.month = month;
            this.day = day;
            this.remaining = remaining;
        }
    }

    private static DayMatch extractDay(String text) {
        for (int i = 0; i < REL_PATTERNS.length; i++) {
            Matcher m = REL_PATTERNS[i].matcher(text);
            if (m.find()) return new DayMatch("REL", REL_OFFSETS[i], null, 0, 0, strip(text, m.start() + m.group(1).length(), m.end()));
        }

        // «۱۴۰۵/۰۷/۲۵», «1405-7-25» — a Jalali date; a year like 2026 is left for a Gregorian one.
        Matcher m = DAY_JALALI_NUMERIC.matcher(text);
        if (m.find()) {
            int jm = Integer.parseInt(m.group(3));
            int jd = Integer.parseInt(m.group(4));
            if (jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31) {
                return new DayMatch("JALALI", 0, Integer.valueOf(Integer.parseInt(m.group(2))), jm, jd, strip(text, m.start() + m.group(1).length(), m.end()));
            }
        }

        // «۲۵ مهر», «۲۵ مهر ۱۴۰۵», «۲۵ام مهر ماه»
        m = DAY_JALALI_NAMED.matcher(text);
        if (m.find()) {
            int jd = Integer.parseInt(m.group(2));
            if (jd >= 1 && jd <= 31) {
                int jm = 0;
                for (int i = 0; i < MONTH_NAMES.length; i++) {
                    if (MONTH_NAMES[i].equals(m.group(3))) jm = i + 1;
                }
                Integer jy = m.group(4) != null ? Integer.valueOf(Integer.parseInt(m.group(4))) : null;
                return new DayMatch("JALALI", 0, jy, jm, jd, strip(text, m.start() + m.group(1).length(), m.end()));
            }
        }

        for (int i = 0; i < WEEKDAY_PATTERNS.length; i++) {
            Matcher w = WEEKDAY_PATTERNS[i].matcher(text);
            if (w.find()) return new DayMatch("WEEKDAY", WEEKDAY_NUMBERS[i], null, 0, 0, strip(text, w.start() + w.group(1).length(), w.end()));
        }

        return null;
    }

    private static final class TimeMatch {
        final int hour;
        final int minute;
        final String remaining;

        TimeMatch(int hour, int minute, String remaining) {
            this.hour = hour;
            this.minute = minute;
            this.remaining = remaining;
        }
    }

    /** Moves an hour into the period of the day the person named: «۵ عصر» is 17, «۱۱ شب» is 23, «۱ ظهر» is 13. */
    private static int hourInPeriod(int h, String period) {
        if (period == null) return h;
        if (PERIOD_LATE.matcher(period).find()) {
            if ("شب".equals(period)) return (h >= 6 && h < 12) ? h + 12 : (h == 12 ? 0 : h);
            return h < 12 ? h + 12 : h;
        }
        if ("ظهر".equals(period)) return (h >= 1 && h <= 5) ? h + 12 : h;
        return h;
    }

    private static String firstNonNull(String a, String b) {
        return a != null ? a : b;
    }

    private static TimeMatch extractTime(String text) {
        // «ساعت ۱۰», «ساعت ۱۰:۳۰», «ساعت ۵ و نیم», «ساعت ۵ عصر», «عصر ساعت ۵»
        Matcher m = TIME_DIGITS.matcher(text);
        if (m.find()) {
            int h = Integer.parseInt(m.group(2));
            int min = m.group(3) != null ? Integer.parseInt(m.group(3)) : 0;
            if ("نیم".equals(m.group(4))) min = 30;
            else if ("ربع".equals(m.group(4))) min = 15;
            if (h <= 24 && min < 60) {
                return new TimeMatch(hourInPeriod(h, firstNonNull(m.group(1), m.group(5))) % 24, min, strip(text, m.start(), m.end()));
            }
        }

        // «ساعت ده», «ساعت دوازده و نیم»
        m = TIME_WORDS.matcher(text);
        if (m.find()) {
            int h = HOUR_WORDS.get(m.group(2));
            int min = "نیم".equals(m.group(3)) ? 30 : ("ربع".equals(m.group(3)) ? 15 : 0);
            return new TimeMatch(hourInPeriod(h, firstNonNull(m.group(1), m.group(4))) % 24, min, strip(text, m.start(), m.end()));
        }

        // «10:00»
        m = TIME_COLON.matcher(text);
        if (m.find()) {
            int h = Integer.parseInt(m.group(1));
            int min = Integer.parseInt(m.group(2));
            if (h <= 24 && min < 60) {
                int end = m.end();
                Matcher tail = TIME_TAIL_PERIOD.matcher(text.substring(end));
                String period = null;
                if (tail.find()) {
                    period = tail.group(1);
                    end += tail.end();
                }
                return new TimeMatch(hourInPeriod(h, period) % 24, min, strip(text, m.start(), end));
            }
        }

        // «۵ عصر» — an hour with no «ساعت» before it but the period after it
        m = TIME_HOUR_PERIOD.matcher(text);
        if (m.find()) {
            int h = Integer.parseInt(m.group(2));
            if (h >= 1 && h <= 12) {
                return new TimeMatch(hourInPeriod(h, m.group(3)) % 24, 0, strip(text, m.start() + m.group(1).length(), m.end()));
            }
        }

        return null;
    }

    // ---- the rest of an entry --------------------------------------------------------------------

    private static String extractCategoryHint(String text) {
        // Locale.ROOT: a Turkish phone would otherwise lower-case "I" to a dotless ı and never match "instagram".
        String lower = text.toLowerCase(Locale.ROOT);
        for (Map.Entry<String, String> e : WASTE_CATEGORY_KEYWORDS.entrySet()) {
            if (lower.contains(e.getKey().toLowerCase(Locale.ROOT))) return e.getValue();
        }
        return null;
    }

    private static String cleanTitle(String text) {
        String out = AND_WORD.matcher(text).replaceAll(" ");
        out = COMMAS.matcher(out).replaceAll(" ");
        out = EXTRA_WHITESPACE.matcher(out).replaceAll(" ");
        out = TRAILING_PREPOSITION.matcher(out).replaceAll("");
        out = TRAILING_DONE.matcher(out).replaceAll("");
        return out.trim();
    }

    /** ENTRY's own extraction — length, amount, day, time, project, «خرید» — in the order that lets each take its words out before the next looks. */
    private static Signals extractEntry(String text, String kind) {
        Signals s = new Signals(kind);
        String remaining = text;

        DurationMatch duration = extractDuration(remaining);
        if (duration != null) {
            s.durationMinutes = Integer.valueOf(duration.minutes);
            remaining = duration.remaining;
        }

        AmountMatch amount = extractAmount(remaining);
        if (amount != null) {
            s.amount = Long.valueOf(amount.amount);
            remaining = amount.remaining;
        }

        DayMatch day = extractDay(remaining);
        if (day != null) {
            s.dayType = day.type;
            s.dayValue = day.value;
            s.jalaliYear = day.year;
            s.jalaliMonth = day.month;
            s.jalaliDay = day.day;
            remaining = day.remaining;
        }

        TimeMatch time = extractTime(remaining);
        if (time != null) {
            s.timeHour = Integer.valueOf(time.hour);
            s.timeMinute = time.minute;
            remaining = time.remaining;
        }

        Matcher project = PROJECT_HINT.matcher(remaining);
        if (project.find()) {
            String hint = project.group(2).trim();
            if (!hint.isEmpty()) {
                s.projectHint = hint;
                remaining = strip(remaining, project.start(), project.end());
            }
        }

        Matcher purchase = PURCHASE.matcher(remaining);
        boolean hadPurchase = purchase.find();
        if (hadPurchase) remaining = strip(remaining, purchase.start(), purchase.end());

        // A WASTE keyword (اینستاگرام, ...) is a more specific signal than the bare fact of a purchase.
        String categoryHint = extractCategoryHint(text);
        s.categoryHint = categoryHint != null ? categoryHint : (hadPurchase ? "خرید" : null);
        s.income = s.amount != null && has(text, KW_INCOME);
        s.eventCue = has(text, KW_EVENT);
        String title = cleanTitle(remaining);
        s.title = title.isEmpty() ? ("REMINDER".equals(kind) ? "یادآوری" : "بدون عنوان") : title;
        return s;
    }

    // ---- the whole line --------------------------------------------------------------------------

    static Signals parse(String rawInput) {
        // No leading whitespace survives stripLeadingMarks and normalize never changes a length, so index i of
        // `t` is index i of `original` — trimming only ever cuts the end.
        String original = stripLeadingMarks(rawInput == null ? "" : rawInput);
        String t = normalize(original).trim();

        // -- keyword-led lines ---------------------------------------------------------------------
        int at = leading(t, KW_NOTE);
        if (at >= 0) {
            String content = original.substring(at).trim();
            Signals s = new Signals("NOTE");
            Matcher dayWord = NOTE_DAY.matcher(content);
            if (dayWord.find()) {
                s.dayType = "REL";
                s.dayValue = "دیروز".equals(dayWord.group(1)) ? -1 : -2;
                content = content.substring(dayWord.end()).trim();
            }
            if (!content.isEmpty()) {
                s.title = content;
                return s;
            }
        }

        at = leading(t, KW_PROJECT_NEW);
        if (at >= 0) {
            String name = collapse(t.substring(at));
            if (!name.isEmpty()) {
                Signals s = new Signals("PROJECT_CREATE");
                s.title = name;
                return s;
            }
        }

        at = leading(t, KW_HABIT_NEW);
        if (at >= 0) {
            String title = collapse(t.substring(at));
            if (!title.isEmpty()) {
                Signals s = new Signals("HABIT_CREATE");
                s.title = title;
                return s;
            }
        }

        at = leading(t, KW_HABIT);
        if (at >= 0) {
            String rest = t.substring(at);
            // Only today can be ticked off: a check-in is a toggle, and yesterday's state is not known here.
            if (!has(rest, "دیروز|پریروز|فردا|پس[\\s\\u200c]*فردا")) {
                String hint = hintFrom(rest, withFiller(KW_DONE));
                if (!hint.isEmpty()) {
                    Signals s = new Signals("HABIT_CHECKIN");
                    s.hint = hint;
                    return s;
                }
            }
        }

        at = leading(t, KW_BUDGET);
        if (at >= 0) {
            AmountMatch amount = extractAmount(t.substring(at));
            if (amount != null) {
                String hint = hintFrom(amount.remaining, "ماهانه", "ماهیانه", "هر[\\s\\u200c]*ماه", "ماهی", "سقف", TOMAN);
                if (!hint.isEmpty()) {
                    Signals s = new Signals("BUDGET");
                    s.hint = hint;
                    s.amount = Long.valueOf(amount.amount);
                    return s;
                }
            }
        }

        at = leading(t, KW_GOAL);
        if (at >= 0) {
            AmountMatch amount = extractAmount(t.substring(at));
            if (amount != null) {
                String title = hintFrom(amount.remaining, "پس[\\s\\u200c]*انداز", "به[\\s\\u200c]*مبلغ", "مبلغ", TOMAN);
                Signals s = new Signals("SAVINGS_GOAL");
                s.title = title.isEmpty() ? "هدف پس‌انداز" : title;
                s.amount = Long.valueOf(amount.amount);
                return s;
            }
        }

        at = leading(t, KW_REMINDER);
        if (at >= 0) {
            Signals s = extractEntry(t.substring(at), "REMINDER");
            s.income = false;
            s.eventCue = false;
            return s;
        }

        // -- installments --------------------------------------------------------------------------
        // A plan is a count («۱۲ قسط», «۱۲ ماهه») and an amount, in a line that is about installments: it has the
        // word «قسط»/«وام», or the count is written «۱۲ ماهه». Paying one is «قسط» with a payment verb.
        Matcher count = INSTALLMENT_COUNT.matcher(t);
        boolean hasCount = count.find();
        boolean aboutInstallments =
            has(t, KW_INSTALLMENT) || has(t, "وام") || (hasCount && (count.group().contains("قسط") || count.group().contains("ماهه")));
        if (hasCount && aboutInstallments) {
            int n = Integer.parseInt(count.group(1));
            String withoutCount = strip(t, count.start(), count.end());
            AmountMatch amount = extractAmount(withoutCount);
            if (amount != null && n >= 1 && n <= 360) {
                String rest = amount.remaining;
                Signals s = new Signals("INSTALLMENT_PLAN");
                s.count = Integer.valueOf(n);
                s.amount = Long.valueOf(amount.amount);

                // «هر ماه روز ۵», «روز ۵ هر ماه», «سررسید ۵» — the day of the month, not a price per month: it comes
                // out of the line before the line's cues («هر ماه») are read.
                String cues = t;
                Matcher dueInLine = INSTALLMENT_DUE_DAY.matcher(t);
                if (dueInLine.find()) {
                    int d = Integer.parseInt(dueInLine.group(1));
                    if (d >= 1 && d <= 31) {
                        s.dueDay = Integer.valueOf(d);
                        cues = strip(t, dueInLine.start(), dueInLine.end());
                        Matcher dueInRest = INSTALLMENT_DUE_DAY.matcher(rest);
                        if (dueInRest.find()) rest = strip(rest, dueInRest.start(), dueInRest.end());
                    }
                }

                // Is the amount what ONE installment costs, or the whole thing? See captureSignals.ts.
                boolean pricedAsInstallment = amount.possessive || has(cues, KW_PER_INSTALLMENT) || has(withoutCount, KW_INSTALLMENT);
                boolean countedInInstallments = count.group().contains("قسط");
                s.perInstallment = pricedAsInstallment || (countedInInstallments && !has(cues, KW_TOTAL));

                String title = hintFrom(rest, KW_PER_INSTALLMENT, "ثبت", "اضافه", "کن", "بساز", "جدید", TOMAN);
                if ("اقساط".equals(title) || "قسط".equals(title)) title = "";
                s.title = title.isEmpty() ? "قسط" : title;
                return s;
            }
        }

        if (has(t, KW_INSTALLMENT) && has(t, KW_PAY)) {
            Signals s = new Signals("INSTALLMENT_PAY");
            AmountMatch amount = extractAmount(t);
            String base = amount != null ? amount.remaining : t;
            s.hint = hintFrom(base, withFiller(KW_INSTALLMENT, KW_PAY, "کردم", "کرد", "شد", "ثبت", "کن"));
            return s;
        }

        // -- everything else: one entry ------------------------------------------------------------
        return extractEntry(t, "ENTRY");
    }
}
