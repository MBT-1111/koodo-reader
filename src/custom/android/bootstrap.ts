import localforage from "localforage";
import { App } from "@capacitor/app";
import { isNativeAndroid } from "../../utils/platform";
import { nativeDatabaseCommand, nativeFiles, readNativePreferences, writeNativePreferences } from "./storage";
import { migrateLegacyLibrary } from "./migration";
import { cachedValues, cachedVersion, hydratePreferences, observePreferences, PREFERENCES_VERSION_KEY } from "./preferencesPersistence";

export const ANDROID_STORAGE_ERROR_EVENT = "android-storage-error";
let persistence: ReturnType<typeof observePreferences> | undefined;

export const hasNativeStorageError = () => !!persistence?.failed;
export const flushAndroidPreferences = () => persistence?.flush() || Promise.resolve();

export async function initNativeStorage(): Promise<void> {
  if (!isNativeAndroid) return;
  const snapshot = await readNativePreferences();
  if (snapshot) {
    const current = hydratePreferences(localStorage, snapshot);
    if (current.version > snapshot.version) await writeNativePreferences(current);
  } else {
    // Keep IndexedDB intact until native files, all tables and preferences succeed.
    await migrateLegacyLibrary(localforage, {
      writeBook: (name, bytes) => nativeFiles.write("book", name, bytes),
      saveCover: (key, cover) => nativeFiles.saveCover(key, cover),
      replaceTable: async (dbName, data) => { await nativeDatabaseCommand({ dbName, statement: "replaceAllStatement", data }); },
    });
    const version = cachedVersion(localStorage) + 1;
    await writeNativePreferences({ schema: 1, version, values: cachedValues(localStorage) });
    localStorage.setItem(PREFERENCES_VERSION_KEY, String(version));
  }
  persistence = observePreferences(localStorage, writeNativePreferences, () => window.dispatchEvent(new Event(ANDROID_STORAGE_ERROR_EVENT)));
  const flush = () => { void flushAndroidPreferences().catch(() => {}); };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", flush);
  await App.addListener("appStateChange", flush);
}
