package xyz.koodoreader.custom.android;

import android.util.AtomicFile;
import android.content.ContentResolver;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Serializes snapshots and installs a fully validated library with crash rollback. */
public final class NativeLibraryManager implements AutoCloseable {
    private static final String[] TABLES = {"books", "notes", "bookmarks", "words", "plugins"};
    private static final String[] GROUPS = {"book", "cover", "font", "background"};
    private final File base, live, candidate, previous;
    private final AtomicFile journal;
    private final AtomicFile dataJournal;
    private NativeLibraryStore store, staging;
    private String mode, token;
    private final Map<String, JSONObject> expected = new HashMap<>();
    private final Set<String> received = new HashSet<>();

    public NativeLibraryManager(File directory) throws Exception {
        this(directory, null);
    }
    public NativeLibraryManager(File directory, ContentResolver resolver) throws Exception {
        base = directory.getCanonicalFile();
        if (!base.isDirectory() && !base.mkdirs()) throw new IOException("LIBRARY_DIRECTORY");
        live = new File(base, "library-v1");
        candidate = new File(base, "library-restore");
        previous = new File(base, "library-previous");
        journal = new AtomicFile(new File(base, "library-restore.pending"));
        dataJournal = new AtomicFile(new File(base, "library-data.pending"));
        recover();
        store = new NativeLibraryStore(live, resolver);
        if (dataJournal.getBaseFile().exists() || new File(dataJournal.getBaseFile() + ".bak").exists()) {
            installData(new JSONObject(new String(dataJournal.readFully(), StandardCharsets.UTF_8)));
            clearDataJournal();
        }
    }

