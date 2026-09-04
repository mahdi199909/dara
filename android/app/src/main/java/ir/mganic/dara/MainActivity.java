package ir.mganic.dara;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

// Home-screen widgets (TodayEventsWidgetProvider, HabitsWidgetProvider) read the app's SQLite
// file directly and otherwise only repaint on Android's platform-enforced updatePeriodMillis
// floor of 30 minutes (see the widget_*_info.xml files) or when first placed. That's much too
// slow to feel "live" after the user adds an event or checks off a habit inside the app. The
// user leaving the app (onPause) is the natural, reliable moment to force a repaint instead —
// nothing native-side needs to know WHAT changed, just that it might have.
//
// One subtlety: this app's on-device database (sql.js running inside the WebView — see
// src/local/drivers/browserSqlJs.ts) debounces its flush to the real dara.sqlite3 file by
// ~300ms after the last write, with a visibilitychange/pagehide safety-flush as backup. That JS
// activity isn't synchronized with this Java onPause() in any hard way, so a widget refresh
// broadcast sent the instant onPause() fires could still race a not-yet-flushed write and read
// stale data. Broadcasting twice — once immediately (covers the common case where nothing was
// pending, so there's nothing to wait for) and once after a short delay (covers the case where a
// write was in flight) — is a pragmatic way to make that race very unlikely to matter in
// practice, without wiring up a JS-to-native bridge call just to confirm a flush landed.
public class MainActivity extends BridgeActivity {

    private static final long DELAYED_WIDGET_REFRESH_MS = 800;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // window.print() is a no-op in a bare Android WebView — Capacitor doesn't wire up
        // printing by default. This exposes window.AndroidPrint.print() to JS instead (see
        // src/app/print/report/page.tsx), bridging to Android's real PrintManager so "چاپ /
        // ذخیره PDF" produces the system print dialog, which itself offers "Save as PDF".
        getBridge().getWebView().addJavascriptInterface(new WebPrintBridge(this), "AndroidPrint");
    }

    // QuickCaptureWidgetProvider is deliberately excluded here: it's a static "tap to open the
    // capture form" button with no dynamic content (see its own file-level comment), so
    // re-running its onUpdate() would just redraw the exact same layout — nothing to refresh.
    private static final Class<?>[] REFRESHABLE_WIDGET_PROVIDERS = {
        TodayEventsWidgetProvider.class,
        HabitsWidgetProvider.class,
        CapitalWidgetProvider.class,
    };

    @Override
    public void onPause() {
        super.onPause();
        final Context appContext = getApplicationContext();
        refreshWidgets(appContext);
        // Plain anonymous Runnable, not a lambda — no compileOptions/sourceCompatibility block
        // sets a Java 8+ language level anywhere in this module's Gradle files, and this is the
        // only place in the whole native codebase a lambda was ever attempted.
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                refreshWidgets(appContext);
            }
        }, DELAYED_WIDGET_REFRESH_MS);
    }

    private static void refreshWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (Class<?> provider : REFRESHABLE_WIDGET_PROVIDERS) {
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
            if (ids.length == 0) continue; // provider has no widget currently placed — nothing to do

            Intent intent = new Intent(context, provider);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            context.sendBroadcast(intent);
        }
    }

    // addJavascriptInterface() methods are always invoked on a WebView background thread, never
    // the UI thread — every real call here has to hop back via runOnUiThread() before touching
    // PrintManager or the WebView itself.
    private static class WebPrintBridge {
        private final MainActivity activity;

        WebPrintBridge(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void print() {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    WebView webView = activity.getBridge().getWebView();
                    PrintManager printManager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                    String jobName = activity.getString(R.string.app_name) + " Document";
                    printManager.print(jobName, webView.createPrintDocumentAdapter(jobName), new PrintAttributes.Builder().build());
                }
            });
        }
    }
}
