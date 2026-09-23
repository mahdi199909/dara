package ir.mganic.dara;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

// The form the widget launches — just a text capsule (see QuickCaptureWidgetProvider's own note
// on why the widget surface itself can't host real text input). Type, press Done/Enter, review a
// one-line preview of what was understood (✓/✕ to confirm or go back), and only on ✓ does
// anything get written. Deliberately does NOT touch the app's SQLite database file for writes —
// it only ever READS that file (to show a matched category's name in the preview), and writes new
// captures into the same SharedPreferences file @capacitor/preferences uses (group
// "CapacitorStorage"), under a key the JS side drains on every app resume — see
// src/local/widgetQueue.ts. What is queued is what the preview showed, as data: the signals
// QuickTextParser read from the line (a task, an event, an expense, an installment plan, a habit
// check-in, a note ...) plus the line itself; the app turns them into the real thing, the same way
// its own «ثبت...» field does. This means a capture doesn't appear inside the app INSTANTLY; it
// appears the next time the app is opened or resumed — an accepted tradeoff for never risking the
// app's own in-memory database silently overwriting a native write made while it wasn't running.
// "ثبت شد" only ever shows once the write to that queue is itself confirmed (SharedPreferences'
// synchronous commit(), not the fire-and-forget apply()) — never before the local half of the
// save is actually known to have succeeded.
public class QuickCaptureActivity extends Activity {

    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String QUEUE_KEY = "widget_pending_captures";
    private static final String LOCAL_USER_ID = "local-device-user";
    private static final String[] PERSIAN_DIGITS = { "۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹" };

    // id, icon, name — for showing the name of the category a parsed hint (QuickTextParser's
    // categoryHint) matches in the preview, from the same "top categories" set the old chip picker
    // used to offer. The app itself matches the hint against every category when it saves.
    private List<String[]> categories;

    private static final String[] WEEKDAY_NAMES = { "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه" }; // index = JS getDay()
    private static final String[] JALALI_MONTH_NAMES = {
        "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
    };

    // What the typed line was understood as (QuickTextParser) and the line itself — both go into the queue on ✓.
    private QuickTextParser.Signals pendingSignals;
    private String pendingText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
        setContentView(R.layout.activity_quick_capture);

        categories = readTopCategories();

        findViewById(R.id.capture_scrim).setOnClickListener(v -> {
            if (v.getId() == R.id.capture_scrim) finish();
        });

        EditText titleInput = findViewById(R.id.capture_title);
        titleInput.setOnEditorActionListener((v, actionId, event) -> {
            boolean isDone = actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_UNSPECIFIED;
            boolean isEnterKeyDown = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN;
            if (!isDone && !isEnterKeyDown) return false;
            showConfirmation(titleInput.getText().toString());
            return true;
        });