    private static JSONObject request(String channel, String action) throws Exception {
        return new JSONObject().put("channel", channel).put("action", action);
    }
    private static JSONObject tableRequest(String table, String statement) throws Exception {
        return new JSONObject().put("channel", "database-command").put("dbName", table).put("statement", statement);
    }
    private static String string(JSONObject value, String key) throws Exception {
        Object item = value.get(key);
        if (!(item instanceof String)) throw new IllegalArgumentException("LIBRARY_STRING");
        return (String) item;
    }
    private boolean marked() { return journal.getBaseFile().exists() || new File(journal.getBaseFile() + ".bak").exists() || new File(journal.getBaseFile() + ".new").exists(); }
    private boolean dataPending() { return dataJournal.getBaseFile().exists() || new File(dataJournal.getBaseFile() + ".bak").exists(); }
    private void clearDataJournal() throws IOException {
        dataJournal.delete();
        if (dataPending() || new File(dataJournal.getBaseFile() + ".new").exists()) throw new IOException("LIBRARY_DATA_JOURNAL");
    }
    private void erase(File root) throws Exception {
        if (!root.exists()) return;
        if (!root.getCanonicalFile().getParentFile().equals(base)) throw new IOException("LIBRARY_PATH");
        eraseChild(root, root.getCanonicalFile());
    }
    private void eraseChild(File file, File root) throws Exception {
        String path = file.getCanonicalPath();
        if (!path.equals(root.getPath()) && !path.startsWith(root.getPath() + File.separator)) throw new IOException("LIBRARY_PATH");
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("LIBRARY_LIST");
            for (File child : children) eraseChild(child, root);
        }
        if (!file.delete()) throw new IOException("LIBRARY_DELETE");
    }
    private void recover() throws Exception {
        if (marked()) {
            if (previous.exists()) {
                erase(live);
                if (!previous.renameTo(live)) throw new IOException("LIBRARY_ROLLBACK");
            } else if (!live.exists()) throw new IOException("LIBRARY_RECOVERY");
            erase(candidate);
            journal.delete();
            if (marked()) throw new IOException("LIBRARY_JOURNAL");
        } else {
            if (previous.exists() && !live.exists()) throw new IOException("LIBRARY_RECOVERY");
            erase(candidate);
            erase(previous);
        }
    }
    private void checkToken(JSONObject request, String requiredMode) throws Exception {
        if (!requiredMode.equals(mode) || !string(request, "token").equals(token)) throw new IllegalArgumentException("LIBRARY_TOKEN");
    }
    private JSONObject beginBackup(String id) throws Exception {
        JSONObject tables = new JSONObject(), files = new JSONObject();
        for (String table : TABLES) tables.put(table, store.execute(tableRequest(table, "getAllStatement")));
        for (String group : GROUPS) files.put(group, store.execute(request("file-command", "list").put("group", group)));
        Object preferences = store.execute(request("preferences", "read"));
        if (!(preferences instanceof JSONObject)) throw new IOException("LIBRARY_PREFERENCES");
        token = id;
        mode = "backup";
        return new JSONObject().put("token", token).put("tables", tables).put("preferences", preferences).put("files", files);
    }
    private void installData(JSONObject data) throws Exception {
        JSONObject tables = data.getJSONObject("tables");
        for (String table : TABLES) if (tables.has(table)) store.execute(tableRequest(table, "replaceAllStatement").put("data", tables.getJSONArray(table)));
        JSONObject preferences = new JSONObject(data.getJSONObject("preferences").toString());
        JSONObject current = (JSONObject) store.execute(request("preferences", "read"));
        preferences.put("version", Math.max(current.getLong("version") + 1, System.currentTimeMillis()));
        store.execute(request("preferences", "write").put("snapshot", preferences));
    }
    private JSONObject commitData(JSONObject data, String id) throws Exception {
        JSONObject next = data.getJSONObject("tables");
        if (next.length() != 3 || !next.has("books") || !next.has("notes") || !next.has("bookmarks")) throw new IllegalArgumentException("LIBRARY_TABLES");
        JSONArray books = (JSONArray) store.execute(tableRequest("books", "getAllStatement"));
        JSONArray incoming = next.getJSONArray("books");
        if (books.length() != incoming.length()) throw new IllegalArgumentException("LIBRARY_BOOK_SET");
        Map<String, JSONObject> keyed = new HashMap<>();
        for (int i = 0; i < incoming.length(); i++) if (keyed.put(string(incoming.getJSONObject(i), "key"), incoming.getJSONObject(i)) != null) throw new IllegalArgumentException("LIBRARY_BOOK_SET");
        for (int i = 0; i < books.length(); i++) {
            JSONObject book = books.getJSONObject(i), other = keyed.get(string(book, "key"));
            if (other == null) throw new IllegalArgumentException("LIBRARY_BOOK_SET");
            for (String field : Arrays.asList("path", "format", "cover")) if (!book.optString(field).equals(other.optString(field))) throw new IllegalArgumentException("LIBRARY_BOOK_SOURCE");
        }
        JSONObject before = new JSONObject().put("tables", new JSONObject()).put("preferences", store.execute(request("preferences", "read")));
        for (String table : Arrays.asList("books", "notes", "bookmarks")) before.getJSONObject("tables").put(table, store.execute(tableRequest(table, "getAllStatement")));
        JSONObject preferences = new JSONObject().put("schema", 1).put("values", data.getJSONObject("preferences")).put("version", 1);
        preferences.getJSONObject("values").put("__koodo_native_restore_id", id);
        NativeLibraryStore.write(dataJournal, before.toString().getBytes(StandardCharsets.UTF_8));
        try {
            installData(new JSONObject().put("tables", next).put("preferences", preferences));
            clearDataJournal();
            return (JSONObject) store.execute(request("preferences", "read"));
        } catch (Exception error) {
            installData(before);
            clearDataJournal();
            throw error;
        }
    }
    private JSONObject beginRestore(JSONObject data, String id) throws Exception {
        if (!(data.get("schema") instanceof Number) || data.getDouble("schema") != 1 || !"koodo-reader-android-backup".equals(data.get("type"))) throw new IllegalArgumentException("LIBRARY_FORMAT");
        JSONObject tables = data.getJSONObject("tables");
        if (tables.length() != TABLES.length) throw new IllegalArgumentException("LIBRARY_TABLES");
        JSONObject values = new JSONObject(data.getJSONObject("preferences").toString());
        for (String key : Arrays.asList("readerConfig", "recordLocation", "shelfList", "customFonts", "customBackgrounds")) {
            if (values.has(key)) new JSONObject(string(values, key));
        }
        for (String key : Arrays.asList("recentBooks", "favoriteBooks", "deletedBooks", "noteTags", "fontList", "backgroundList")) {
            if (values.has(key)) new JSONArray(string(values, key));
        }
        JSONObject current = (JSONObject) store.execute(request("preferences", "read"));
        long version = Math.max(current.getLong("version") + 1, System.currentTimeMillis());
        values.remove("__koodo_native_preferences_version");
        values.put("__koodo_native_fonts_version", "1").put("__koodo_native_backgrounds_version", "1");
        values.put("__koodo_native_restore_id", id);
        try {
            erase(candidate);
            staging = new NativeLibraryStore(candidate);
            staging.execute(request("preferences", "write").put("snapshot", new JSONObject().put("schema", 1).put("version", version).put("values", values)));
            JSONArray files = data.getJSONArray("files");
            for (int i = 0; i < files.length(); i++) {
                JSONObject file = files.getJSONObject(i);
                String group = string(file, "group"), name = string(file, "name"), sha = string(file, "sha256");
                Object size = file.get("size");
                if (!(size instanceof Number) || ((Number) size).doubleValue() != ((Number) size).longValue() || ((Number) size).longValue() < 0 || !sha.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("LIBRARY_FILE");
                staging.execute(request("file-command", "exists").put("group", group).put("name", name));
                if (expected.put(group + "/" + name, file) != null) throw new IllegalArgumentException("LIBRARY_DUPLICATE_FILE");
            }
            for (String table : TABLES) {
                JSONArray rows = tables.getJSONArray(table);
                Set<String> keys = new HashSet<>();
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject row = rows.getJSONObject(i);
                    String key = string(row, "key");
                    if (!keys.add(key)) throw new IllegalArgumentException("LIBRARY_DUPLICATE_RECORD");
                    if (table.equals("books") && !expected.containsKey("book/" + key + "." + string(row, "format").toLowerCase(java.util.Locale.ROOT))) throw new IllegalArgumentException("LIBRARY_MISSING_BOOK");
                }
                staging.execute(tableRequest(table, "replaceAllStatement").put("data", rows));
            }
            mode = "restore";
            token = id;
            return new JSONObject().put("token", token);
        } catch (Exception error) { discardStaging(); throw error; }
    }
    private void discardStaging() throws Exception {
        if (staging != null) { staging.close(); staging = null; }
        erase(candidate);
        mode = token = null;
        expected.clear(); received.clear();
    }
    private Object restoreFile(JSONObject data) throws Exception {
        checkToken(data, "restore");
        String group = string(data, "group"), name = string(data, "name");
        String key = group + "/" + name;
        JSONObject file = expected.get(key);
        if (file == null) throw new IllegalArgumentException("LIBRARY_UNEXPECTED_FILE");
        received.remove(key);
        JSONObject result = (JSONObject) staging.execute(new JSONObject(data.toString()).put("action", "write"));
        if (result.getLong("size") != file.getLong("size") || !result.getString("sha256").equals(file.getString("sha256"))) throw new IOException("LIBRARY_FILE_VERIFY");
        received.add(key);
        return result;
    }
    private Object commit() throws Exception {
        if (!received.equals(expected.keySet())) throw new IOException("LIBRARY_INCOMPLETE");
        staging.close(); staging = null;
        try {
            erase(previous);
            NativeLibraryStore.write(journal, new byte[]{1});
            store.close(); store = null;
            if (!live.renameTo(previous) || !candidate.renameTo(live)) throw new IOException("LIBRARY_INSTALL");
            store = new NativeLibraryStore(live);
            Object result = store.execute(request("preferences", "read"));
            journal.delete();
            if (marked()) throw new IOException("LIBRARY_JOURNAL");
            mode = token = null;
            expected.clear(); received.clear();
            try { erase(previous); } catch (Exception ignored) { /* Retry old-library cleanup on next startup. */ }
            return result;
        } catch (Exception error) {
            if (store != null) { store.close(); store = null; }
            recover();
            store = new NativeLibraryStore(live);
            mode = token = null; expected.clear(); received.clear();
            throw error;
        }
    }
    public synchronized Object execute(JSONObject data) throws Exception {
        if (dataPending()) throw new IOException("LIBRARY_DATA_RECOVERY");
        String channel = string(data, "channel");
        if (channel.equals("database-command") && "library".equals(data.opt("dbName"))) {
            switch (string(data, "statement")) {
                case "backupBeginStatement":
                    if (mode != null) throw new IOException("LIBRARY_BUSY");
                    return beginBackup(validToken(data));
                case "backupEndStatement": checkToken(data, "backup"); mode = token = null; return JSONObject.NULL;
                case "dataCommitStatement": checkToken(data, "backup"); return commitData(data.getJSONObject("data"), token);
                case "restoreBeginStatement":
                    if (mode != null) throw new IOException("LIBRARY_BUSY");
                    return beginRestore(data.getJSONObject("data"), validToken(data));
                case "restoreCommitStatement": checkToken(data, "restore"); return commit();
                case "restoreAbortStatement": checkToken(data, "restore"); discardStaging(); return JSONObject.NULL;
                default: throw new IllegalArgumentException("LIBRARY_STATEMENT");
            }
        }
        if (channel.equals("file-command") && "restore-write".equals(data.opt("action"))) return restoreFile(data);
        if (mode != null) {
            boolean read = channel.equals("database-command") && data.optString("statement").startsWith("get") ||
                channel.equals("file-command") && Arrays.asList("read", "list", "exists", "fingerprint").contains(data.optString("action")) ||
                channel.equals("preferences") && "read".equals(data.opt("action"));
            if (!read) throw new IOException("LIBRARY_BUSY");
        }
        return store.execute(data);
    }
    private String validToken(JSONObject data) throws Exception {
        String value = string(data, "token");
        if (!UUID.fromString(value).toString().equals(value)) throw new IllegalArgumentException("LIBRARY_TOKEN");
        return value;
    }
    @Override public synchronized void close() {
        if (staging != null) { staging.close(); staging = null; }
        if (store != null) { store.close(); store = null; }
    }
}
