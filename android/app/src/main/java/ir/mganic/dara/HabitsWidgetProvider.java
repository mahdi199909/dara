package ir.mganic.dara;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.TimeZone;
import java.util.Calendar;

// Checklist-style widget: today's active, non-trial habits, each with a tappable checkbox — see
// src/app/(app)/page.tsx's `activeHabits` filter (isActive && !isTrial; trial habits, BJ Fogg's
// 3-day experiments, live only on the dedicated /habits page). The actual row data now lives in
// HabitsWidgetService's RemoteViewsFactory (a ListView-backed collection widget, for real
// touch-scrolling) — this class only builds the outer frame and wires the adapter/click template.
//
// The write side: a tap on a row's checkbox must NOT write to the SQLite file directly — see the
// file-level note on QuickCaptureWidgetProvider for why that risks the WebView's in-memory sql.js
// instance silently clobbering it on its next flush. So a tap instead goes through the exact same
// @capacitor/preferences-backed hand-off queue QuickCapture uses (see src/local/widgetQueue.ts),
// via a small "pending habit checkin" entry that the JS side drains (and actually persists to
// SQLite) on next app open/resume. HabitsWidgetService's factory overlays these not-yet-drained
// taps on top of the SQLite read so the checkbox shows correct-looking instant feedback rather
// than flipping back to unchecked until the next real drain.
public class HabitsWidgetProvider extends AppWidgetProvider {

    static final String ACTION_TOGGLE_CHECKIN = "ir.mganic.dara.action.TOGGLE_HABIT_CHECKIN";
    static final String EXTRA_HABIT_ID = "habitId";

    // Same SharedPreferences file @capacitor/preferences reads/writes as "CapacitorStorage" —
    // see QuickCaptureActivity's PREFS_GROUP for the established precedent of native code
    // sharing that storage with the JS side.
    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String PENDING_CHECKINS_KEY = "widget_pending_habit_checkins";

    @Override
    public void onReceive(Context context, Intent intent) {
        // Handles the standard AppWidgetProvider actions (APPWIDGET_UPDATE etc.) first; our own
        // custom action below is simply ignored by that default implementation, so calling both
        // unconditionally is safe — see AppWidgetProvider.onReceive()'s own action dispatch.
        super.onReceive(context, intent);

        if (ACTION_TOGGLE_CHECKIN.equals(intent.getAction())) {
            String habitId = intent.getStringExtra(EXTRA_HABIT_ID);
            if (habitId != null) {
                enqueuePendingToggle(context, habitId);
                notifyDataChanged(context);
            }
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            appWidgetManager.updateAppWidget(appWidgetId, buildViews(context, appWidgetId));
        }
    }

    /** Refreshes just the list's data (re-running the factory's onDataSetChanged) rather than a
      * full onUpdate — this is what actually shows a just-tapped checkbox's new state without
      * tearing down and rebuilding the whole RemoteViews tree (which would also reset scroll
      * position on every tap). */
    private void notifyDataChanged(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, HabitsWidgetProvider.class));
        if (ids.length > 0) {
            manager.notifyAppWidgetViewDataChanged(ids, R.id.habits_list);
        }
    }

    private RemoteViews buildViews(Context context, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_habits);

        views.setInt(R.id.widget_theme_overlay, "setBackgroundColor", WidgetTheme.getBackgroundArgb(context, 0xFFFFFFFF));

        Intent serviceIntent = new Intent(context, HabitsWidgetService.class);
        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        // Data (not just extras) must differ per widget instance, or RemoteViews treats these
        // service intents as equal (Intent.filterEquals() ignores extras) and reuses a stale
        // adapter across multiple placed instances of this same widget.
        serviceIntent.setData(Uri.parse(serviceIntent.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.habits_list, serviceIntent);
        views.setEmptyView(R.id.habits_list, R.id.habits_empty_view);

        // A collection widget's individual rows can't each carry their own independent
        // PendingIntent — only one PendingIntentTemplate for the whole list, with each row
        // supplying the part that differs (which habit) via setOnClickFillInIntent in the
        // factory. FLAG_MUTABLE (not FLAG_IMMUTABLE) is required here specifically — the system
        // needs to merge that per-row fill-in intent's extras into this template at click time,
        // which an immutable PendingIntent would silently refuse.
        Intent toggleIntent = new Intent(context, HabitsWidgetProvider.class);
        toggleIntent.setAction(ACTION_TOGGLE_CHECKIN);
        PendingIntent toggleTemplate = PendingIntent.getBroadcast(
            context, 0, toggleIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
        views.setPendingIntentTemplate(R.id.habits_list, toggleTemplate);

        // Explicit MainActivity intent, not getLaunchIntentForPackage() — that resolves to
        // whichever Activity holds the LAUNCHER intent-filter, which is now SplashActivity; a
        // widget tap should jump straight into the app, not sit through the splash delay.
        Intent launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent launchPendingIntent = PendingIntent.getActivity(
            context, appWidgetId, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        // Fires for taps outside the list itself (the title, empty space) — a tap that lands on
        // the list goes through the adapter's own template/fill-in above instead.
        views.setOnClickPendingIntent(R.id.widget_habits_root, launchPendingIntent);

        return views;
    }

    /** Local midnight of today, formatted the same way HabitCheckIn.date is stored — matches
      * HabitsWidgetService's own copy of this exact method, used here only as the pending-queue
      * date key. */
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

    /** Appends a pending toggle for this habit + today into the queue the JS side drains on next
      * app resume — see the class doc comment and src/local/widgetQueue.ts's drain side. Never
      * touches the SQLite file directly. */
    private void enqueuePendingToggle(Context context, String habitId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String existingRaw = prefs.getString(PENDING_CHECKINS_KEY, "[]");
        JSONArray queue;
        try {
            queue = new JSONArray(existingRaw);
        } catch (Exception e) {
            queue = new JSONArray();
        }
        try {
            JSONObject entry = new JSONObject();
            entry.put("habitId", habitId);
            entry.put("date", todayIsoUtc());
            entry.put("source", "widget");
            queue.put(entry);
            prefs.edit().putString(PENDING_CHECKINS_KEY, queue.toString()).apply();
        } catch (Exception ignored) {
            // If this somehow fails, the tap just doesn't register — no crash, matching
            // QuickCaptureActivity.submit()'s fail-soft posture for the same queue mechanism.
        }
    }
}
