package ir.mganic.dara;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
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
// user-chosen opacity, not a real backdrop blur.
//
// The text on top picks its own color (getTextColor): a neutral white or near-black, whichever
// stays readable. See useLightText for the rule; src/lib/widgetContrast.ts is the same rule in
// TypeScript (it draws the preview in Settings), keep the two in step.
final class WidgetTheme {

    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String COLOR_KEY = "widget_theme_color";
    private static final String OPACITY_KEY = "widget_theme_opacity";

    // Neutral (no hue) on purpose — the brand teal that used to colour some widget text is
    // unreadable on a dark theme, and a tinted text colour reads as a mistake on any custom one.
    private static final int TEXT_ON_LIGHT_BACKGROUND = 0xFF111111;
    private static final int TEXT_ON_DARK_BACKGROUND = 0xFFFFFFFF;
    private static final int SECONDARY_TEXT_ALPHA = 0xB3;

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

    /**
     * True when white text reads better than near-black on this widget's background.
     *
     * A translucent background lets the wallpaper show through, and the wallpaper is unknown. So
     * each candidate (white, black) is scored by its WORST contrast over the two extreme
     * backdrops — a black wallpaper and a white one — and the candidate with the better worst
     * case wins. For an opaque background that is just "whichever has more contrast"; for a
     * see-through one it is the tone that stays readable however the wallpaper turns out. A dead
     * heat (a fully transparent widget) follows the phone's light/dark mode.
     */
    static boolean useLightText(Context context, int defaultBackgroundArgb) {
        int argb = getBackgroundArgb(context, defaultBackgroundArgb);
        float alpha = Color.alpha(argb) / 255f;
        int rgb = argb & 0x00FFFFFF;

        double overBlack = relativeLuminance(blend(rgb, 0x000000, alpha));
        double overWhite = relativeLuminance(blend(rgb, 0xFFFFFF, alpha));
        double whiteWorst = Math.min(contrast(1.0, overBlack), contrast(1.0, overWhite));
        double blackWorst = Math.min(contrast(0.0, overBlack), contrast(0.0, overWhite));

        if (Math.abs(whiteWorst - blackWorst) < 0.01) return isNightMode(context);
        return whiteWorst > blackWorst;
    }

    /** Main text (titles, row labels): neutral white or near-black, whichever stays readable. */
    static int getTextColor(Context context, int defaultBackgroundArgb) {
        return useLightText(context, defaultBackgroundArgb) ? TEXT_ON_DARK_BACKGROUND : TEXT_ON_LIGHT_BACKGROUND;
    }

    /** Hints and empty-state lines: the same neutral tone, softened. */
    static int getSecondaryTextColor(Context context, int defaultBackgroundArgb) {
        int primary = getTextColor(context, defaultBackgroundArgb);
        return (SECONDARY_TEXT_ALPHA << 24) | (primary & 0x00FFFFFF);
    }

    // --- colour maths (WCAG 2.x relative luminance / contrast ratio) -----------------------

    private static int blend(int rgb, int backdropRgb, float alpha) {
        int r = Math.round(alpha * ((rgb >> 16) & 0xFF) + (1f - alpha) * ((backdropRgb >> 16) & 0xFF));
        int g = Math.round(alpha * ((rgb >> 8) & 0xFF) + (1f - alpha) * ((backdropRgb >> 8) & 0xFF));
        int b = Math.round(alpha * (rgb & 0xFF) + (1f - alpha) * (backdropRgb & 0xFF));
        return (r << 16) | (g << 8) | b;
    }

    private static double channel(int value) {
        double s = value / 255.0;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }

    private static double relativeLuminance(int rgb) {
        return 0.2126 * channel((rgb >> 16) & 0xFF) + 0.7152 * channel((rgb >> 8) & 0xFF) + 0.0722 * channel(rgb & 0xFF);
    }

    private static double contrast(double l1, double l2) {
        double hi = Math.max(l1, l2);
        double lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
    }

    private static boolean isNightMode(Context context) {
        int mode = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }
}
