package xyz.koodoreader.custom.android;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeSpeechProgressTest {
    @Test public void savesOnlyReadingAnchorsAndAnOldAcknowledgmentCannotEraseNewProgress() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String key = "synthetic-progress-" + java.util.UUID.randomUUID();
        try {
            JSObject first = NativeSpeechProgress.save(context, key, 1, "Next", "Original sentence.");
            JSObject second = NativeSpeechProgress.save(context, key, 2, "Later", "Another sentence.");
            NativeSpeechProgress.acknowledge(context, key, first.optString("id"));
            JSObject restored = NativeSpeechProgress.read(context, key);
            assertEquals(second.optString("id"), restored.optString("id"));
            assertEquals(2, restored.optInt("chapterDocIndex"));
            assertEquals("Another sentence.", restored.optString("text"));
            assertFalse(restored.has("queue")); assertFalse(restored.has("apiKey")); assertFalse(restored.has("playing"));
            NativeSpeechProgress.acknowledge(context, key, second.optString("id"));
            assertNull(NativeSpeechProgress.read(context, key));
        } finally {
            JSObject saved = NativeSpeechProgress.read(context, key);
            if (saved != null) NativeSpeechProgress.acknowledge(context, key, saved.optString("id"));
        }
    }
}
