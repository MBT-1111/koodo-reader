package xyz.koodoreader.custom.android;

import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import static org.junit.Assert.*;

public class NativeCredentialStoreTest {
    private File directory;
    private String alias;
    private NativeCredentialStore store;
    @Before public void setup() throws Exception {
        directory = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(), "credential-test-" + UUID.randomUUID());
        assertTrue(directory.mkdir()); alias = "koodo-test-" + UUID.randomUUID(); store = new NativeCredentialStore(directory, alias);
    }
    @After public void cleanup() throws Exception {
        store.execute(request("remove"));
        for (File file : directory.listFiles()) assertTrue(file.delete());
        assertTrue(directory.delete());
    }
    private JSONObject request(String action) throws Exception { return new JSONObject().put("slot", "mega").put("action", action); }
    @Test public void encryptsWithRandomIvAndSurvivesProcessReopening() throws Exception {
        String secret = "synthetic-session-with-unicode-会话";
        assertEquals(JSONObject.NULL, store.execute(request("read")));
        store.execute(request("write").put("value", secret));
        File file = new File(directory, "mega-session-v1.enc"); byte[] first = Files.readAllBytes(file.toPath());
        assertFalse(new String(first, StandardCharsets.UTF_8).contains(secret));
        store = new NativeCredentialStore(directory, alias);
        assertEquals(secret, store.execute(request("read")));
        store.execute(request("write").put("value", secret));
        assertFalse(java.util.Arrays.equals(first, Files.readAllBytes(file.toPath())));
    }
    @Test public void rejectsCorruptCiphertextAndRemovesTheLocalSession() throws Exception {
        store.execute(request("write").put("value", "synthetic-secret"));
        File file = new File(directory, "mega-session-v1.enc");
        JSONObject payload = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        payload.put("data", "AA=="); Files.write(file.toPath(), payload.toString().getBytes(StandardCharsets.UTF_8));
        assertThrows(Exception.class, () -> store.execute(request("read")));
        store.execute(request("remove")); assertEquals(JSONObject.NULL, store.execute(request("read")));
    }
    @Test public void validatesSlotsAndValuesBeforeWriting() throws Exception {
        assertThrows(Exception.class, () -> store.execute(request("write").put("slot", "../escape").put("value", "synthetic")));
        assertThrows(Exception.class, () -> store.execute(request("write").put("value", new JSONObject())));
        assertEquals(JSONObject.NULL, store.execute(request("read")));
    }
}
