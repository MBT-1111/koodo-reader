package xyz.koodoreader.custom.android;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeCloudSpeechTest {
    private JSONObject config() throws Exception { return new JSONObject().put("apiKey", "synthetic-key").put("voiceName", "zh-CN-XiaoxiaoNeural").put("locale", "zh-CN").put("region", "eastus"); }

    @Test public void azureEscapesBookTextAndAppliesRateAndEmotion() throws Exception {
        NativeCloudSpeech client = new NativeCloudSpeech("azure", config().put("style", "cheerful").put("styleDegree", 1.5), 1.25);
        String ssml = client.body("<book>&\"'\u0000😀");
        assertTrue(ssml.contains("rate=\"+25%\"")); assertTrue(ssml.contains("style=\"cheerful\" styledegree=\"1.5\""));
        assertTrue(ssml.contains("&lt;book&gt;&amp;&quot;&apos;�😀"));
        assertFalse(ssml.contains("synthetic-key"));
    }
    @Test public void mimoUsesAssistantTextAndBase64AudioContract() throws Exception {
        NativeCloudSpeech client = new NativeCloudSpeech("mimo", config().put("voiceName", "冰糖"), 2);
        JSONObject body = new JSONObject(client.body("测试原文"));
        assertEquals("mimo-v2.5-tts", body.getString("model"));
        assertEquals("assistant", body.getJSONArray("messages").getJSONObject(0).getString("role"));
        assertEquals("测试原文", body.getJSONArray("messages").getJSONObject(0).getString("content"));
        assertEquals("冰糖", body.getJSONObject("audio").getString("voice"));
        assertEquals("mp3", body.getJSONObject("audio").getString("format"));
        assertFalse(body.toString().contains("synthetic-key"));
    }
    @Test public void rejectsEndpointCredentialsAndSsmlAttributeInjection() throws Exception {
        assertThrows(Exception.class, () -> new NativeCloudSpeech("azure", config().put("voiceName", "voice\" attack="), 1));
        assertThrows(Exception.class, () -> new NativeCloudSpeech("azure", config().put("endpoint", "file:///private/key"), 1));
        assertThrows(Exception.class, () -> new NativeCloudSpeech("mimo", config().put("endpoint", "https://user:secret@example.invalid"), 1));
        assertThrows(Exception.class, () -> new NativeCloudSpeech("mimo", config().put("apiKey", "key\r\nheader"), 1));
    }
}
