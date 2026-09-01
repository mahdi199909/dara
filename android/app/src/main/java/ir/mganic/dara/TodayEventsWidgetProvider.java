package ir.mganic.dara;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

// Read-only, unlike QuickCaptureWidgetProvider — this only ever reads the app's SQLite file
// (never writes), so it doesn't need the SharedPreferences hand-off queue that widget uses. A
// stale read here (if the app just wrote something and this widget refreshes before that write
// is flushed to disk) just means the list is a few hundred ms out of date until the next
// periodic update — not a data-loss risk the way a native write would be.
public class TodayEventsWidgetProvider extends AppWidgetProvider {

    private static final String LOCAL_USER_ID = "local-device-user";
    private static final int MAX_ROWS = 5;
    private static final String[] PERSIAN_DIGITS = { "۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹" };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_events);
            views.removeAllViews(R.id.events_container);

            List<String[]> events = readTodayEvents(context);
            if (events.isEmpty()) {
                RemoteViews empty = new RemoteViews(context.getPackageName(), R.layout.widget_today_events_empty);
                views.addView(R.id.events_container, empty);
            } else {
                for (String[] event : events) {
                    RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_today_events_item);
                    row.setTextViewText(R.id.event_time, event[0]);
                    row.setTextViewText(R.id.event_title, event[1]);
                    views.addView(R.id.events_container, row);
                }
            }

            // Explicit MainActivity intent, not getLaunchIntentForPackage() — that resolves to
            // whichever Activity holds the LAUNCHER intent-filter, which is now SplashActivity;
            // a widget tap should jump straight into the app, not sit through the splash delay.
            Intent launch = new Intent(context, MainActivity.class);
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, appWidgetId, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_today_events_root, pendingIntent);

            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }

    /** [time label, title] pairs for today's events, earliest first, capped at MAX_ROWS. */
    private List<String[]> readTodayEvents(Context context) {
        List<String[]> result = new ArrayList<>();
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
                "ORDER BY \"startAt\" ASC LIMIT ?",
                new String[] { LOCAL_USER_ID, startIso, endIso, String.valueOf(MAX_ROWS) }
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
                result.add(new String[] { timeLabel, title });
            }
            cursor.close();
        } catch (Exception e) {
            // Database not created yet, or some other read issue — an empty list renders the
            // widget's own "no events" row, which is a perfectly reasonable state either way.
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
