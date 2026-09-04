package ir.mganic.dara;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

// Checklist-style widget: today's active, non-trial habits, each with a tappable checkbox — see
// src/app/(app)/page.tsx's `activeHabits` filter (isActive && !isTrial; trial habits, BJ Fogg's
// 3-day experiments, live only on the dedicated /habits page). Structurally this mirrors
// TodayEventsWidgetProvider on the read side: reads the on-device SQLite file directly on every
// onUpdate(), RemoteViews.addView() in a loop for rows, no RemoteViewsService/ListView.
//
// The write side is the new part. A tap on a row's checkbox must NOT write to the SQLite file
// directly — see the file-level note on QuickCaptureWidgetProvider for why that risks the
// WebView's in-memory sql.js instance silently clobbering it on its next flush. So a tap instead
// goes through the exact same @capacitor/preferences-backed hand-off queue QuickCapture uses
// (see src/local/widgetQueue.ts), via a small "pending habit checkin" entry that the JS side
// drains (and actually persists to SQLite) on next app open/resume.
//
// Because that drain only happens later, a naive implementation would show the checkbox flip
// back to unchecked the next time this widget repaints (onUpdate() re-reads SQLite, which the
// tap never touched). To give correct-looking instant feedback, this class also tracks pending,
// not-yet-drained taps in the same SharedPreferences-backed queue storage (a second key next to
// QuickCapture's, in the same "CapacitorStorage" file @capacitor/preferences itself writes to)
// and overlays that on top of the SQLite read when rendering — see readPendingToggleCounts().
public class HabitsWidgetProvider extends AppWidgetProvider {

    static final String ACTION_TOGGLE_CHECKIN = "ir.mganic.dara.action.TOGGLE_HABIT_CHECKIN";
    static final String EXTRA_HABIT_ID = "habitId";

    private static final String LOCAL_USER_ID = "local-device-user";
    private static final int MAX_ROWS = 5;

    // Same SharedPreferences file @capacitor/preferences reads/writes as "CapacitorStorage" —
    // see QuickCaptureActivity's PREFS_GROUP for the established precedent of native code
    // sharing that storage with the JS side.
    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String PENDING_CHECKINS_KEY = "widget_pending_habit_checkins";

    @Override
    public void onReceive(Context context, Intent intent) {
        // Handles the standard AppWidgetProvider actions (APPWIDGET_UPDATE etc.) first; our own
        // custom action below is simply ignored by that default implementation, so calling both
        // unconditionally is safe — see AppWidgetProvider.onReceive()'s own action dispatch.
        super.onReceive(context, intent);

        if (ACTION_TOGGLE_CHECKIN.equals(intent.getAction())) {
            String habitId = intent.getStringExtra(EXTRA_HABIT_ID);
            if (habitId != null) {
                enqueuePendingToggle(context, habitId);
                refreshAllInstances(context);
            }
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            appWidgetManager.updateAppWidget(appWidgetId, buildViews(context, appWidgetId));
        }
    }

