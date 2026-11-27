package bg.magazin.ekrani;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Екрани — показва /tv/N на цял екран. При първо пускане пита кой екран е.
 *  Смяна на екрана: натисни „Назад“ 3 пъти бързо (или бутона Меню). */
public class MainActivity extends Activity {
    static final String PREFS = "ekrani";
    private WebView web;
    private final Handler h = new Handler(Looper.getMainLooper());
    private long[] backs = new long[3];
    private int backIdx = 0;

    static int screen(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE).getInt("screen", 0); }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        if (screen(this) == 0) showChooser(); else showPlayer();
    }

    @Override protected void onResume() {
        super.onResume();
        hideBars();
        if (screen(this) != 0) KeepService.start(this);
    }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    /* ---------- плейър ---------- */
    private void showPlayer() {
        if (web != null) { web.destroy(); web = null; }
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // видеата тръгват сами и със звук
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " EkraniTV/" + BuildConfig.VERSION_NAME);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) retryLater();
            }
        });
        setContentView(web);
        web.loadUrl(url());
    }

    private String url() { return BuildConfig.BASE_URL + "/tv/" + screen(this) + "?app=1"; }

    private void retryLater() {
        h.removeCallbacksAndMessages(null);
        if (web != null) web.loadData("<html><body style='background:#000;color:#777;font:24px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>Няма връзка… опитвам пак</body></html>", "text/html; charset=utf-8", "UTF-8");
        h.postDelayed(() -> { if (web != null) web.loadUrl(url()); }, 15000);
    }

    /* ---------- избор на екран ---------- */
    private void showChooser() {
        if (web != null) { web.destroy(); web = null; }
        h.removeCallbacksAndMessages(null);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setBackgroundColor(Color.rgb(17, 22, 27));

        TextView t = new TextView(this);
        t.setText("Кой екран е този телевизор?");
        t.setTextColor(Color.WHITE); t.setTextSize(34); t.setGravity(Gravity.CENTER);
        col.addView(t);
        TextView sub = new TextView(this);
        sub.setText("Номерът е същият като в админ страницата (Екран 1, Екран 2 …).\nПо-късно го сменяш с 3 бързи натискания на „Назад“.");
        sub.setTextColor(Color.rgb(150, 160, 170)); sub.setTextSize(18); sub.setGravity(Gravity.CENTER);
        sub.setPadding(0, 16, 0, 36);
        col.addView(sub);

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER);
        Button first = null;
        int cur = screen(this);
        for (int i = 1; i <= 6; i++) {
            final int n = i;
            Button btn = new Button(this);
            btn.setText(String.valueOf(i));
            btn.setTextSize(32);
            btn.setMinWidth(150); btn.setMinHeight(120);
            btn.setOnClickListener(v -> {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putInt("screen", n).apply();
                KeepService.start(this);
                showPlayer();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
            lp.setMargins(12, 0, 12, 0);
            row.addView(btn, lp);
            if (first == null || i == cur) first = btn;
        }
        col.addView(row);

        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            TextView note = new TextView(this);
            note.setText("За да тръгва само при включване на телевизора, разреши „Показване върху други приложения“.");
            note.setTextColor(Color.rgb(227, 162, 59)); note.setTextSize(17); note.setGravity(Gravity.CENTER);
            note.setPadding(40, 40, 40, 12);
            col.addView(note);
            Button allow = new Button(this);
            allow.setText("Разреши автоматичното пускане");
            allow.setTextSize(20);
            allow.setOnClickListener(v -> {
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
                } catch (Exception e) {
                    try { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)); }
                    catch (Exception e2) { note.setText("Отвори Настройки → Приложения → Специален достъп → Показване върху други приложения → Екрани."); }
                }
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
            lp.gravity = Gravity.CENTER_HORIZONTAL;
            col.addView(allow, lp);
        }

        FrameLayout root = new FrameLayout(this);
        root.addView(col, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (first != null) first.requestFocus();
    }

    /* ---------- дистанционно ---------- */
    @Override public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_SETTINGS) { showChooser(); return true; }
        if (code == KeyEvent.KEYCODE_BACK) {
            if (web == null) { if (screen(this) != 0) showPlayer(); return true; }
            long now = System.currentTimeMillis();
            backs[backIdx++ % 3] = now;
            long oldest = Math.min(backs[0], Math.min(backs[1], backs[2]));
            if (oldest > 0 && now - oldest < 2000) { backs = new long[3]; showChooser(); }
            return true; // „Назад“ не излиза от рекламите
        }
        if (web != null && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER)) {
            web.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown'))", null);
        }
        return super.onKeyDown(code, e);
    }

    @Override protected void onDestroy() {
        h.removeCallbacksAndMessages(null);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
