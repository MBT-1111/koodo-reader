import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedBackup } from "./backupArchive";

const mocks = vi.hoisted(() => ({ pause: vi.fn(), resume: vi.fn(), library: vi.fn(), command: vi.fn(), read: vi.fn(), prefs: vi.fn() }));
vi.mock("./bootstrap", () => ({ pauseAndroidPreferences: mocks.pause }));
vi.mock("./storage", () => ({ nativeLibraryCommand: mocks.library, nativeCommand: mocks.command, nativeFiles: { read: mocks.read }, readNativePreferences: mocks.prefs }));
import { createAndroidBackup, restoreAndroidBackup } from "./backup";

class Cache {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const backup: PreparedBackup = {
  manifest: { type: "koodo-reader-android-backup", schema: 1, createdAt: "2026-11-02T00:00:00Z", tables: { books: [{ key: "book", name: "Book", format: "EPUB" }], notes: [], bookmarks: [], words: [], plugins: [] }, preferences: { readerConfig: '{"fontSize":"22"}' }, files: [{ group: "book", name: "book.epub", size: 3, sha256: "expected" }] },
  read: async () => new Uint8Array([1, 2, 3]).buffer,
};
const snapshot = (token?: string) => ({ schema: 1, version: 100, values: { readerConfig: '{"fontSize":"22"}', __koodo_native_restore_id: token } });

beforeEach(() => {
  vi.resetAllMocks();
  const cache = new Cache();
  cache.setItem("readerConfig", "old");
  cache.setItem("__koodo_native_preferences_version", "7");
  vi.stubGlobal("localStorage", cache);
  mocks.pause.mockResolvedValue(mocks.resume);
  mocks.command.mockResolvedValue({ size: 3, sha256: "expected" });
  mocks.prefs.mockResolvedValue(null);
});

describe("native full backup orchestration", () => {
  it("releases the snapshot lock and preference observer after a missing source file", async () => {
    mocks.library.mockResolvedValue({ tables: backup.manifest.tables, preferences: { values: {} }, files: { book: ["book.epub"], cover: [], font: [], background: [] } });
    mocks.read.mockResolvedValue(null);
    await expect(createAndroidBackup()).rejects.toThrow("ANDROID_BACKUP_MISSING_FILE");
    expect(mocks.library.mock.calls.map(([statement]) => statement)).toEqual(["backupBeginStatement", "backupEndStatement"]);
    expect(mocks.library.mock.calls[0][2]).toBe(mocks.library.mock.calls[1][2]);
    expect(mocks.resume).toHaveBeenCalledOnce();
  });

  it("updates the preference cache only after the native commit", async () => {
    mocks.library.mockImplementation(async (statement, _data, token) => {
      expect(localStorage.getItem("readerConfig")).toBe("old");
      return statement === "restoreCommitStatement" ? snapshot(token) : { token };
    });
    await restoreAndroidBackup(backup);
    expect(localStorage.getItem("readerConfig")).toBe(backup.manifest.preferences.readerConfig);
    expect(localStorage.getItem("__koodo_native_preferences_version")).toBe("100");
    expect(mocks.resume).toHaveBeenCalledOnce();
  });

  it("aborts a failed write without replacing the old cache", async () => {
    mocks.library.mockResolvedValue({});
    mocks.command.mockRejectedValue(new Error("disk full"));
    await expect(restoreAndroidBackup(backup)).rejects.toThrow("disk full");
    expect(mocks.library.mock.calls.map(([statement]) => statement)).toEqual(["restoreBeginStatement", "restoreAbortStatement"]);
    expect(localStorage.getItem("readerConfig")).toBe("old");
    expect(mocks.resume).toHaveBeenCalledOnce();
  });

  it("can abort when the begin response is lost because the client already knows the job token", async () => {
    mocks.library.mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(null);
    await expect(restoreAndroidBackup(backup)).rejects.toThrow("lost response");
    expect(mocks.library.mock.calls[0][2]).toBe(mocks.library.mock.calls[1][2]);
    expect(localStorage.getItem("readerConfig")).toBe("old");
    expect(mocks.resume).toHaveBeenCalledOnce();
  });

  it("recognizes a committed library when the commit response is lost", async () => {
    let token: string | undefined;
    mocks.library.mockImplementation(async (statement, _data, id) => {
      token = id;
      if (statement === "restoreCommitStatement") throw new Error("lost commit response");
      return { token };
    });
    mocks.prefs.mockImplementation(async () => snapshot(token));
    await restoreAndroidBackup(backup);
    expect(mocks.library.mock.calls.map(([statement]) => statement)).toEqual(["restoreBeginStatement", "restoreCommitStatement"]);
    expect(localStorage.getItem("readerConfig")).toBe(backup.manifest.preferences.readerConfig);
    expect(mocks.resume).toHaveBeenCalledOnce();
  });
});
