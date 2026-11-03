import { describe, expect, it } from "vitest";
import { createDataBackup, DATA_STATE_KEY, parseDataBackup, planDataRestore, rawData } from "./dataBackup";
import { stable } from "../sync/protocol";
import type { RawData } from "../sync/types";

const hash = "a".repeat(64);
function source(key = "windows-book", path = "D:\\Books\\original.epub") {
  const tables: RawData["tables"] = {
    books: [{ key, path, format: "EPUB", name: "同一本书", cover: "private-cover" }],
    notes: [{ key: "note", bookKey: key, notes: "笔记", text: "选中的文字", tag: ["标签"] }],
    bookmarks: [{ key: "bookmark", bookKey: key, cfi: "chapter-2", label: "书签" }],
  };
  const values = {
    readerConfig: JSON.stringify({ fontSize: "24", lineHeight: "1.8", aiApiKey: "secret", storageLocation: path, isImportPath: "yes" }),
    recordLocation: JSON.stringify({ [key]: { percentage: 0.42, chapterTitle: "第二章" } }),
    readingTime: JSON.stringify({ [key]: 125 }), readingStats: JSON.stringify({ "2026-11-03": [`${key}-125`] }),
    favoriteBooks: JSON.stringify([key]), shelfList: JSON.stringify({ 书架: [key] }),
    serviceKey: "secret", customFonts: '{"private":"file:///font.ttf"}',
  };
  return { tables, values, raw: rawData(tables, values), hashes: { [key]: hash } };
}

describe("shared Windows/Android reading data backup", () => {
  it("contains shared entities and safe preferences without original files, local paths, keys or credentials", async () => {
    const s = source();
    const { backup } = await createDataBackup(s.raw, s.values, s.hashes);
    const text = JSON.stringify(backup);
    for (const excluded of ["D:\\Books", "windows-book", "private-cover", "secret", "serviceKey", "customFonts", "isImportPath"]) expect(text.includes(excluded), excluded).toBe(false);
    expect(backup.settings).toEqual({ fontSize: "24", lineHeight: "1.8" });
    expect(await parseDataBackup(text)).toEqual(backup);
  });

  it("restores between different local keys and paths without creating books or copying originals", async () => {
    const s = source(), target = source("android-book", "content://documents/original");
    target.tables.books[0].format = "epub";
    target.tables.notes = []; target.tables.bookmarks = [];
    const { backup } = await createDataBackup(s.raw, s.values, s.hashes);
    const result = planDataRestore(backup, target.raw, { ...target.values, readerConfig: '{"fontSize":"16","isTouch":"yes","aiApiKey":"local-secret"}' }, target.hashes);
    expect(result.pendingBooks).toBe(0);
    expect(result.next.tables.books).toEqual(target.tables.books);
    expect(result.next.tables.notes).toHaveLength(1);
    expect(result.next.tables.notes[0]).toMatchObject({ bookKey: "android-book", notes: "笔记", tag: ["标签"] });
    expect(result.next.tables.bookmarks[0]).toMatchObject({ bookKey: "android-book", label: "书签" });
    expect(JSON.parse(result.preferences.recordLocation)["android-book"].percentage).toBe(0.42);
    expect(JSON.parse(result.preferences.readingTime)["android-book"]).toBe(125);
    expect(JSON.parse(result.preferences.readingStats)["2026-11-03"]).toEqual(["android-book-125"]);
    expect(JSON.parse(result.preferences.shelfList)["书架"]).toEqual(["android-book"]);
    expect(JSON.parse(result.preferences.readerConfig)).toMatchObject({ fontSize: "24", isTouch: "yes", aiApiKey: "local-secret" });
    const again = planDataRestore(backup, result.next, result.preferences, target.hashes);
    expect(stable(again.next)).toBe(stable(result.next));
    expect(again.next.tables.notes).toHaveLength(1);
  });

  it("retains pending data until the matching original is linked and preserves unrelated books", async () => {
    const s = source(), target = source("unrelated");
    target.hashes.unrelated = "b".repeat(64);
    const { backup } = await createDataBackup(s.raw, s.values, s.hashes);
    const result = planDataRestore(backup, target.raw, target.values, target.hashes);
    expect(result.pendingBooks).toBe(1);
    expect(result.next.tables.notes).toEqual(target.tables.notes);
    const roundtrip = await createDataBackup(result.next, result.preferences, target.hashes);
    expect(roundtrip.backup.document.entries[`progress/${hash}`]).toBeDefined();
    result.next.tables.books.push({ key: "newly-linked", format: "EPUB", path: "content://new", name: "原书" });
    const linked = planDataRestore(backup, result.next, result.preferences, { ...target.hashes, "newly-linked": hash });
    expect(linked.pendingBooks).toBe(0);
    expect(linked.next.tables.notes.some((row) => row.bookKey === "newly-linked")).toBe(true);
  });

  it("keeps note identities stable across repeated exports and reverse restores", async () => {
    const s = source();
    const first = await createDataBackup(s.raw, s.values, s.hashes);
    const values = { ...s.values, readerConfig: '{"fontSize":"24","lineHeight":"1.8","readerMode":"single"}', [DATA_STATE_KEY]: JSON.stringify(first.state) };
    const second = await createDataBackup(s.raw, values, s.hashes);
    expect(second.backup.document.entries).toEqual(first.backup.document.entries);
    const restored = planDataRestore(second.backup, s.raw, values, s.hashes);
    expect(JSON.parse(planDataRestore({ ...second.backup, settings: { ...second.backup.settings, readerMode: "double" } }, s.raw, values, s.hashes).preferences.readerConfig).readerMode).toBe("single");
    expect(restored.next.tables.notes).toHaveLength(1);
    expect(restored.next.tables.notes[0].key).toBe("note");
  });
  it("recognizes independently imported identical notes instead of duplicating them", async () => {
    const s = source(), target = source("android-book", "content://original");
    const { backup } = await createDataBackup(s.raw, s.values, s.hashes);
    const localBackup = await createDataBackup(target.raw, target.values, target.hashes);
    const result = planDataRestore(backup, target.raw, { ...target.values, [DATA_STATE_KEY]: JSON.stringify(localBackup.state) }, target.hashes);
    expect(result.next.tables.notes).toHaveLength(1);
    expect(result.next.tables.bookmarks).toHaveLength(1);
  });

  it("rejects tampering, full book archives and incomplete source fingerprints", async () => {
    const s = source(), { backup } = await createDataBackup(s.raw, s.values, s.hashes);
    await expect(parseDataBackup(JSON.stringify({ ...backup, settings: { fontSize: "30" } }))).rejects.toThrow();
    await expect(parseDataBackup(JSON.stringify({ ...backup, settings: { aiApiKey: "secret" } }))).rejects.toThrow();
    await expect(parseDataBackup(JSON.stringify({ type: "koodo-reader-android-backup", schema: 1 }))).rejects.toThrow();
    await expect(createDataBackup(s.raw, s.values, {})).rejects.toThrow("CUSTOM_INVALID_BOOK");
  });
});