    private void refreshAllInstances(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, HabitsWidgetProvider.class));
        if (ids.length > 0) {
            onUpdate(context, manager, ids);
        }
    }

    private RemoteViews buildViews(Context context, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_habits);
        views.removeAllViews(R.id.habits_container);

        String todayIso = todayIsoUtc();
        List<String[]> habits = readTodayHabits(context);
        Set<String> checkedToday = readCheckedInHabitIds(context, todayIso);
        Map<String, Integer> pendingCounts = readPendingToggleCounts(context, todayIso);

        if (habits.isEmpty()) {
            RemoteViews empty = new RemoteViews(context.getPackageName(), R.layout.widget_habits_empty);
            views.addView(R.id.habits_container, empty);
        } else {
            for (String[] habit : habits) {
                String habitId = habit[0];
                String title = habit[1];

                boolean checkedInSqlite = checkedToday.contains(habitId);
                Integer pending = pendingCounts.get(habitId);
                int pendingCount = pending == null ? 0 : pending;
                // An odd number of not-yet-drained toggles means the true state (once drained)
                // will be the opposite of what SQLite currently shows; an even number (including
                // zero) means SQLite's own state already agrees with reality.
                boolean effectiveChecked = (pendingCount % 2 != 0) != checkedInSqlite;

                RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_habits_item);
                row.setTextViewText(R.id.habit_title, title);
                row.setImageViewResource(
                    R.id.habit_checkbox,
                    effectiveChecked ? R.drawable.ic_habit_checked : R.drawable.ic_habit_unchecked
                );

                Intent toggleIntent = new Intent(context, HabitsWidgetProvider.class);
                toggleIntent.setAction(ACTION_TOGGLE_CHECKIN);
                toggleIntent.putExtra(EXTRA_HABIT_ID, habitId);
                // requestCode must be distinct per habit: PendingIntent treats two intents with
                // the same requestCode targeting the same component as interchangeable and
                // reuses/updates the cached one (via FLAG_UPDATE_CURRENT), *regardless of intent
                // extras* (Intent.filterEquals(), which backs that comparison, does not consider
                // extras). Without a distinct requestCode here, every row's checkbox would end up
                // firing with whichever habitId was rendered last. habitId.hashCode() is unique
                // enough for the handful of rows (MAX_ROWS) this widget ever renders at once.
                PendingIntent togglePendingIntent = PendingIntent.getBroadcast(
                    context,
                    habitId.hashCode(),
                    toggleIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                row.setOnClickPendingIntent(R.id.habit_checkbox, togglePendingIntent);

                views.addView(R.id.habits_container, row);
            }
        }

        // Explicit MainActivity intent, not getLaunchIntentForPackage() — that resolves to
        // whichever Activity holds the LAUNCHER intent-filter, which is now SplashActivity; a
        // widget tap should jump straight into the app, not sit through the splash delay.
        Intent launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent launchPendingIntent = PendingIntent.getActivity(
            context, appWidgetId, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        // Rows bind their own, more specific PendingIntent on R.id.habit_checkbox above;
        // that always takes precedence over this root-level one for a tap that lands on the
        // checkbox specifically, so this only fires for taps elsewhere on the card (the
        // title text, the empty state, empty space) — same "tap card to open app" pattern as
        // TodayEventsWidgetProvider.
        views.setOnClickPendingIntent(R.id.widget_habits_root, launchPendingIntent);

        return views;
    }

    /** Local midnight of today, formatted the same way HabitCheckIn.date is stored (UTC ISO
      * string of the device's local midnight instant) — matches startOfDay(new Date()) on the JS
      * side (src/local/repositories/habits.ts) exactly, since both read the same device clock
      * and timezone. Reused as both the SQLite lookup key and the pending-queue date key so the
      * two sources of truth line up. */
    private static String todayIsoUtc() {
        Calendar startCal = Calendar.getInstance();
        startCal.set(Calendar.HOUR_OF_DAY, 0);
        startCal.set(Calendar.MINUTE, 0);
        startCal.set(Calendar.SECOND, 0);
        startCal.set(Calendar.MILLISECOND, 0);

        SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return isoFmt.format(startCal.getTime());
    }

    /** [id, title] pairs for today's active, non-trial, non-deleted habits — same filter Home
      * applies (isActive && !isTrial) — ordered oldest-first like listHabits(), capped at
      * MAX_ROWS. */
    private List<String[]> readTodayHabits(Context context) {
        List<String[]> result = new ArrayList<>();
        String dbPath = context.getFilesDir().getAbsolutePath() + "/dara.sqlite3";
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(dbPath, null, SQLiteDatabase.OPEN_READONLY);
            Cursor cursor = db.rawQuery(
                "SELECT \"id\", \"title\" FROM \"Habit\" " +
                "WHERE \"userId\" = ? AND \"deletedAt\" IS NULL AND \"isActive\" = 1 AND \"isTrial\" = 0 " +
                "ORDER BY \"createdAt\" ASC LIMIT ?",
                new String[] { LOCAL_USER_ID, String.valueOf(MAX_ROWS) }
            );
            while (cursor.moveToNext()) {
                result.add(new String[] { cursor.getString(0), cursor.getString(1) });
            }
            cursor.close();
        } catch (Exception e) {
            // Database not created yet, or some other read issue — an empty list renders the
            // widget's own "no habits" row, same fallback TodayEventsWidgetProvider uses.
        } finally {
            if (db != null) db.close();
        }
        return result;
    }

    /** habitIds that already have a real HabitCheckIn row for the given day. */
    private Set<String> readCheckedInHabitIds(Context context, String todayIso) {
        Set<String> result = new HashSet<>();
        String dbPath = context.getFilesDir().getAbsolutePath() + "/dara.sqlite3";
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(dbPath, null, SQLiteDatabase.OPEN_READONLY);
            Cursor cursor = db.rawQuery(
                "SELECT hc.\"habitId\" FROM \"HabitCheckIn\" hc " +
                "JOIN \"Habit\" h ON h.\"id\" = hc.\"habitId\" " +
                "WHERE h.\"userId\" = ? AND hc.\"date\" = ?",
                new String[] { LOCAL_USER_ID, todayIso }
            );
            while (cursor.moveToNext()) {
                result.add(cursor.getString(0));
            }
            cursor.close();
        } catch (Exception e) {
            // Same fallback as readTodayHabits — treated as "nothing checked in yet".
        } finally {
            if (db != null) db.close();
        }
        return result;
    }

    /** habitId -> count of not-yet-drained toggle-queue entries for today. Reads the exact same
      * @capacitor/preferences-backed SharedPreferences entry the JS drain
      * (src/local/widgetQueue.ts) consumes and clears on next app resume, so this is purely a
      * read of a shared source of truth, not a second copy of it. */
    private Map<String, Integer> readPendingToggleCounts(Context context, String todayIso) {
        Map<String, Integer> counts = new HashMap<>();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String raw = prefs.getString(PENDING_CHECKINS_KEY, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject entry = arr.optJSONObject(i);
                if (entry == null) continue;
                String habitId = entry.optString("habitId", null);
                String date = entry.optString("date", null);
                if (habitId == null || !todayIso.equals(date)) continue;
                Integer existing = counts.get(habitId);
                counts.put(habitId, (existing == null ? 0 : existing) + 1);
            }
        } catch (Exception ignored) {
            // Malformed queue contents — treat as "nothing pending" rather than break the widget.
        }
        return counts;
    }

    /** Appends a pending toggle for this habit + today into the queue the JS side drains on next
      * app resume — see the class doc comment and src/local/widgetQueue.ts's drain side. Never
      * touches the SQLite file directly. */
    private void enqueuePendingToggle(Context context, String habitId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String existingRaw = prefs.getString(PENDING_CHECKINS_KEY, "[]");
        JSONArray queue;
        try {
            queue = new JSONArray(existingRaw);
        } catch (Exception e) {
            queue = new JSONArray();
        }
        try {
            JSONObject entry = new JSONObject();
            entry.put("habitId", habitId);
            entry.put("date", todayIsoUtc());
            entry.put("source", "widget");
            queue.put(entry);
            prefs.edit().putString(PENDING_CHECKINS_KEY, queue.toString()).apply();
        } catch (Exception ignored) {
            // If this somehow fails, the tap just doesn't register — no crash, matching
            // QuickCaptureActivity.submit()'s fail-soft posture for the same queue mechanism.
        }
    }
}
