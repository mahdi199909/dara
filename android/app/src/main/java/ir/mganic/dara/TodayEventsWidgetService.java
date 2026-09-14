package ir.mganic.dara;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

// Backs widget_today_events.xml's ListView with real touch-scrolling — see HabitsWidgetService's
// class doc comment for why a collection widget (not a plain ScrollView) is what this needs.
// Read-only, unlike HabitsWidgetService — this only ever reads the app's SQLite file directly, no
// write-side queue to account for.
public class TodayEventsWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new TodayEventsRemoteViewsFactory(getApplicationContext());
    }

    private static class EventRow {
        final String timeLabel;
        final String title;

        EventRow(String timeLabel, String title) {
            this.timeLabel = timeLabel;
            this.title = title;
        }
    }

    private static class TodayEventsRemoteViewsFactory implements RemoteViewsFactory {
        private static final String LOCAL_USER_ID = "local-device-user";
        private static final String[] PERSIAN_DIGITS = { "۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹" };

        private final Context context;
        private final List<EventRow> rows = new ArrayList<>();

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
            rows.addAll(readTodayEvents());
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            EventRow row = rows.get(position);
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_events_item);
            views.setTextViewText(R.id.event_time, row.timeLabel);
            views.setTextViewText(R.id.event_title, row.title);
            // No per-row destination beyond "open the app" — an empty fill-in still lets a tap
            // on this row resolve through the ListView's PendingIntentTemplate (see
            // TodayEventsWidgetProvider), instead of the tap being swallowed by row selection.
            views.setOnClickFillInIntent(R.id.event_row_root, new Intent());
            return views;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
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

        /** [time label, title] pairs for today's events, earliest first. No row cap — that's what
          * the ListView's own scrolling is for now. */
        private List<EventRow> readTodayEvents() {
            List<EventRow> result = new ArrayList<>();
            String dbPath = context.getFilesDir().getAbsolutePath() + "/dara.sqlite3";
            SQLiteDatabase db = null;
            try {
                db = SQLiteDatabase.openDatabase(dbPath, null, SQLiteDatabase.OPEN_READONLY);

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

                Cursor cursor = db.rawQuery(
                    "SELECT \"startAt\", \"title\" FROM \"Event\" " +
                    "WHERE \"userId\" = ? AND \"startAt\" >= ? AND \"startAt\" < ? " +
                    "ORDER BY \"startAt\" ASC",
                    new String[] { LOCAL_USER_ID, startIso, endIso }
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
                // Database not created yet, or some other read issue — an empty list renders the
                // ListView's own setEmptyView state.
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
