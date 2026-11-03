package xyz.koodoreader.custom.android;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Process;
import android.os.SystemClock;
import android.view.View;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Installed in the test APK, never in production. Does not access the library. */
public class SpeechFocusProbeActivity extends Activity {
    private AudioManager audio;
    private AudioFocusRequest focus;
    private boolean requested;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(new View(this));
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus || requested) return;
        requested = true;
        String mode = getIntent().getStringExtra("mode");
        int gain;
        if ("duck".equals(mode)) gain = AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK;
        else if ("transient".equals(mode)) gain = AudioManager.AUDIOFOCUS_GAIN_TRANSIENT;
        else if ("gain".equals(mode)) gain = AudioManager.AUDIOFOCUS_GAIN;
        else { finish(); return; }
        focus = new AudioFocusRequest.Builder(gain).setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setOnAudioFocusChangeListener(change -> {}).build();
        try {
            JSONObject result = new JSONObject().put("uid", Process.myUid()).put("mode", mode)
                .put("granted", audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
                .put("time", SystemClock.elapsedRealtime());
            try (FileOutputStream output = new FileOutputStream(new File(getFilesDir(), "focus-probe.json"))) {
                output.write(result.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception error) { finish(); }
    }

    @Override public void onPause() {
        if (focus != null) audio.abandonAudioFocusRequest(focus);
        super.onPause();
    }
}
