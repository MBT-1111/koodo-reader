import { describe, expect, it, vi } from "vitest";
import { migrateLegacyLibrary, NATIVE_TABLES } from "./migration";

const cover = "data:image/png;base64,AQID";
function fixture() {
  const source = new Map<string, unknown>([
    ["books", [{ key: "book", format: "EPUB", name: "测试书", cover }]],
    ["book", new Uint8Array([1, 2, 3]).buffer],
    ["cache-book", new Uint8Array([4, 5])],
    ["notes", [{ key: "note", bookKey: "book", notes: "笔记" }]],
    ["bookmarks", [{ key: "bookmark", bookKey: "book", percentage: 0.4 }]],
    ["words", [{ key: "word", bookKey: "book", word: "reader" }]],
  ]);
  return {
    source,
    legacy: { getItem: vi.fn(async (key: string) => source.get(key) ?? null) },
    target: {
      writeBook: vi.fn(async (_name: string, _bytes: ArrayBuffer) => {}),
      saveCover: vi.fn(async (_key: string, _cover: string) => true),
      replaceTable: vi.fn(async (_table: string, _rows: Record<string, unknown>[]) => {}),
    },
  };
}

describe("Android legacy library migration", () => {
  it("copies originals, caches, covers and all record categories without editing the source", async () => {
    const { source, legacy, target } = fixture();
    await migrateLegacyLibrary(legacy, target);
    expect(target.writeBook.mock.calls.map(([name]) => name)).toEqual(["book.epub", "cache-book.zip"]);
    expect([...new Uint8Array(target.writeBook.mock.calls[1][1])]).toEqual([4, 5]);
    expect(target.saveCover).toHaveBeenCalledWith("book", cover);
    expect(target.replaceTable.mock.calls.map(([table]) => table)).toEqual(NATIVE_TABLES);
    expect(target.replaceTable.mock.calls[0][1][0].cover).toBe("");
    expect(source.get("books")).toEqual([{ key: "book", format: "EPUB", name: "测试书", cover }]);
    expect(source.has("book")).toBe(true);
    expect(target.replaceTable).toHaveBeenCalledWith("notes", source.get("notes"));
  });

  it("does not publish metadata after a failed file write and can retry", async () => {
    const { source, legacy, target } = fixture();
    target.writeBook.mockRejectedValueOnce(new Error("disk full"));
    await expect(migrateLegacyLibrary(legacy, target)).rejects.toThrow("disk full");
    expect(target.replaceTable).not.toHaveBeenCalled();
    expect(source.has("book")).toBe(true);
    await migrateLegacyLibrary(legacy, target);
    expect(target.replaceTable).toHaveBeenCalledTimes(5);
  });

  it("propagates a database failure without removing the original records", async () => {
    const { source, legacy, target } = fixture();
    target.replaceTable.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(migrateLegacyLibrary(legacy, target)).rejects.toThrow("database unavailable");
    expect(source.get("notes")).toEqual([{ key: "note", bookKey: "book", notes: "笔记" }]);
    await migrateLegacyLibrary(legacy, target);
    expect(target.replaceTable).toHaveBeenLastCalledWith("plugins", []);
  });

  it("retains metadata-only books and unsupported inline covers", async () => {
    const { source, legacy, target } = fixture();
    source.delete("book");
    source.delete("cache-book");
    target.saveCover.mockResolvedValue(false);
    await migrateLegacyLibrary(legacy, target);
    expect(target.writeBook).not.toHaveBeenCalled();
    expect(target.replaceTable.mock.calls[0][1][0].cover).toBe(cover);
  });

  it("rejects malformed legacy records instead of replacing them with an empty library", async () => {
    const { source, legacy, target } = fixture();
    source.set("books", "corrupt");
    await expect(migrateLegacyLibrary(legacy, target)).rejects.toThrow("ANDROID_STORAGE_LEGACY_TABLE");
    expect(target.replaceTable).not.toHaveBeenCalled();
  });
});
