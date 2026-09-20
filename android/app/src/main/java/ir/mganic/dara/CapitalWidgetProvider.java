package ir.mganic.dara;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

// Shows today's/lifetime invested-hours summary plus one-tap shortcut buttons for the user's
// most-used categories (a scrollable grid — see CapitalShortcutsService) — "ثبت را بدون باز شدن
// اپ ممکن کن" (make logging possible without opening the app), the widget half of that (the
// notification half is separate, not yet built).
//
// The capital number is read-only and never computed here — see readCapitalSummary(). It's
// whatever src/local/reportEngine.ts's writeCapitalWidgetSummary last wrote to the
// "widget_capital_summary" Preferences key — on boot/resume, on every /api/capital read, and after
// every save of the database (src/local/widgetRefresh.ts) — so it's always exactly what the app
// itself computed, never independently wrong the way a widget-side recomputation from a
// possibly-different formula could be.
//
// A shortcut tap queues a capture the exact same way QuickCaptureActivity/HabitsWidgetProvider's
// checkbox do — through the @capacitor/preferences-backed hand-off queue (src/local/widgetQueue.ts
// drains it), never the app's SQLite file directly. Unlike the habit checkbox, there's no
// "checked" visual state to give optimistic feedback for here — a capture is a one-shot append,
// not a toggle — so a Toast is the only confirmation; nothing about this widget's own layout needs
// to repaint after a tap.
public class CapitalWidgetProvider extends AppWidgetProvider {

    static final String ACTION_QUICK_CAPTURE = "ir.mganic.dara.action.WIDGET_QUICK_CAPTURE";
    static final String EXTRA_CATEGORY_ID = "categoryId";
    static final String EXTRA_CATEGORY_LABEL = "categoryLabel";

    /** The widget's own original background (WidgetTheme paints something else only when the user picked a colour). */
    static final int DEFAULT_BACKGROUND_ARGB = 0xFFFFFFFF;

    // The single most common quick-log duration — same default QuickCaptureActivity's duration
    // chips start on. A one-tap shortcut has nowhere to ask for a different one; the user can
    // still edit the logged duration later from inside the app like any other record.
    private static final int DEFAULT_DURATION_MIN = 60;

    // Same SharedPreferences file @capacitor/preferences reads/writes as "CapacitorStorage" —
    // see QuickCaptureActivity/HabitsWidgetProvider for the established precedent.
    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String CAPITAL_SUMMARY_KEY = "widget_capital_summary";
    private static final String CAPTURE_QUEUE_KEY = "widget_pending_captures";

