package ir.parvaapp;

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
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

// Backs widget_today_events.xml's ListView with real touch-scrolling — see HabitsWidgetService's
// class doc comment for why a collection widget (not a plain ScrollView) is what this needs.
// Read-only, unlike HabitsWidgetService — no write-side queue to account for.
//
// Where the rows come from: the app computes the next week itself — events (recurring ones
// expanded, completed occurrences marked, the same code the calendar screen uses), the tasks for each
// day and the installments that fall due, never habits — and stores it under "widget_today_events"
// (src/local/widgetEvents.ts), so the widget shows exactly what the app would. Each item arrives as a
// finished line with its own marker, and each day with its heading text (this class has no Jalali
// calendar). The widget draws the first AGENDA_DAYS days of it: today, tomorrow, the day after, each day
// that has something under its own heading. Only when nothing has been written yet (the app has not been
// opened since it was installed/updated, or not for a week) does it fall back to reading the SQLite file
// directly, which can only see events whose own start falls today.
public class TodayEventsWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new TodayEventsRemoteViewsFactory(getApplicationContext());
    }

    private static class EventRow {
        final String timeLabel;
        final String title;
        /** A day heading ("امروز · دوشنبه ۱۱ آبان") rather than one thing of the agenda. */
        final boolean heading;

        EventRow(String timeLabel, String title) {
            this(timeLabel, title, false);
        }

        EventRow(String timeLabel, String title, boolean heading) {
            this.timeLabel = timeLabel;
            this.title = title;
            this.heading = heading;
        }
    }

    private static class TodayEventsRemoteViewsFactory implements RemoteViewsFactory {
        private static final String[] PERSIAN_DIGITS = { "۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹" };
        // Same SharedPreferences file @capacitor/preferences reads/writes as "CapacitorStorage".
        private static final String PREFS_GROUP = "CapacitorStorage";
        private static final String PUBLISHED_EVENTS_KEY = "widget_today_events";
        // How many days the widget draws, and what each is called; the app publishes a whole week so these
        // stay right after midnight while it has not been opened.
        private static final int AGENDA_DAYS = 3;
        private static final String[] DAY_NAMES = { "امروز", "فردا", "پس‌فردا" };

        private final Context context;
        private final List<EventRow> rows = new ArrayList<>();

        // Re-read with the data (onDataSetChanged), so a theme change shows up on the next refresh.
        private int textColor = 0xFF111111;
        private int headingColor = 0xB3111111;

        TodayEventsRemoteViewsFactory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDestroy() {
            rows.clear();
        }

        @Override
        public void onDataSetChanged() {
            rows.clear();
            textColor = WidgetTheme.getTextColor(context, TodayEventsWidgetProvider.DEFAULT_BACKGROUND_ARGB);
            headingColor = WidgetTheme.getSecondaryTextColor(context, TodayEventsWidgetProvider.DEFAULT_BACKGROUND_ARGB);
            List<EventRow> published = readPublishedEvents();
            rows.addAll(published != null ? published : readTodayEvents());
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            EventRow row = rows.get(position);
            if (row.heading) {
                RemoteViews heading = new RemoteViews(context.getPackageName(), R.layout.widget_today_events_heading);
                heading.setTextViewText(R.id.event_day_heading, row.title);
                heading.setTextColor(R.id.event_day_heading, headingColor);
                // Same as an item: an empty fill-in so a tap still reaches the list's PendingIntentTemplate.
                heading.setOnClickFillInIntent(R.id.event_day_root, new Intent());
                return heading;
            }
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_events_item);
            views.setTextViewText(R.id.event_time, row.timeLabel);
            views.setTextViewText(R.id.event_title, row.title);
            views.setTextColor(R.id.event_time, textColor);
            views.setTextColor(R.id.event_title, textColor);
            // A tap on a row opens the app on the calendar — an empty fill-in still lets it
            // resolve through the ListView's PendingIntentTemplate (see TodayEventsWidgetProvider),
            // instead of the tap being swallowed by row selection.
            views.setOnClickFillInIntent(R.id.event_row_root, new Intent());
            return views;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            // A day heading and a line of the agenda are two different layouts.
            return 2;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }

        /** The agenda rows from what the app published — a heading and then the lines of each of
          * the next AGENDA_DAYS days that has anything — or null when there is nothing usable (never
          * published, malformed, or all of those days are beyond the published week). */
        private List<EventRow> readPublishedEvents() {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
            String raw = prefs.getString(PUBLISHED_EVENTS_KEY, null);
            if (raw == null) return null;
            try {
                JSONObject payload = new JSONObject(raw);
                JSONObject days = payload.optJSONObject("days");
                if (days == null) return null;
                // Older builds published no labels; a heading then is just the day's name.
                JSONObject labels = payload.optJSONObject("labels");

                List<EventRow> result = new ArrayList<>();
                boolean anyDayPublished = false;
                for (int offset = 0; offset < AGENDA_DAYS; offset++) {
                    String key = dayKey(offset);
                    JSONArray list = days.optJSONArray(key);
                    if (list == null) continue; // beyond the published week
                    anyDayPublished = true;

                    List<EventRow> lines = new ArrayList<>();
                    for (int i = 0; i < list.length(); i++) {
                        JSONObject item = list.optJSONObject(i);
                        if (item == null) continue;
                        String title = item.optString("title", "");
                        boolean done = item.optBoolean("done", false);
                        // org.json turns a JSON null into the text "null" through optString, so ask isNull first.
                        String time = item.isNull("t") ? "" : item.optString("t", "");
                        String timeLabel = time.length() == 0 ? "همه‌روز" : toPersianDigits(time);
                        lines.add(new EventRow(timeLabel, (done ? "✓ " : "") + title));
                    }
                    if (lines.isEmpty()) continue; // a day with nothing gets no heading

                    String label = labels == null ? "" : labels.optString(key, "");
                    String heading = label.length() == 0 ? DAY_NAMES[offset] : DAY_NAMES[offset] + " · " + label;
                    result.add(new EventRow("", heading, true));
                    result.addAll(lines);
                }
                return anyDayPublished ? result : null;
            } catch (Exception e) {
                return null;
            }
        }

        /** The device-local date "yyyy-MM-dd", offset days from today — the key the app files each day of the week under. */
        private static String dayKey(int offset) {
            Calendar day = Calendar.getInstance();
            day.add(Calendar.DAY_OF_MONTH, offset);
            return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(day.getTime());
        }

        /** [time label, title] pairs for today's events, earliest first. No row cap — that's what
          * the ListView's own scrolling is for now. */
        private List<EventRow> readTodayEvents() {
            List<EventRow> result = new ArrayList<>();
            SQLiteDatabase db = null;
            try {
                db = WidgetDb.openReadOnly(context);
                if (db == null) return result; // never opened / mid-write — the ListView shows its empty state

                Calendar startCal = Calendar.getInstance();
                startCal.set(Calendar.HOUR_OF_DAY, 0);
                startCal.set(Calendar.MINUTE, 0);
                startCal.set(Calendar.SECOND, 0);
                startCal.set(Calendar.MILLISECOND, 0);
                Calendar endCal = (Calendar) startCal.clone();
                endCal.add(Calendar.DAY_OF_MONTH, 1);

                SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
                String startIso = isoFmt.format(startCal.getTime());
                String endIso = isoFmt.format(endCal.getTime());

                // Soft-deleted events (deletedAt set) are not shown — the app's own calendar hides
                // them, and a synced deletion must disappear from the widget too.
                Cursor cursor = db.rawQuery(
                    "SELECT \"startAt\", \"title\" FROM \"Event\" " +
                    "WHERE \"userId\" = ? AND \"deletedAt\" IS NULL AND \"startAt\" >= ? AND \"startAt\" < ? " +
                    "ORDER BY \"startAt\" ASC",
                    new String[] { WidgetDb.LOCAL_USER_ID, startIso, endIso }
                );

                SimpleDateFormat timeFmt = new SimpleDateFormat("HH:mm", Locale.US);
                while (cursor.moveToNext()) {
                    String startAt = cursor.getString(0);
                    String title = cursor.getString(1);
                    String timeLabel = "--:--";
                    try {
                        isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
                        timeFmt.setTimeZone(TimeZone.getDefault());
                        timeLabel = toPersianDigits(timeFmt.format(isoFmt.parse(startAt)));
                    } catch (Exception ignored) {
                        // keep the "--:--" fallback
                    }
                    result.add(new EventRow(timeLabel, title));
                }
                cursor.close();
            } catch (Exception e) {
                // Some other read issue — an empty list renders the ListView's own setEmptyView state.
            } finally {
                if (db != null) db.close();
            }
            return result;
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
}
