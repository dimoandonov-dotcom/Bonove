package bg.magazin.ekrani;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** След включване на телевизора пуска Екрани. */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        if (MainActivity.screen(c) == 0) return;
        KeepService.start(c);
        KeepService.launch(c);
    }
}
