package ir.mganic.dara;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

// Shows today's/lifetime invested-hours summary plus up to three one-tap shortcut buttons for the
// user's most-used categories — "ثبت را بدون باز شدن اپ ممکن کن" (make logging possible without
// opening the app), the widget half of that (the notification half is separate, not yet built).
//
// The capital number is read-only and never computed here — see readCapitalSummary(). It's
// whatever src/local/reportEngine.ts's recordDailyCapitalSnapshot last wrote to the
// "widget_capital_summary" Preferences key on boot/resume/every /api/capital read, so it's always
// at most one of those events stale, never independently wrong the way a widget-side
// recomputation from a possibly-different formula could be.
//
// A shortcut tap queues a capture the exact same way QuickCaptureActivity/HabitsWidgetProvider's
// checkbox do — through the @capacitor/preferences-backed hand-off queue (src/local/widgetQueue.ts
// drains it), never the app's SQLite file directly. Unlike the habit checkbox, there's no
// "checked" visual state to give optimistic feedback for here — a capture is a one-shot append,
// not a toggle — so a Toast is the only confirmation; nothing about this widget's own layout needs
// to repaint after a tap.
public class CapitalWidgetProvider extends AppWidgetProvider {

    static final String ACTION_QUICK_CAPTURE = "ir.mganic.dara.action.WIDGET_QUICK_CAPTURE";
    static final String EXTRA_CATEGORY_ID = "categoryId";
    static final String EXTRA_CATEGORY_LABEL = "categoryLabel";

    private static final String LOCAL_USER_ID = "local-device-user";
    private static final int MAX_SHORTCUTS = 3;
    // The single most common quick-log duration — same default QuickCaptureActivity's duration
    // chips start on. A one-tap shortcut has nowhere to ask for a different one; the user can
    // still edit the logged duration later from inside the app like any other record.
    private static final int DEFAULT_DURATION_MIN = 60;

    // Same SharedPreferences file @capacitor/preferences reads/writes as "CapacitorStorage" —
    // see QuickCaptureActivity/HabitsWidgetProvider for the established precedent.
    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String CAPITAL_SUMMARY_KEY = "widget_capital_summary";
    private static final String CAPTURE_QUEUE_KEY = "widget_pending_captures";

