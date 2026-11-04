package xyz.koodoreader.custom.android;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.text.BreakIterator;
import java.util.*;

/** Classifies only the next chapter. Model credentials and source text stay in memory. */
final class NativeRoleSpeech {
    static final class Result {
        final List<String> text = new ArrayList<>(), roles = new ArrayList<>(), anchors = new ArrayList<>();
    }
    private final URL endpoint;
    private final JSONObject headers, template;
    private final boolean nativeGemini;
    private volatile HttpURLConnection active;
    private volatile boolean closed;

    NativeRoleSpeech(JSONObject request) throws Exception {
        endpoint = new URL(request.getString("url"));
        boolean local = endpoint.getHost().equals("localhost") || endpoint.getHost().equals("127.0.0.1");
        if (!(endpoint.getProtocol().equals("https") || (local && endpoint.getProtocol().equals("http") && android.security.NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(endpoint.getHost()))) || endpoint.getUserInfo() != null || endpoint.getRef() != null) throw new IllegalArgumentException("CUSTOM_AI_NOT_CONFIGURED");
        nativeGemini = request.getBoolean("native");
        template = request.getJSONObject("body"); headers = request.getJSONObject("headers");
        if (template.toString().length() > 131072 || headers.length() > 16) throw new IllegalArgumentException("CUSTOM_AI_NOT_CONFIGURED");
        for (Iterator<String> keys = headers.keys(); keys.hasNext();) {
            String key = keys.next(); Object value = headers.get(key);
            if (!key.matches("[a-zA-Z0-9-]{1,80}") || !(value instanceof String) || ((String) value).length() > 8192 || ((String) value).contains("\r") || ((String) value).contains("\n") || Arrays.asList("host", "content-length", "connection").contains(key.toLowerCase(Locale.ROOT))) throw new IllegalArgumentException("CUSTOM_AI_NOT_CONFIGURED");
        }
    }

    Result analyze(List<String> paragraphs, List<String> sourceAnchors) throws Exception {
        Result result = new Result(); int size = 0;
        BreakIterator iterator = BreakIterator.getSentenceInstance(Locale.CHINA);
        for (int p = 0; p < paragraphs.size(); p++) {
            String paragraph = paragraphs.get(p); size += paragraph.length();
            if (size > 50000) throw new IOException("CUSTOM_AI_TEXT_TOO_LONG");
            iterator.setText(paragraph);
            for (int start = iterator.first(), end = iterator.next(); end != BreakIterator.DONE; start = end, end = iterator.next()) {
                String text = paragraph.substring(start, end).trim();
                if (text.isEmpty()) continue;
                result.text.add(text); result.roles.add("narrator"); result.anchors.add(NativeSpeechQueue.readingAnchor(sourceAnchors.get(p)));
                if (result.text.size() > 2000) throw new IOException("CUSTOM_AI_TEXT_TOO_LONG");
            }
        }
        List<Integer> pending = new ArrayList<>();
        for (int i = 0; i < result.text.size(); i++) if (result.text.get(i).codePoints().anyMatch(Character::isLetter)) pending.add(i);
        long deadline = android.os.SystemClock.elapsedRealtime() + 120000;
        for (int offset = 0; offset < pending.size();) {
            if (closed || Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
            JSONArray sentences = new JSONArray(); int count = 0, characters = 0;
            while (offset + count < pending.size() && count < 8 && (count == 0 || characters + result.text.get(pending.get(offset + count)).length() <= 6000)) {
                String text = result.text.get(pending.get(offset + count)); characters += text.length();
                sentences.put(new JSONObject().put("id", String.valueOf(count)).put("text", text)); count++;
            }
            JSONObject body = new JSONObject(template.toString());
            String input = new JSONObject().put("sentences", sentences).toString();
            if (nativeGemini) body.getJSONArray("contents").getJSONObject(0).getJSONArray("parts").getJSONObject(0).put("text", input);
            else { JSONArray messages = body.getJSONArray("messages"); messages.getJSONObject(messages.length() - 1).put("content", input); }
            JSONObject output = new JSONObject(readText(post(body, deadline)).trim().replaceAll("(?s)^```(?:json)?\\s*", "").replaceAll("\\s*```$", ""));
            JSONObject roles = output.getJSONObject("roles");
            for (Iterator<String> keys = roles.keys(); keys.hasNext();) {
                String key = keys.next();
                if (!key.matches("[0-7]") || Integer.parseInt(key) >= count) throw new IOException("CUSTOM_AI_INVALID_RESPONSE");
            }
            for (int i = 0; i < count; i++) {
                Object role = roles.opt(String.valueOf(i));
                if (role == null) continue; // An omitted label is narration; the source sentence is retained.
                if (!(role instanceof String) || !Arrays.asList("narrator", "male", "female", "child").contains(role)) throw new IOException("CUSTOM_AI_INVALID_RESPONSE");
                result.roles.set(pending.get(offset + i), (String) role);
            }
            offset += count;
        }
        return result;
    }

    private JSONObject post(JSONObject body, long deadline) throws Exception {
        int remaining = (int) Math.min(60000, deadline - android.os.SystemClock.elapsedRealtime());
        if (remaining <= 0) throw new IOException("CUSTOM_AI_SERVICE_BUSY");
        HttpURLConnection connection = (HttpURLConnection) endpoint.openConnection(); active = connection;
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(Math.min(15000, remaining)); connection.setReadTimeout(remaining);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            for (Iterator<String> keys = headers.keys(); keys.hasNext();) { String key = keys.next(); connection.setRequestProperty(key, headers.getString(key)); }
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream stream = connection.getOutputStream()) { stream.write(bytes); }
            int status = connection.getResponseCode();
            if (status == 429 || status == 503) throw new IOException("CUSTOM_AI_SERVICE_BUSY");
            if (status != 200) throw new IOException("CUSTOM_AI_REQUEST_FAILED");
            try (InputStream stream = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = stream.read(buffer)) != -1) {
                    if (closed || Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                    if (out.size() + count > 2 * 1024 * 1024) throw new IOException("CUSTOM_AI_INVALID_RESPONSE");
                    out.write(buffer, 0, count);
                }
                return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); if (active == connection) active = null; }
    }
    private String readText(JSONObject response) throws Exception {
        if (nativeGemini) {
            JSONObject candidate = response.getJSONArray("candidates").getJSONObject(0);
            if (candidate.optString("finishReason").equals("MAX_TOKENS")) throw new IOException("CUSTOM_AI_INCOMPLETE_RESPONSE");
            if (!candidate.optString("finishReason", "STOP").equals("STOP")) throw new IOException("CUSTOM_AI_REQUEST_FAILED");
            JSONArray parts = candidate.getJSONObject("content").getJSONArray("parts"); StringBuilder text = new StringBuilder();
            for (int i = 0; i < parts.length(); i++) if (!parts.getJSONObject(i).optBoolean("thought")) text.append(parts.getJSONObject(i).optString("text"));
            return text.toString();
        }
        JSONObject choice = response.getJSONArray("choices").getJSONObject(0);
        if (choice.optString("finish_reason").equals("length")) throw new IOException("CUSTOM_AI_INCOMPLETE_RESPONSE");
        return choice.getJSONObject("message").getString("content");
    }
    void cancel() { HttpURLConnection connection = active; if (connection != null) connection.disconnect(); }
    void close() { closed = true; cancel(); }
}
