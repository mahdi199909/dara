package ir.parvaapp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

// «صندوق ورودی» on the home screen: a 1×1 tile with an inbox-tray icon. Tapping it opens
// InboxCaptureActivity — a text box and nothing else: what is written there goes into the app's
// inbox, to be decided on later (GTD's "capture everything, decide later"). Same shape as
// QuickCaptureWidgetProvider: RemoteViews cannot host a text field, so the tile only launches one.
public class InboxWidgetProvider extends AppWidgetProvider {

    /** The brand teal, used until the person picks a colour for their widgets in Settings. */
    private static final int DEFAULT_BACKGROUND_ARGB = 0xFF0E5F54;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_inbox);

            views.setInt(R.id.widget_theme_overlay, "setBackgroundColor", WidgetTheme.getBackgroundArgb(context, DEFAULT_BACKGROUND_ARGB));
            // The icon is drawn white; tinted to whichever of white / near-black reads on the chosen colour.
            views.setInt(R.id.inbox_icon, "setColorFilter", WidgetTheme.getTextColor(context, DEFAULT_BACKGROUND_ARGB));

            Intent intent = new Intent(context, InboxCaptureActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }
}