    private static final String[] PERSIAN_DIGITS = { "۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹" };

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);

        if (ACTION_QUICK_CAPTURE.equals(intent.getAction())) {
            String categoryId = intent.getStringExtra(EXTRA_CATEGORY_ID);
            String categoryLabel = intent.getStringExtra(EXTRA_CATEGORY_LABEL);
            if (categoryId != null && categoryLabel != null) {
                enqueueCapture(context, categoryId, categoryLabel);
                Toast.makeText(context, "«" + categoryLabel + "» ثبت شد", Toast.LENGTH_SHORT).show();
            }
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            appWidgetManager.updateAppWidget(appWidgetId, buildViews(context, appWidgetId));
        }
    }

    private RemoteViews buildViews(Context context, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_capital);
        views.removeAllViews(R.id.shortcuts_container);

        String[] summary = readCapitalSummary(context);
        if (summary == null) {
            // Nothing written yet (app never opened once) or malformed — hide the line rather
            // than show a fabricated "۰ ساعت" that isn't really traceable to anything yet.
            views.setViewVisibility(R.id.capital_summary, View.GONE);
        } else {
            views.setViewVisibility(R.id.capital_summary, View.VISIBLE);
            views.setTextViewText(R.id.capital_summary, summary[0] + " — " + summary[1]);
        }

        List<String[]> categories = readTopCategories(context);
        if (categories.isEmpty()) {
            RemoteViews empty = new RemoteViews(context.getPackageName(), R.layout.widget_capital_shortcuts_empty);
            views.addView(R.id.shortcuts_container, empty);
        } else {
            for (String[] cat : categories) {
                String categoryId = cat[0];
                String icon = cat[1];
                String name = cat[2];
                String label = (icon == null || icon.isEmpty() ? "" : icon + " ") + name;

                RemoteViews button = new RemoteViews(context.getPackageName(), R.layout.widget_capital_shortcut_item);
                button.setTextViewText(R.id.shortcut_button, label);

                Intent captureIntent = new Intent(context, CapitalWidgetProvider.class);
                captureIntent.setAction(ACTION_QUICK_CAPTURE);
                captureIntent.putExtra(EXTRA_CATEGORY_ID, categoryId);
                captureIntent.putExtra(EXTRA_CATEGORY_LABEL, name);
                // Distinct requestCode per category — see HabitsWidgetProvider's identical note
                // on why PendingIntent.getBroadcast would otherwise reuse/collide across rows
                // (Intent.filterEquals() ignores extras, so two intents targeting the same
                // component need different requestCodes to stay distinct PendingIntents).
                PendingIntent capturePendingIntent = PendingIntent.getBroadcast(
                    context,
                    categoryId.hashCode(),
                    captureIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                button.setOnClickPendingIntent(R.id.shortcut_button, capturePendingIntent);

                views.addView(R.id.shortcuts_container, button);
            }
        }

        // Explicit MainActivity intent, not getLaunchIntentForPackage() — see the identical note
        // on every other widget provider in this app.
        Intent launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent launchPendingIntent = PendingIntent.getActivity(
            context, appWidgetId, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        // Shortcut buttons bind their own, more specific PendingIntent above; that always takes
        // precedence for a tap that lands on a button specifically, so this only fires for taps
        // elsewhere on the card — same "tap card to open app" pattern as the other widgets.
        views.setOnClickPendingIntent(R.id.widget_capital_root, launchPendingIntent);

        return views;
    }

    /** ["امروز N ساعت", "جمع M ساعت"] in Persian digits, or null if the JS side hasn't written
      * the summary yet or it's malformed. */
    private String[] readCapitalSummary(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String raw = prefs.getString(CAPITAL_SUMMARY_KEY, null);
        if (raw == null) return null;
        try {
            JSONObject json = new JSONObject(raw);
            int today = json.getInt("investedHoursToday");
            int total = json.getInt("investedHoursTotal");
            return new String[] {
                "امروز " + toPersianDigits(String.valueOf(today)) + " ساعت",
                "جمع " + toPersianDigits(String.valueOf(total)) + " ساعت"
            };
        } catch (Exception e) {
            return null;
        }
    }

    /** [id, icon, name] for the user's most-used categories, most-used first — the exact same
      * ranking query as QuickCaptureActivity.readTopCategories() (usage = count of Activity rows
      * per category; ties fall back to oldest-created-first so a fresh install still gets a
      * stable, deterministic list instead of an empty one), just capped at MAX_SHORTCUTS
      * instead of 10. */
    private List<String[]> readTopCategories(Context context) {
        List<String[]> result = new ArrayList<>();
        String dbPath = context.getFilesDir().getAbsolutePath() + "/dara.sqlite3";
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
                "LIMIT ?",
                new String[] { LOCAL_USER_ID, LOCAL_USER_ID, String.valueOf(MAX_SHORTCUTS) }
            );
            while (cursor.moveToNext()) {
                result.add(new String[] { cursor.getString(0), cursor.getString(1), cursor.getString(2) });
            }
            cursor.close();
        } catch (Exception e) {
            // Database not created yet, or some other read issue — an empty list renders the
            // widget's own "no categories" row, same fallback every other widget provider uses.
        } finally {
            if (db != null) db.close();
        }
        return result;
    }

    /** Appends a pending capture into the same queue QuickCaptureActivity writes to — see
      * src/local/widgetQueue.ts's drain side. Never touches the SQLite file directly. */
    private void enqueueCapture(Context context, String categoryId, String categoryLabel) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String existingRaw = prefs.getString(CAPTURE_QUEUE_KEY, "[]");
        JSONArray queue;
        try {
            queue = new JSONArray(existingRaw);
        } catch (Exception e) {
            queue = new JSONArray();
        }
        try {
            JSONObject entry = new JSONObject();
            entry.put("title", categoryLabel);
            entry.put("categoryId", categoryId);
            entry.put("durationMinutes", DEFAULT_DURATION_MIN);
            entry.put("startedAt", isoNow());
            entry.put("source", "widget");
            queue.put(entry);
            prefs.edit().putString(CAPTURE_QUEUE_KEY, queue.toString()).apply();
        } catch (Exception ignored) {
            // If this somehow fails, the tap just doesn't register — no crash, matching
            // QuickCaptureActivity.submit()'s fail-soft posture for the same queue mechanism.
        }
    }

    private static String isoNow() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(new Date());
    }

    private static String toPersianDigits(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= '0' && c <= '9') sb.append(PERSIAN_DIGITS[c - '0']);
            else sb.append(c);
        }
        return sb.toString();
    }
}
