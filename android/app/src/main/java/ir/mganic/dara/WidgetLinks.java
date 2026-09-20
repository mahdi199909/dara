package ir.mganic.dara;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

// Taps on a widget that should open the app on a particular screen. The intent is an explicit
// ACTION_VIEW aimed at MainActivity carrying a parva://open/<screen> link: Capacitor's App plugin
// reports such a link to the web side as `appUrlOpen` (app already running) or as the launch URL
// (the tap started it), and src/components/native/DeepLinkHandler.tsx navigates there. Only the
// screens listed in src/lib/widgetRoutes.ts are honoured on that side.
//
// MainActivity, not getLaunchIntentForPackage(): that resolves to SplashActivity, and a widget tap
// should go straight into the app instead of sitting through the splash.
final class WidgetLinks {

    static final String ROUTE_HOME = "/";
    static final String ROUTE_HABITS = "/habits";
    static final String ROUTE_CALENDAR = "/calendar";

    private WidgetLinks() {}

    /** A PendingIntent that opens `route`. Pass mutable = true when it doubles as a collection
      * widget's click template (the system has to merge each row's fill-in into it). */
    static PendingIntent open(Context context, int requestCode, String route, boolean mutable) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("parva://open" + route), context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (mutable ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE);
        return PendingIntent.getActivity(context, requestCode, intent, flags);
    }
}
