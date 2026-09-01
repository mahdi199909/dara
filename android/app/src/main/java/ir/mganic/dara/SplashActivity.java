package ir.mganic.dara;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

// The LAUNCHER activity (see AndroidManifest.xml) — MainActivity no longer holds that
// intent-filter. Shows the logo, app name, and slogan for a fixed short delay while the real
// app (MainActivity's WebView + JS bundle) loads underneath, then hands off and finishes so the
// user can never navigate "back" into the splash. Plain Activity, not BridgeActivity — this
// screen has no need for the Capacitor bridge/WebView at all.
public class SplashActivity extends Activity {

    private static final long SPLASH_DURATION_MS = 1800;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);

        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                startActivity(new Intent(SplashActivity.this, MainActivity.class));
                finish();
            }
        }, SPLASH_DURATION_MS);
    }
}
