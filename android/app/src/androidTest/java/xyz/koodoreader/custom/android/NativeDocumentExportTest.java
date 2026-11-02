package xyz.koodoreader.custom.android;

import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.nio.file.Files;
import java.util.UUID;
import static org.junit.Assert.*;

public class NativeDocumentExportTest {
    private File directory;
    private NativeDocumentExport exporter;

    @Before public void setup() throws Exception {
        File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir().getCanonicalFile();
        directory = new File(cache, "document-export-test-" + UUID.randomUUID()).getCanonicalFile();
        assertEquals(cache, directory.getParentFile());
        exporter = new NativeDocumentExport(directory);
    }

    @After public void cleanup() throws Exception { remove(directory); }
    private void remove(File file) throws Exception {
        assertTrue(file.getCanonicalPath().startsWith(directory.getCanonicalPath() + File.separator) || file.equals(directory));
        if (file.isDirectory()) for (File child : file.listFiles()) remove(child);
        assertTrue(file.delete());
    }

    private JSONObject request(byte[] bytes) throws Exception {
        StringBuilder hash = new StringBuilder();
        for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes)) hash.append(String.format("%02x", value & 255));
        return new JSONObject().put("name", "中文原书.epub").put("mime", "application/epub+zip")
            .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("size", bytes.length).put("sha256", hash.toString());
    }

    @Test public void stagesLargeBinaryCopiesExactlyAndDiscardsOnlyItsOwnFile() throws Exception {
        byte[] bytes = new byte[200000];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) i;
        JSONObject source = request(bytes);
        JSONObject document = exporter.stage(source);
        assertFalse(document.has("data"));
        ByteArrayOutputStream target = new ByteArrayOutputStream();
        JSONObject result = exporter.copy(document, target);
        assertArrayEquals(bytes, target.toByteArray());
        assertEquals(source.getString("sha256"), result.getString("sha256"));
        assertEquals(bytes.length, result.getInt("size"));
        exporter.discard(document);
        assertThrows(Exception.class, () -> exporter.copy(document, new ByteArrayOutputStream()));
    }

    @Test public void rejectsInvalidInputsAndStagingPathTraversal() throws Exception {
        byte[] bytes = new byte[]{1, 2, 3};
        assertThrows(Exception.class, () -> exporter.stage(request(bytes).put("name", "../book.epub")));
        assertThrows(Exception.class, () -> exporter.stage(request(bytes).put("name", "bad\n\nname")));
        assertThrows(Exception.class, () -> exporter.stage(request(bytes).put("mime", "text/plain\ninvalid")));
        assertThrows(Exception.class, () -> exporter.stage(request(bytes).put("data", "%%%=")));
        assertThrows(Exception.class, () -> exporter.stage(request(bytes).put("size", 2)));
        assertThrows(Exception.class, () -> exporter.stage(request(bytes).put("sha256", "0".repeat(64))));
        assertThrows(Exception.class, () -> exporter.discard(new JSONObject().put("token", "../escape")));
        assertEquals(0, new File(directory, "document-exports").list().length);
    }

    @Test public void propagatesWriteFailuresAndDetectsChangedStagedData() throws Exception {
        JSONObject document = exporter.stage(request(new byte[]{1, 2, 3}));
        assertThrows(IOException.class, () -> exporter.copy(document, new OutputStream() {
            @Override public void write(int value) throws IOException { throw new IOException("provider failed"); }
        }));
        File stage = new File(directory, "document-exports/" + document.getString("token") + ".bin");
        Files.write(stage.toPath(), new byte[]{4, 5, 6});
        assertThrows(IOException.class, () -> exporter.copy(document, new ByteArrayOutputStream()));
        exporter.discard(document);
        assertEquals(0, new File(directory, "document-exports").list().length);
    }
}
