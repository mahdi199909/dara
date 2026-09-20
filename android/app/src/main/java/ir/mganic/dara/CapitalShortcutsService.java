package ir.mganic.dara;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.List;

// Backs widget_capital.xml's GridView of one-tap category shortcuts. It used to be exactly three
// buttons in a plain row (nothing in a RemoteViews layout can scroll except a collection view); as
// a GridView it shows the most-used categories three to a row and scrolls to the rest — see
// HabitsWidgetService's class doc comment for why a collection widget is what scrolling needs.
//
// A tap queues a capture exactly as before (CapitalWidgetProvider.onReceive, through the
// @capacitor/preferences hand-off queue) — each row supplies which category via a fill-in intent
// merged onto the provider's click template.
public class CapitalShortcutsService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new ShortcutsRemoteViewsFactory(getApplicationContext());
    }

    private static class Shortcut {
        final String categoryId;
        final String name;
        final String label;

        Shortcut(String categoryId, String name, String label) {
            this.categoryId = categoryId;
            this.name = name;
            this.label = label;
        }
    }

    private static class ShortcutsRemoteViewsFactory implements RemoteViewsFactory {
        // Enough to be worth scrolling, few enough that the query stays trivial.
        private static final int MAX_SHORTCUTS = 12;

        private final Context context;
        private final List<Shortcut> shortcuts = new ArrayList<>();

        // Re-read with the data (onDataSetChanged), so a theme change shows up on the next refresh.
        private int textColor = 0xFF111111;

        ShortcutsRemoteViewsFactory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDestroy() {
            shortcuts.clear();
        }

        @Override
        public void onDataSetChanged() {
            shortcuts.clear();
            textColor = WidgetTheme.getTextColor(context, CapitalWidgetProvider.DEFAULT_BACKGROUND_ARGB);
            shortcuts.addAll(readTopCategories());
        }

        @Override
        public int getCount() {
            return shortcuts.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            Shortcut shortcut = shortcuts.get(position);
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_capital_shortcut_item);
            views.setTextViewText(R.id.shortcut_button, shortcut.label);
            views.setTextColor(R.id.shortcut_button, textColor);

            // Which category this tap is for — merged onto CapitalWidgetProvider's click template.
            Intent fillIn = new Intent();
            fillIn.putExtra(CapitalWidgetProvider.EXTRA_CATEGORY_ID, shortcut.categoryId);
            fillIn.putExtra(CapitalWidgetProvider.EXTRA_CATEGORY_LABEL, shortcut.name);
            views.setOnClickFillInIntent(R.id.shortcut_button, fillIn);
            return views;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }

        /** The user's most-used categories, most-used first — the exact same ranking query as
          * QuickCaptureActivity.readTopCategories() (usage = count of Activity rows per category;
          * ties fall back to oldest-created-first so a fresh install still gets a stable,
          * deterministic list instead of an empty one). */
        private List<Shortcut> readTopCategories() {
            List<Shortcut> result = new ArrayList<>();
            SQLiteDatabase db = null;
            try {
                db = WidgetDb.openReadOnly(context);
                if (db == null) return result; // never opened / mid-write — the grid shows its empty state
                Cursor cursor = db.rawQuery(
                    "SELECT c.id, c.icon, c.name " +
                    "FROM Category c " +
                    "LEFT JOIN (SELECT categoryId, COUNT(*) as cnt FROM Activity WHERE userId = ? GROUP BY categoryId) u " +
                    "ON c.id = u.categoryId " +
                    "WHERE c.userId = ? AND c.deletedAt IS NULL " +
                    "ORDER BY COALESCE(u.cnt, 0) DESC, c.createdAt ASC " +
                    "LIMIT ?",
                    new String[] { WidgetDb.LOCAL_USER_ID, WidgetDb.LOCAL_USER_ID, String.valueOf(MAX_SHORTCUTS) }
                );
                while (cursor.moveToNext()) {
                    String id = cursor.getString(0);
                    String icon = cursor.getString(1);
                    String name = cursor.getString(2);
                    String label = (icon == null || icon.isEmpty() ? "" : icon + " ") + name;
                    result.add(new Shortcut(id, name, label));
                }
                cursor.close();
            } catch (Exception e) {
                // Some other read issue — an empty grid renders the widget's own "no categories" line.
            } finally {
                if (db != null) db.close();
            }
            return result;
        }
    }
}