    private static final String[] PERSIAN_DIGITS = { "۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹" };

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);

        String action = intent.getAction();
        if (ACTION_QUICK_CAPTURE.equals(action)) {
            String categoryId = intent.getStringExtra(EXTRA_CATEGORY_ID);
            String categoryLabel = intent.getStringExtra(EXTRA_CATEGORY_LABEL);
            if (categoryId != null && categoryLabel != null) {
                enqueueCapture(context, categoryId, categoryLabel);
                Toast.makeText(context, "«" + categoryLabel + "» ثبت شد", Toast.LENGTH_SHORT).show();
            }
        } else if (WidgetRefresh.isClockChange(action)) {
            // A new day started: repaint so "today" is not still showing yesterday's hours.
            WidgetRefresh.refreshAll(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            appWidgetManager.updateAppWidget(appWidgetId, buildViews(context, appWidgetId));
        }
        // updateAppWidget repaints the frame; this is what makes the grid re-read its shortcuts.
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.shortcuts_grid);
    }

    private RemoteViews buildViews(Context context, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_capital);

        views.setInt(R.id.widget_theme_overlay, "setBackgroundColor", WidgetTheme.getBackgroundArgb(context, DEFAULT_BACKGROUND_ARGB));
        int textColor = WidgetTheme.getTextColor(context, DEFAULT_BACKGROUND_ARGB);
        views.setTextColor(R.id.widget_title, textColor);
        views.setTextColor(R.id.capital_summary, textColor);
        views.setTextColor(R.id.shortcuts_empty, WidgetTheme.getSecondaryTextColor(context, DEFAULT_BACKGROUND_ARGB));

        String[] summary = readCapitalSummary(context);
        if (summary == null) {
            // Nothing written yet (app never opened once) or malformed — hide the line rather
            // than show a fabricated "۰ ساعت" that isn't really traceable to anything yet.
            views.setViewVisibility(R.id.capital_summary, View.GONE);
        } else {
            views.setViewVisibility(R.id.capital_summary, View.VISIBLE);
            views.setTextViewText(R.id.capital_summary, summary[0] + " — " + summary[1]);
        }

        // The shortcut grid is a collection widget: the rows come from CapitalShortcutsService, and
        // one PendingIntentTemplate serves them all, each row supplying which category through its
        // fill-in intent. FLAG_MUTABLE (not FLAG_IMMUTABLE) because the system has to merge that
        // fill-in into this template at click time — an immutable one would silently refuse.
        Intent serviceIntent = new Intent(context, CapitalShortcutsService.class);
        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        // Data (not just extras) must differ per widget instance — see HabitsWidgetProvider.
        serviceIntent.setData(Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.shortcuts_grid, serviceIntent);
        views.setEmptyView(R.id.shortcuts_grid, R.id.shortcuts_empty);

        Intent captureIntent = new Intent(context, CapitalWidgetProvider.class);
        captureIntent.setAction(ACTION_QUICK_CAPTURE);
        PendingIntent captureTemplate = PendingIntent.getBroadcast(
            context, 0, captureIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
        views.setPendingIntentTemplate(R.id.shortcuts_grid, captureTemplate);

        // A tap elsewhere on the card (the title, the summary) opens the app on the home screen,
        // where the capital is shown; a tap on a shortcut goes through the grid's template above.
        views.setOnClickPendingIntent(R.id.widget_capital_root, WidgetLinks.open(context, appWidgetId, WidgetLinks.ROUTE_HOME, false));

        return views;
    }

    /** ["امروز N ساعت", "جمع M ساعت"] in Persian digits, or null if the JS side hasn't written
      * the summary yet or it's malformed. If the summary was written on an earlier day, "today" is
      * a new day nothing has been logged on yet, so it reads 0 rather than yesterday's figure. */
    private String[] readCapitalSummary(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String raw = prefs.getString(CAPITAL_SUMMARY_KEY, null);
        if (raw == null) return null;
        try {
            JSONObject json = new JSONObject(raw);
            int today = writtenToday(json.optString("updatedAt", null)) ? json.getInt("investedHoursToday") : 0;
            int total = json.getInt("investedHoursTotal");
            return new String[] {
                "امروز " + toPersianDigits(String.valueOf(today)) + " ساعت",
                "جمع " + toPersianDigits(String.valueOf(total)) + " ساعت"
            };
        } catch (Exception e) {
            return null;
        }
    }

    /** True when the ISO timestamp (UTC, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") falls on the device's
      * current local day. An unreadable timestamp counts as "today" — better a possibly-stale
      * figure than a wrong zero. */
    private static boolean writtenToday(String updatedAtIso) {
        if (updatedAtIso == null) return true;
        try {
            SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date written = isoFmt.parse(updatedAtIso);

            Calendar a = Calendar.getInstance();
            a.setTime(written);
            Calendar b = Calendar.getInstance();
            return a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR);
        } catch (Exception e) {
            return true;
        }
    }

    /** Appends a pending capture into the same queue QuickCaptureActivity writes to — see
      * src/local/widgetQueue.ts's drain side. Never touches the SQLite file directly. */
    private void enqueueCapture(Context context, String categoryId, String categoryLabel) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String existingRaw = prefs.getString(CAPTURE_QUEUE_KEY, "[]");
        JSONArray queue;
        try {
            queue = new JSONArray(existingRaw);
        } catch (Exception e) {
            queue = new JSONArray();
        }
        try {
            JSONObject entry = new JSONObject();
            entry.put("title", categoryLabel);
            entry.put("categoryId", categoryId);
            entry.put("durationMinutes", DEFAULT_DURATION_MIN);
            entry.put("startedAt", isoNow());
            entry.put("source", "widget");
            queue.put(entry);
            prefs.edit().putString(CAPTURE_QUEUE_KEY, queue.toString()).apply();
        } catch (Exception ignored) {
            // If this somehow fails, the tap just doesn't register — no crash, matching
            // QuickCaptureActivity.submit()'s fail-soft posture for the same queue mechanism.
        }
    }

    private static String isoNow() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(new Date());
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
