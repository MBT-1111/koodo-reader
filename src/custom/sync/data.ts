import { copy, materialize, stable, winner } from "./protocol";
import type { Change, Checkpoint, Json, Mappings, RawData, Row, Snapshot, Table } from "./types";
import { fields } from "./contract";

export const configKeys = ["recordLocation", "readingTime", "readingStats", "shelfList", "favoriteBooks", "deletedBooks", "recentBooks", "noteTags"] as const;
export const tables: Table[] = ["books", "notes", "bookmarks"];
const pick = (row: Record<string, Json>, keys: string[]): Record<string, Json> => Object.fromEntries(keys.filter((k) => Object.hasOwn(row, k) && row[k] !== undefined).map((k) => [k, copy(row[k])]));
const record = (value: Json | undefined): Record<string, Json> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export const parseConfig = (raw: RawData, key: string): Json => {
  const text = raw.config[key];
  if (!text) return ["favoriteBooks", "deletedBooks", "recentBooks", "noteTags"].includes(key) ? [] : {};
  try {
    const value = JSON.parse(text) as Json;
    if (!["favoriteBooks", "deletedBooks", "recentBooks", "noteTags"].includes(key) && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error();
    return value;
  } catch { throw new Error("CUSTOM_INVALID_LOCAL_DATA"); }
};
const list = (raw: RawData, key: string): string[] => {
  const value = parseConfig(raw, key);
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
  return value as string[];
};
// Hex is reversible and keeps user shelf names out of document filenames/keys.
export const nameId = (name: string) => Array.from(new TextEncoder().encode(name), (n) => n.toString(16).padStart(2, "0")).join("");

export function snapshot(raw: RawData, mappings: Mappings): Snapshot {
  const result: Snapshot = {};
  const add = (id: string, kind: Snapshot[string]["kind"], value: Json) => { result[`${kind}/${id}`] = { kind, value }; };
  for (const tag of list(raw, "noteTags")) add(nameId(tag), "tag", tag);
  for (const book of raw.tables.books) {
    const id = mappings.books[book.key];
    if (id) add(id, "book", pick(book, fields.book));
  }
  for (const [table, kind] of [["notes", "note"], ["bookmarks", "bookmark"]] as const) for (const row of raw.tables[table]) {
    const book = mappings.books[String(row.bookKey)];
    if (!book) continue;
    const id = mappings[table][row.key] ||= crypto.randomUUID();
    add(id, kind, { ...pick(row, fields[kind]), book });
  }
  const progress = record(parseConfig(raw, "recordLocation"));
  for (const [key, value] of Object.entries(progress)) if (mappings.books[key] && value !== null) {
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
    const location = pick(record(value), fields.progress);
    if (Object.keys(location).length) add(mappings.books[key], "progress", location);
  }
  for (const key of list(raw, "favoriteBooks")) if (mappings.books[key]) add(mappings.books[key], "favorite", true);
  const removed = new Set(list(raw, "deletedBooks"));
  const present = new Set(raw.tables.books.map((b) => b.key));
  for (const [key, id] of Object.entries(mappings.books)) if (removed.has(key) || !present.has(key)) add(id, "trash", true);
  list(raw, "recentBooks").forEach((key, rank) => { if (mappings.books[key]) add(mappings.books[key], "recent", rank); });
  for (const [key, seconds] of Object.entries(record(parseConfig(raw, "readingTime")))) if (mappings.books[key]) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
    add(mappings.books[key], "time", seconds);
  }
  for (const [date, entries] of Object.entries(record(parseConfig(raw, "readingStats")))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(entries)) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
    for (const entry of entries) {
      if (typeof entry !== "string") throw new Error("CUSTOM_INVALID_LOCAL_DATA");
      const match = /^(.*)-(\d+(?:\.\d+)?)$/.exec(entry);
      if (!match) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
      const book = mappings.books[match[1]];
      if (book) add(`${date}/${book}`, "daily", Number(match[2]));
    }
  }
  for (const [name, keys] of Object.entries(record(parseConfig(raw, "shelfList")))) {
    if (name === "New") continue;
    if (!Array.isArray(keys) || !keys.every((v) => typeof v === "string")) throw new Error("CUSTOM_INVALID_LOCAL_DATA");
    add(nameId(name), "shelfName", { name });
    for (const key of keys as string[]) if (mappings.books[key]) add(`${nameId(name)}/${mappings.books[key]}`, "shelf", { name, book: mappings.books[key] });
  }
  return result;
}

