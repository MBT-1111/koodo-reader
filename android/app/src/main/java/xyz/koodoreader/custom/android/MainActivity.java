package xyz.koodoreader.custom.android;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KoodoStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
