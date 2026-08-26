package ir.mganic.dara;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
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

        findViewById(R.id.capture_submit).setOnClickListener(v -> submit());
    }

    private void setupDurationChips() {
        int[] ids = { R.id.duration_05, R.id.duration_1, R.id.duration_15, R.id.duration_2, R.id.duration_25 };
        for (int id : ids) {
            TextView chip = findViewById(id);
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

    /** id, icon, name — ordered by how often each category is used on Activity rows, most first. */
    private List<String[]> readTopCategories() {
        List<String[]> result = new ArrayList<>();
        String dbPath = getFilesDir().getAbsolutePath() + "/dara.sqlite3";
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(dbPath, null, SQLiteDatabase.OPEN_READONLY);
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
