import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { snapshot } from "./data";
import type { RawData } from "./types";
import Book from "../../models/Book";
import Bookmark from "../../models/Bookmark";

const require = createRequire(import.meta.url);
const { applyBatch } = require("../../utils/main/custom/database.js") as typeof import("../../utils/main/custom/database.js");
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, String(value)); }, removeItem: (key: string) => { values.delete(key); } };
let engine: typeof import("../../assets/lib/kookit-extra-browser.min.js");
beforeAll(async () => {
  vi.stubGlobal("window", globalThis); vi.stubGlobal("localStorage", storage); vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("addEventListener", () => undefined); vi.stubGlobal("removeEventListener", () => undefined);
  vi.stubGlobal("fetch", () => { throw new Error("NETWORK_BLOCKED"); });
  vi.stubGlobal("document", { hidden: false, visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });
  // Consume public APIs normally. No minified source is read or deobfuscated.
  engine = await import("../../assets/lib/kookit-extra-browser.min.js");
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("real public persistence contracts using synthetic data", () => {
  it("verifies ReadingTimeUtil's two persisted formats and adapter parsing", () => {
    values.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-31T04:00:00Z"));
    const time = new engine.ReadingTimeUtil(engine.ConfigService, { registerUnloadHandler: () => () => undefined });
    time.start("synthetic-book"); vi.setSystemTime(new Date("2026-10-31T04:00:06Z")); time.commit(); time.stop();
    expect(engine.ConfigService.getAllObjectConfig("readingTime")["synthetic-book"]).toBe(6);
    const dates = time.getAllDates(); expect(dates).toHaveLength(1);
    expect(time.getDayStats(dates[0])).toEqual([{ bookKey: "synthetic-book", seconds: 6 }]);
    time.start("synthetic-book"); vi.setSystemTime(new Date("2026-10-31T04:00:10Z")); time.stop();
    expect(engine.ConfigService.getAllObjectConfig("readingTime")["synthetic-book"]).toBe(10);
    expect(time.getDayStats(dates[0])).toEqual([{ bookKey: "synthetic-book", seconds: 10 }]);
    const raw: RawData = { tables: { books: [], notes: [], bookmarks: [] }, config: Object.fromEntries(values) };
    const data = snapshot(raw, { books: { "synthetic-book": "a".repeat(64) }, notes: {}, bookmarks: {} });
    expect(data[`daily/${dates[0]}/${"a".repeat(64)}`].value).toBe(10);
    vi.useRealTimers();
  });
  it("uses actual upstream SQL converters and rolls back the entire compare-and-swap batch", () => {
    const db = new DatabaseSync(":memory:");
    const statements = engine.SqlStatement;
    db.exec(statements.sqlStatement.createTableStatement.notes);
    const facade = {
      prepare: (sql: string) => db.prepare(sql),
      transaction: (action: () => void) => () => { db.exec("BEGIN"); try { action(); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } },
    };
    const note = { key: "synthetic-note", bookKey: "synthetic-book", date: { year: 2026, month: 10, day: 31 }, chapter: "Chapter", chapterIndex: 0, text: "original", cfi: "{}", range: "[]", notes: "", percentage: "0.5", color: "1", tag: [] };
    applyBatch(facade, statements, "notes", [{ key: note.key, before: null, value: note }]);
    const read = () => statements.sqliteToJson.notes(db.prepare(statements.sqlStatement.getStatement.notes).get(note.key));
    const before = read(); expect(before.text).toBe("original");
    expect(() => applyBatch(facade, statements, "notes", [
      { key: note.key, before, value: { ...before, text: "changed" } },
      { key: "missing", before: { ...before, key: "missing" }, value: null },
    ])).toThrow("CUSTOM_LOCAL_CHANGED");
    expect(read().text).toBe("original");
    applyBatch(facade, statements, "notes", [{ key: note.key, before, value: { ...before, text: "changed" } }]);
    expect(read().text).toBe("changed");
    expect(() => applyBatch(facade, statements, "books", [{ key: "book", before: { key: "book", path: "old" }, value: { key: "book", path: "new" } }])).toThrow("CUSTOM_UNSAFE_BOOK_CHANGE");
    db.close();
  });
  it("preserves local book resources when updating metadata and deletes bookmarks through upstream SQL", () => {
    const db = new DatabaseSync(":memory:"), statements = engine.SqlStatement;
    for (const table of ["books", "bookmarks"]) {
      db.exec(statements.sqlStatement.createTableStatement[table]);
      for (const sql of statements.sqlStatement.migrateStatement[table] || []) { try { db.exec(sql); } catch { /* Existing columns mirror main-process migration behavior. */ } }
    }
    const facade = { prepare: (sql: string) => db.prepare(sql), transaction: (action: () => void) => () => { db.exec("BEGIN"); try { action(); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } } };
    const book = new Book("synthetic-book", "Book", "Author", "Description", "md5", "local-cover", "EPUB", "Publisher", 10, 1, "/synthetic/book.epub", "utf-8");
    db.prepare(statements.sqlStatement.saveStatement.books).run(statements.jsonToSqlite.books(book));
    const before = statements.sqliteToJson.books(db.prepare(statements.sqlStatement.getStatement.books).get(book.key));
    applyBatch(facade, statements, "books", [{ key: book.key, before, value: { ...before, name: "Renamed" } }]);
    const saved = statements.sqliteToJson.books(db.prepare(statements.sqlStatement.getStatement.books).get(book.key));
    expect(saved.name).toBe("Renamed"); expect(saved.path).toBe(book.path); expect(saved.cover).toBe(book.cover);
    const bookmark = new Bookmark(book.key, "cfi", "Label", "0.5", "Chapter");
    db.prepare(statements.sqlStatement.saveStatement.bookmarks).run(statements.jsonToSqlite.bookmarks(bookmark));
    const original = statements.sqliteToJson.bookmarks(db.prepare(statements.sqlStatement.getStatement.bookmarks).get(bookmark.key));
    applyBatch(facade, statements, "bookmarks", [{ key: bookmark.key, before: original, value: null }]);
    expect(db.prepare(statements.sqlStatement.getStatement.bookmarks).get(bookmark.key)).toBeUndefined();
    db.close();
  });
});
