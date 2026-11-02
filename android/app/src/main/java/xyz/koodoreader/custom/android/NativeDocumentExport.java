package xyz.koodoreader.custom.android;

import android.util.Base64;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.UUID;

/** Stages exports privately so activity state never contains book contents. */
public final class NativeDocumentExport {
    private final File directory;

    public NativeDocumentExport(File cache) throws IOException {
        directory = new File(cache, "document-exports").getCanonicalFile();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("EXPORT_DIRECTORY");
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) {
            if (file.isFile() && file.getName().matches("[0-9a-f-]{36}\\.bin") &&
                System.currentTimeMillis() - file.lastModified() > 24 * 60 * 60 * 1000L) file.delete();
        }
    }

    private File location(String token) throws IOException {
        if (!UUID.fromString(token).toString().equals(token)) throw new IllegalArgumentException("EXPORT_TOKEN");
        File file = new File(directory, token + ".bin").getCanonicalFile();
        if (!directory.equals(file.getParentFile())) throw new IllegalArgumentException("EXPORT_PATH");
        return file;
    }

    private static String hash(byte[] bytes) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format("%02x", value & 255));
        return result.toString();
    }

    public JSONObject stage(JSONObject request) throws Exception {
        Object name = request.get("name");
        Object mime = request.get("mime");
        Object data = request.get("data");
        Object sha = request.get("sha256");
        Object size = request.get("size");
        if (!(name instanceof String) || ((String) name).isEmpty() || ((String) name).length() > 255 ||
            name.equals(".") || name.equals("..") || ((String) name).matches("(?s).*[\\\\/\\p{Cntrl}].*")) throw new IllegalArgumentException("EXPORT_NAME");
        if (!(mime instanceof String) || !((String) mime).matches("[a-z0-9.+-]+/[a-z0-9.+-]+")) throw new IllegalArgumentException("EXPORT_MIME");
        if (!(data instanceof String) || ((String) data).length() % 4 != 0 || !((String) data).matches("[A-Za-z0-9+/]*={0,2}") ||
            !(sha instanceof String) || !((String) sha).matches("[0-9a-f]{64}") ||
            !(size instanceof Number) || ((Number) size).doubleValue() != ((Number) size).longValue()) throw new IllegalArgumentException("EXPORT_DATA");
        byte[] bytes = Base64.decode((String) data, Base64.NO_WRAP);
        if (((Number) size).longValue() != bytes.length || !sha.equals(hash(MessageDigest.getInstance("SHA-256").digest(bytes)))) throw new IllegalArgumentException("EXPORT_VERIFY");
        String token = UUID.randomUUID().toString();
        File file = location(token);
        try (FileOutputStream stream = new FileOutputStream(file)) {
            stream.write(bytes);
            stream.getFD().sync();
        } catch (Exception error) { file.delete(); throw error; }
        return new JSONObject().put("token", token).put("name", name).put("mime", mime).put("size", bytes.length).put("sha256", sha);
    }

    public JSONObject copy(JSONObject document, OutputStream target) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long size = 0;
        try (FileInputStream source = new FileInputStream(location(document.getString("token")))) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = source.read(buffer)) != -1) {
                target.write(buffer, 0, count);
                digest.update(buffer, 0, count);
                size += count;
            }
            target.flush();
        }
        String sha = hash(digest.digest());
        if (size != document.getLong("size") || !sha.equals(document.getString("sha256"))) throw new IOException("EXPORT_VERIFY");
        return new JSONObject().put("status", "success").put("size", size).put("sha256", sha);
    }

    public void discard(JSONObject document) throws Exception {
        File file = location(document.getString("token"));
        if (file.exists() && !file.delete()) throw new IOException("EXPORT_CLEANUP");
    }
}
