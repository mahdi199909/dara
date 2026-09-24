package ir.mganic.dara;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.util.Locale;

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
        // window.AndroidNotifications: the system screens and facts about notifications that the
        // notification plugin does not cover (see src/local/notificationStatus.ts).
        getBridge().getWebView().addJavascriptInterface(new NotificationSettingsBridge(this), "AndroidNotifications");
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

    // Why a reminder does not ring is very often outside the app: the notification switch in system
    // settings, or a battery manager (the system's own, or the brand's: Xiaomi's autostart, Samsung's
    // sleeping apps) that stops a closed app's alarms. The notification plugin can neither read the
    // latter nor open the screens for either, so the notifications card in Settings asks this bridge
    // to (see src/local/notificationStatus.ts). Every open call hops to the UI thread first, like
    // WebPrintBridge, and falls back to the app's own details screen when the wanted one does not
    // exist on this phone.
    private static class NotificationSettingsBridge {
        private final MainActivity activity;

        NotificationSettingsBridge(MainActivity activity) {
            this.activity = activity;
        }

        // Lower-case brand ("xiaomi", "samsung", ...): the battery advice differs per brand.
        @JavascriptInterface
        public String manufacturer() {
            return Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        }

        // false = the system's battery optimization may stop this app's alarms.
        @JavascriptInterface
        public boolean ignoringBatteryOptimizations() {
            PowerManager powerManager = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
            return powerManager != null && powerManager.isIgnoringBatteryOptimizations(activity.getPackageName());
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            Intent wanted;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                wanted = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                wanted.putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
            } else {
                wanted = appDetails();
            }
            open(new Intent[] { wanted });
        }

        // The list of apps with their "don't optimize" switch; needs no special permission.
        @JavascriptInterface
        public void openBatterySettings() {
            open(new Intent[] { new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) });
        }

        // The brand's own autostart / protected-apps screen. Returns false when this brand has none
        // we know of (the app's details screen is opened instead).
        @JavascriptInterface
        public boolean openAutostartSettings() {
            String brand = manufacturer();
            Intent[] candidates;
            if (brand.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco")) {
                candidates = new Intent[] {
                    component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
                };
            } else if (brand.contains("huawei") || brand.contains("honor")) {
                candidates = new Intent[] {
                    component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                    component("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")
                };
            } else if (brand.contains("oppo") || brand.contains("realme") || brand.contains("oneplus")) {
                candidates = new Intent[] {
                    component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                    component("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")
                };
            } else if (brand.contains("vivo") || brand.contains("iqoo")) {
                candidates = new Intent[] {
                    component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                    component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")
                };
            } else {
                open(new Intent[] {});
                return false;
            }
            open(candidates);
            return true;
        }

        private Intent component(String packageName, String className) {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(packageName, className));
            return intent;
        }

        private Intent appDetails() {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", activity.getPackageName(), null));
            return intent;
        }

        // Tries each intent in turn; when none of them can be started, opens the app's details screen.
        private void open(final Intent[] candidates) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    for (Intent candidate : candidates) {
                        try {
                            activity.startActivity(candidate);
                            return;
                        } catch (RuntimeException ignored) {
                            // Not on this phone (ActivityNotFoundException) or not exported (SecurityException).
                        }
                    }
                    try {
                        activity.startActivity(appDetails());
                    } catch (RuntimeException ignored) {
                        // Nothing left to open.
                    }
                }
            });
        }
    }
}
