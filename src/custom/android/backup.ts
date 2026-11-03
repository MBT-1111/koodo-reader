import { flushAndroidPreferences, pauseAndroidPreferences } from "./bootstrap";
import { cachedValues, hydratePreferences, PREFERENCES_VERSION_KEY } from "./preferencesPersistence";
import { nativeFiles, nativeLibraryCommand, readNativePreferences, type PreferencesSnapshot } from "./storage";
import { createDataBackup, DATA_STATE_KEY, parseDataBackup, planDataRestore, rawData, type DataBackup } from "../backup/dataBackup";
import type { RawData } from "../sync/types";
import { stable } from "../sync/protocol";

export interface NativeSnapshot { tables: RawData["tables"]; preferences: PreferencesSnapshot }
type Progress = (done: number, total: number) => void;
let active: { token: string; baseline: Record<string, string>; source?: NativeSnapshot } | undefined;
const readerOpen = () => typeof window !== "undefined" && !!window.location.hash && !window.location.hash.startsWith("#/manager/");

export async function fingerprints(source: NativeSnapshot, progress?: Progress) {
  const hashes: Record<string, string> = {};
  for (const [index, book] of source.tables.books.entries()) {
    hashes[book.key] = (await nativeFiles.fingerprint(`${book.key}.${String(book.format).toLowerCase()}`)).sha256;
    progress?.(index + 1, source.tables.books.length);
  }
  return hashes;
}

export async function snapshotJob<T>(job: (source: NativeSnapshot, token: string) => Promise<T>): Promise<T> {
  if (readerOpen()) throw new Error("CUSTOM_CLOSE_READERS");
  const resume = await pauseAndroidPreferences(), token = crypto.randomUUID();
  const context = { token, baseline: cachedValues(localStorage), source: undefined as NativeSnapshot | undefined };
  active = context;
  try {
    const source = await nativeLibraryCommand<NativeSnapshot>("backupBeginStatement", undefined, token);
    context.source = source;
    return await job(source, token);
  } finally {
    try { await nativeLibraryCommand("backupEndStatement", undefined, token); }
    finally {
      const current = cachedValues(localStorage);
      const changed = [...new Set([...Object.keys(context.baseline), ...Object.keys(current)])].filter((key) => context.baseline[key] !== current[key]);
      active = undefined; resume();
      // Changes made while the observer was paused must be queued again, even
      // when the data job aborted before reaching the native commit.
      for (const key of changed) {
        if (current[key] === undefined) localStorage.removeItem(key); else localStorage.setItem(key, current[key]);
      }
      if (changed.length) await flushAndroidPreferences();
    }
  }
}

export async function commit(tables: RawData["tables"], preferences: Record<string, string>, token: string) {
  const context = active;
  if (!context?.source || context.token !== token) throw new Error("CUSTOM_SESSION_EXPIRED");
  if (readerOpen()) throw new Error("CUSTOM_CLOSE_READERS");
  if (stable(cachedValues(localStorage)) !== stable(context.baseline)) throw new Error("CUSTOM_LOCAL_CHANGED");
  let current: PreferencesSnapshot;
  try { current = await nativeLibraryCommand<PreferencesSnapshot>("dataCommitStatement", { tables, preferences }, token); }
  catch (error) {
    const saved = await readNativePreferences().catch(() => null);
    if (saved?.values.__koodo_native_restore_id !== token) {
      // Native rollback advances the preference version as well. Keep the JS
      // cache on that version so the next ordinary save is not rejected stale.
      if (saved) {
        if (stable(cachedValues(localStorage)) === stable(context.baseline)) { hydratePreferences(localStorage, saved); context.baseline = saved.values; }
        else localStorage.setItem(PREFERENCES_VERSION_KEY, String(saved.version));
      }
      throw error;
    }
    current = saved;
  }
  if (readerOpen() || stable(cachedValues(localStorage)) !== stable(context.baseline)) {
    // A JS edit raced the bridge response. Undo this application while the
    // native lock is still held, then resume ordinary saving of the user's edit.
    const { books, notes, bookmarks } = context.source.tables;
    const values = cachedValues(localStorage);
    try {
      const rollback = await nativeLibraryCommand<PreferencesSnapshot>("dataCommitStatement", { tables: { books, notes, bookmarks }, preferences: values }, token);
      localStorage.setItem(PREFERENCES_VERSION_KEY, String(rollback.version));
    } catch {
      throw new Error("CUSTOM_RECOVERY_REQUIRED");
    }
    throw new Error(readerOpen() ? "CUSTOM_CLOSE_READERS" : "CUSTOM_LOCAL_CHANGED");
  }
  hydratePreferences(localStorage, current);
  context.baseline = current.values;
}

export async function createAndroidBackup(progress?: Progress) {
  return snapshotJob(async (source, token) => {
    const tables = { books: source.tables.books, notes: source.tables.notes, bookmarks: source.tables.bookmarks };
    const values = source.preferences.values;
    const result = await createDataBackup(rawData(tables, values), values, await fingerprints(source, progress));
    await commit(tables, { ...values, [DATA_STATE_KEY]: JSON.stringify(result.state) }, token);
    return result;
  });
}

export async function restoreAndroidBackup(input: DataBackup, progress?: Progress) {
  const backup = await parseDataBackup(JSON.stringify(input));
  return snapshotJob(async (source, token) => {
    const tables = { books: source.tables.books, notes: source.tables.notes, bookmarks: source.tables.bookmarks };
    const result = planDataRestore(backup, rawData(tables, source.preferences.values), source.preferences.values, await fingerprints(source, progress));
    await commit(result.next.tables, result.preferences, token);
    return result.pendingBooks;
  });
}
