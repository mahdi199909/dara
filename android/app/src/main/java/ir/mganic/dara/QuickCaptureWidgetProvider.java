package ir.mganic.dara;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

// The home-screen widget itself is deliberately minimal — RemoteViews can't host a real text
// input (no WebView, no live EditText across all supported API levels), so the widget surface is
// just a 1×1 tappable "+" (see widget_quick_capture_info.xml — resizable larger if the user drags
// it bigger, but that default matches how compact this tap target actually needs to be). The
// actual capture form lives in QuickCaptureActivity, a small translucent Activity the tap
// launches — see that class for why it writes to SharedPreferences instead of the app's SQLite
// file directly.
public class QuickCaptureWidgetProvider extends AppWidgetProvider {

    /** The widget's own original background — the brand teal — used until the user picks a colour. */
    private static final int DEFAULT_BACKGROUND_ARGB = 0xFF0E5F54;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_capture);

            views.setInt(R.id.widget_theme_overlay, "setBackgroundColor", WidgetTheme.getBackgroundArgb(context, DEFAULT_BACKGROUND_ARGB));
            // White "+" on the default teal, as always; near-black (or white) automatically on
            // any colour the user picks — whichever contrasts.
            views.setTextColor(R.id.capture_plus_text, WidgetTheme.getTextColor(context, DEFAULT_BACKGROUND_ARGB));

            Intent intent = new Intent(context, QuickCaptureActivity.class);
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
