package xyz.koodoreader.custom.android;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.UUID;

/** A reading anchor only; audio, credentials and playback queues are never restored. */
final class NativeSpeechProgress {
    private static SharedPreferences store(Context context) { return context.getSharedPreferences("speech-reading", Context.MODE_PRIVATE); }
    static synchronized JSObject read(Context context, String bookKey) {
        try {
            String saved = store(context).getString(bookKey, null);
            return saved == null ? null : new JSObject(saved);
        } catch (Exception ignored) { return null; }
    }
    static synchronized JSObject save(Context context, String bookKey, int chapter, String title, String text) {
        return save(context, bookKey, chapter, title, text, false);
    }
    static synchronized JSObject save(Context context, String bookKey, int chapter, String title, String text, boolean pdf) {
        JSObject position = new JSObject().put("id", UUID.randomUUID().toString()).put("bookKey", bookKey)
            .put("chapterDocIndex", chapter).put("chapterTitle", title).put("text", NativeSpeechQueue.readingAnchor(text));
        if (pdf) position.put("page", chapter);
        if (!store(context).edit().putString(bookKey, position.toString()).commit()) throw new IllegalStateException("ANDROID_SPEECH_PROGRESS");
        return position;
    }
    static synchronized void acknowledge(Context context, String bookKey, String id) {
        JSObject saved = read(context, bookKey);
        if (saved != null && id.equals(saved.optString("id")) && !store(context).edit().remove(bookKey).commit()) throw new IllegalStateException("ANDROID_SPEECH_PROGRESS");
    }
    static synchronized JSONArray pending(Context context) {
        JSONArray positions = new JSONArray();
        for (String key : store(context).getAll().keySet()) {
            JSObject position = read(context, key);
            if (position != null) positions.put(position);
        }
        return positions;
    }
}
