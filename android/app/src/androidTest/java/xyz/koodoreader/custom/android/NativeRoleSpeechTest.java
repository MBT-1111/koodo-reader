package xyz.koodoreader.custom.android;

import org.json.JSONObject;
import org.junit.Test;
import java.util.Arrays;
import java.util.Collections;
import static org.junit.Assert.*;

public class NativeRoleSpeechTest {
    private JSONObject config() throws Exception {
        return new JSONObject().put("url", "https://model.invalid/v1/chat/completions").put("native", false)
            .put("headers", new JSONObject().put("Content-Type", "application/json"))
            .put("body", new JSONObject().put("model", "synthetic-model"));
    }
    @Test public void rejectsUnsafeEndpointsAndInjectedHeaders() throws Exception {
        assertThrows(Exception.class, () -> new NativeRoleSpeech(config().put("url", "file:///private/model")));
        assertThrows(Exception.class, () -> new NativeRoleSpeech(config().put("url", "https://user:secret@model.invalid")));
        assertThrows(Exception.class, () -> new NativeRoleSpeech(config().put("headers", new JSONObject().put("Authorization", "value\r\nInjected: x"))));
    }
    @Test public void validatesChapterLimitsBeforeMakingARequest() throws Exception {
        NativeRoleSpeech client = new NativeRoleSpeech(config());
        Exception failure = assertThrows(Exception.class, () -> client.analyze(Collections.singletonList("字".repeat(50001)), Collections.singletonList("Original")));
        assertEquals("CUSTOM_AI_TEXT_TOO_LONG", failure.getMessage()); client.close();
    }
    @Test public void preservesNonverbalTextWithoutSendingItForClassification() throws Exception {
        NativeRoleSpeech client = new NativeRoleSpeech(config());
        NativeRoleSpeech.Result result = client.analyze(Arrays.asList("123", "—", "😀"), Arrays.asList("123", "—", "😀"));
        assertEquals(Arrays.asList("123", "—", "😀"), result.text);
        assertEquals(Arrays.asList("narrator", "narrator", "narrator"), result.roles);
        assertEquals(result.text, result.anchors); client.close();
    }
    @Test public void aClosedSessionCannotStartAnotherPaidRequest() throws Exception {
        NativeRoleSpeech client = new NativeRoleSpeech(config()); client.close();
        assertThrows(java.io.InterruptedIOException.class, () -> client.analyze(Collections.singletonList("原文。"), Collections.singletonList("原文。")));
    }
}
