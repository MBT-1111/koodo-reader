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
import org.json.JSONObject;
import java.io.OutputStream;

@CapacitorPlugin(name = "KoodoStorage")
public class KoodoStoragePlugin extends Plugin {
    private NativeLibraryManager store;
    private volatile boolean exportPending;

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
            if (store == null) store = new NativeLibraryManager(getContext().getFilesDir());
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
