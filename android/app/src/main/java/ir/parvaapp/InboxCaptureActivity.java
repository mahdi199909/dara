package ir.parvaapp;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

// What the «صندوق ورودی» widget opens: one text box. Write, tap ✓ and it is kept — no
// parsing, no preview, no questions: deciding what it is happens later, inside the app's inbox.
//
// Like QuickCaptureActivity it never writes the app's SQLite file: the text goes into the same
// SharedPreferences file @capacitor/preferences uses (group "CapacitorStorage"), under a key of its
// own, and the app moves it into the inbox the next time it is opened or resumed
// (src/local/widgetQueue.ts, drainInboxQueue). "ثبت شد" only shows once that write is confirmed
// (commit(), not apply()).
public class InboxCaptureActivity extends Activity {

    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String QUEUE_KEY = "widget_pending_inbox";
    /** Same ceiling as the app's inbox (INBOX_MAX_LENGTH in src/lib/schemas/inbox.ts). */
    private static final int MAX_LENGTH = 5000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        setContentView(R.layout.activity_inbox_capture);

        findViewById(R.id.inbox_scrim).setOnClickListener(v -> {
            if (v.getId() == R.id.inbox_scrim) finish();
        });

        // Several lines are fine (Enter starts a new one); ✓ keeps it.
        EditText input = findViewById(R.id.inbox_text);
        input.requestFocus();

        findViewById(R.id.inbox_save).setOnClickListener(v -> save(input.getText().toString()));
    }

    private void save(String raw) {
        String text = raw == null ? "" : raw.trim();
        if (text.isEmpty()) {
            Toast.makeText(this, "چیزی بنویس", Toast.LENGTH_SHORT).show();
            return;
        }
        if (text.length() > MAX_LENGTH) text = text.substring(0, MAX_LENGTH);
        try {
            JSONObject entry = new JSONObject();
            entry.put("v", 1);
            entry.put("text", text);
            entry.put("createdAt", isoNow());

            SharedPreferences prefs = getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
            JSONArray queue;
            try {
                queue = new JSONArray(prefs.getString(QUEUE_KEY, "[]"));
            } catch (Exception e) {
                queue = new JSONArray();
            }
            queue.put(entry);

            boolean saved = prefs.edit().putString(QUEUE_KEY, queue.toString()).commit();
            if (saved) {
                Toast.makeText(this, "به صندوق ورودی رفت", Toast.LENGTH_SHORT).show();
                finish();
            } else {
                Toast.makeText(this, "ذخیره نشد. دوباره امتحان کن.", Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "خطایی رخ داد. دوباره تلاش کنید.", Toast.LENGTH_SHORT).show();
        }
    }

    private static String isoNow() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(new Date());
    }
}
