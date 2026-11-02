import { describe, expect, it, vi } from "vitest";
import { migrateLegacyBackgrounds, migrateLegacyFonts, migrateLegacyLibrary, NATIVE_TABLES } from "./migration";

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

describe("Android legacy font migration", () => {
  it("copies Unicode font names and data URLs without removing the source", async () => {
    const { source, legacy } = fixture();
    source.set("font_中文字体", "data:font/ttf;base64,AQID");
    source.set("font_binary", new Uint8Array([4, 5]));
    const write = vi.fn(async (_name: string, _bytes: ArrayBuffer) => {});
    await migrateLegacyFonts(legacy, { 中文字体: { type: "ttf" }, binary: { type: "woff" } }, write);
    expect(write.mock.calls.map(([name, bytes]) => [name, [...new Uint8Array(bytes)]])).toEqual([
      ["中文字体.ttf", [1, 2, 3]], ["binary.woff", [4, 5]],
    ]);
    expect(source.get("font_中文字体")).toBe("data:font/ttf;base64,AQID");
  });

  it("retains the source after a failed write and retries the copy", async () => {
    const { source, legacy } = fixture();
    source.set("font_fixture", "data:font/otf;base64,AQID");
    const write = vi.fn(async (_name: string, _bytes: ArrayBuffer) => {});
    write.mockRejectedValueOnce(new Error("disk full"));
    await expect(migrateLegacyFonts(legacy, { fixture: { type: "otf" } }, write)).rejects.toThrow("disk full");
    expect(source.has("font_fixture")).toBe(true);
    await migrateLegacyFonts(legacy, { fixture: { type: "otf" } }, write);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed metadata and font data", async () => {
    const { source, legacy } = fixture();
    const write = vi.fn(async (_name: string, _bytes: ArrayBuffer) => {});
    await expect(migrateLegacyFonts(legacy, [], write)).rejects.toThrow("ANDROID_STORAGE_LEGACY_FONTS");
    await expect(migrateLegacyFonts(legacy, { bad: { type: "exe" } }, write)).rejects.toThrow("ANDROID_STORAGE_LEGACY_FONT_TYPE");
    source.set("font_bad", "data:font/ttf;base64,broken!");
    await expect(migrateLegacyFonts(legacy, { bad: { type: "ttf" } }, write)).rejects.toThrow("ANDROID_STORAGE_LEGACY_FONT_DATA");
    expect(write).not.toHaveBeenCalled();
  });

  it("retains missing-font metadata and tolerates an empty font library", async () => {
    const { legacy } = fixture();
    const write = vi.fn(async (_name: string, _bytes: ArrayBuffer) => {});
    await migrateLegacyFonts(legacy, null, write);
    await migrateLegacyFonts(legacy, { missing: { type: "ttf" } }, write);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("Android legacy background migration", () => {
  it("copies image bytes and keeps legacy images and metadata intact", async () => {
    const { source, legacy } = fixture();
    source.set("background_山水", "data:image/jpeg;base64,AQID");
    source.set("background_vector", "data:image/svg+xml;base64,BAU=");
    const metadata = { 山水: { extension: "jpg" }, vector: { extension: "svg" }, missing: { extension: "png" } };
    const write = vi.fn(async (_name: string, _bytes: ArrayBuffer) => {});
    await migrateLegacyBackgrounds(legacy, metadata, write);
    expect(write.mock.calls.map(([name, bytes]) => [name, [...new Uint8Array(bytes)]])).toEqual([
      ["山水.jpg", [1, 2, 3]], ["vector.svg", [4, 5]],
    ]);
    expect(source.get("background_山水")).toBe("data:image/jpeg;base64,AQID");
    expect(metadata.山水.extension).toBe("jpg");
  });

  it("propagates a failed copy and permits retry without removing the source", async () => {
    const { source, legacy } = fixture();
    source.set("background_fixture", "data:image/png;base64,AQID");
    const write = vi.fn(async (_name: string, _bytes: ArrayBuffer) => {});
    write.mockRejectedValueOnce(new Error("disk full"));
    await expect(migrateLegacyBackgrounds(legacy, { fixture: { extension: "png" } }, write)).rejects.toThrow("disk full");
    await migrateLegacyBackgrounds(legacy, { fixture: { extension: "png" } }, write);
    expect(write).toHaveBeenCalledTimes(2);
    expect(source.has("background_fixture")).toBe(true);
  });

  it("rejects malformed metadata and image data, and accepts an empty library", async () => {
    const { source, legacy } = fixture();
    const write = vi.fn(async (_name: string, _bytes: ArrayBuffer) => {});
    await migrateLegacyBackgrounds(legacy, null, write);
    await expect(migrateLegacyBackgrounds(legacy, [], write)).rejects.toThrow("ANDROID_STORAGE_LEGACY_BACKGROUNDS");
    await expect(migrateLegacyBackgrounds(legacy, { bad: { extension: "../png" } }, write)).rejects.toThrow("ANDROID_STORAGE_LEGACY_BACKGROUND_TYPE");
    source.set("background_bad", "data:image/png;base64,broken!");
    await expect(migrateLegacyBackgrounds(legacy, { bad: { extension: "png" } }, write)).rejects.toThrow("ANDROID_STORAGE_IMAGE_DATA");
    expect(write).not.toHaveBeenCalled();
  });
});