        findViewById(R.id.confirm_ok).setOnClickListener(v -> submit());
        findViewById(R.id.confirm_edit).setOnClickListener(v -> backToEditing());
    }

    /** Parses the typed text and shows a one-line preview of exactly what ✓ will save — nothing
     * is written yet. Matches a category hint the same way the old chip picker did: an exact name
     * match, or the hint as a substring of it (e.g. "خرید" hint matching a "🛍️ خرید" chip's name). */
    private void showConfirmation(String rawText) {
        if (TextUtils.isEmpty(rawText.trim())) {
            Toast.makeText(this, "چیزی بنویس", Toast.LENGTH_SHORT).show();
            return;
        }

        pendingText = rawText.trim();
        pendingSignals = QuickTextParser.parse(rawText);

        // Only the preview matches a category hint to a name (the app matches it against every category when it
        // saves): an exact name, or the hint as a substring of it (e.g. "خرید" hint matching a "🛍️ خرید" name).
        String categoryName = null;
        if (pendingSignals.categoryHint != null) {
            for (String[] cat : categories) {
                String name = cat[2];
                if (name.equals(pendingSignals.categoryHint) || name.contains(pendingSignals.categoryHint)) {
                    categoryName = name;
                    break;
                }
            }
        }

        TextView previewView = findViewById(R.id.confirm_preview);
        previewView.setText(buildPreview(pendingSignals, categoryName));

        EditText titleInput = findViewById(R.id.capture_title);
        titleInput.setEnabled(false);
        findViewById(R.id.confirm_row).setVisibility(View.VISIBLE);

        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(titleInput.getWindowToken(), 0);
    }

    /** ✕ — back to editing, same text still there, nothing lost. */
    private void backToEditing() {
        findViewById(R.id.confirm_row).setVisibility(View.GONE);
        EditText titleInput = findViewById(R.id.capture_title);
        titleInput.setEnabled(true);
        titleInput.requestFocus();
        titleInput.setSelection(titleInput.getText().length());
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.showSoftInput(titleInput, InputMethodManager.SHOW_IMPLICIT);
    }

    /** One line saying what ✓ will save — the words the app will act on, in the order a person would say them. */
    private String buildPreview(QuickTextParser.Signals s, String categoryName) {
        StringBuilder p = new StringBuilder();
        String kind = s.kind;

        if ("INSTALLMENT_PLAN".equals(kind)) {
            long count = s.count == null ? 1 : s.count.longValue();
            long amount = s.amount == null ? 0 : s.amount.longValue();
            long each = s.perInstallment ? amount : Math.round((double) amount / count);
            long total = s.perInstallment ? amount * count : amount;
            p.append("طرح قسط جدید «").append(s.title).append("» · ").append(faNum(count)).append(" قسط · هر قسط ")
                .append(formatTomanFa(each)).append(" · مجموع ").append(formatTomanFa(total));
            if (s.dueDay != null) p.append(" · روز ").append(faNum(s.dueDay.longValue())).append(" هر ماه");
        } else if ("INSTALLMENT_PAY".equals(kind)) {
            p.append("پرداخت قسط");
            if (s.hint != null && !s.hint.isEmpty()) p.append(" «").append(s.hint).append("»");
        } else if ("HABIT_CHECKIN".equals(kind)) {
            p.append("ثبت عادت «").append(s.hint).append("» برای امروز");
        } else if ("HABIT_CREATE".equals(kind)) {
            p.append("عادت جدید «").append(s.title).append("»");
        } else if ("NOTE".equals(kind)) {
            String day = dayLabel(s);
            p.append("یادداشت");
            if (day != null) p.append(" ").append(day);
            p.append(": ").append(s.title.length() > 50 ? s.title.substring(0, 50) + "…" : s.title);
        } else if ("SAVINGS_GOAL".equals(kind)) {
            p.append("هدف پس‌انداز «").append(s.title).append("» · ").append(formatTomanFa(s.amount == null ? 0 : s.amount.longValue()));
        } else if ("PROJECT_CREATE".equals(kind)) {
            p.append("پروژه جدید «").append(s.title).append("»");
        } else if ("BUDGET".equals(kind)) {
            p.append("بودجه ماهانه «").append(s.hint).append("» · ").append(formatTomanFa(s.amount == null ? 0 : s.amount.longValue()));
        } else if ("REMINDER".equals(kind)) {
            p.append("یادآوری «").append(s.title).append("»");
            appendWhen(p, s);
        } else {
            // An entry: a task, an event, an expense or an income.
            boolean dated = s.dayType != null || s.timeHour != null;
            String label = s.amount != null ? (s.income ? "درآمد" : "هزینه") : (dated || s.eventCue ? "رویداد" : "کار");
            p.append(label).append(" «").append(s.title).append("»");
            appendWhen(p, s);
            if (s.durationMinutes != null && s.durationMinutes.intValue() > 0) p.append(" · ").append(formatMinutesFa(s.durationMinutes.intValue()));
            if (s.amount != null) p.append(" · ").append(formatTomanFa(s.amount.longValue()));
            if (categoryName != null) p.append(" · ").append(categoryName);
            if (s.projectHint != null) p.append(" · پروژه ").append(s.projectHint);
        }
        return p.toString();
    }

    private void appendWhen(StringBuilder p, QuickTextParser.Signals s) {
        String day = dayLabel(s);
        if (day != null) p.append(" · ").append(day);
        if (s.timeHour != null) {
            p.append(day == null ? " · " : " ").append("ساعت ").append(toPersianDigits(String.format(Locale.US, "%d:%02d", s.timeHour.intValue(), s.timeMinute)));
        }
    }

    /** The day a line named, in words — null when it named none. */
    private String dayLabel(QuickTextParser.Signals s) {
        if (s.dayType == null) return null;
        if ("REL".equals(s.dayType)) {
            switch (s.dayValue) {
                case -2: return "پریروز";
                case -1: return "دیروز";
                case 0: return "امروز";
                case 1: return "فردا";
                default: return "پس‌فردا";
            }
        }
        if ("WEEKDAY".equals(s.dayType)) {
            return s.dayValue >= 0 && s.dayValue < WEEKDAY_NAMES.length ? WEEKDAY_NAMES[s.dayValue] : null;
        }
        if (s.jalaliMonth < 1 || s.jalaliMonth > JALALI_MONTH_NAMES.length) return null;
        String label = faNum(s.jalaliDay) + " " + JALALI_MONTH_NAMES[s.jalaliMonth - 1];
        if (s.jalaliYear != null) label += " " + faNum(s.jalaliYear.longValue());
        return label;
    }

    private static String faNum(long n) {
        return toPersianDigits(String.valueOf(n));
    }

    private static String formatMinutesFa(int minutes) {
        int h = minutes / 60;
        int m = minutes % 60;
        if (h == 0) return toPersianDigits(String.valueOf(m)) + " دقیقه";
        if (m == 0) return toPersianDigits(String.valueOf(h)) + " ساعت";
        return toPersianDigits(String.valueOf(h)) + " ساعت و " + toPersianDigits(String.valueOf(m)) + " دقیقه";
    }

    /** Same shape as money.ts's formatToman: thousands-separated, Persian digits, "تومان" suffix.
     * Locale.US pins the grouping character to a comma regardless of the device's own locale. */
    private static String formatTomanFa(long amountToman) {
        return toPersianDigits(String.format(Locale.US, "%,d", amountToman)) + " تومان";
    }

    private static String toPersianDigits(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            sb.append(c >= '0' && c <= '9' ? PERSIAN_DIGITS[c - '0'] : String.valueOf(c));
        }
        return sb.toString();
    }

    /** id, icon, name — ordered by how often each category is used on Activity rows, most first. */
    private List<String[]> readTopCategories() {
        List<String[]> result = new ArrayList<>();
        SQLiteDatabase db = null;
        try {
            db = WidgetDb.openReadOnly(this);
            if (db == null) return result; // never opened / mid-write — treated as "no categories"
            Cursor cursor = db.rawQuery(
                "SELECT c.id, c.icon, c.name " +
                "FROM Category c " +
                "LEFT JOIN (SELECT categoryId, COUNT(*) as cnt FROM Activity WHERE userId = ? GROUP BY categoryId) u " +
                "ON c.id = u.categoryId " +
                "WHERE c.userId = ? AND c.deletedAt IS NULL " +
                "ORDER BY COALESCE(u.cnt, 0) DESC, c.createdAt ASC " +
                "LIMIT 10",
                new String[] { LOCAL_USER_ID, LOCAL_USER_ID }
            );
            while (cursor.moveToNext()) {
                result.add(new String[] { cursor.getString(0), cursor.getString(1), cursor.getString(2) });
            }
            cursor.close();
        } catch (Exception e) {
            // Database not created yet (app never opened), or some other read issue — treated the
            // same as "no categories": a parsed category hint just won't resolve to an id.
        } finally {
            if (db != null) db.close();
        }
        return result;
    }

    private void submit() {
        try {
            // What the preview showed, as data: the signals (src/lib/captureSignalsSchema.ts reads them back)
            // and the line as typed. The app turns the signals into a real entry when it drains the queue —
            // using `startedAt`, so «فردا» is the day after now, however long the app takes to open.
            JSONObject entry = new JSONObject();
            entry.put("v", 2);
            entry.put("text", pendingText);
            entry.put("signals", pendingSignals.toJson());
            entry.put("startedAt", isoNow());
            entry.put("source", "widget");

            SharedPreferences prefs = getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
            String existingRaw = prefs.getString(QUEUE_KEY, "[]");
            JSONArray queue;
            try {
                queue = new JSONArray(existingRaw);
            } catch (Exception e) {
                queue = new JSONArray();
            }
            queue.put(entry);

            // commit() (synchronous, returns success/failure) rather than apply() (fire-and-forget)
            // — "ثبت شد" must mean the write actually landed, not just that it was requested.
            boolean saved = prefs.edit().putString(QUEUE_KEY, queue.toString()).commit();
            if (saved) {
                Toast.makeText(this, "ثبت شد", Toast.LENGTH_SHORT).show();
                finish();
            } else {
                Toast.makeText(this, "ذخیره نشد. دوباره امتحان کن.", Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "خطایی رخ داد. دوباره تلاش کنید.", Toast.LENGTH_SHORT).show();
        }
    }

    private static String isoNow() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(new Date());
    }
}
