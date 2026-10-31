import { describe, expect, it } from "vitest";
import { acknowledge, conflicts, copy, envelope, freshCheckpoint, materialize, reconcile, validateEnvelope } from "./protocol";
import { changes, plan, snapshot } from "./data";
import type { Checkpoint, RawData, Snapshot } from "./types";

const book = "a".repeat(64), note = "12345678-1234-4234-8234-123456789012";
const progress = (text: string): Snapshot => ({ [`progress/${book}`]: { kind: "progress", value: { text, percentage: "0.5" } } });
const apply = (state: Checkpoint) => acknowledge(state, materialize(state.entries));
const raw = (): RawData => ({ tables: { books: [], notes: [], bookmarks: [] }, config: {} });

describe("custom sync protocol", () => {
  it("converges independent edits and retains both conflicting versions", () => {
    const first = apply(reconcile(freshCheckpoint(), progress("start"), []));
    const second = apply(reconcile(freshCheckpoint(), {}, [envelope(first)]));
    const a = reconcile(first, progress("A"), []), b = reconcile(second, progress("B"), []);
    const left = reconcile(a, progress("A"), [envelope(b)]), right = reconcile(b, progress("B"), [envelope(a)]);
    expect(materialize(left.entries)).toEqual(materialize(right.entries));
    expect(conflicts(left.entries)).toHaveLength(1);
    const conflict = conflicts(left.entries)[0];
    const resolved = reconcile(left, progress("A"), [], { [conflict.entity]: conflict.versions[0].id });
    expect(conflicts(resolved.entries)).toEqual([]);
    const remote = reconcile(right, right.observed, [envelope(resolved)]);
    expect(materialize(remote.entries)).toEqual(materialize(resolved.entries));
  });
  it("adopts an identical initial book baseline without creating a phantom conflicting edit", () => {
    const value: Snapshot = { [`book/${book}`]: { kind: "book", value: { name: "Book", format: "EPUB" } } };
    const a = apply(reconcile(freshCheckpoint(), value, []));
    const b = apply(reconcile(freshCheckpoint(), value, [envelope(a)]));
    expect(b.entries[`book/${book}`]).toEqual(a.entries[`book/${book}`]);
    const renamed = reconcile(a, { [`book/${book}`]: { kind: "book", value: { name: "Renamed", format: "EPUB" } } }, [envelope(b)]);
    const imported = reconcile(b, value, [envelope(renamed)]);
    expect(materialize(imported.entries)[`book/${book}`].value).toEqual({ name: "Renamed", format: "EPUB" });
    expect(conflicts(imported.entries)).toEqual([]);
  });
  it("propagates deletion, retains concurrent edits, and permits explicit restoration", () => {
    const initial: Snapshot = { [`note/${note}`]: { kind: "note", value: { book, text: "original" } } };
    const a = apply(reconcile(freshCheckpoint(), initial, []));
    const b = apply(reconcile(freshCheckpoint(), {}, [envelope(a)]));
    const removed = reconcile(a, {}, []);
    const edited = reconcile(b, { [`note/${note}`]: { kind: "note", value: { book, text: "edited offline" } } }, []);
    const merged = reconcile(removed, {}, [envelope(edited)]);
    expect(materialize(merged.entries)[`note/${note}`]).toBeUndefined();
    const conflict = conflicts(merged.entries)[0];
    expect(conflict.versions).toHaveLength(2);
    const kept = conflict.versions.find((v) => !v.deleted)!;
    const restored = reconcile(merged, {}, [], { [conflict.entity]: kept.id });
    expect(materialize(restored.entries)[`note/${note}`].value).toEqual({ book, text: "edited offline" });
  });
  it("merges statistics deltas without counting an imported total twice", () => {
    const id = `time/${book}`, value = (seconds: number): Snapshot => ({ [id]: { kind: "time", value: seconds } });
    const a = apply(reconcile(freshCheckpoint(), value(100), []));
    const b = apply(reconcile(freshCheckpoint(), value(100), [envelope(a)]));
    expect(materialize(b.entries)[id].value).toBe(100);
    const aa = reconcile(a, value(110), []), bb = reconcile(b, value(120), []);
    const merged = apply(reconcile(aa, value(110), [envelope(bb)]));
    expect(materialize(merged.entries)[id].value).toBe(130);
    const repeated = apply(reconcile(merged, merged.observed, [envelope(bb), envelope(aa), envelope(bb)]));
    expect(materialize(repeated.entries)[id].value).toBe(130);
    expect(conflicts(repeated.entries)).toEqual([]);
  });
  it("keeps unsent revisions in a checkpoint after an offline upload", () => {
    const local = reconcile(freshCheckpoint(), progress("offline"), []);
    const retry = reconcile(copy(local), progress("offline"), []);
    expect(materialize(retry.entries)).toEqual(progress("offline"));
    expect(retry.entries[`progress/${book}`]).toHaveLength(1);
    expect(retry.sequence).toBeGreaterThan(local.sequence);
  });
  it("does not acknowledge remote edits when staging succeeded but local application was interrupted", () => {
    const a = apply(reconcile(freshCheckpoint(), progress("start"), []));
    const b = apply(reconcile(freshCheckpoint(), {}, [envelope(a)]));
    const remote = reconcile(b, progress("remote edit"), []);
    const staged = reconcile(a, progress("start"), [envelope(remote)]);
    const retried = reconcile(staged, progress("local edit during upload"), [envelope(remote)]);
    expect(conflicts(retried.entries)).toHaveLength(1);
  });
  it("rejects incompatible versions, invalid clocks and injected prototype keys", () => {
    const doc = envelope(reconcile(freshCheckpoint(), progress("text"), []));
    expect(() => validateEnvelope({ ...doc, version: 2 })).toThrow("CUSTOM_PROTOCOL_VERSION");
    const malformed = copy(doc); malformed.entries[`progress/${book}`][0].clock = { [doc.deviceId]: -1 };
    expect(() => validateEnvelope(malformed)).toThrow("CUSTOM_INVALID_DOCUMENT");
    const poison: unknown = JSON.parse(JSON.stringify(doc).replace('"text":"text"', '"__proto__":{"polluted":true},"text":"text"'));
    expect(() => validateEnvelope(poison)).toThrow("CUSTOM_INVALID_DOCUMENT");
    expect(Object.hasOwn({}, "polluted")).toBe(false);
    const credentialPayload = copy(doc);
    credentialPayload.entries[`progress/${book}`][0].value = { percentage: "0.5", apiKey: "synthetic-secret" };
    expect(() => validateEnvelope(credentialPayload)).toThrow("CUSTOM_INVALID_DOCUMENT");
  });
  it("converges three devices with delayed, duplicated and reordered deliveries", () => {
    const id = `time/${book}`;
    const clients = Array.from({ length: 3 }, () => apply(reconcile(freshCheckpoint(), { [id]: { kind: "time", value: 0 } }, [])));
    let expected = 0;
    for (let step = 0; step < 30; step++) {
      const index = (step * 7 + 1) % 3, state = clients[index], delta = step % 5 + 1;
      const local = copy(state.observed);
      local[id] = { kind: "time", value: Number(local[id].value) + delta };
      Object.assign(local, progress(`edit-${step}`));
      const incoming = step % 4 === 0 ? clients.filter((_, i) => i !== index).map(envelope).reverse() : [];
      clients[index] = apply(reconcile(state, local, [...incoming, ...incoming]));
      expected += delta;
    }
    for (let round = 0; round < 2; round++) {
      const messages = clients.map(envelope);
      for (let i = 0; i < clients.length; i++) clients[i] = apply(reconcile(clients[i], clients[i].observed, messages));
    }
    expect(clients.map((state) => materialize(state.entries)[id].value)).toEqual([expected, expected, expected]);
    expect(materialize(clients[0].entries)).toEqual(materialize(clients[1].entries));
    expect(materialize(clients[1].entries)).toEqual(materialize(clients[2].entries));
  });
});

