package xyz.koodoreader.custom.android;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import androidx.activity.result.ActivityResult;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.io.OutputStream;

@CapacitorPlugin(name = "KoodoStorage")
public class KoodoStoragePlugin extends Plugin {
    private NativeLibraryManager store;
    private volatile boolean exportPending;
    private boolean pickerPending;

    @PluginMethod
    public void pickBooks(PluginCall call) {
        if (pickerPending) { call.reject("ANDROID_IMPORT_BUSY"); return; }
        pickerPending = true;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try { startActivityForResult(call, intent, "booksSelected"); }
        catch (Exception error) { pickerPending = false; call.reject("ANDROID_IMPORT_FAILED"); }
    }

    @ActivityCallback
    private void booksSelected(PluginCall call, ActivityResult activityResult) {
        if (call == null) { pickerPending = false; return; }
        bridge.execute(() -> {
            try {
                JSONArray books = new JSONArray();
                if (activityResult.getResultCode() == Activity.RESULT_OK) {
                    Intent data = activityResult.getData();
                    if (data == null) throw new IllegalArgumentException("IMPORT_DOCUMENT");
                    List<Uri> uris = new ArrayList<>();
                    if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
                    else if (data.getData() != null) uris.add(data.getData());
                    for (Uri uri : uris) {
                        if (!"content".equals(uri.getScheme())) throw new IllegalArgumentException("IMPORT_URI");
                        getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        String name;
                        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                            if (cursor == null || !cursor.moveToFirst()) throw new IllegalArgumentException("IMPORT_NAME");
                            name = cursor.getString(0);
                        }
                        try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                            if (input == null) throw new IllegalArgumentException("IMPORT_SOURCE");
                            byte[] bytes = new byte[65536]; int count;
                            while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
                            books.put(new JSONObject().put("uri", uri.toString()).put("name", name).put("data", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)));
                        }
                    }
                } else if (activityResult.getResultCode() != Activity.RESULT_CANCELED) throw new IllegalArgumentException("IMPORT_RESULT");
                call.resolve(new JSObject().put("books", books));
            } catch (Exception error) { call.reject("ANDROID_IMPORT_FAILED", "ANDROID_IMPORT_FAILED"); }
            finally { pickerPending = false; }
        });
    }

    @PluginMethod
    public void saveDocument(PluginCall call) {
        if (exportPending) { call.reject("ANDROID_EXPORT_BUSY", "ANDROID_EXPORT_BUSY"); return; }
        exportPending = true;
        try {
            NativeDocumentExport exporter = new NativeDocumentExport(getContext().getCacheDir());
            JSONObject document = exporter.stage(call.getData());
            call.getData().remove("data");
            call.getData().put("document", document);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(document.getString("mime")).putExtra(Intent.EXTRA_TITLE, document.getString("name"));
            bridge.executeOnMainThread(() -> {
                try { startActivityForResult(call, intent, "documentCreated"); }
                catch (Exception error) {
                    try { exporter.discard(document); } catch (Exception ignored) {}
                    exportPending = false;
                    call.reject("ANDROID_EXPORT_FAILED", "ANDROID_EXPORT_FAILED");
                }
            });
        } catch (Exception error) {
            exportPending = false;
            call.reject("ANDROID_EXPORT_FAILED", "ANDROID_EXPORT_FAILED");
        }
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult activityResult) {
        if (call == null) { exportPending = false; return; }
        bridge.execute(() -> {
            JSONObject document = call.getData().optJSONObject("document");
            try {
                NativeDocumentExport exporter = new NativeDocumentExport(getContext().getCacheDir());
                JSObject result;
                try {
                    if (activityResult.getResultCode() == Activity.RESULT_CANCELED) {
                        result = new JSObject().put("status", "cancel");
                    } else {
                        Uri uri = activityResult.getData() == null ? null : activityResult.getData().getData();
                        if (activityResult.getResultCode() != Activity.RESULT_OK || uri == null || !"content".equals(uri.getScheme())) throw new IllegalArgumentException("EXPORT_URI");
                        try (OutputStream target = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                            if (target == null) throw new IllegalArgumentException("EXPORT_TARGET");
                            result = JSObject.fromJSONObject(exporter.copy(document, target));
                        }
                    }
                } finally { exporter.discard(document); }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("ANDROID_EXPORT_FAILED", "ANDROID_EXPORT_FAILED");
            } finally { exportPending = false; }
        });
    }

    @PluginMethod
    public void execute(PluginCall call) {
        try {
            if ("credential".equals(call.getData().optString("channel"))) {
                JSObject result = new JSObject();
                result.put("value", new NativeCredentialStore(getContext().getNoBackupFilesDir(), getContext().getPackageName()).execute(call.getData()));
                call.resolve(result); return;
            }
            if (store == null) store = new NativeLibraryManager(getContext().getFilesDir(), getContext().getContentResolver());
            JSObject result = new JSObject();
            result.put("value", store.execute(call.getData()));
            call.resolve(result);
        } catch (Exception error) {
            // Do not send filesystem paths, record content or credentials to logs/JS.
            call.reject("ANDROID_STORAGE_FAILED", "ANDROID_STORAGE_FAILED");
        }
    }

    @Override protected void handleOnDestroy() {
        if (store != null) store.close();
    }
}
