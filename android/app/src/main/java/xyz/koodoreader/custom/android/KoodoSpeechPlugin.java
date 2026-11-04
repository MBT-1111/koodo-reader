package xyz.koodoreader.custom.android;

import android.content.*;
import android.os.*;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "KoodoSpeech")
public class KoodoSpeechPlugin extends Plugin {
    @PluginMethod public void readingPosition(PluginCall call) {
        String key = call.getString("bookKey", "");
        if (key.isEmpty() && !call.getData().has("acknowledge")) { call.resolve(new JSObject().put("positions", NativeSpeechProgress.pending(getContext()))); return; }
        if (key.isEmpty() || key.length() > 256) { call.reject("ANDROID_SPEECH_INPUT"); return; }
        String id = call.getString("acknowledge");
        if (id != null && !id.matches("[0-9a-f-]{36}")) { call.reject("ANDROID_SPEECH_INPUT"); return; }
        if (id != null) NativeSpeechProgress.acknowledge(getContext(), key, id);
        call.resolve(new JSObject().put("position", NativeSpeechProgress.read(getContext(), key)));
    }
    private final Handler main = new Handler(Looper.getMainLooper());
    private CompletableFuture<NativeSpeechService> connected = new CompletableFuture<>();
    private NativeSpeechService service;
    private boolean bound;
    private boolean destroyed;
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((NativeSpeechService.LocalBinder) binder).service();
            service.listener = state -> notifyListeners("stateChanged", state);
            connected.complete(service);
        }
        @Override public void onServiceDisconnected(ComponentName name) { service = null; connected = new CompletableFuture<>(); }
    };

    @PluginMethod public void execute(PluginCall call) {
        main.post(() -> {
            if (destroyed) { call.reject("ANDROID_SPEECH_UNAVAILABLE"); return; }
            if (!bound) {
                bound = getContext().bindService(new Intent(getContext(), NativeSpeechService.class), connection, Context.BIND_AUTO_CREATE);
                if (!bound) { call.reject("ANDROID_SPEECH_UNAVAILABLE"); return; }
            }
            String action = call.getString("action", "");
            AtomicBoolean settled = new AtomicBoolean();
            Runnable timeout = () -> { if (settled.compareAndSet(false, true)) call.reject("ANDROID_SPEECH_UNAVAILABLE"); };
            main.postDelayed(timeout, 16000);
            boolean systemEngine = "voices".equals(action) || ("start".equals(action) && "system".equals(call.getString("source", "system")));
            connected.thenCompose(target -> systemEngine ? target.ready : CompletableFuture.completedFuture(null)).whenComplete((unused, failure) -> main.post(() -> {
                main.removeCallbacks(timeout);
                if (!settled.compareAndSet(false, true)) return;
                if (failure != null || service == null || destroyed) { call.reject("ANDROID_SPEECH_UNAVAILABLE"); return; }
                try {
                    if ("voices".equals(action)) call.resolve(new JSObject().put("voices", service.voices()));
                    else if ("start".equals(action)) { service.start(call.getData()); call.resolve(service.state()); }
                    else call.resolve(service.command(action));
                } catch (Exception error) { call.reject("ANDROID_SPEECH_FAILED"); }
            }));
        });
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        if (service != null) service.listener = null;
        if (bound) getContext().unbindService(connection);
        connected.completeExceptionally(new IllegalStateException("ANDROID_SPEECH_UNAVAILABLE"));
        super.handleOnDestroy();
    }
}
