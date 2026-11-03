package xyz.koodoreader.custom.android;

import android.app.*;
import android.annotation.SuppressLint;
import android.content.*;
import android.media.*;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.*;
import android.speech.tts.*;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

public class NativeSpeechService extends Service {
    private static final String CHANNEL = "reading-speech";
    private static final int NOTIFICATION = 4101;
    final CompletableFuture<Void> ready = new CompletableFuture<>();
    Consumer<JSObject> listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech engine;
    private NativeSpeechQueue queue;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private MediaSession session;
    private PowerManager.WakeLock wake;
    private String status = "idle", bookKey = "", title = "", error = "";
    private boolean foreground;
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { pause(); }
    };

    final class LocalBinder extends Binder { NativeSpeechService service() { return NativeSpeechService.this; } }
    @Override public IBinder onBind(Intent intent) { return new LocalBinder(); }

    @Override public void onCreate() {
        super.onCreate();
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes)
            .setWillPauseWhenDucked(true).setOnAudioFocusChangeListener(change -> {
                if (change < 0) pause(); // Never restart speech unexpectedly after an interruption.
            }, main).build();
        wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":speech");
        wake.setReferenceCounted(false);
        session = new MediaSession(this, "KoodoSpeech");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { resumeSafely(); }
            @Override public void onPause() { pause(); }
            @Override public void onStop() { stop(); }
            @Override public void onSkipToNext() { move(1); }
            @Override public void onSkipToPrevious() { move(-1); }
            @Override public void onCustomAction(String action, Bundle extras) {
                if ("stop".equals(action)) stop();
            }
        }, main);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(
            CHANNEL, getString(R.string.speech_channel), NotificationManager.IMPORTANCE_LOW));
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        engine = new TextToSpeech(this, result -> main.post(() -> {
            if (ready.isDone()) return;
            if (result != TextToSpeech.SUCCESS) { ready.completeExceptionally(new IllegalStateException("ANDROID_SPEECH_UNAVAILABLE")); return; }
            engine.setAudioAttributes(attributes);
            engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { main.post(() -> {
                    if (queue == null || !queue.finish(id)) return;
                    if (queue.playing) speak();
                    else { status = "completed"; releasePlayback(); session.setActive(false); publish(); }
                }); }
                @Override public void onError(String id) { main.post(() -> {
                    if (queue != null && queue.playing && queue.token().equals(id)) fail();
                }); }
            });
            ready.complete(null);
        }));
        main.postDelayed(() -> ready.completeExceptionally(new IllegalStateException("ANDROID_SPEECH_UNAVAILABLE")), 15000);
    }

    JSONArray voices() {
        JSONArray result = new JSONArray();
        Set<Voice> available = engine.getVoices();
        if (available == null) return result;
        available.stream().filter(voice -> !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))
            .sorted(Comparator.comparing(Voice::getName)).forEach(voice -> result.put(new JSObject()
                .put("name", voice.getName()).put("locale", voice.getLocale().toLanguageTag()).put("network", voice.isNetworkConnectionRequired())));
        return result;
    }

    JSObject state() {
        return new JSObject().put("status", status).put("bookKey", bookKey).put("index", queue == null ? 0 : queue.index)
            .put("total", queue == null ? 0 : queue.text.size()).put("error", error);
    }

    void start(JSONObject request) throws Exception {
        String key = request.getString("bookKey"), name = request.getString("title"), voiceName = request.getString("voice");
        double speed = request.getDouble("speed");
        if (key.isEmpty() || key.length() > 256 || name.length() > 512 || voiceName.length() > 512 || !Double.isFinite(speed) || speed < 0.5 || speed > 3)
            throw new IllegalArgumentException("ANDROID_SPEECH_INPUT");
        JSONArray input = request.getJSONArray("text");
        if (input.length() > 20000) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
        List<String> text = new ArrayList<>();
        for (int i = 0; i < input.length(); i++) {
            if (!(input.get(i) instanceof String)) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
            text.add(input.getString(i));
        }
        NativeSpeechQueue next = new NativeSpeechQueue(text, Math.min(3500, TextToSpeech.getMaxSpeechInputLength()));
        Voice voice = engine.getVoices() == null ? null : engine.getVoices().stream().filter(item -> item.getName().equals(voiceName)
            && !item.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)).findFirst().orElse(null);
        if (voice == null) throw new IllegalArgumentException("ANDROID_SPEECH_UNAVAILABLE");
        stop();
        if (engine.setVoice(voice) != TextToSpeech.SUCCESS || engine.setSpeechRate((float) speed) != TextToSpeech.SUCCESS)
            throw new IllegalStateException("ANDROID_SPEECH_UNAVAILABLE");
        queue = next; bookKey = key; title = name; error = "";
        resumeSafely();
    }

    private void resumeSafely() {
        if (queue == null || queue.playing) return;
        try {
            // Establish the foreground service before requesting audio focus (target API 35+).
            startForegroundService(new Intent(this, NativeSpeechService.class));
            status = "playing";
            startForeground(NOTIFICATION, notification()); foreground = true;
            if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { fail(); return; }
            session.setActive(true);
            queue.resume(); speak();
        } catch (RuntimeException exception) { fail(); }
    }

    private void speak() {
        wake.acquire(30 * 60 * 1000L);
        if (engine.speak(queue.text.get(queue.index), TextToSpeech.QUEUE_FLUSH, null, queue.token()) != TextToSpeech.SUCCESS) { fail(); return; }
        publish();
    }

    void pause() {
        if (queue == null || !queue.playing) return;
        queue.pause(); engine.stop(); status = "paused";
        releasePlayback(); publish();
    }

    void move(int delta) {
        if (queue == null) return;
        boolean playing = queue.playing;
        queue.move(delta); engine.stop();
        if (playing) { queue.resume(); speak(); }
        else { status = "paused"; publish(); }
    }

    void stop() {
        if (queue != null) queue.pause();
        if (engine != null) engine.stop();
        queue = null; status = "idle"; bookKey = ""; error = "";
        releasePlayback(); session.setActive(false);
        getSystemService(NotificationManager.class).cancel(NOTIFICATION);
        publish();
    }

    private void fail() {
        if (queue != null) queue.pause();
        engine.stop(); status = "error"; error = "ANDROID_SPEECH_FAILED";
        releasePlayback(); session.setActive(false); publish();
    }

    private void releasePlayback() {
        audio.abandonAudioFocusRequest(focus);
        if (wake.isHeld()) wake.release();
        if (foreground) { stopForeground(STOP_FOREGROUND_DETACH); foreground = false; }
        stopSelf();
    }

    // Only MediaStyle notifications with this MediaSession token are posted.
    // https://developer.android.com/develop/ui/views/notifications/notification-permission#exemptions-media-sessions
    @SuppressLint("NotificationPermission")
    private void publish() {
        int playback = "playing".equals(status) ? PlaybackState.STATE_PLAYING : "paused".equals(status) ? PlaybackState.STATE_PAUSED : PlaybackState.STATE_STOPPED;
        session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            // Android 13+ derives notification controls from PlaybackState instead of Notification actions.
            .addCustomAction(new PlaybackState.CustomAction.Builder("stop", getString(R.string.speech_stop),
                android.R.drawable.ic_menu_close_clear_cancel).build())
            .setState(playback, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1).build());
        session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, getString(R.string.app_name)).build());
        if (queue != null && ("playing".equals(status) || "paused".equals(status))) getSystemService(NotificationManager.class).notify(NOTIFICATION, notification());
        else getSystemService(NotificationManager.class).cancel(NOTIFICATION);
        if (listener != null) listener.accept(state());
    }

    private PendingIntent action(String action) {
        Intent intent = new Intent(this, NativeSpeechService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return "resume".equals(action) ? PendingIntent.getForegroundService(this, 0, intent, flags) : PendingIntent.getService(this, 0, intent, flags);
    }

    private Notification notification() {
        boolean playing = "playing".equals(status);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_speech).setContentTitle(title)
            .setContentText(getString(R.string.speech_channel)).setContentIntent(open).setOnlyAlertOnce(true).setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setDeleteIntent(action("stop"))
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, getString(R.string.speech_previous), action("previous")).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                getString(playing ? R.string.speech_pause : R.string.speech_resume), action(playing ? "pause" : "resume")).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, getString(R.string.speech_stop), action("stop")).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }

    JSObject command(String action) {
        switch (action) {
            case "state": break;
            case "pause": pause(); break;
            case "resume": resumeSafely(); break;
            case "stop": stop(); break;
            case "next": move(1); break;
            case "previous": move(-1); break;
            default: throw new IllegalArgumentException("ANDROID_SPEECH_ACTION");
        }
        return state();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "resume".equals(intent.getAction()) && queue == null) {
            // A stale notification must still satisfy getForegroundService's deadline.
            startForeground(NOTIFICATION, notification()); foreground = true; stop();
        } else if (intent != null && intent.getAction() != null) {
            try { command(intent.getAction()); } catch (IllegalArgumentException error) { stop(); }
        }
        else if (queue == null || !queue.playing) stopSelf();
        return START_NOT_STICKY;
    }

    @Override public void onTaskRemoved(Intent rootIntent) { stop(); }
    @Override public void onDestroy() {
        listener = null; ready.completeExceptionally(new IllegalStateException("ANDROID_SPEECH_UNAVAILABLE"));
        stop(); engine.shutdown(); session.release(); unregisterReceiver(noisy); main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
