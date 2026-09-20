package ir.mganic.dara;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;

import java.io.File;

// One place that knows where the app's database lives, for everything native that only READS it
// (the widgets and the quick-capture screen).
//
// The app (sql.js inside the WebView, see src/local/drivers/browserSqlJs.ts) saves by writing a
// .tmp file, renaming the current dara.sqlite3 to dara.sqlite3.bak, then renaming the .tmp into
// place. For a moment in between, dara.sqlite3 does not exist — a widget that read at exactly that
// instant used to conclude "no data" and paint its empty state. The .bak is a complete copy of the
// previous version in that window, so falling back to it shows the last saved state instead of a
// blank widget.
final class WidgetDb {

    static final String LOCAL_USER_ID = "local-device-user";

    private static final String DB_FILE = "dara.sqlite3";
    private static final String DB_BACKUP_FILE = "dara.sqlite3.bak";

    private WidgetDb() {}

    /** The database opened read-only, or null when neither the file nor its backup can be read
      * (the app has never been opened, or the file is mid-write and unreadable). The caller owns
      * the returned database and must close it. */
    static SQLiteDatabase openReadOnly(Context context) {
        String dir = context.getFilesDir().getAbsolutePath();
        String[] candidates = { dir + "/" + DB_FILE, dir + "/" + DB_BACKUP_FILE };
        for (String path : candidates) {
            if (!new File(path).exists()) continue;
            try {
                return SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READONLY);
            } catch (Exception e) {
                // unreadable right now — try the next candidate
            }
        }
        return null;
    }
}
