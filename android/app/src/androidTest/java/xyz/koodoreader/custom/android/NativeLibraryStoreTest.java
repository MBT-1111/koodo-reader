package xyz.koodoreader.custom.android;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeLibraryStoreTest {
    private File directory;
    private NativeLibraryStore store;

    @Before public void setup() throws Exception {
        // Each test owns a fresh cache subdirectory; never open the user's library.
        File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir().getCanonicalFile();
        directory = new File(cache, "native-storage-test-" + UUID.randomUUID()).getCanonicalFile();
        assertEquals(cache, directory.getParentFile());
        store = new NativeLibraryStore(directory);
    }

    @After public void cleanup() throws Exception {
        if (store != null) store.close();
        removeOwnedDirectory(directory);
    }

    private void removeOwnedDirectory(File file) throws Exception {
        assertTrue(file.getCanonicalPath().startsWith(directory.getCanonicalPath() + File.separator) || file.equals(directory));
        if (file.isDirectory()) for (File child : file.listFiles()) removeOwnedDirectory(child);
        assertTrue(file.delete());
    }

    private Object database(String table, String statement, Object data) throws Exception {
        return store.execute(new JSONObject().put("channel", "database-command").put("dbName", table).put("statement", statement).put("data", data));
    }

    private Object file(String action, String name, String data) throws Exception {
        return store.execute(new JSONObject().put("channel", "file-command").put("group", "book").put("action", action).put("name", name).put("data", data));
    }

    private Object preferences(String action, JSONObject snapshot) throws Exception {
        return store.execute(new JSONObject().put("channel", "preferences").put("action", action).put("snapshot", snapshot));
    }

    private JSONObject snapshot(int version) throws Exception {
        return new JSONObject().put("schema", 1).put("version", version).put("values", new JSONObject().put("recordLocation", "{\"测试书\":0.4}"));
    }

    @Test public void preservesRecordsAcrossReopeningAndSeparatesCategories() throws Exception {
        JSONObject note = new JSONObject().put("key", "shared-key").put("bookKey", "book").put("notes", "中文笔记").put("extra", new JSONObject().put("nested", true));
        database("notes", "saveStatement", note);
        database("books", "saveStatement", new JSONObject().put("key", "shared-key").put("name", "书籍"));
        store.close();
        store = new NativeLibraryStore(directory);
        assertEquals("中文笔记", ((JSONObject) database("notes", "getStatement", "shared-key")).getString("notes"));
        assertEquals(1, ((JSONArray) database("notes", "getByBookKeysStatement", new JSONArray().put("book"))).length());
        assertEquals(1, ((JSONArray) database("notes", "getByKeysStatement", new JSONArray().put("shared-key"))).length());
        database("notes", "deleteByBookKeyStatement", "book");
        assertEquals(0, ((JSONArray) database("notes", "getAllStatement", null)).length());
        assertEquals("书籍", ((JSONObject) database("books", "getStatement", "shared-key")).getString("name"));
    }

    @Test public void rollsBackARejectedBulkMigration() throws Exception {
        database("books", "saveStatement", new JSONObject().put("key", "original"));
        JSONArray badRows = new JSONArray().put(new JSONObject().put("key", "new")).put(new JSONObject().put("key", ""));
        assertThrows(Exception.class, () -> database("books", "replaceAllStatement", badRows));
        assertTrue(database("books", "getStatement", "original") instanceof JSONObject);
        assertEquals(JSONObject.NULL, database("books", "getStatement", "new"));
    }

    @Test public void rejectsArbitraryDatabaseAndFileOperations() throws Exception {
        assertThrows(Exception.class, () -> database("books; DROP TABLE records", "getAllStatement", null));
        assertThrows(Exception.class, () -> database("books", "DROP TABLE records", null));
        assertThrows(Exception.class, () -> file("write", "../escape.epub", "AQID"));
        assertThrows(Exception.class, () -> file("write", "bad\nname.epub", "AQID"));
        assertThrows(Exception.class, () -> file("write", "bad\\name.epub", "AQID"));
        assertThrows(Exception.class, () -> file("write", "fixture.epub.bak", "AQID"));
        assertThrows(Exception.class, () -> store.execute(new JSONObject().put("channel", "shell")));
        assertFalse(new File(directory, "escape.epub").exists());
    }

    @Test public void roundTripsAtomicBookBytesAndReportsTheirDigest() throws Exception {
        JSONObject result = (JSONObject) file("write", "fixture.epub", "AQID");
        assertEquals(3, result.getInt("size"));
        assertEquals("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81", result.getString("sha256"));
        assertArrayEquals(new byte[]{1, 2, 3}, Base64.decode((String) file("read", "fixture.epub", null), Base64.DEFAULT));
        assertEquals(true, file("exists", "fixture.epub", null));
        file("remove", "fixture.epub", null);
        assertEquals(JSONObject.NULL, file("read", "fixture.epub", null));
    }

    @Test public void restoresAtomicBackupAndHidesIncompleteWrites() throws Exception {
        file("write", "fixture.epub", "AQID");
        File book = new File(directory, "book/fixture.epub");
        assertTrue(book.renameTo(new File(book + ".bak")));
        Files.write(book.toPath(), new byte[]{9});
        assertArrayEquals(new byte[]{1, 2, 3}, Base64.decode((String) file("read", "fixture.epub", null), Base64.DEFAULT));
        Files.write(new File(directory, "book/partial.epub.new").toPath(), new byte[]{9});
        JSONArray list = (JSONArray) file("list", null, null);
        assertEquals(1, list.length());
        assertEquals("fixture.epub", list.getString(0));
    }

    @Test public void persistsFontsSeparatelyAndRejectsFontPathTraversal() throws Exception {
        JSONObject request = new JSONObject().put("channel", "file-command").put("group", "font")
            .put("name", "中文字体.ttf").put("action", "write").put("data", "AQID");
        assertEquals(3, ((JSONObject) store.execute(request)).getInt("size"));
        store.close();
        store = new NativeLibraryStore(directory);
        assertEquals("AQID", store.execute(request.put("action", "read")));
        assertEquals(JSONObject.NULL, file("read", "中文字体.ttf", null));
        assertThrows(Exception.class, () -> store.execute(new JSONObject(request.toString()).put("name", "../escape.ttf")));
        store.execute(request.put("action", "remove"));
        assertEquals(JSONObject.NULL, store.execute(request.put("action", "read")));
    }

    @Test public void rejectsStalePreferencesAndRetainsTheNewerProgress() throws Exception {
        assertEquals(JSONObject.NULL, preferences("read", null));
        preferences("write", snapshot(2));
        assertThrows(Exception.class, () -> preferences("write", snapshot(1)));
        store.close();
        store = new NativeLibraryStore(directory);
        assertEquals(2, ((JSONObject) preferences("read", null)).getInt("version"));
        assertEquals("{\"测试书\":0.4}", ((JSONObject) preferences("read", null)).getJSONObject("values").getString("recordLocation"));
    }

    @Test public void rejectsMalformedPreferenceSnapshotsBeforeWriting() throws Exception {
        assertThrows(Exception.class, () -> preferences("write", snapshot(1).put("schema", "1")));
        assertThrows(Exception.class, () -> preferences("write", snapshot(1).put("version", 1.5)));
        assertThrows(Exception.class, () -> preferences("write", snapshot(1).put("values", new JSONObject().put("setting", true))));
        assertEquals(JSONObject.NULL, preferences("read", null));
    }

    @Test public void failsClosedWhenAnInitializedSnapshotIsMissingOrCorrupt() throws Exception {
        preferences("write", snapshot(1));
        File prefs = new File(directory, "preferences.json");
        Files.write(prefs.toPath(), "corrupt".getBytes(StandardCharsets.UTF_8));
        assertThrows(Exception.class, () -> preferences("read", null));
        assertTrue(prefs.delete());
        assertThrows(Exception.class, () -> preferences("read", null));
    }
}
