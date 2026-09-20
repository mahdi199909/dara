package ir.mganic.dara;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

// Home-screen widgets (TodayEventsWidgetProvider, HabitsWidgetProvider, CapitalWidgetProvider)
// read the app's SQLite file directly, so they only show what has been saved to that file. They are
// repainted (WidgetRefresh.refreshAll) in three situations:
//
// 1. The app tells us its database was just saved — the AndroidWidgets.refresh() bridge below,
//    called from src/local/widgetRefresh.ts after every save. This is what keeps the widgets
//    current while the app is open and when a sync pulls in changes.
// 2. The user leaves the app (onPause) — a backstop for anything the bridge could not cover.
// 3. The system's own timer (updatePeriodMillis, 30 minutes at the platform floor) and the
//    date/time/time-zone changes each provider listens for.
//
// One subtlety for (2): the on-device database (sql.js inside the WebView — see
// src/local/drivers/browserSqlJs.ts) debounces its flush to the real dara.sqlite3 file by ~300ms
// after the last write, with a visibilitychange/pagehide safety-flush as backup. That JS activity is
// not synchronized with this Java onPause() in any hard way, so a refresh broadcast sent the
// instant onPause() fires could still race a not-yet-flushed write. Broadcasting twice — once
// immediately and once after a short delay — makes that race very unlikely to matter, without
// having to wait on the WebView.
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
        // window.AndroidWidgets.refresh(): "the database was just saved, repaint the widgets".
        getBridge().getWebView().addJavascriptInterface(new WidgetBridge(getApplicationContext()), "AndroidWidgets");
    }

    @Override
    public void onPause() {
        super.onPause();
        final Context appContext = getApplicationContext();
        WidgetRefresh.refreshAll(appContext);
        // Plain anonymous Runnable, not a lambda — no compileOptions/sourceCompatibility block
        // sets a Java 8+ language level anywhere in this module's Gradle files.
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                WidgetRefresh.refreshAll(appContext);
            }
        }, DELAYED_WIDGET_REFRESH_MS);
    }

    // addJavascriptInterface() methods are always invoked on a WebView background thread, never
    // the UI thread. Sending a broadcast is fine from any thread.
    private static class WidgetBridge {
        private final Context appContext;

        WidgetBridge(Context appContext) {
            this.appContext = appContext;
        }

        @JavascriptInterface
        public void refresh() {
            WidgetRefresh.refreshAll(appContext);
        }
    }

    // Every real call here has to hop back via runOnUiThread() before touching PrintManager or the
    // WebView itself.
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
