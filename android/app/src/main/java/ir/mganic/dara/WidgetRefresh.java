package ir.mganic.dara;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

// Repaints every placed widget. Used when the app goes to the background (MainActivity.onPause),
// when the app reports that its database was just saved (the AndroidWidgets JS bridge in
// MainActivity), and when the system clock/date/time zone changes (each provider's onReceive).
//
// A widget's frame is rebuilt by its provider's onUpdate; the two list widgets' ROWS are only
// re-read when notifyAppWidgetViewDataChanged is called — which each list provider's onUpdate now
// does, so sending APPWIDGET_UPDATE is enough to refresh a whole widget.
final class WidgetRefresh {

    // QuickCaptureWidgetProvider is here too: its background reads WidgetTheme like the others, so
    // a theme change made in Settings needs it repainted as well.
    private static final Class<?>[] PROVIDERS = {
        TodayEventsWidgetProvider.class,
        HabitsWidgetProvider.class,
        CapitalWidgetProvider.class,
        QuickCaptureWidgetProvider.class,
    };

    private WidgetRefresh() {}

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (Class<?> provider : PROVIDERS) {
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
            if (ids.length == 0) continue; // no widget of this kind is placed — nothing to do

            Intent intent = new Intent(context, provider);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            context.sendBroadcast(intent);
        }
    }

    /** True for the system broadcasts after which "today" may have changed under a widget. */
    static boolean isClockChange(String action) {
        return Intent.ACTION_DATE_CHANGED.equals(action)
            || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action);
    }
}
