package xyz.koodoreader.custom.android;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Iterator;

/** Native-only persistence. Callers supply operations and values, never SQL or paths. */
public final class NativeLibraryStore implements AutoCloseable {
    private static final List<String> TABLES = Arrays.asList("books", "notes", "bookmarks", "words", "plugins");
    private final File root;
    private final SQLiteDatabase db;

    public NativeLibraryStore(File directory) throws IOException {
        root = directory.getCanonicalFile();
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("STORAGE_DIRECTORY");
        db = SQLiteDatabase.openOrCreateDatabase(new File(root, "records.sqlite"), null);
        if (db.getVersion() > 1) { db.close(); throw new IOException("STORAGE_VERSION"); }
        db.enableWriteAheadLogging();
        db.execSQL("PRAGMA synchronous=FULL");
        db.execSQL("CREATE TABLE IF NOT EXISTS records (table_name TEXT NOT NULL, record_key TEXT NOT NULL, book_key TEXT, body TEXT NOT NULL, PRIMARY KEY(table_name, record_key))");
        db.execSQL("CREATE INDEX IF NOT EXISTS records_by_book ON records(table_name, book_key)");
        db.execSQL("CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.setVersion(1);
    }

    public synchronized Object execute(JSONObject request) throws Exception {
        switch (request.getString("channel")) {
            case "database-command": return database(request);
            case "file-command": return file(request);
            case "preferences": return preferences(request);
            default: throw new IllegalArgumentException("STORAGE_CHANNEL");
        }
    }

    private static String text(Object value) {
        if (!(value instanceof String) || ((String) value).isEmpty() || ((String) value).length() > 1024) {
            throw new IllegalArgumentException("STORAGE_KEY");
        }
        return (String) value;
    }

    private Object database(JSONObject request) throws Exception {
        String table = request.getString("dbName");
        if (!TABLES.contains(table)) throw new IllegalArgumentException("STORAGE_TABLE");
        String statement = request.getString("statement");
        Object data = request.opt("data");
        String where = "table_name=?";
        List<String> args = new ArrayList<>();
        args.add(table);
        switch (statement) {
            case "saveStatement": return save(table, (JSONObject) data, false);
            case "updateStatement": return save(table, (JSONObject) data, true);
            case "replaceAllStatement":
                if (!(data instanceof JSONArray)) throw new IllegalArgumentException("STORAGE_RECORDS");
                db.beginTransaction();
                try {
                    db.delete("records", where, new String[]{table});
                    JSONArray rows = (JSONArray) data;
                    for (int i = 0; i < rows.length(); i++) save(table, rows.getJSONObject(i), false);
                    db.setTransactionSuccessful();
                    return rows.length();
                } finally { db.endTransaction(); }
            case "getStatement": case "deleteStatement":
                where += " AND record_key=?"; args.add(text(data)); break;
            case "getByBookKeyStatement": case "deleteByBookKeyStatement":
                where += " AND book_key=?"; args.add(text(data)); break;
            case "getByBookKeysStatement": case "getByKeysStatement":
                if (!(data instanceof JSONArray)) throw new IllegalArgumentException("STORAGE_KEYS");
                JSONArray keys = (JSONArray) data;
                if (keys.length() == 0) return new JSONArray();
                // Filter below to avoid SQLite's bound-variable limit for large libraries.
                break;
            case "getAllStatement": case "getKeysStatement": case "deleteAllStatement": break;
            default: throw new IllegalArgumentException("STORAGE_STATEMENT");
        }
        if (statement.startsWith("delete")) return db.delete("records", where, args.toArray(new String[0]));
        List<String> keys = null;
        if (statement.equals("getByBookKeysStatement") || statement.equals("getByKeysStatement")) {
            keys = new ArrayList<>();
            for (int i = 0; i < ((JSONArray) data).length(); i++) keys.add(text(((JSONArray) data).get(i)));
        }
        JSONArray result = new JSONArray();
        try (Cursor cursor = db.query("records", new String[]{"record_key", "book_key", "body"}, where, args.toArray(new String[0]), null, null, "rowid")) {
            while (cursor.moveToNext()) {
                if (keys != null && !keys.contains(cursor.getString(statement.equals("getByKeysStatement") ? 0 : 1))) continue;
                JSONObject row = statement.equals("getKeysStatement")
                    ? new JSONObject().put("key", cursor.getString(0)) : new JSONObject(cursor.getString(2));
                if (statement.equals("getStatement")) return row;
                result.put(row);
            }
        }
        return statement.equals("getStatement") ? JSONObject.NULL : result;
    }

    private long save(String table, JSONObject row, boolean update) throws Exception {
        String key = text(row.get("key"));
        ContentValues values = new ContentValues();
        values.put("table_name", table);
        values.put("record_key", key);
        values.put("book_key", row.optString("bookKey", ""));
        values.put("body", row.toString());
        if (update) return db.update("records", values, "table_name=? AND record_key=?", new String[]{table, key});
        long result = db.insertWithOnConflict("records", null, values, SQLiteDatabase.CONFLICT_REPLACE);
        if (result == -1) throw new IOException("STORAGE_RECORD_WRITE");
        return result;
    }

    private File location(String group, String name) throws IOException {
        if (!group.equals("book") && !group.equals("cover") && !group.equals("font")) throw new IllegalArgumentException("STORAGE_GROUP");
        if (name.isEmpty() || name.length() > 255 || name.equals(".") || name.equals("..") || name.endsWith(".bak") || name.endsWith(".new")
            || name.contains("/") || name.contains("\\") || name.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("STORAGE_FILENAME");
        }
        File directory = new File(root, group);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("STORAGE_DIRECTORY");
        File target = new File(directory, name).getCanonicalFile();
        if (!target.getParentFile().equals(directory.getCanonicalFile())) throw new IllegalArgumentException("STORAGE_PATH");
        return target;
    }

    private Object file(JSONObject request) throws Exception {
        String group = request.getString("group");
        String action = request.getString("action");
        if (action.equals("list")) {
            File directory = location(group, "listing").getParentFile();
            File[] files = directory.listFiles();
            if (files == null) throw new IOException("STORAGE_LIST");
            JSONArray result = new JSONArray();
            for (File child : files) {
                if (child.isFile() && !child.getName().endsWith(".bak") && !child.getName().endsWith(".new")) result.put(child.getName());
            }
            return result;
        }
        File target = location(group, request.getString("name"));
        AtomicFile atomic = new AtomicFile(target);
        switch (action) {
            case "exists": return target.exists() || new File(target + ".bak").exists();
            case "read":
                if (!target.exists() && !new File(target + ".bak").exists()) return JSONObject.NULL;
                return Base64.encodeToString(atomic.readFully(), Base64.NO_WRAP);
            case "write":
                byte[] bytes = Base64.decode(request.getString("data"), Base64.DEFAULT);
                write(atomic, bytes);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long size = 0;
                try (FileInputStream input = atomic.openRead()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) { digest.update(buffer, 0, count); size += count; }
                }
                StringBuilder hash = new StringBuilder();
                for (byte value : digest.digest()) hash.append(String.format("%02x", value & 255));
                return new JSONObject().put("size", size).put("sha256", hash.toString());
            case "remove":
                atomic.delete();
                if (target.exists() || new File(target + ".bak").exists() || new File(target + ".new").exists()) throw new IOException("STORAGE_DELETE");
                return JSONObject.NULL;
            default: throw new IllegalArgumentException("STORAGE_FILE_ACTION");
        }
    }

