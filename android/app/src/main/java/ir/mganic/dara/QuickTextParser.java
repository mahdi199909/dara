package ir.mganic.dara;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A free-text line ("شکلات ۱ میلیون تومن", "۲ ساعت رو پروژه کار کردم") into the fields this
 * widget's queue entry can carry: a cleaned title, a duration in minutes, a direct-cost amount in
 * Toman, and a category-name hint the caller matches against the categories it already loaded
 * from WidgetDb. A partial, native port of src/lib/parser.ts (duration + amount + category only —
 * date/time/project hint still deliberately NOT ported: an Activity's queue entry has nowhere for
 * those to go, and widening it further is a separate change). This native popup has no route to
 * the JS/TS runtime (see QuickCaptureActivity's own note), hence a second copy of this logic
 * rather than a shared one.
 */
final class QuickTextParser {

    static final class Result {
        final String title;
        final Integer durationMinutes; // null when the text named none
        final Long amount; // Toman, null when the text named none — see extractAmount
        final String categoryHint; // null when the text named none

        Result(String title, Integer durationMinutes, Long amount, String categoryHint) {
            this.title = title;
            this.durationMinutes = durationMinutes;
            this.amount = amount;
            this.categoryHint = categoryHint;
        }
    }

    // Same set as parser.ts's WASTE_CATEGORY_KEYWORDS — kept in sync by hand (see that file's own
    // comment on why this one isn't stripped from the title the way "خرید" below is).
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

    private static final Pattern DURATION_HOURS =
        Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*ساعت(?:\\s*و\\s*(نیم|\\d+\\s*دقیقه))?");
    private static final Pattern DURATION_HOURS_LATIN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*h\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern DURATION_MINUTES = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*دقیقه");
    private static final Pattern DURATION_MINUTES_LATIN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*m\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern DURATION_DAYS = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*روز");
    private static final Pattern DURATION_DAYS_LATIN = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*d\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern PURCHASE_KEYWORD = Pattern.compile("خرید");
    private static final Pattern EXTRA_WHITESPACE = Pattern.compile("\\s{2,}");
    private static final Pattern AND_WORD = Pattern.compile("\\s+و\\s+");
    private static final Pattern COMMAS = Pattern.compile("[،,]+");

    // Same as money.ts's TOMAN_WORD — both the written ("تومان") and everyday-spoken ("تومن") spelling.
    private static final String TOMAN_WORD = "توم[ا]?ن";
    private static final String SCALE_WORD = "میلیارد|میلیون|هزار";

    // Same set as parser.ts's NUMBER_WORDS — deliberately no teens (یازده..نوزده), same reasoning
    // as that file's own comment: several share a leading substring with a smaller word here
    // ("دو" inside "دوازده"), and a spoken amount almost never needs one anyway.
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

    // Longest word first — same reasoning as parser.ts's own NUMBER_WORD_PATTERN: cheap insurance
    // against one word swallowing a shorter one it starts with, even though the current set has no
    // real overlaps.
    private static final Pattern AMOUNT_DIGITS_SCALE =
        Pattern.compile("(\\d+(?:[.,]\\d+)*)\\s*(" + SCALE_WORD + ")\\s*(" + TOMAN_WORD + ")?");
    private static final Pattern AMOUNT_WORD_SCALE;
    static {
        List<String> words = new ArrayList<>(NUMBER_WORDS.keySet());
        Collections.sort(words, (a, b) -> b.length() - a.length());
        String wordPattern = String.join("|", words);
        AMOUNT_WORD_SCALE = Pattern.compile("(" + wordPattern + ")\\s*(" + SCALE_WORD + ")\\s*(" + TOMAN_WORD + ")?");
    }
    private static final Pattern AMOUNT_COMMA_GROUPED = Pattern.compile("(\\d{1,3}(?:,\\d{3})+)\\s*(" + TOMAN_WORD + ")?");
    private static final Pattern AMOUNT_BARE_TOMAN = Pattern.compile("(\\d+)\\s*" + TOMAN_WORD);
    private static final Pattern AMOUNT_SCALE_PREFIX = Pattern.compile("^([\\d,.]+)\\s*(" + SCALE_WORD + ")?");

    private QuickTextParser() {}

    /** Removes the matched span from `text`, same as parser.ts's stripMatch: replaces it with a
     * single space (so words on either side don't get glued together) and trims the ends. */
    private static String strip(String text, Matcher m) {
        return (text.substring(0, m.start()) + " " + text.substring(m.end())).trim();
    }

    private static final class DurationMatch {
        final int minutes;
        final String remaining;
        DurationMatch(int minutes, String remaining) { this.minutes = minutes; this.remaining = remaining; }
    }

    private static DurationMatch extractDuration(String text) {
        Matcher m = DURATION_HOURS.matcher(text);
        if (m.find()) {
            int minutes = Math.round(Float.parseFloat(m.group(1)) * 60);
            String extra = m.group(2);
            if ("نیم".equals(extra)) {
                minutes += 30;
            } else if (extra != null) {
                Matcher mm = Pattern.compile("\\d+").matcher(extra);
                if (mm.find()) minutes += Integer.parseInt(mm.group());
            }
            return new DurationMatch(minutes, strip(text, m));
        }
        m = DURATION_HOURS_LATIN.matcher(text);
        if (m.find()) return new DurationMatch(Math.round(Float.parseFloat(m.group(1)) * 60), strip(text, m));

        m = DURATION_MINUTES.matcher(text);
        if (m.find()) return new DurationMatch(Math.round(Float.parseFloat(m.group(1))), strip(text, m));
        m = DURATION_MINUTES_LATIN.matcher(text);
        if (m.find()) return new DurationMatch(Math.round(Float.parseFloat(m.group(1))), strip(text, m));

        m = DURATION_DAYS.matcher(text);
        if (m.find()) return new DurationMatch(Math.round(Float.parseFloat(m.group(1)) * 24 * 60), strip(text, m));
        m = DURATION_DAYS_LATIN.matcher(text);
        if (m.find()) return new DurationMatch(Math.round(Float.parseFloat(m.group(1)) * 24 * 60), strip(text, m));

        return null;
    }

    private static final class AmountMatch {
        final long amount;
        final String remaining;
        AmountMatch(long amount, String remaining) { this.amount = amount; this.remaining = remaining; }
    }

    /** Same as money.ts's parseAmount — "۱.۵ میلیون" -> 1,500,000, a bare "۸۰۰" (no scale word) ->
     * 800 unchanged. `raw` is expected to already be ASCII digits (parse() normalizes once, up
     * front, rather than every call site normalizing again). Returns null for anything that
     * doesn't start with a number. */
    private static Long parseAmount(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return null;
        Matcher m = AMOUNT_SCALE_PREFIX.matcher(s);
        if (!m.find()) return null;

        String numPart = m.group(1).replace(",", "");
        double num;
        try {
            num = Double.parseDouble(numPart);
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

    /** Same four patterns as parser.ts's extractAmount, tried in the same order — a bare number
     * only counts as money when a scale word (میلیون/هزار/میلیارد) or an explicit تومان/تومن
     * marks it as one, so this never collides with a bare duration number like "۲" in "۲ ساعت". */
    private static AmountMatch extractAmount(String text) {
        Matcher m = AMOUNT_DIGITS_SCALE.matcher(text);
        if (m.find()) {
            Long amount = parseAmount(m.group(1) + " " + m.group(2));
            if (amount != null) return new AmountMatch(amount, strip(text, m));
        }

        m = AMOUNT_WORD_SCALE.matcher(text);
        if (m.find()) {
            Integer wordValue = NUMBER_WORDS.get(m.group(1));
            Long amount = wordValue == null ? null : parseAmount(wordValue + " " + m.group(2));
            if (amount != null) return new AmountMatch(amount, strip(text, m));
        }

        m = AMOUNT_COMMA_GROUPED.matcher(text);
        if (m.find()) {
            Long amount = parseAmount(m.group(1));
            if (amount != null) return new AmountMatch(amount, strip(text, m));
        }

        m = AMOUNT_BARE_TOMAN.matcher(text);
        if (m.find()) {
            Long amount = parseAmount(m.group(1));
            if (amount != null) return new AmountMatch(amount, strip(text, m));
        }

        return null;
    }

    private static String extractCategoryHint(String text) {
        String lower = text.toLowerCase();
        for (Map.Entry<String, String> e : WASTE_CATEGORY_KEYWORDS.entrySet()) {
            if (lower.contains(e.getKey().toLowerCase())) return e.getValue();
        }
        return null;
    }

    private static String cleanTitle(String text) {
        String out = AND_WORD.matcher(text).replaceAll(" ");
        out = COMMAS.matcher(out).replaceAll(" ");
        out = EXTRA_WHITESPACE.matcher(out).replaceAll(" ");
        return out.trim();
    }

    private static final String PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
    private static final String ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

    /** Same conversion as toAsciiDigits in src/lib/money.ts, applied first for the same reason
     * parser.ts's own parse() does — every \d in the patterns below is ASCII-only (Java regex,
     * same as JS regex, never matches ۰-۹ or ٠-٩), and an Android Persian-locale keyboard types
     * ۰-۹ by default, so without this every duration/amount pattern here silently never matched
     * anything a person actually typed. */
    private static String toAsciiDigits(String input) {
        StringBuilder sb = new StringBuilder(input.length());
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            int p = PERSIAN_DIGITS.indexOf(c);
            if (p >= 0) {
                sb.append((char) ('0' + p));
                continue;
            }
            int a = ARABIC_INDIC_DIGITS.indexOf(c);
            sb.append(a >= 0 ? (char) ('0' + a) : c);
        }
        return sb.toString();
    }

    static Result parse(String rawInput) {
        String normalized = rawInput == null ? "" : toAsciiDigits(rawInput).trim();
        String remaining = normalized;

        DurationMatch durationMatch = extractDuration(remaining);
        if (durationMatch != null) remaining = durationMatch.remaining;

        // Same order as parser.ts's parseQuickCapture: duration, then amount, off what's left
        // after duration is already stripped — "۲ ساعت ۱ میلیون شکلات" reduces amount-matching to
        // "۱ میلیون شکلات" rather than re-matching the "۲" duration figure as a bare number.
        AmountMatch amountMatch = extractAmount(remaining);
        if (amountMatch != null) remaining = amountMatch.remaining;

        // Same precedence as parser.ts: خرید strips from the remaining text (after duration/amount
        // are already out of the way), a WASTE keyword (checked against the full normalized text,
        // before any stripping) wins over it if both are somehow present.
        Matcher purchase = PURCHASE_KEYWORD.matcher(remaining);
        boolean hadPurchaseKeyword = purchase.find();
        if (hadPurchaseKeyword) remaining = strip(remaining, purchase);

        String categoryHint = extractCategoryHint(normalized);
        if (categoryHint == null && hadPurchaseKeyword) categoryHint = "خرید";

        String title = cleanTitle(remaining);
        if (title.isEmpty()) title = "بدون عنوان";

        Integer durationMinutes = durationMatch == null ? null : Integer.valueOf(durationMatch.minutes);
        Long amount = amountMatch == null ? null : Long.valueOf(amountMatch.amount);
        return new Result(title, durationMinutes, amount, categoryHint);
    }
}
