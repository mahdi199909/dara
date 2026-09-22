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
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

// The form the widget launches. Deliberately does NOT touch the app's SQLite database file for
// writes — see the file-level note in QuickCaptureWidgetProvider. It only ever READS that file
// (to list categories), and writes new captures into the same SharedPreferences file
// @capacitor/preferences uses (group "CapacitorStorage"), under a key the JS side drains on
// every app resume — see src/local/widgetQueue.ts. This means a capture doesn't appear inside
// the app INSTANTLY; it appears the next time the app is opened or resumed. That's an accepted
// tradeoff for never risking the app's own in-memory database silently overwriting a native
// write made while it wasn't running.
public class QuickCaptureActivity extends Activity {

    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String QUEUE_KEY = "widget_pending_captures";
    private static final String LOCAL_USER_ID = "local-device-user";

    private int selectedDurationMin = 60;
    private String selectedCategoryId = null;
    private TextView selectedDurationView;
    private TextView selectedCategoryView;
    private final List<TextView> durationChips = new ArrayList<>();
    // Category chip -> its plain name (without the icon prefix loadCategories() adds for
    // display), so a parsed categoryHint (a bare name, same as parser.ts's contract) can find the
    // matching chip and select it the same way a tap would.
    private final Map<TextView, String> categoryChipNames = new HashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
        setContentView(R.layout.activity_quick_capture);

        findViewById(R.id.capture_scrim).setOnClickListener(v -> {
            if (v.getId() == R.id.capture_scrim) finish();
        });

        setupDurationChips();
        loadCategories();
        loadTitleSuggestions();
        setupSmartParse();

