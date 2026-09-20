package ir.mganic.dara;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

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

// Backs widget_habits.xml's ListView with real touch-scrolling — RemoteViews collection widgets
// (ListView/GridView/StackView) are the one Android-documented way to get that inside a widget;
// a plain ScrollView around a LinearLayout (the old widget_habits_container approach) isn't in
// RemoteViews' supported view set and doesn't reliably scroll via touch across launchers. See
// HabitsWidgetProvider for the setRemoteAdapter()/setPendingIntentTemplate() wiring this needs.
public class HabitsWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new HabitsRemoteViewsFactory(getApplicationContext());
    }

    private static class HabitRow {
        final String habitId;
        final String title;
        final boolean checked;

        HabitRow(String habitId, String title, boolean checked) {
            this.habitId = habitId;
            this.title = title;
            this.checked = checked;
        }
    }

    private static class HabitsRemoteViewsFactory implements RemoteViewsFactory {
        private static final String PREFS_GROUP = "CapacitorStorage";
        private static final String PENDING_CHECKINS_KEY = "widget_pending_habit_checkins";

        private final Context context;
        private final List<HabitRow> rows = new ArrayList<>();

        // Re-read with the data (onDataSetChanged), so a theme change shows up on the next refresh.
        private int textColor = 0xFF111111;
        private boolean lightText = false;

        HabitsRemoteViewsFactory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDestroy() {
            rows.clear();
        }

        // Called by the widget framework whenever notifyAppWidgetViewDataChanged() fires (see
        // HabitsWidgetProvider), and once up front the first time this factory is bound — this is
        // the actual data read, moved here verbatim from the old buildViews()'s per-onUpdate loop.
        @Override
        public void onDataSetChanged() {
            rows.clear();

            textColor = WidgetTheme.getTextColor(context, HabitsWidgetProvider.DEFAULT_BACKGROUND_ARGB);
            lightText = WidgetTheme.useLightText(context, HabitsWidgetProvider.DEFAULT_BACKGROUND_ARGB);

            String todayIso = todayIsoUtc();
            List<String[]> habits = readTodayHabits();
            Set<String> checkedToday = readCheckedInHabitIds(todayIso);
            Map<String, Integer> pendingCounts = readPendingToggleCounts(todayIso);

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

                rows.add(new HabitRow(habitId, title, effectiveChecked));
            }
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            HabitRow row = rows.get(position);
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_habits_item);
            views.setTextViewText(R.id.habit_title, row.title);
            views.setTextColor(R.id.habit_title, textColor);
            // The ticked/unticked icons come in a light and a dark variant so they stay visible
            // whichever way the text (and therefore the background) goes.
            int checkedIcon = lightText ? R.drawable.ic_habit_checked_light : R.drawable.ic_habit_checked;
            int uncheckedIcon = lightText ? R.drawable.ic_habit_unchecked_light : R.drawable.ic_habit_unchecked;
            views.setImageViewResource(R.id.habit_checkbox, row.checked ? checkedIcon : uncheckedIcon);

            // A collection widget's rows can't each carry their own independent PendingIntent —
            // only a single PendingIntentTemplate on the ListView itself (see
            // HabitsWidgetProvider.buildViews). This fill-in intent supplies the one thing that
            // differs per row (which habit), merged onto that template at click time.
            Intent fillInIntent = new Intent();
            fillInIntent.putExtra(HabitsWidgetProvider.EXTRA_HABIT_ID, row.habitId);
            views.setOnClickFillInIntent(R.id.habit_checkbox, fillInIntent);

            return views;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null; // default loading view is fine — rows are cheap enough not to need a custom placeholder
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }

        /** Local midnight of today, formatted the same way HabitCheckIn.date is stored (UTC ISO
          * string of the device's local midnight instant) — matches startOfDay(new Date()) on the
          * JS side (src/local/repositories/habits.ts) exactly. */
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
          * applies (isActive && !isTrial), ordered oldest-first like listHabits(). No row cap —
          * that's what the ListView's own scrolling is for now. */
        private List<String[]> readTodayHabits() {
            List<String[]> result = new ArrayList<>();
            SQLiteDatabase db = null;
            try {
                db = WidgetDb.openReadOnly(context);
                if (db == null) return result; // never opened / mid-write — the ListView shows its empty state
                Cursor cursor = db.rawQuery(
                    "SELECT \"id\", \"title\" FROM \"Habit\" " +
                    "WHERE \"userId\" = ? AND \"deletedAt\" IS NULL AND \"isActive\" = 1 AND \"isTrial\" = 0 " +
                    "ORDER BY \"createdAt\" ASC",
                    new String[] { WidgetDb.LOCAL_USER_ID }
                );
                while (cursor.moveToNext()) {
                    result.add(new String[] { cursor.getString(0), cursor.getString(1) });
                }
                cursor.close();
            } catch (Exception e) {
                // Some other read issue — an empty list renders the ListView's own setEmptyView state.
            } finally {
                if (db != null) db.close();
            }
            return result;
        }

        /** habitIds that already have a real HabitCheckIn row for the given day. */
        private Set<String> readCheckedInHabitIds(String todayIso) {
            Set<String> result = new HashSet<>();
            SQLiteDatabase db = null;
            try {
                db = WidgetDb.openReadOnly(context);
                if (db == null) return result;
                Cursor cursor = db.rawQuery(
                    "SELECT hc.\"habitId\" FROM \"HabitCheckIn\" hc " +
                    "JOIN \"Habit\" h ON h.\"id\" = hc.\"habitId\" " +
                    "WHERE h.\"userId\" = ? AND hc.\"date\" = ?",
                    new String[] { WidgetDb.LOCAL_USER_ID, todayIso }
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

        /** habitId -> count of not-yet-drained toggle-queue entries for today. Reads the exact
          * same @capacitor/preferences-backed SharedPreferences entry the JS drain
          * (src/local/widgetQueue.ts) consumes and clears on next app resume. */
        private Map<String, Integer> readPendingToggleCounts(String todayIso) {
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
    }
}
