package xyz.koodoreader.custom.android;

import android.util.AtomicFile;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.io.File;
import java.security.MessageDigest;
import java.util.UUID;
import static org.junit.Assert.*;

public class NativeLibraryManagerTest {
    private File directory;
    private NativeLibraryManager manager;
    private final String token = UUID.randomUUID().toString();

    @Before public void setup() throws Exception {
        File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir().getCanonicalFile();
        directory = new File(cache, "library-manager-test-" + UUID.randomUUID()).getCanonicalFile();
        assertEquals(cache, directory.getParentFile());
        manager = new NativeLibraryManager(directory);
        manager.execute(table("books", "saveStatement").put("data", book("old")));
        manager.execute(file("write", "book", "old.epub").put("data", "AQID"));
        manager.execute(file("write", "font", "old.ttf").put("data", "AQID"));
        manager.execute(new JSONObject().put("channel", "preferences").put("action", "write").put("snapshot", new JSONObject().put("schema", 1).put("version", 7).put("values", new JSONObject().put("readerConfig", "{}"))));
    }
    @After public void cleanup() throws Exception { if (manager != null) manager.close(); remove(directory); }
    private void remove(File file) throws Exception {
        assertTrue(file.getCanonicalPath().equals(directory.getCanonicalPath()) || file.getCanonicalPath().startsWith(directory.getCanonicalPath() + File.separator));
        if (file.isDirectory()) for (File child : file.listFiles()) remove(child);
        assertTrue(file.delete());
    }
    private JSONObject table(String table, String statement) throws Exception { return new JSONObject().put("channel", "database-command").put("dbName", table).put("statement", statement); }
    private JSONObject command(String statement) throws Exception { return table("library", statement).put("token", token); }
    private JSONObject file(String action, String group, String name) throws Exception { return new JSONObject().put("channel", "file-command").put("action", action).put("group", group).put("name", name); }
    private JSONObject book(String key) throws Exception { return new JSONObject().put("key", key).put("name", "测试书").put("format", "EPUB"); }
    private JSONObject prefs() throws Exception { return (JSONObject) manager.execute(new JSONObject().put("channel", "preferences").put("action", "read")); }
    @Test public void metadataRestorePreservesOriginalsAndOtherTables() throws Exception {
        manager.execute(table("words", "saveStatement").put("data", new JSONObject().put("key", "word").put("bookKey", "old")));
        JSONObject capture = (JSONObject) manager.execute(command("backupBeginStatement"));
        JSONObject tables = capture.getJSONObject("tables"); tables.remove("words"); tables.remove("plugins");
        tables.put("notes", new JSONArray().put(new JSONObject().put("key", "restored-note").put("bookKey", "old").put("notes", "笔记")));
        JSONObject result = (JSONObject) manager.execute(command("dataCommitStatement").put("data", new JSONObject().put("tables", tables).put("preferences", new JSONObject().put("readerConfig", "{\"fontSize\":\"24\"}"))));
        assertEquals(token, result.getJSONObject("values").getString("__koodo_native_restore_id"));
        assertEquals("AQID", manager.execute(file("read", "book", "old.epub")));
        assertEquals("AQID", manager.execute(file("read", "font", "old.ttf")));
        assertEquals(1, ((JSONArray) manager.execute(table("words", "getAllStatement"))).length());
        manager.execute(command("backupEndStatement"));
        manager.close(); manager = new NativeLibraryManager(directory);
        assertEquals(1, ((JSONArray) manager.execute(table("notes", "getAllStatement"))).length());
        assertFalse(new File(directory, "library-data.pending").exists());
    }
    @Test public void metadataRestoreRejectsBookReplacementBeforeWriting() throws Exception {
        JSONObject capture = (JSONObject) manager.execute(command("backupBeginStatement"));
        JSONObject tables = capture.getJSONObject("tables"); tables.remove("words"); tables.remove("plugins");
        tables.put("books", new JSONArray().put(book("different")));
        assertThrows(Exception.class, () -> manager.execute(command("dataCommitStatement").put("data", new JSONObject().put("tables", tables).put("preferences", new JSONObject()))));
        assertEquals("old", ((JSONArray) manager.execute(table("books", "getAllStatement"))).getJSONObject(0).getString("key"));
        assertEquals("AQID", manager.execute(file("read", "book", "old.epub")));
    }
    @Test public void rollsBackInterruptedMetadataRestoreWithoutCopyingBookFiles() throws Exception {
        JSONObject before = (JSONObject) manager.execute(command("backupBeginStatement"));
        manager.execute(command("backupEndStatement"));
        before.getJSONObject("tables").remove("words"); before.getJSONObject("tables").remove("plugins");
        manager.execute(table("notes", "saveStatement").put("data", new JSONObject().put("key", "partial").put("bookKey", "old")));
        NativeLibraryStore.write(new AtomicFile(new File(directory, "library-data.pending")), before.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        manager.close(); manager = new NativeLibraryManager(directory);
        assertEquals(0, ((JSONArray) manager.execute(table("notes", "getAllStatement"))).length());
        assertEquals("AQID", manager.execute(file("read", "book", "old.epub")));
        assertEquals("{}", prefs().getJSONObject("values").getString("readerConfig"));
    }
    @Test public void invalidLateTableRollsBackEarlierTablesAndKeepsPreferencesWritable() throws Exception {
        JSONObject capture = (JSONObject) manager.execute(command("backupBeginStatement"));
        JSONObject tables = capture.getJSONObject("tables"); tables.remove("words"); tables.remove("plugins");
        tables.getJSONArray("books").getJSONObject(0).put("name", "partial rename");
        tables.put("notes", new JSONArray().put(new JSONObject().put("notes", "invalid without key")));
        assertThrows(Exception.class, () -> manager.execute(command("dataCommitStatement").put("data", new JSONObject().put("tables", tables).put("preferences", new JSONObject().put("readerConfig", "{}")))));
        assertEquals("测试书", ((JSONArray) manager.execute(table("books", "getAllStatement"))).getJSONObject(0).getString("name"));
        assertEquals(0, ((JSONArray) manager.execute(table("notes", "getAllStatement"))).length());
        assertEquals("AQID", manager.execute(file("read", "book", "old.epub")));
        assertFalse(new File(directory, "library-data.pending").exists());
        manager.execute(command("backupEndStatement"));
        JSONObject snapshot = prefs(); snapshot.put("version", snapshot.getLong("version") + 1);
        manager.execute(new JSONObject().put("channel", "preferences").put("action", "write").put("snapshot", snapshot));
    }
    private JSONObject manifest() throws Exception {
        JSONObject tables = new JSONObject();
        for (String key : new String[]{"books", "notes", "bookmarks", "words", "plugins"}) tables.put(key, new JSONArray());
        tables.put("books", new JSONArray().put(book("new")));
        tables.put("notes", new JSONArray().put(new JSONObject().put("key", "note").put("bookKey", "new").put("notes", "恢复的笔记")));
        StringBuilder hash = new StringBuilder();
        for (byte value : MessageDigest.getInstance("SHA-256").digest(new byte[]{1, 2, 3})) hash.append(String.format("%02x", value & 255));
        JSONArray files = new JSONArray();
        for (String[] pair : new String[][]{{"book", "new.epub"}, {"cover", "new.png"}, {"font", "中文.ttf"}, {"background", "paper.png"}}) {
            files.put(new JSONObject().put("group", pair[0]).put("name", pair[1]).put("size", 3).put("sha256", hash.toString()));
        }
        return new JSONObject().put("type", "koodo-reader-android-backup").put("schema", 1).put("tables", tables).put("files", files)
            .put("preferences", new JSONObject().put("readerConfig", "{\"fontSize\":\"22\"}").put("recordLocation", "{\"new\":0.42}").put("shelfList", "{\"我的书架\":[\"new\"]}"));
    }
    private void begin(JSONObject manifest) throws Exception { manager.execute(command("restoreBeginStatement").put("data", manifest)); }
    private void upload(JSONObject manifest) throws Exception {
        JSONArray files = manifest.getJSONArray("files");
        for (int i = 0; i < files.length(); i++) {
            JSONObject file = files.getJSONObject(i);
            manager.execute(file("restore-write", file.getString("group"), file.getString("name")).put("token", token).put("data", "AQID"));
        }
    }
    private void original() throws Exception {
        assertEquals("old", ((JSONObject) manager.execute(table("books", "getStatement").put("data", "old"))).getString("key"));
        assertEquals("AQID", manager.execute(file("read", "book", "old.epub")));
        assertEquals(7, prefs().getInt("version"));
    }
    @Test public void backupFreezesMutationsAndReleasesWithItsToken() throws Exception {
        JSONObject result = (JSONObject) manager.execute(command("backupBeginStatement"));
        assertEquals(5, result.getJSONObject("tables").length());
        assertEquals("old.epub", result.getJSONObject("files").getJSONArray("book").getString(0));
        assertThrows(Exception.class, () -> manager.execute(table("books", "deleteAllStatement")));
        assertThrows(Exception.class, () -> manager.execute(file("remove", "book", "old.epub")));
        assertThrows(Exception.class, () -> manager.execute(command("backupEndStatement").put("token", UUID.randomUUID().toString())));
        original();
        manager.execute(command("backupEndStatement"));
        manager.execute(table("words", "saveStatement").put("data", new JSONObject().put("key", "word")));
    }
    @Test public void restoresRecordsFilesAndPreferencesTogetherAndSurvivesRestart() throws Exception {
        JSONObject manifest = manifest(); begin(manifest); upload(manifest);
        JSONObject result = (JSONObject) manager.execute(command("restoreCommitStatement"));
        assertTrue(result.getLong("version") > 7);
        assertEquals(token, result.getJSONObject("values").getString("__koodo_native_restore_id"));
        manager.close(); manager = new NativeLibraryManager(directory);
        assertEquals(JSONObject.NULL, manager.execute(table("books", "getStatement").put("data", "old")));
        assertEquals(JSONObject.NULL, manager.execute(file("read", "font", "old.ttf")));
        assertEquals("AQID", manager.execute(file("read", "font", "中文.ttf")));
        assertEquals("恢复的笔记", ((JSONObject) manager.execute(table("notes", "getStatement").put("data", "note"))).getString("notes"));
        assertEquals("1", prefs().getJSONObject("values").getString("__koodo_native_fonts_version"));
    }
    @Test public void incompleteOrBadWritesCannotReplaceTheCurrentLibrary() throws Exception {
        JSONObject manifest = manifest(); begin(manifest);
        assertThrows(Exception.class, () -> manager.execute(command("restoreCommitStatement")));
        upload(manifest);
        assertThrows(Exception.class, () -> manager.execute(file("restore-write", "book", "new.epub").put("token", token).put("data", "BAUG")));
        assertThrows(Exception.class, () -> manager.execute(command("restoreCommitStatement")));
        original();
        manager.execute(command("restoreAbortStatement"));
        assertFalse(new File(directory, "library-restore").exists());
        original();
    }
    @Test public void rejectsInvalidNamesDuplicateRecordsAndMissingOriginals() throws Exception {
        JSONObject bad = manifest(); bad.getJSONArray("files").getJSONObject(0).put("name", "../escape");
        assertThrows(Exception.class, () -> begin(bad));
        JSONObject duplicate = manifest(); duplicate.getJSONObject("tables").getJSONArray("books").put(book("new"));
        assertThrows(Exception.class, () -> begin(duplicate));
        JSONObject missing = manifest(); missing.getJSONArray("files").remove(0);
        assertThrows(Exception.class, () -> begin(missing));
        original();
    }
    @Test public void interruptionDuringStagingKeepsTheOriginalLibrary() throws Exception {
        begin(manifest());
        manager.close(); manager = new NativeLibraryManager(directory);
        original();
        assertFalse(new File(directory, "library-restore").exists());
    }
    @Test public void interruptionAfterRenamingTheOriginalRollsBackOnStartup() throws Exception {
        JSONObject manifest = manifest(); begin(manifest); upload(manifest); manager.close();
        NativeLibraryStore.write(new AtomicFile(new File(directory, "library-restore.pending")), new byte[]{1});
        assertTrue(new File(directory, "library-v1").renameTo(new File(directory, "library-previous")));
        manager = new NativeLibraryManager(directory);
        original();
    }
    @Test public void interruptionAfterInstallingButBeforeCommitRollsBackOnStartup() throws Exception {
        JSONObject manifest = manifest(); begin(manifest); upload(manifest); manager.close();
        NativeLibraryStore.write(new AtomicFile(new File(directory, "library-restore.pending")), new byte[]{1});
        assertTrue(new File(directory, "library-v1").renameTo(new File(directory, "library-previous")));
        assertTrue(new File(directory, "library-restore").renameTo(new File(directory, "library-v1")));
        manager = new NativeLibraryManager(directory);
        original();
    }
}