describe("upstream data mapping", () => {
  it("excludes paths, covers, credentials and unrelated configuration", () => {
    const data = raw();
    data.tables.books = [{ key: "123", name: "Book", format: "EPUB", path: "C:/private/book.epub", cover: "private", apiKey: "secret" }];
    data.config = { recordLocation: JSON.stringify({ "123": { percentage: "0.2", cfi: "x", apiKey: "secret", path: "private" } }), azureKey: "secret" };
    const mappings = { books: { "123": book }, notes: {}, bookmarks: {} };
    const outgoing = JSON.stringify(snapshot(data, mappings));
    expect(outgoing).not.toMatch(/private|apiKey|secret|azureKey|cover|path/);
    expect(outgoing).toContain("percentage");
  });
  it("maps colliding timestamp keys to different note IDs and local book keys", () => {
    const one = raw(), two = raw();
    one.tables.books = [{ key: "100", name: "Book", format: "EPUB", path: "one" }];
    two.tables.books = [{ key: "200", name: "Book", format: "EPUB", path: "two" }];
    one.tables.notes = [{ key: "300", bookKey: "100", text: "one" }];
    two.tables.notes = [{ key: "300", bookKey: "200", text: "two" }];
    const a = freshCheckpoint(), b = freshCheckpoint(); a.mappings.books["100"] = book; b.mappings.books["200"] = book;
    const left = reconcile(a, snapshot(one, a.mappings), []);
    const right = reconcile(b, snapshot(two, b.mappings), [envelope(left)]);
    const result = plan(two, right);
    expect(result.tables.notes).toHaveLength(2);
    expect(result.tables.notes.every((row) => row.bookKey === "200")).toBe(true);
    expect(new Set(result.tables.notes.map((row) => row.key)).size).toBe(2);
    expect(result.tables.books[0].path).toBe("two");
  });
  it("retains unapplied notes until the matching book is imported", () => {
    const state = reconcile(freshCheckpoint(), { [`note/${note}`]: { kind: "note", value: { book, text: "pending" } } }, []);
    const result = plan(raw(), state);
    expect(result.tables.notes).toEqual([]);
    const local = raw(); local.tables.books = [{ key: "new", name: "Book", format: "EPUB" }];
    state.mappings.books.new = book;
    expect(plan(local, state).tables.notes[0].bookKey).toBe("new");
  });
  it("does not acknowledge or silently overwrite metadata for an unbound remote book", () => {
    const original: Snapshot = { [`book/${book}`]: { kind: "book", value: { name: "Remote title", format: "EPUB" } } };
    const remote = reconcile(freshCheckpoint(), original, []);
    const local = acknowledge(reconcile(freshCheckpoint(), {}, [envelope(remote)]), {});
    expect(local.context[`book/${book}`]).toBeUndefined();
    const imported = reconcile(local, { [`book/${book}`]: { kind: "book", value: { name: "Imported title", format: "EPUB" } } }, [envelope(remote)]);
    expect(conflicts(imported.entries)).toHaveLength(1);
  });
  it("detects actual row changes and preserves source records for compare-and-swap", () => {
    expect(changes([{ key: "a", text: "old" }], [{ key: "a", text: "new" }])).toEqual([{ key: "a", before: { key: "a", text: "old" }, value: { key: "a", text: "new" } }]);
    expect(changes([{ key: "a", text: "same" }], [{ text: "same", key: "a" }])).toEqual([]);
  });
});