export function plan(raw: RawData, state: Checkpoint): RawData {
  const next = copy(raw), desired = materialize(state.entries);
  const localBooks = new Set(raw.tables.books.map((b) => b.key));
  // A duplicate local copy maps to the same publication; apply to each copy.
  const bookKeys = (id: string) => Object.entries(state.mappings.books).filter(([key, value]) => value === id && localBooks.has(key)).map(([key]) => key);
  const progress = record(parseConfig(next, "recordLocation"));
  const times = record(parseConfig(next, "readingTime"));
  const days = record(parseConfig(next, "readingStats"));
  const shelves = record(parseConfig(next, "shelfList"));
  const favorites = new Set(list(next, "favoriteBooks")), trash = new Set(list(next, "deletedBooks"));
  const tags = new Set(list(next, "noteTags"));
  const recent = new Map(list(next, "recentBooks").map((key, index) => [key, index]));
  for (const [entity, revisions] of Object.entries(state.entries)) {
    const chosen = winner(revisions), item = desired[entity], id = entity.slice(entity.indexOf("/") + 1);
    const value = record(item?.value);
    if (chosen.kind === "tag") {
      if (item && typeof item.value === "string") tags.add(item.value);
      else for (const tag of tags) if (nameId(tag) === id) tags.delete(tag);
    }
    if (chosen.kind === "book" && item) for (const key of bookKeys(id)) {
      const row = next.tables.books.find((b) => b.key === key)!;
      Object.assign(row, pick(value, fields.book));
    }
    if (chosen.kind === "note" || chosen.kind === "bookmark") {
      const table = chosen.kind === "note" ? "notes" : "bookmarks";
      const known = Object.entries(state.mappings[table]).find(([, syncId]) => syncId === id)?.[0];
      if (!item) {
        if (known) next.tables[table] = next.tables[table].filter((row) => row.key !== known);
      } else if (typeof value.book === "string") {
        const keys = bookKeys(value.book);
        if (!keys.length) continue; // Retain pending remote data until the book is imported locally.
        const key = known || `krc-${id}`;
        if (!known && next.tables[table].some((r) => r.key === key)) throw new Error("CUSTOM_KEY_COLLISION");
        const existing = next.tables[table].find((r) => r.key === key);
        const row: Row = { ...(existing || {}), ...pick(value, fields[chosen.kind]), key, bookKey: keys[0] };
        state.mappings[table][key] = id;
        next.tables[table] = [...next.tables[table].filter((r) => r.key !== key), row];
      }
    }
    if (chosen.kind === "progress") for (const key of bookKeys(id)) {
      if (item) progress[key] = pick(value, fields.progress); else delete progress[key];
    }
    if (chosen.kind === "favorite" || chosen.kind === "trash") for (const key of bookKeys(id)) {
      const set = chosen.kind === "favorite" ? favorites : trash;
      if (item) set.add(key); else set.delete(key);
    }
    if (chosen.kind === "recent") for (const key of bookKeys(id)) { if (item && typeof item.value === "number") recent.set(key, item.value); else recent.delete(key); }
    if (chosen.kind === "time" && item) for (const key of bookKeys(id)) times[key] = item.value;
    if (chosen.kind === "daily" && item) {
      const [date, book] = id.split("/");
      for (const key of bookKeys(book)) {
        const existing = Array.isArray(days[date]) ? days[date] as Json[] : [];
        days[date] = [...existing.filter((entry) => typeof entry !== "string" || entry.slice(0, entry.lastIndexOf("-")) !== key), `${key}-${item.value}`];
      }
    }
    if (chosen.kind === "shelfName") {
      if (item && typeof value.name === "string" && value.name !== "New" && !["__proto__", "constructor", "prototype"].includes(value.name)) shelves[value.name] ||= [];
      if (!item) {
        // The deleted name is retained in the causal history/previous observation.
        const previous = state.observed[entity];
        const name = record(previous?.value).name;
        if (typeof name === "string") delete shelves[name];
        for (const name of Object.keys(shelves)) if (nameId(name) === id) delete shelves[name];
      }
    }
    if (chosen.kind === "shelf") {
      const shelfHex = id.split("/")[0], book = id.split("/")[1];
      const name = Object.keys(shelves).find((n) => nameId(n) === shelfHex) || (typeof value.name === "string" ? value.name : "");
      if (!name || name === "New" || ["__proto__", "constructor", "prototype"].includes(name)) continue;
      const nameEntry = state.entries[`shelfName/${shelfHex}`];
      if (nameEntry && winner(nameEntry).deleted) continue;
      const set = new Set(Array.isArray(shelves[name]) ? shelves[name] as string[] : []);
      for (const key of bookKeys(book)) { if (item) set.add(key); else set.delete(key); }
      shelves[name] = [...set];
    }
  }
  next.config = {
    recordLocation: JSON.stringify(progress), readingTime: JSON.stringify(times), readingStats: JSON.stringify(days), shelfList: JSON.stringify(shelves),
    favoriteBooks: JSON.stringify([...favorites]), deletedBooks: JSON.stringify([...trash]), recentBooks: JSON.stringify([...recent].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([key]) => key)), noteTags: JSON.stringify([...tags]),
  };
  return next;
}

export function changes(before: Row[], after: Row[]): Change[] {
  const a = new Map(before.map((r) => [r.key, r])), b = new Map(after.map((r) => [r.key, r]));
  return [...new Set([...a.keys(), ...b.keys()])].filter((key) => stable(a.get(key)) !== stable(b.get(key))).map((key) => ({ key, before: a.get(key) || null, value: b.get(key) || null }));
}
