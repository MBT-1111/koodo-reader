import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDataBackup, rawData } from "../backup/dataBackup";

const mocks = vi.hoisted(() => ({ pause: vi.fn(), resume: vi.fn(), library: vi.fn(), fingerprint: vi.fn(), prefs: vi.fn(), hydrate: vi.fn(), flush: vi.fn() }));
vi.mock("./bootstrap", () => ({ pauseAndroidPreferences: mocks.pause, flushAndroidPreferences: mocks.flush }));
vi.mock("./storage", () => ({ nativeLibraryCommand: mocks.library, nativeFiles: { fingerprint: mocks.fingerprint }, readNativePreferences: mocks.prefs }));
vi.mock("./preferencesPersistence", async (importOriginal) => {
  const original = await importOriginal<typeof import("./preferencesPersistence")>();
  return { ...original, hydratePreferences: (...args: Parameters<typeof original.hydratePreferences>) => { mocks.hydrate(...args); return original.hydratePreferences(...args); } };
});
import { createAndroidBackup, restoreAndroidBackup } from "./backup";
const tables = { books: [{ key: "book", name: "Book", format: "EPUB" }], notes: [], bookmarks: [] };
const preferences = { schema: 1, version: 100, values: { readerConfig: '{"fontSize":"22"}' } };
class Cache {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllGlobals();
  const cache = new Cache(); cache.setItem("readerConfig", preferences.values.readerConfig); cache.setItem("__koodo_native_preferences_version", "100");
  vi.stubGlobal("localStorage", cache);
  mocks.pause.mockResolvedValue(mocks.resume);
  mocks.fingerprint.mockResolvedValue({ size: 10, sha256: "a".repeat(64) });
  mocks.library.mockImplementation(async (statement, data, token) => statement === "backupBeginStatement" ? { tables, preferences } : { ...preferences, version: 101, values: { ...(data?.preferences || preferences.values), __koodo_native_restore_id: token } });
});

describe("Android metadata-only backup jobs", () => {
  it("requires closing the reader before taking a data snapshot", async () => {
    vi.stubGlobal("window", { location: { hash: "#/epub/book" } });
    await expect(createAndroidBackup()).rejects.toThrow("CUSTOM_CLOSE_READERS");
    expect(mocks.pause).not.toHaveBeenCalled(); expect(mocks.library).not.toHaveBeenCalled();
  });
  it("exports JSON without reading or writing original bytes and saves stable mappings", async () => {
    const result = await createAndroidBackup();
    expect(result.blob.type).toBe("application/json");
    expect(mocks.library.mock.calls.map(([statement]) => statement)).toEqual(["backupBeginStatement", "dataCommitStatement", "backupEndStatement"]);
    expect(mocks.library.mock.calls[1][1].tables).toEqual(tables);
    expect(mocks.hydrate).toHaveBeenCalledOnce();
    expect(mocks.resume).toHaveBeenCalledOnce();
  });
  it("always releases the native read lock when a source is unavailable", async () => {
    mocks.fingerprint.mockRejectedValue(new Error("source missing"));
    await expect(createAndroidBackup()).rejects.toThrow("source missing");
    expect(mocks.library.mock.calls.map(([statement]) => statement)).toEqual(["backupBeginStatement", "backupEndStatement"]);
    expect(mocks.hydrate).not.toHaveBeenCalled(); expect(mocks.resume).toHaveBeenCalledOnce();
  });
  it("does not update JS preferences after a failed data commit", async () => {
    const { backup } = await createDataBackup(rawData(tables, preferences.values), preferences.values, { book: "a".repeat(64) });
    mocks.library.mockImplementation(async (statement) => {
      if (statement === "dataCommitStatement") throw new Error("disk full");
      return { tables, preferences };
    });
    mocks.prefs.mockResolvedValue(preferences);
    await expect(restoreAndroidBackup(backup)).rejects.toThrow("disk full");
    expect(mocks.hydrate).toHaveBeenCalledWith(localStorage, preferences); expect(mocks.resume).toHaveBeenCalledOnce();
  });
  it("recognizes a successful native commit whose response was lost", async () => {
    mocks.library.mockImplementation(async (statement, _data, token) => {
      if (statement === "dataCommitStatement") {
        mocks.prefs.mockResolvedValue({ ...preferences, values: { ...preferences.values, __koodo_native_restore_id: token } });
        throw new Error("response lost");
      }
      return { tables, preferences };
    });
    await createAndroidBackup();
    expect(mocks.hydrate).toHaveBeenCalledOnce();
  });
  it("retains and queues a preference edit made while hashing before a commit", async () => {
    mocks.fingerprint.mockImplementation(async () => {
      localStorage.setItem("recordLocation", '{"book":{"percentage":0.8}}');
      return { size: 10, sha256: "a".repeat(64) };
    });
    await expect(createAndroidBackup()).rejects.toThrow("CUSTOM_LOCAL_CHANGED");
    expect(mocks.library.mock.calls.some(([statement]) => statement === "dataCommitStatement")).toBe(false);
    expect(JSON.parse(localStorage.getItem("recordLocation")!).book.percentage).toBe(0.8);
    expect(mocks.flush).toHaveBeenCalledOnce();
  });
  it("undoes a native application if a JS preference edit races its response", async () => {
    let commits = 0;
    mocks.library.mockImplementation(async (statement, data, token) => {
      if (statement === "backupBeginStatement") return { tables, preferences };
      if (statement !== "dataCommitStatement") return null;
      if (++commits === 1) localStorage.setItem("readingTime", '{"book":125}');
      return { schema: 1, version: 100 + commits, values: { ...data.preferences, __koodo_native_restore_id: token } };
    });
    await expect(createAndroidBackup()).rejects.toThrow("CUSTOM_LOCAL_CHANGED");
    expect(commits).toBe(2);
    const rollback = mocks.library.mock.calls.filter(([statement]) => statement === "dataCommitStatement")[1][1];
    expect(rollback.tables).toEqual(tables);
    expect(rollback.preferences.customDataCheckpoint).toBeUndefined();
    expect(JSON.parse(localStorage.getItem("readingTime")!).book).toBe(125);
    expect(mocks.flush).toHaveBeenCalledOnce();
  });
  it("undoes an application if a reader opened while waiting for the bridge", async () => {
    let commits = 0;
    mocks.library.mockImplementation(async (statement, data, token) => {
      if (statement === "backupBeginStatement") return { tables, preferences };
      if (statement !== "dataCommitStatement") return null;
      if (++commits === 1) vi.stubGlobal("window", { location: { hash: "#/epub/book" } });
      return { schema: 1, version: 100 + commits, values: { ...data.preferences, __koodo_native_restore_id: token } };
    });
    await expect(createAndroidBackup()).rejects.toThrow("CUSTOM_CLOSE_READERS");
    expect(commits).toBe(2);
    expect(localStorage.getItem("customDataCheckpoint")).toBeNull();
  });
});
