package xyz.koodoreader.custom.android;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "KoodoStorage")
public class KoodoStoragePlugin extends Plugin {
    private NativeLibraryStore store;

    @PluginMethod
    public void execute(PluginCall call) {
        try {
            if (store == null) store = new NativeLibraryStore(new File(getContext().getFilesDir(), "library-v1"));
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
