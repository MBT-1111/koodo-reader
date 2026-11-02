import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createBackupArchive, prepareBackupArchive, type BackupSource } from "./backupArchive";

function fixture() {
  const data = new Map([
    ["book/book.epub", new Uint8Array([1, 2, 3]).buffer],
    ["cover/book.png", new Uint8Array([4, 5]).buffer],
    ["font/中文.ttf", new Uint8Array([6, 7]).buffer],
    ["background/paper.png", new Uint8Array([8, 9]).buffer],
  ]);
  const source: BackupSource = {
    tables: { books: [{ key: "book", name: "真实书名", format: "EPUB" }], notes: [{ key: "note", bookKey: "book", text: "引用", notes: "中文笔记", tag: ["标签"] }], bookmarks: [{ key: "bookmark", bookKey: "book" }], words: [{ key: "word", bookKey: "book" }], plugins: [{ key: "plugin", config: "settings" }] },
    preferences: { readerConfig: '{"fontSize":"22"}', recordLocation: '{"book":{"percentage":0.42}}', shelfList: '{"我的书架":["book"]}', customFonts: '{"中文":{"type":"ttf"}}', fontList: '["中文"]', customBackgrounds: '{"paper":{"extension":"png"}}', __koodo_native_preferences_version: "123", __koodo_native_fonts_version: "1" },
    files: [...data.keys()].map((path) => { const [group, name] = path.split("/"); return { group: group as BackupSource["files"][number]["group"], name }; }),
    read: async (file) => data.get(`${file.group}/${file.name}`) ?? null,
  };
  return { source, data };
}

describe("Android full backup archives", () => {
  it("roundtrips all record categories, Unicode settings, progress and binary resources", async () => {
    const { source, data } = fixture();
    const { blob, manifest } = await createBackupArchive(source);
    const restored = await prepareBackupArchive(await blob.arrayBuffer());
    expect(restored.manifest.tables).toEqual(source.tables);
    expect(restored.manifest.preferences.shelfList).toBe(source.preferences.shelfList);
    expect(restored.manifest.preferences.recordLocation).toBe(source.preferences.recordLocation);
    expect(restored.manifest.preferences.__koodo_native_preferences_version).toBeUndefined();
    expect(source.preferences.__koodo_native_preferences_version).toBe("123");
    for (const file of restored.manifest.files) expect(await restored.read(file)).toEqual(data.get(`${file.group}/${file.name}`));
    expect(restored.manifest).toEqual(manifest);
  });

  it("refuses incomplete backups instead of silently omitting a book or font", async () => {
    const { source, data } = fixture();
    data.delete("book/book.epub");
    await expect(createBackupArchive(source)).rejects.toThrow("ANDROID_BACKUP_MISSING_FILE");
    source.files = source.files.filter((file) => file.group !== "book");
    await expect(createBackupArchive(source)).rejects.toThrow("ANDROID_BACKUP_INVALID");
    source.tables.books = [];
    source.files = source.files.filter((file) => file.group !== "font");
    await expect(createBackupArchive(source)).rejects.toThrow("ANDROID_BACKUP_INVALID");
  });

  it("rejects a changed payload before a restore can begin", async () => {
    const { source } = fixture();
    const { blob } = await createBackupArchive(source);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    zip.file("book/book.epub", new Uint8Array([9, 8, 7]));
    await expect(prepareBackupArchive(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow("ANDROID_BACKUP_INVALID");
  });

  it("rejects unknown formats, duplicate entries, duplicate records and invalid settings", async () => {
    const { source } = fixture();
    const { blob, manifest } = await createBackupArchive(source);
    for (const change of [
      { schema: 2 }, { files: [...manifest.files, manifest.files[0]] },
      { tables: { ...manifest.tables, books: [...manifest.tables.books, manifest.tables.books[0]] } },
      { preferences: { ...manifest.preferences, readerConfig: "[]" } },
      { preferences: { ...manifest.preferences, __koodo_native_preferences_version: "999" } },
    ]) {
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      zip.file("koodo-android-backup.json", JSON.stringify({ ...manifest, ...change }));
      await expect(prepareBackupArchive(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow();
    }
  });

  it("rejects path traversal and unlisted files", async () => {
    const { source } = fixture();
    const { blob } = await createBackupArchive(source);
    for (const path of ["../escape", "unknown.txt"]) {
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      zip.file(path, "bad");
      await expect(prepareBackupArchive(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow("ANDROID_BACKUP_INVALID");
    }
  });
});
