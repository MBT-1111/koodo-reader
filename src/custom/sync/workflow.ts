import { DATA_STATE_KEY, localEntityId, readDataState } from "../backup/dataBackup";
import { plan, snapshot } from "./data";
import { acknowledge, conflicts, copy, materialize, mergeDocuments, reconcile, stable } from "./protocol";
import type { Checkpoint, Conflict, RawData } from "./types";

export function prepareSync(raw: RawData, hashes: Record<string, string>, saved: Checkpoint, documents: unknown[], resolutions: Record<string, string> = {}) {
  const state = copy(saved), registry = readDataState(raw.config[DATA_STATE_KEY]);
  for (const book of raw.tables.books) {
    if (hashes[book.key]) state.mappings.books[book.key] = hashes[book.key];
  }
  const identities = raw.tables.books.map((book) => state.mappings.books[book.key]).filter(Boolean);
  if (new Set(identities).size !== identities.length) throw new Error("CUSTOM_DUPLICATE_BOOK");
  const remote = materialize(mergeDocuments(documents));
  for (const table of ["notes", "bookmarks"] as const) {
    for (const row of raw.tables[table]) {
      state.mappings[table][row.key] ||= registry.mappings[table][row.key] || localEntityId(row.key) || "";
      if (!state.mappings[table][row.key]) delete state.mappings[table][row.key];
    }
  }
  const local = snapshot(raw, state.mappings);
  for (const [table, kind] of [["notes", "note"], ["bookmarks", "bookmark"]] as const) {
    const used = new Set(Object.values(state.mappings[table]).filter((id) => !!remote[`${kind}/${id}`]));
    for (const row of raw.tables[table]) {
      const id = state.mappings[table][row.key];
      if (saved.mappings[table][row.key] || remote[`${kind}/${id}`]) continue;
      const match = Object.entries(remote).find(([entity, item]) => item.kind === kind && !used.has(entity.slice(kind.length + 1)) && stable(item.value) === stable(local[`${kind}/${id}`]?.value));
      if (match) { state.mappings[table][row.key] = match[0].slice(kind.length + 1); used.add(state.mappings[table][row.key]); }
    }
  }
  const merged = reconcile(state, snapshot(raw, state.mappings), documents, resolutions);
  const next = plan(raw, merged);
  for (const book of next.tables.books) book.format = raw.tables.books.find((local) => local.key === book.key)!.format;
  return { state: merged, next, publish: stable(merged.entries) !== stable(mergeDocuments(documents)) };
}

export function sharedIdentityState(text: string | null | undefined, state: Checkpoint) {
  const registry = readDataState(text);
  for (const [table, kind] of [["notes", "note"], ["bookmarks", "bookmark"]] as const) for (const [key, id] of Object.entries(state.mappings[table])) {
    const previous = registry.mappings[table][key];
    registry.mappings[table][key] = id;
    if (previous && previous !== id && !Object.values(registry.mappings[table]).includes(previous)) {
      for (const field of ["entries", "observed", "context"] as const) {
        const from = `${kind}/${previous}`, to = `${kind}/${id}`;
        if (registry[field][from] && !registry[field][to]) Object.assign(registry[field], { [to]: registry[field][from] });
        delete registry[field][from];
      }
    }
  }
  Object.assign(registry.mappings.books, state.mappings.books);
  return JSON.stringify(registry);
}

export function describeConflicts(state: Checkpoint): Conflict[] {
  const values = materialize(state.entries);
  return conflicts(state.entries).map((conflict) => {
    const value = conflict.versions.find((revision) => !revision.deleted)?.value;
    const book = value && typeof value === "object" && !Array.isArray(value) && typeof value.book === "string" ? value.book : conflict.entity.split("/").at(-1);
    const metadata = values[`book/${book}`]?.value;
    const bookTitle = metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata.name === "string" ? metadata.name : undefined;
    return { ...conflict, bookTitle };
  });
}

export function finishSync(state: Checkpoint, actual: RawData) {
  acknowledge(state, snapshot(actual, state.mappings));
  const known = new Set(actual.tables.books.map((book) => state.mappings.books[book.key]).filter(Boolean));
  return {
    conflicts: describeConflicts(state),
    pendingBooks: Object.keys(materialize(state.entries)).filter((id) => id.startsWith("book/") && !known.has(id.slice(5))).length,
    skippedBooks: actual.tables.books.filter((book) => !state.mappings.books[book.key]).length,
  };
}