        findViewById(R.id.capture_submit).setOnClickListener(v -> submit());
    }

    /**
     * The title field doubles as a free-text quick-entry, matching the web app's "ثبت ..." bar
     * (src/components/home/QuickTaskInput.tsx / src/lib/parser.ts) — press the keyboard's Done/
     * Enter action to parse whatever's been typed so far: a named duration selects the closest
     * duration chip, a recognized category word (خرید, اینستاگرام, ...) selects that category
     * chip, and both are stripped out of the text, leaving just the title. Nothing submits on its
     * own here — the person still reviews the now-filled-in chips and taps «ثبت» themselves,
     * same as typing them in by hand always has.
     */
    private void setupSmartParse() {
        EditText titleInput = findViewById(R.id.capture_title);
        titleInput.setOnEditorActionListener((v, actionId, event) -> {
            boolean isDone = actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_UNSPECIFIED;
            boolean isEnterKeyDown = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN;
            if (!isDone && !isEnterKeyDown) return false;
            applyParsedText(titleInput.getText().toString());
            return true;
        });
    }

    private void applyParsedText(String rawText) {
        QuickTextParser.Result result = QuickTextParser.parse(rawText);

        EditText titleInput = findViewById(R.id.capture_title);
        titleInput.setText(result.title);
        titleInput.setSelection(result.title.length());

        if (result.durationMinutes != null) {
            TextView closest = null;
            int closestDiff = Integer.MAX_VALUE;
            for (TextView chip : durationChips) {
                int chipMinutes = Integer.parseInt((String) chip.getTag());
                int diff = Math.abs(chipMinutes - result.durationMinutes);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closest = chip;
                }
            }
            if (closest != null) closest.performClick();
        }

        if (result.categoryHint != null) {
            for (Map.Entry<TextView, String> entry : categoryChipNames.entrySet()) {
                String name = entry.getValue();
                boolean matches = name.equals(result.categoryHint) || name.contains(result.categoryHint);
                // Only the plain (unclicked) case toggles a category chip on — clicking an
                // already-selected one toggles it back OFF (see its own listener above), so
                // re-parsing the same hint twice must never re-click a chip that's already picked.
                if (matches && entry.getKey() != selectedCategoryView) {
                    entry.getKey().performClick();
                    break;
                } else if (matches) {
                    break;
                }
            }
        }
    }

    private void setupDurationChips() {
        int[] ids = { R.id.duration_05, R.id.duration_1, R.id.duration_15, R.id.duration_2, R.id.duration_25 };
        for (int id : ids) {
            TextView chip = findViewById(id);
            durationChips.add(chip);
            chip.setOnClickListener(v -> {
                if (selectedDurationView != null) selectedDurationView.setBackgroundResource(R.drawable.chip_unselected);
                chip.setBackgroundResource(R.drawable.chip_selected);
                chip.setTextColor(0xFFFFFFFF);
                if (selectedDurationView != null) selectedDurationView.setTextColor(0xFF374151);
                selectedDurationView = chip;
                selectedDurationMin = Integer.parseInt((String) chip.getTag());
            });
        }
        // 1 hour selected by default — the single most common quick-log duration.
        TextView defaultChip = findViewById(R.id.duration_1);
        defaultChip.performClick();
    }

    private void loadCategories() {
        LinearLayout row = findViewById(R.id.category_row);
        List<String[]> categories = readTopCategories();

        if (categories.isEmpty()) {
            TextView hint = new TextView(this);
            hint.setText("دسته‌بندی‌ای پیدا نشد — یک‌بار اپ رو باز کنید");
            hint.setTextColor(0xFF9CA3AF);
            hint.setTextSize(12);
            row.addView(hint);
            return;
        }

        for (String[] cat : categories) {
            String id = cat[0];
            String label = (cat[1] == null || cat[1].isEmpty() ? "" : cat[1] + " ") + cat[2];
            TextView chip = new TextView(this);
            chip.setText(label);
            chip.setTextColor(0xFF374151);
            chip.setTextSize(13);
            chip.setBackgroundResource(R.drawable.chip_unselected);
            int pad = (int) (10 * getResources().getDisplayMetrics().density);
            int padV = (int) (8 * getResources().getDisplayMetrics().density);
            chip.setPadding(pad, padV, pad, padV);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            );
            lp.setMarginEnd((int) (6 * getResources().getDisplayMetrics().density));
            chip.setLayoutParams(lp);
            categoryChipNames.put(chip, cat[2]);
            chip.setOnClickListener(v -> {
                if (selectedCategoryView == chip) {
                    // tapping the already-selected chip clears the selection
                    chip.setBackgroundResource(R.drawable.chip_unselected);
                    chip.setTextColor(0xFF374151);
                    selectedCategoryView = null;
                    selectedCategoryId = null;
                    return;
                }
                if (selectedCategoryView != null) {
                    selectedCategoryView.setBackgroundResource(R.drawable.chip_unselected);
                    selectedCategoryView.setTextColor(0xFF374151);
                }
                chip.setBackgroundResource(R.drawable.chip_selected);
                chip.setTextColor(0xFFFFFFFF);
                selectedCategoryView = chip;
                selectedCategoryId = id;
            });
            row.addView(chip);
        }
    }

    /**
     * Past Activity titles as tappable chips, so a repeated entry (a routine, a recurring
     * project) never needs retyping — mirrors the web app's Quick Capture suggestions
     * (src/lib/titleSuggestions.ts) with the same "frecency" idea: log-scaled use count times an
     * exponential recency decay, so a title used a lot but long ago doesn't drown out one you've
     * started using again this week. Reimplemented here in Java rather than shared, since this
     * native popup has no route to the JS/TS runtime.
     */
    private void loadTitleSuggestions() {
        HorizontalScrollView scroll = findViewById(R.id.suggestion_scroll);
        LinearLayout row = findViewById(R.id.suggestion_row);
        List<TitleSuggestion> suggestions = readTopTitles();

        if (suggestions.isEmpty()) {
            scroll.setVisibility(View.GONE);
            return;
        }

        EditText titleInput = findViewById(R.id.capture_title);
        for (TitleSuggestion s : suggestions) {
            TextView chip = new TextView(this);
            chip.setText(s.title);
            chip.setTextColor(0xFF374151);
            chip.setTextSize(13);
            chip.setBackgroundResource(R.drawable.chip_unselected);
            int pad = (int) (10 * getResources().getDisplayMetrics().density);
            int padV = (int) (8 * getResources().getDisplayMetrics().density);
            chip.setPadding(pad, padV, pad, padV);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            );
            lp.setMarginEnd((int) (6 * getResources().getDisplayMetrics().density));
            chip.setLayoutParams(lp);
            chip.setOnClickListener(v -> titleInput.setText(s.title));
            row.addView(chip);
        }
    }

    private static class TitleSuggestion {
        final String title;
        final double score;

        TitleSuggestion(String title, double score) {
            this.title = title;
            this.score = score;
        }
    }

    /** Same 14-day half-life as titleSuggestions.ts's RECENCY_HALF_LIFE_DAYS. */
    private static final double RECENCY_HALF_LIFE_DAYS = 14.0;

    /** Top 8 past Activity titles for this device's user, ranked by frecency, most first. */
    private List<TitleSuggestion> readTopTitles() {
        List<TitleSuggestion> result = new ArrayList<>();
        SQLiteDatabase db = null;
        SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        long now = System.currentTimeMillis();

        try {
            db = WidgetDb.openReadOnly(this);
            if (db == null) return result; // never opened / mid-write — no suggestions
            Cursor cursor = db.rawQuery(
                "SELECT title, COUNT(*) as cnt, MAX(createdAt) as lastUsed " +
                "FROM Activity " +
                "WHERE userId = ? AND deletedAt IS NULL " +
                "GROUP BY title " +
                "ORDER BY lastUsed DESC " +
                "LIMIT 50",
                new String[] { LOCAL_USER_ID }
            );
            while (cursor.moveToNext()) {
                String title = cursor.getString(0);
                int count = cursor.getInt(1);
                String lastUsed = cursor.getString(2);
                double daysSince = 999;
                try {
                    daysSince = Math.max(0, (now - isoFmt.parse(lastUsed).getTime()) / 86_400_000.0);
                } catch (ParseException ignored) {
                    // Unparseable timestamp — treat as very old rather than crashing the ranking.
                }
                double score = Math.log(1 + count) * Math.exp(-daysSince / RECENCY_HALF_LIFE_DAYS);
                result.add(new TitleSuggestion(title, score));
            }
            cursor.close();
        } catch (Exception e) {
            // Database not created yet, or some other read issue — no suggestions, same as an
            // empty result; the form still works fine with just manual typing.
        } finally {
            if (db != null) db.close();
        }

        Collections.sort(result, (a, b) -> Double.compare(b.score, a.score));
        return result.subList(0, Math.min(8, result.size()));
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
            // same as "no categories": the user can still submit with just a title/duration.
        } finally {
            if (db != null) db.close();
        }
        return result;
    }

    private void submit() {
        EditText titleInput = findViewById(R.id.capture_title);
        String title = titleInput.getText().toString().trim();
        if (TextUtils.isEmpty(title)) {
            Toast.makeText(this, "عنوان رو وارد کنید", Toast.LENGTH_SHORT).show();
            return;
        }

        try {
            JSONObject entry = new JSONObject();
            entry.put("title", title);
            // JSONObject.put(key, (Object) null) is not reliable across org.json
            // implementations — JSONObject.NULL is the explicit, documented way to write a
            // literal JSON null (which the JS side's JSON.parse then reads back as null).
            entry.put("categoryId", selectedCategoryId == null ? JSONObject.NULL : selectedCategoryId);
            entry.put("durationMinutes", selectedDurationMin);
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
            prefs.edit().putString(QUEUE_KEY, queue.toString()).apply();

            Toast.makeText(this, "ثبت شد", Toast.LENGTH_SHORT).show();
            finish();
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
