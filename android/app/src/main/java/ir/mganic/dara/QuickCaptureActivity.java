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
// it only ever READS that file (to resolve a parsed category name to its id), and writes new
// captures into the same SharedPreferences file @capacitor/preferences uses (group
// "CapacitorStorage"), under a key the JS side drains on every app resume — see
// src/local/widgetQueue.ts. This means a capture doesn't appear inside the app INSTANTLY; it
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

    // id, icon, name — for resolving a parsed category-name hint (QuickTextParser.categoryHint)
    // to a real categoryId, the same "top categories" set the old chip picker used to offer.
    private List<String[]> categories;

    private String pendingTitle;
    private Integer pendingDurationMinutes;
    private String pendingCategoryId;

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

        QuickTextParser.Result result = QuickTextParser.parse(rawText);
        pendingTitle = result.title;
        pendingDurationMinutes = result.durationMinutes != null ? result.durationMinutes : 60;
        pendingCategoryId = null;
        String categoryName = null;
        if (result.categoryHint != null) {
            for (String[] cat : categories) {
                String name = cat[2];
                if (name.equals(result.categoryHint) || name.contains(result.categoryHint)) {
                    pendingCategoryId = cat[0];
                    categoryName = name;
                    break;
                }
            }
        }

        StringBuilder preview = new StringBuilder();
        preview.append("«").append(pendingTitle).append("»");
        preview.append(" · ").append(formatMinutesFa(pendingDurationMinutes));
        if (categoryName != null) preview.append(" · ").append(categoryName);

        TextView previewView = findViewById(R.id.confirm_preview);
        previewView.setText(preview.toString());

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

    private static String formatMinutesFa(int minutes) {
        int h = minutes / 60;
        int m = minutes % 60;
        if (h == 0) return toPersianDigits(String.valueOf(m)) + " دقیقه";
        if (m == 0) return toPersianDigits(String.valueOf(h)) + " ساعت";
        return toPersianDigits(String.valueOf(h)) + " ساعت و " + toPersianDigits(String.valueOf(m)) + " دقیقه";
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
            JSONObject entry = new JSONObject();
            entry.put("title", pendingTitle);
            // JSONObject.put(key, (Object) null) is not reliable across org.json
            // implementations — JSONObject.NULL is the explicit, documented way to write a
            // literal JSON null (which the JS side's JSON.parse then reads back as null).
            entry.put("categoryId", pendingCategoryId == null ? JSONObject.NULL : pendingCategoryId);
            entry.put("durationMinutes", pendingDurationMinutes);
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
