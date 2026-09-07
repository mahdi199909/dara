package ir.mganic.dara;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

// Shared by every *WidgetProvider — reads the optional background color/opacity the user picks
// in Settings ("ویجت‌ها" tab), written there via @capacitor/preferences (same "CapacitorStorage"
// SharedPreferences file every other JS<->native hand-off in this app already uses — see
// CapitalWidgetProvider's own note on that). Returns null when the user has never customized
// anything, so every widget's buildViews() can fall back to its original hardcoded look exactly
// as before this existed — this is purely additive, never a required migration.
//
// Only the background is themeable this way. RemoteViews (what AppWidgetProvider renders
// through) has no API for blurring whatever sits behind the widget on the launcher — only for
// the widget's own background color/alpha — so "glassy" here means a solid color at a
// user-chosen opacity, not a real backdrop blur. Text/icon colors are left as each layout already
// defines them; an arbitrary user-chosen color can end up low-contrast against them, the same
// tradeoff any widget-color-customizer leaves to the user rather than guessing at it.
final class WidgetTheme {

    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String COLOR_KEY = "widget_theme_color";
    private static final String OPACITY_KEY = "widget_theme_opacity";

    private WidgetTheme() {}

    /** ARGB color to set as the widget's background overlay, or null if unset — meaning "leave
      * this widget's own default background drawable alone" (see each layout's
      * widget_theme_overlay view, transparent by default). */
    static Integer getBackgroundArgbOrNull(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String colorHex = prefs.getString(COLOR_KEY, null);
        if (colorHex == null) return null;

        int rgb;
        try {
            rgb = Color.parseColor(colorHex) & 0x00FFFFFF;
        } catch (IllegalArgumentException e) {
            return null; // malformed value somehow written — ignore rather than crash the widget
        }

        int opacityPercent = 100;
        String opacityRaw = prefs.getString(OPACITY_KEY, null);
        if (opacityRaw != null) {
            try {
                opacityPercent = Math.max(0, Math.min(100, Integer.parseInt(opacityRaw)));
            } catch (NumberFormatException e) {
                // keep the 100 default
            }
        }
        int alpha = Math.round(opacityPercent / 100f * 255);
        return (alpha << 24) | rgb;
    }
}
