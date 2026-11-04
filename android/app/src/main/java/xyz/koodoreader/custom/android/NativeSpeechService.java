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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Consumer;
import java.io.File;

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
    private String source = "system";
    private NativeCloudSpeech cloud;
    private final Map<String, NativeCloudSpeech> roleVoices = new HashMap<>();
    private boolean multiRole;
    private final Map<Integer, String> chapterNames = new HashMap<>();
    private final ExecutorService cloudWorker = Executors.newSingleThreadExecutor();
    private Future<?> cloudTask;
    private int cloudTaskIndex = -1, cloudErrorIndex = -1;
    private long cloudRevision;
    private String cloudError = "";
    private MediaPlayer player;
    private File cloudDirectory;
    private final Map<Integer, File> clips = new LinkedHashMap<>();
    private int cloudPosition;
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { pause(); }
    };

    final class LocalBinder extends Binder { NativeSpeechService service() { return NativeSpeechService.this; } }
    @Override public IBinder onBind(Intent intent) { return new LocalBinder(); }

    @Override public void onCreate() {
        super.onCreate();
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        cloudDirectory = new File(getCacheDir(), "cloud-speech");
        cloudDirectory.mkdirs();
        File[] orphaned = cloudDirectory.listFiles();
        if (orphaned != null) for (File file : orphaned) if (file.isFile() && file.getName().startsWith("clip-")) file.delete();
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
        JSObject result = new JSObject().put("status", status).put("bookKey", bookKey).put("index", queue == null ? 0 : queue.index)
            .put("total", queue == null ? 0 : queue.text.size()).put("error", error).put("source", source)
            .put("multiRole", multiRole).put("role", queue == null ? "narrator" : queue.roles.get(queue.index));
        if (queue != null && !chapterNames.isEmpty()) {
            int chapter = queue.chapters.get(queue.index);
            result.put("chapterDocIndex", chapter).put("chapterTitle", chapterNames.get(chapter));
        }
        return result;
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
        String requestedSource = request.optString("source", "system");
        List<String> roles = null;
        if (request.has("roles") || request.has("roleVoices")) {
            JSONArray inputRoles = request.getJSONArray("roles");
            if (inputRoles.length() != text.size()) throw new IllegalArgumentException("ANDROID_SPEECH_ROLES");
            request.getJSONObject("roleVoices");
            roles = new ArrayList<>();
            for (int i = 0; i < inputRoles.length(); i++) {
                if (!(inputRoles.get(i) instanceof String)) throw new IllegalArgumentException("ANDROID_SPEECH_ROLES");
                roles.add(inputRoles.getString(i));
            }
            if (requestedSource.equals("system")) throw new IllegalArgumentException("ANDROID_SPEECH_ROLES");
        }
        List<Integer> chapterIndexes = null;
        Map<Integer, String> nextChapterNames = new HashMap<>();
        if (request.has("followingChapters")) {
            if (roles != null) throw new IllegalArgumentException("ANDROID_SPEECH_CHAPTERS");
            Object firstIndex = request.get("chapterIndex");
            if (!(firstIndex instanceof Integer) || (Integer) firstIndex < 0 || (Integer) firstIndex >= 20000 || !(request.get("chapterTitle") instanceof String)) throw new IllegalArgumentException("ANDROID_SPEECH_CHAPTERS");
            int chapter = (Integer) firstIndex;
            String chapterTitle = request.getString("chapterTitle");
            if (chapterTitle.length() > 512) throw new IllegalArgumentException("ANDROID_SPEECH_CHAPTERS");
            chapterIndexes = new ArrayList<>(Collections.nCopies(text.size(), chapter));
            nextChapterNames.put(chapter, chapterTitle);
            JSONArray following = request.getJSONArray("followingChapters");
            if (following.length() > 20000) throw new IllegalArgumentException("ANDROID_SPEECH_CHAPTERS");
            for (int i = 0; i < following.length(); i++) {
                JSONObject item = following.getJSONObject(i);
                Object index = item.get("index");
                if (!(index instanceof Integer) || (Integer) index <= chapter || (Integer) index >= 20000 || !(item.get("title") instanceof String)) throw new IllegalArgumentException("ANDROID_SPEECH_CHAPTERS");
                chapter = (Integer) index;
                String label = item.getString("title");
                if (label.length() > 512) throw new IllegalArgumentException("ANDROID_SPEECH_CHAPTERS");
                nextChapterNames.put(chapter, label);
                JSONArray paragraphs = item.getJSONArray("text");
                if (text.size() + paragraphs.length() > 20000) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
                for (int j = 0; j < paragraphs.length(); j++) {
                    if (!(paragraphs.get(j) instanceof String)) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
                    text.add(paragraphs.getString(j)); chapterIndexes.add(chapter);
                }
            }
        }
        if (!requestedSource.equals("system")) {
            NativeSpeechQueue next = NativeSpeechQueue.cloud(text, roles, chapterIndexes);
            NativeCloudSpeech nextCloud = new NativeCloudSpeech(requestedSource, request.getJSONObject("config"), speed);
            Map<String, NativeCloudSpeech> nextVoices = new HashMap<>();
            if (roles != null) {
                JSONObject voices = request.getJSONObject("roleVoices");
                Iterator<String> names = voices.keys();
                while (names.hasNext()) {
                    String role = names.next();
                    if (!Arrays.asList("male", "female", "child").contains(role)) throw new IllegalArgumentException("ANDROID_SPEECH_ROLES");
                    JSONObject voice = voices.getJSONObject(role);
                    nextVoices.put(role, new NativeCloudSpeech(voice.getString("source"), voice.getJSONObject("config"), speed));
                }
            }
            stop(); cloud = nextCloud; roleVoices.putAll(nextVoices); chapterNames.putAll(nextChapterNames); multiRole = roles != null; source = requestedSource;
            queue = next; bookKey = key; title = name; error = ""; resumeSafely(); return;
        }
        NativeSpeechQueue next = new NativeSpeechQueue(text, Math.min(3500, TextToSpeech.getMaxSpeechInputLength()), chapterIndexes);
        Voice voice = engine.getVoices() == null ? null : engine.getVoices().stream().filter(item -> item.getName().equals(voiceName)
            && !item.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)).findFirst().orElse(null);
        if (voice == null) throw new IllegalArgumentException("ANDROID_SPEECH_UNAVAILABLE");
        stop();
        if (engine.setVoice(voice) != TextToSpeech.SUCCESS || engine.setSpeechRate((float) speed) != TextToSpeech.SUCCESS)
            throw new IllegalStateException("ANDROID_SPEECH_UNAVAILABLE");
        queue = next; bookKey = key; title = name; error = ""; source = "system";
        chapterNames.putAll(nextChapterNames);
        resumeSafely();
    }

    private void resumeSafely() {
        if (queue == null || queue.playing) return;
        if (!source.equals("system") && cloud == null) return;
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
        if (cloud != null) { speakCloud(); return; }
        if (engine.speak(queue.text.get(queue.index), TextToSpeech.QUEUE_FLUSH, null, queue.token()) != TextToSpeech.SUCCESS) { fail(); return; }
        publish();
    }

    private void speakCloud() {
        status = "buffering"; publish();
        trimCloudClips();
        File cached = clips.get(queue.index);
        if (cached != null && cached.isFile()) { playCloud(cached, queue, queue.token()); return; }
        if (cloudErrorIndex == queue.index) { failCloud(cloudError); return; }
        requestCloud(queue.index);
    }

    private void trimCloudClips() {
        Iterator<Map.Entry<Integer, File>> entries = clips.entrySet().iterator();
        while (entries.hasNext()) {
            Map.Entry<Integer, File> entry = entries.next();
            if (entry.getKey() < queue.index || entry.getKey() > queue.index + 1) {
                releaseClip(entry.getValue()); entries.remove();
            }
        }
    }

    private void prefetchCloud() {
        trimCloudClips();
        int next = queue.index + 1;
        if (next < queue.text.size() && !clips.containsKey(next) && cloudErrorIndex != next) requestCloud(next);
    }

    private void requestCloud(int index) {
        // A segment ending (or Next) can adopt the in-flight prefetch without a second paid request.
        if (cloudTask != null) {
            if (cloudTaskIndex == index) return;
            cancelCloudWork();
        }
        final NativeSpeechQueue expected = queue;
        final NativeCloudSpeech sessionCloud = cloud;
        final NativeCloudSpeech client = roleVoices.getOrDefault(queue.roles.get(index), cloud);
        final long revision = cloudRevision;
        cloudTaskIndex = index;
        cloudTask = cloudWorker.submit(() -> {
            try {
                File file = client.synthesize(expected.text.get(index), cloudDirectory);
                main.post(() -> {
                    if (cloud != sessionCloud || queue != expected || !queue.playing || cloudRevision != revision) { client.release(file); return; }
                    cloudTask = null; cloudTaskIndex = -1;
                    clips.put(index, file);
                    if (index == queue.index) playCloud(file, expected, queue.token());
                });
            } catch (Exception failure) {
                main.post(() -> {
                    if (cloud == sessionCloud && queue == expected && queue.playing && cloudRevision == revision) {
                        cloudTask = null; cloudTaskIndex = -1;
                        // Let the current audio finish; surface the next segment's error without retrying it.
                        if (index == queue.index) failCloud(failure.getMessage());
                        else { cloudErrorIndex = index; cloudError = failure.getMessage(); }
                    }
                });
            }
        });
    }

    private void failCloud(String code) {
        fail();
        if ("ANDROID_SPEECH_AUTH".equals(code) || "ANDROID_SPEECH_QUOTA".equals(code)) { error = code; publish(); }
    }

    private void playCloud(File file, NativeSpeechQueue expected, String token) {
        try {
            releasePlayer();
            MediaPlayer next = new MediaPlayer(); player = next;
            next.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            next.setDataSource(file.getAbsolutePath());
            Runnable start = () -> {
                if (player != next || queue != expected || !queue.playing || !queue.token().equals(token)) return;
                try { next.setPlaybackParams(new PlaybackParams().setSpeed(roleVoices.getOrDefault(queue.roles.get(queue.index), cloud).playbackSpeed())); next.start(); status = "playing"; publish(); prefetchCloud(); }
                catch (RuntimeException failure) { fail(); }
            };
            next.setOnPreparedListener(value -> { if (player != next) return; if (cloudPosition > 0) { next.setOnSeekCompleteListener(seeked -> start.run()); next.seekTo(cloudPosition); } else start.run(); });
            next.setOnCompletionListener(value -> {
                if (player != next || queue != expected || !queue.finish(token)) return;
                releasePlayer(); cloudPosition = 0;
                if (queue.playing) speak();
                else { closeCloud(); status = "completed"; releasePlayback(); session.setActive(false); publish(); }
            });
            next.setOnErrorListener((value, what, extra) -> { if (player == next) fail(); return true; });
            next.prepareAsync();
        } catch (Exception failure) { fail(); }
    }

    private void releasePlayer() { if (player != null) { player.release(); player = null; } }
    private void releaseClip(File file) { if (cloud != null) cloud.release(file); for (NativeCloudSpeech voice : roleVoices.values()) voice.release(file); }
    private void cancelCloudWork() { cloudRevision++; cloudTaskIndex = -1; if (cloudTask != null) { cloudTask.cancel(true); cloudTask = null; } if (cloud != null) cloud.cancel(); for (NativeCloudSpeech voice : roleVoices.values()) voice.cancel(); }
    private void closeCloud() { cancelCloudWork(); releasePlayer(); if (cloud != null) cloud.close(); for (NativeCloudSpeech voice : roleVoices.values()) voice.close(); roleVoices.clear(); cloud = null; clips.clear(); cloudPosition = 0; cloudErrorIndex = -1; cloudError = ""; }

    void pause() {
        if (queue == null || !queue.playing) return;
        queue.pause(); engine.stop();
        if (cloud != null) {
            if (player != null) { try { cloudPosition = player.getCurrentPosition(); } catch (RuntimeException ignored) {} }
            cancelCloudWork(); releasePlayer();
        }
        status = "paused";
        releasePlayback(); publish();
    }

    void move(int delta) {
        if (queue == null) return;
        boolean playing = queue.playing;
        int target = Math.max(0, Math.min(queue.text.size() - 1, queue.index + delta));
        boolean adoptPrefetch = playing && cloud != null && cloudTaskIndex == target;
        queue.move(delta); engine.stop();
        if (!adoptPrefetch) cancelCloudWork();
        releasePlayer(); cloudPosition = 0;
        if (playing) { queue.resume(); speak(); }
        else { status = "paused"; publish(); }
    }

    void stop() {
        if (queue != null) queue.pause();
        if (engine != null) engine.stop();
        closeCloud();
        queue = null; status = "idle"; bookKey = ""; error = ""; multiRole = false; chapterNames.clear();
        releasePlayback(); session.setActive(false);
        getSystemService(NotificationManager.class).cancel(NOTIFICATION);
        publish();
    }

    private void fail() {
        if (queue != null) queue.pause();
        engine.stop(); closeCloud(); status = "error"; error = "ANDROID_SPEECH_FAILED";
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
        int playback = "buffering".equals(status) ? PlaybackState.STATE_BUFFERING : "playing".equals(status) ? PlaybackState.STATE_PLAYING : "paused".equals(status) ? PlaybackState.STATE_PAUSED : PlaybackState.STATE_STOPPED;
        session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            // Android 13+ derives notification controls from PlaybackState instead of Notification actions.
            .addCustomAction(new PlaybackState.CustomAction.Builder("stop", getString(R.string.speech_stop),
                android.R.drawable.ic_menu_close_clear_cancel).build())
            .setState(playback, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1).build());
        session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, getString(R.string.app_name)).build());
        if (queue != null && ("playing".equals(status) || "buffering".equals(status) || "paused".equals(status))) getSystemService(NotificationManager.class).notify(NOTIFICATION, notification());
        else getSystemService(NotificationManager.class).cancel(NOTIFICATION);
        if (listener != null) listener.accept(state());
    }

    private PendingIntent action(String action) {
        Intent intent = new Intent(this, NativeSpeechService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return "resume".equals(action) ? PendingIntent.getForegroundService(this, 0, intent, flags) : PendingIntent.getService(this, 0, intent, flags);
    }

    private Notification notification() {
        boolean playing = "playing".equals(status) || "buffering".equals(status);
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
        stop(); cloudWorker.shutdownNow(); engine.shutdown(); session.release(); unregisterReceiver(noisy); main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
