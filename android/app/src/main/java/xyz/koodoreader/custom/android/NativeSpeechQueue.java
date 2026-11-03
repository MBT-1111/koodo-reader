package xyz.koodoreader.custom.android;

import java.util.ArrayList;
import java.util.List;

/** In-memory only: no book text or playback session is restored after process death. */
final class NativeSpeechQueue {
    final List<String> text = new ArrayList<>();
    int index;
    private long revision;
    private final String session = java.util.UUID.randomUUID().toString();
    boolean playing;

    NativeSpeechQueue(List<String> paragraphs, int limit) {
        if (limit < 2 || paragraphs.size() > 20000) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
        int size = 0;
        for (String paragraph : paragraphs) {
            if (paragraph == null || (size += paragraph.length()) > 2000000) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
            // Keep sentence boundaries where possible; never split a surrogate pair.
            for (String sentence : paragraph.split("(?<=[。！？.!?；;])\\s*|[\\r\\n]+")) {
                String remaining = sentence.trim();
                while (!remaining.isEmpty()) {
                    int end = Math.min(limit, remaining.length());
                    if (end < remaining.length() && Character.isHighSurrogate(remaining.charAt(end - 1))) end--;
                    text.add(remaining.substring(0, end));
                    if (text.size() > 20000) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
                    remaining = remaining.substring(end).trim();
                }
            }
        }
        if (text.isEmpty()) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
    }

    String token() { return session + ":" + revision + ":" + index; }
    void resume() { revision++; playing = true; }
    void pause() { revision++; playing = false; }
    void move(int delta) { pause(); index = Math.max(0, Math.min(text.size() - 1, index + delta)); }
    boolean finish(String token) {
        if (!playing || !token().equals(token)) return false;
        if (index + 1 < text.size()) index++;
        else pause();
        return true;
    }
}
