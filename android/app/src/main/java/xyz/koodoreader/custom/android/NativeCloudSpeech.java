package xyz.koodoreader.custom.android;

import android.util.Base64;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** One session's HTTP synthesis. Credentials and book text are kept in memory only. */
final class NativeCloudSpeech {
    private static final int LIMIT = 30 * 1024 * 1024;
    private final String source, endpoint, key, voice, locale, style;
    private final double speed, degree;
    private volatile HttpURLConnection active;
    private volatile boolean closed;
    private final Set<File> files = ConcurrentHashMap.newKeySet();

    NativeCloudSpeech(String source, JSONObject config, double speed) throws Exception {
        if (!source.equals("azure") && !source.equals("mimo")) throw new IllegalArgumentException("ANDROID_SPEECH_CONFIG");
        this.source = source; this.speed = speed;
        key = config.getString("apiKey"); voice = config.getString("voiceName");
        if (key.trim().isEmpty() || key.length() > 4096 || key.contains("\r") || key.contains("\n") || voice.trim().isEmpty() || voice.length() > 160) throw new IllegalArgumentException("ANDROID_SPEECH_CONFIG");
        String region = config.optString("region", "eastus");
        if (!region.matches("[a-z][a-z0-9-]{0,62}")) throw new IllegalArgumentException("ANDROID_SPEECH_CONFIG");
        String base = config.optString("endpoint", source.equals("azure") ? "https://" + region + ".tts.speech.microsoft.com" : "https://api.xiaomimimo.com/v1").replaceAll("/+$", "");
        URL url = new URL(base);
        boolean local = url.getHost().equals("localhost") || url.getHost().equals("127.0.0.1");
        if (!(url.getProtocol().equals("https") || (local && url.getProtocol().equals("http") && android.security.NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(url.getHost()))) || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null) throw new IllegalArgumentException("ANDROID_SPEECH_CONFIG");
        endpoint = base + (source.equals("azure") ? "/cognitiveservices/v1" : "/chat/completions");
        locale = config.optString("locale", "zh-CN"); style = config.optString("style", "neutral"); degree = config.optDouble("styleDegree", 1);
        if (source.equals("azure") && (!voice.matches("[a-zA-Z0-9:_-]{1,160}") || !locale.matches("[a-zA-Z0-9-]{1,40}") || !style.matches("[a-z][a-z0-9_-]{0,79}") || !Double.isFinite(degree) || degree < 0.01 || degree > 2)) throw new IllegalArgumentException("ANDROID_SPEECH_CONFIG");
    }

    static String xml(String text) {
        StringBuilder out = new StringBuilder();
        text.codePoints().forEach(code -> {
            if (!(code == 9 || code == 10 || code == 13 || (code >= 32 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) code = 0xfffd;
            switch (code) {
                case '&': out.append("&amp;"); break; case '<': out.append("&lt;"); break; case '>': out.append("&gt;"); break;
                case '"': out.append("&quot;"); break; case '\'': out.append("&apos;"); break; default: out.appendCodePoint(code);
            }
        });
        return out.toString();
    }

    String body(String text) throws JSONException {
        if (source.equals("mimo")) return new JSONObject().put("model", "mimo-v2.5-tts").put("stream", false)
            .put("messages", new JSONArray().put(new JSONObject().put("role", "assistant").put("content", text)))
            .put("audio", new JSONObject().put("format", "mp3").put("voice", voice)).toString();
        long percent = Math.round((speed - 1) * 100);
        String prosody = "<prosody rate=\"" + (percent > 0 ? "+" : "") + percent + "%\">" + xml(text) + "</prosody>";
        if (!style.equals("neutral")) prosody = "<mstts:express-as style=\"" + style + "\" styledegree=\"" + degree + "\">" + prosody + "</mstts:express-as>";
        return "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xmlns:mstts=\"https://www.w3.org/2001/mstts\" xml:lang=\"" + locale + "\"><voice name=\"" + voice + "\">" + prosody + "</voice></speak>";
    }

    File synthesize(String text, File directory) throws Exception {
        if (closed || Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection(); active = connection;
        byte[] audio;
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(60000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty(source.equals("azure") ? "Ocp-Apim-Subscription-Key" : "api-key", key);
            connection.setRequestProperty("Content-Type", source.equals("azure") ? "application/ssml+xml" : "application/json");
            connection.setRequestProperty("User-Agent", "koodo-reader-custom");
            if (source.equals("azure")) connection.setRequestProperty("X-Microsoft-OutputFormat", "audio-16khz-128kbitrate-mono-mp3");
            byte[] request = body(text).getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(request.length);
            try (OutputStream stream = connection.getOutputStream()) { stream.write(request); }
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) throw new IOException("ANDROID_SPEECH_AUTH");
            if (status == 429) throw new IOException("ANDROID_SPEECH_QUOTA");
            if (status != 200) throw new IOException("ANDROID_SPEECH_FAILED");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16384]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (closed || Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                    if (output.size() + count > LIMIT) throw new IOException("ANDROID_SPEECH_FAILED");
                    output.write(buffer, 0, count);
                }
                audio = output.toByteArray();
            }
        } finally { connection.disconnect(); if (active == connection) active = null; }
        if (source.equals("mimo")) {
            String encoded = new JSONObject(new String(audio, StandardCharsets.UTF_8)).getJSONArray("choices").getJSONObject(0).getJSONObject("message").getJSONObject("audio").getString("data");
            audio = Base64.decode(encoded, Base64.DEFAULT);
        }
        if (audio.length == 0 || audio.length > LIMIT || closed || Thread.currentThread().isInterrupted()) throw new IOException("ANDROID_SPEECH_FAILED");
        File file = File.createTempFile("clip-", ".mp3", directory);
        files.add(file);
        try (OutputStream output = new FileOutputStream(file)) { output.write(audio); }
        catch (Exception failure) { file.delete(); throw failure; }
        if (closed) { file.delete(); throw new InterruptedIOException(); }
        return file;
    }

    void cancel() { HttpURLConnection connection = active; if (connection != null) connection.disconnect(); }
    float playbackSpeed() { return source.equals("mimo") ? (float) speed : 1; }
    void release(File file) { files.remove(file); file.delete(); }
    void close() { closed = true; cancel(); for (File file : files) file.delete(); files.clear(); }
}
