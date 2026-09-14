package ir.mganic.dara;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

// Read-only — this only ever reads the app's SQLite file (never writes), so unlike
// HabitsWidgetProvider it needs no SharedPreferences hand-off queue. The actual row data now
// lives in TodayEventsWidgetService's RemoteViewsFactory (a ListView-backed collection widget,
// for real touch-scrolling) — this class only builds the outer frame and wires the adapter.
public class TodayEventsWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_events);

            views.setInt(R.id.widget_theme_overlay, "setBackgroundColor", WidgetTheme.getBackgroundArgb(context, 0xFFFFFFFF));

            Intent serviceIntent = new Intent(context, TodayEventsWidgetService.class);
            serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            // Data (not just extras) must differ per widget instance, or RemoteViews treats these
            // service intents as equal (Intent.filterEquals() ignores extras) and reuses a stale
            // adapter across multiple placed instances of this same widget.
            serviceIntent.setData(Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME)));
            views.setRemoteAdapter(R.id.events_list, serviceIntent);
            views.setEmptyView(R.id.events_list, R.id.events_empty_view);

            // Explicit MainActivity intent, not getLaunchIntentForPackage() — that resolves to
            // whichever Activity holds the LAUNCHER intent-filter, which is now SplashActivity;
            // a widget tap should jump straight into the app, not sit through the splash delay.
            Intent launch = new Intent(context, MainActivity.class);
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent launchPendingIntent = PendingIntent.getActivity(
                context, appWidgetId, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
            // Used two ways: directly on the root, for taps outside the list (the title, empty
            // space); and as the list's own PendingIntentTemplate, so a tap that lands on an
            // event row (which supplies an empty fill-in — see TodayEventsWidgetService) also
            // opens the app, same as tapping anywhere else on this card always has.
            views.setOnClickPendingIntent(R.id.widget_today_events_root, launchPendingIntent);
            views.setPendingIntentTemplate(R.id.events_list, launchPendingIntent);

            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }
}
