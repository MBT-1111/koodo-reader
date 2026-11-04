package xyz.koodoreader.custom.android;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** In-memory only: no book text or playback session is restored after process death. */
final class NativeSpeechQueue {
    final List<String> text = new ArrayList<>();
    final List<String> roles = new ArrayList<>();
    final List<Integer> chapters = new ArrayList<>();
    int index;
    private long revision;
    private final String session = java.util.UUID.randomUUID().toString();
    boolean playing;

    NativeSpeechQueue(List<String> paragraphs, int limit) {
        this(paragraphs, limit, true);
    }

    NativeSpeechQueue(List<String> paragraphs, int limit, List<Integer> chapterIndexes) {
        this(paragraphs, limit, true, null, chapterIndexes);
    }

    private NativeSpeechQueue(List<String> paragraphs, int limit, boolean sentences) {
        this(paragraphs, limit, sentences, null);
    }

    private NativeSpeechQueue(List<String> paragraphs, int limit, boolean sentences, List<String> speakers) {
        this(paragraphs, limit, sentences, speakers, null);
    }

    private NativeSpeechQueue(List<String> paragraphs, int limit, boolean sentences, List<String> speakers, List<Integer> chapterIndexes) {
        if (limit < 2 || paragraphs.size() > 20000) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
        if (speakers != null && (speakers.size() != paragraphs.size() || speakers.stream().anyMatch(role -> !Arrays.asList("narrator", "male", "female", "child").contains(role)))) throw new IllegalArgumentException("ANDROID_SPEECH_ROLES");
        if (chapterIndexes != null) {
            if (chapterIndexes.size() != paragraphs.size()) throw new IllegalArgumentException("ANDROID_SPEECH_CHAPTERS");
            int previous = -1;
            for (Integer chapter : chapterIndexes) {
                if (chapter == null || chapter < previous || chapter < 0 || chapter >= 20000) throw new IllegalArgumentException("ANDROID_SPEECH_CHAPTERS");
                previous = chapter;
            }
        }
        int size = 0;
        for (int index = 0; index < paragraphs.size(); index++) {
            String paragraph = paragraphs.get(index);
            if (paragraph == null || (size += paragraph.length()) > 2000000) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
            // Keep sentence boundaries where possible; never split a surrogate pair.
            for (String sentence : sentences ? paragraph.split("(?<=[。！？.!?；;])\\s*|[\\r\\n]+") : new String[] { paragraph }) {
                String remaining = sentence.trim();
                while (!remaining.isEmpty()) {
                    int end = Math.min(limit, remaining.length());
                    if (end < remaining.length() && Character.isHighSurrogate(remaining.charAt(end - 1))) end--;
                    text.add(remaining.substring(0, end));
                    roles.add(speakers == null ? "narrator" : speakers.get(index));
                    chapters.add(chapterIndexes == null ? 0 : chapterIndexes.get(index));
                    if (text.size() > 20000) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
                    remaining = remaining.substring(end).trim();
                }
            }
        }
        if (text.isEmpty()) throw new IllegalArgumentException("ANDROID_SPEECH_TEXT");
    }

    static NativeSpeechQueue cloud(List<String> paragraphs) {
        return cloud(paragraphs, null);
    }

    static NativeSpeechQueue cloud(List<String> paragraphs, List<String> speakers) {
        return cloud(paragraphs, speakers, null);
    }

    static NativeSpeechQueue cloud(List<String> paragraphs, List<String> speakers, List<Integer> chapterIndexes) {
        NativeSpeechQueue queue = new NativeSpeechQueue(paragraphs, 1200, false, speakers, chapterIndexes);
        List<String> combined = new ArrayList<>();
        List<String> combinedRoles = new ArrayList<>();
        List<Integer> combinedChapters = new ArrayList<>();
        for (int index = 0; index < queue.text.size(); index++) {
            String part = queue.text.get(index), role = queue.roles.get(index);
            int last = combined.size() - 1;
            int chapter = queue.chapters.get(index);
            if (last >= 0 && combinedChapters.get(last) == chapter && combinedRoles.get(last).equals(role) && combined.get(last).length() + part.length() + 1 <= 1200) combined.set(last, combined.get(last) + "\n" + part);
            else { combined.add(part); combinedRoles.add(role); combinedChapters.add(chapter); }
        }
        queue.text.clear(); queue.text.addAll(combined);
        queue.roles.clear(); queue.roles.addAll(combinedRoles);
        queue.chapters.clear(); queue.chapters.addAll(combinedChapters);
        return queue;
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
