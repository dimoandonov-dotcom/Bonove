package bg.magazin.ekrani;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/** Държи се жив и когато телевизорът се събуди от готовност, връща рекламите на екрана. */
public class KeepService extends Service {
    private static final String CH = "ekrani";
    private BroadcastReceiver onScreen;

    static void start(Context c) {
        try {
            Intent i = new Intent(c, KeepService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) { }
    }

    static void launch(Context c) {
        try {
            Intent a = new Intent(c, MainActivity.class);
            a.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            c.startActivity(a);
        } catch (Exception ignored) { }
    }

    @Override public void onCreate() {
        super.onCreate();
        Notification.Builder nb;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel(CH, "Екрани", NotificationManager.IMPORTANCE_MIN));
            nb = new Notification.Builder(this, CH);
        } else nb = new Notification.Builder(this);
        Notification n = nb.setContentTitle("Екрани").setContentText("Рекламите се въртят")
                .setSmallIcon(android.R.drawable.ic_media_play).build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(1, n);
        } catch (Exception e) { stopSelf(); return; }

        onScreen = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                if (MainActivity.screen(c) == 0) return;
                // малко изчакване — телевизорът първо показва началния си екран
                new Handler(Looper.getMainLooper()).postDelayed(() -> launch(c), 4000);
            }
        };
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(onScreen, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(onScreen, f);
    }

    @Override public int onStartCommand(Intent i, int flags, int id) { return START_STICKY; }

    @Override public void onDestroy() {
        if (onScreen != null) try { unregisterReceiver(onScreen); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}
