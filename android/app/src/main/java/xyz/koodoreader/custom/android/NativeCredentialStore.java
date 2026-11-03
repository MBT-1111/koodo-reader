package xyz.koodoreader.custom.android;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Session material never enters library preferences, WebView storage or backups. */
public final class NativeCredentialStore {
    private final AtomicFile file;
    private final String alias;
    public NativeCredentialStore(File noBackupDirectory, String packageName) {
        file = new AtomicFile(new File(noBackupDirectory, "mega-session-v1.enc"));
        alias = packageName + ".mega-session-v1";
    }
    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(alias)) {
            if (!create) throw new IllegalStateException("CREDENTIAL_KEY_MISSING");
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(alias, null);
    }
    public synchronized Object execute(JSONObject request) throws Exception {
        if (!"mega".equals(request.getString("slot"))) throw new IllegalArgumentException("CREDENTIAL_SLOT");
        switch (request.getString("action")) {
            case "read":
                if (!file.getBaseFile().exists() && !new File(file.getBaseFile() + ".bak").exists()) return JSONObject.NULL;
                JSONObject encrypted = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
                if (encrypted.getInt("version") != 1) throw new IllegalArgumentException("CREDENTIAL_VERSION");
                Cipher decrypt = Cipher.getInstance("AES/GCM/NoPadding");
                decrypt.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Base64.decode(encrypted.getString("iv"), Base64.NO_WRAP)));
                decrypt.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
                return new String(decrypt.doFinal(Base64.decode(encrypted.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8);
            case "write":
                Object value = request.get("value");
                if (!(value instanceof String) || ((String) value).isEmpty() || ((String) value).length() > 1024 * 1024) throw new IllegalArgumentException("CREDENTIAL_VALUE");
                Cipher encrypt = Cipher.getInstance("AES/GCM/NoPadding");
                encrypt.init(Cipher.ENCRYPT_MODE, key(true));
                encrypt.updateAAD(alias.getBytes(StandardCharsets.UTF_8));
                JSONObject payload = new JSONObject().put("version", 1).put("iv", Base64.encodeToString(encrypt.getIV(), Base64.NO_WRAP))
                    .put("data", Base64.encodeToString(encrypt.doFinal(((String) value).getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
                NativeLibraryStore.write(file, payload.toString().getBytes(StandardCharsets.UTF_8));
                if (!value.equals(execute(new JSONObject().put("slot", "mega").put("action", "read")))) throw new IllegalStateException("CREDENTIAL_VERIFY");
                return JSONObject.NULL;
            case "remove":
                file.delete();
                if (file.getBaseFile().exists() || new File(file.getBaseFile() + ".bak").exists()) throw new IllegalStateException("CREDENTIAL_DELETE");
                KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
                if (store.containsAlias(alias)) store.deleteEntry(alias);
                return JSONObject.NULL;
            default: throw new IllegalArgumentException("CREDENTIAL_ACTION");
        }
    }
}
