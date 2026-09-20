package ir.mganic.dara;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

// Read-only — this only ever reads the app's SQLite file (never writes), so unlike
// HabitsWidgetProvider it needs no SharedPreferences hand-off queue. The actual row data now
// lives in TodayEventsWidgetService's RemoteViewsFactory (a ListView-backed collection widget,
// for real touch-scrolling) — this class only builds the outer frame and wires the adapter.
//
// The rows are only re-read when notifyAppWidgetViewDataChanged is called (updateAppWidget alone
// repaints the frame and leaves them as they were), so onUpdate notifies too — and the
// date/time/time-zone broadcasts do, so "today" rolls over at midnight without waiting for the
// 30-minute timer.
public class TodayEventsWidgetProvider extends AppWidgetProvider {

    /** The widget's own original background (WidgetTheme paints something else only when the user picked a colour). */
    static final int DEFAULT_BACKGROUND_ARGB = 0xFFFFFFFF;

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);

        if (WidgetRefresh.isClockChange(intent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayEventsWidgetProvider.class));
            if (ids.length > 0) {
                manager.notifyAppWidgetViewDataChanged(ids, R.id.events_list);
            }
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_events);

            views.setInt(R.id.widget_theme_overlay, "setBackgroundColor", WidgetTheme.getBackgroundArgb(context, DEFAULT_BACKGROUND_ARGB));
            views.setTextColor(R.id.widget_title, WidgetTheme.getTextColor(context, DEFAULT_BACKGROUND_ARGB));
            views.setTextColor(R.id.events_empty_view, WidgetTheme.getSecondaryTextColor(context, DEFAULT_BACKGROUND_ARGB));

            Intent serviceIntent = new Intent(context, TodayEventsWidgetService.class);
            serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            // Data (not just extras) must differ per widget instance, or RemoteViews treats these
            // service intents as equal (Intent.filterEquals() ignores extras) and reuses a stale
            // adapter across multiple placed instances of this same widget.
            serviceIntent.setData(Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME)));
            views.setRemoteAdapter(R.id.events_list, serviceIntent);
            views.setEmptyView(R.id.events_list, R.id.events_empty_view);

            // Opens the app on the calendar — MainActivity directly, not the launcher activity
            // (which is the splash), so the tap doesn't sit through the splash delay. Used two
            // ways: directly on the root, for taps outside the list (the title, empty space); and
            // as the list's own PendingIntentTemplate, so a tap that lands on an event row (which
            // supplies an empty fill-in — see TodayEventsWidgetService) opens it too. Mutable
            // because the template has to accept those fill-ins.
            PendingIntent openCalendar = WidgetLinks.open(context, appWidgetId, WidgetLinks.ROUTE_CALENDAR, true);
            views.setOnClickPendingIntent(R.id.widget_today_events_root, openCalendar);
            views.setPendingIntentTemplate(R.id.events_list, openCalendar);

            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
        // updateAppWidget repaints the frame; this is what makes the factory re-read the rows.
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.events_list);
    }
}
