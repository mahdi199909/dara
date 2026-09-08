package ir.mganic.dara;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

// Shared by every *WidgetProvider — reads the optional background color/opacity the user picks
// in Settings ("ویجت‌ها" tab), written there via @capacitor/preferences (same "CapacitorStorage"
// SharedPreferences file every other JS<->native hand-off in this app already uses — see
// CapitalWidgetProvider's own note on that).
//
// Each widget's root layout background (widget_theme_shape) is deliberately fill-less — only a
// rounded-corner outline for clipToOutline to clip against — so the *only* thing painting a
// visible color is the widget_theme_overlay view getBackgroundArgb's result gets set on. A fully
// opaque default color there reproduces each widget's original hardcoded look exactly; painting
// the root drawable itself with an opaque fill instead (the first version of this) meant a
// translucent theme color could only ever blend against that opaque fill, never truly show the
// launcher/wallpaper behind the widget — it looked "tinted white" instead of glassy.
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

    /** ARGB color to set as the widget's background overlay, or null if the user has never
      * customized one — callers use getBackgroundArgb below rather than this directly. */
    private static Integer getBackgroundArgbOrNull(Context context) {
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

    /** Same as getBackgroundArgbOrNull, but returns defaultArgb (each widget's own original,
      * fully-opaque look) instead of null when the user hasn't customized anything — the overlay
      * view has no XML-level default of its own (it's a plain transparent shape until painted),
      * so a provider must always paint it with *something* on every render. */
    static int getBackgroundArgb(Context context, int defaultArgb) {
        Integer custom = getBackgroundArgbOrNull(context);
        return custom != null ? custom : defaultArgb;
    }
}