    private static void write(AtomicFile file, byte[] bytes) throws IOException {
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(bytes);
            output.getFD().sync();
            file.finishWrite(output);
        } catch (IOException error) {
            if (output != null) file.failWrite(output);
            throw error;
        }
    }

    private JSONObject readPreferences() throws Exception {
        File file = new File(root, "preferences.json");
        if (!file.exists() && !new File(file + ".bak").exists()) {
            try (Cursor cursor = db.rawQuery("SELECT value FROM metadata WHERE name='initialized'", null)) {
                if (cursor.moveToFirst()) throw new IOException("STORAGE_PREFERENCES_MISSING");
            }
            return null;
        }
        JSONObject snapshot = new JSONObject(new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8));
        validatePreferences(snapshot);
        return snapshot;
    }

    private static void validatePreferences(JSONObject snapshot) throws Exception {
        Object version = snapshot.get("version");
        Object schema = snapshot.get("schema");
        if (!(schema instanceof Number) || ((Number) schema).doubleValue() != 1 || !(version instanceof Number) || ((Number) version).doubleValue() != ((Number) version).longValue()
            || ((Number) version).longValue() < 1 || ((Number) version).longValue() > 9007199254740991L) throw new IllegalArgumentException("STORAGE_PREFERENCES");
        JSONObject values = snapshot.getJSONObject("values");
        for (Iterator<String> keys = values.keys(); keys.hasNext();) {
            String key = keys.next();
            if (!(values.get(key) instanceof String)) throw new IllegalArgumentException("STORAGE_PREFERENCE_VALUE");
        }
    }

    private Object preferences(JSONObject request) throws Exception {
        JSONObject current = readPreferences();
        switch (request.getString("action")) {
            case "read": return current == null ? JSONObject.NULL : current;
            case "write":
                JSONObject snapshot = request.getJSONObject("snapshot");
                validatePreferences(snapshot);
                if (current != null && snapshot.getLong("version") < current.getLong("version")) throw new IllegalArgumentException("STORAGE_STALE");
                AtomicFile file = new AtomicFile(new File(root, "preferences.json"));
                byte[] bytes = snapshot.toString().getBytes(StandardCharsets.UTF_8);
                write(file, bytes);
                if (!Arrays.equals(bytes, file.readFully())) throw new IOException("STORAGE_PREFERENCES_VERIFY");
                db.execSQL("INSERT OR REPLACE INTO metadata(name,value) VALUES('initialized','1')");
                return JSONObject.NULL;
            default: throw new IllegalArgumentException("STORAGE_PREFERENCE_ACTION");
        }
    }

    @Override public synchronized void close() { db.close(); }
}
