package ir.mganic.dara;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A free-text line ("۲ ساعت رو پروژه کار کردم") into the three fields this widget's form already
 * has: a cleaned title, a duration in minutes, and a category-name hint the caller matches against
 * the categories it already loaded from WidgetDb. A partial, native port of src/lib/parser.ts —
 * only the pieces this widget's data model (Activity: title + categoryId + duration, see
 * QuickCaptureActivity/widgetQueue.ts) can actually use. Deliberately NOT ported here: amount,
 * date/time, project hint — none of those have anywhere to go in this queue entry's shape, and
 * widening it is a separate change, not a parsing one. This native popup has no route to the
 * JS/TS runtime (see QuickCaptureActivity's own note), hence a second copy of this logic rather
 * than a shared one.
 */
final class QuickTextParser {

    static final class Result {
        final String title;
        final Integer durationMinutes; // null when the text named none
        final String categoryHint; // null when the text named none

        Result(String title, Integer durationMinutes, String categoryHint) {
            this.title = title;
            this.durationMinutes = durationMinutes;
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

        // Same precedence as parser.ts: خرید strips from the remaining text (after duration is
        // already out of the way), a WASTE keyword (checked against the full normalized text,
        // before duration/خرید stripping) wins over it if both are somehow present.
        Matcher purchase = PURCHASE_KEYWORD.matcher(remaining);
        boolean hadPurchaseKeyword = purchase.find();
        if (hadPurchaseKeyword) remaining = strip(remaining, purchase);

        String categoryHint = extractCategoryHint(normalized);
        if (categoryHint == null && hadPurchaseKeyword) categoryHint = "خرید";

        String title = cleanTitle(remaining);
        if (title.isEmpty()) title = "بدون عنوان";

        Integer durationMinutes = durationMatch == null ? null : Integer.valueOf(durationMatch.minutes);
        return new Result(title, durationMinutes, categoryHint);
    }
}
