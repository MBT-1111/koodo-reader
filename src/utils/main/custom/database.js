const stable = (value) => {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

// Runs synchronously on the main process, inside the existing database-command IPC.
const applyBatch = (db, statements, table, changes) => {
  if (!["books", "notes", "bookmarks"].includes(table) || !Array.isArray(changes) || changes.length > 100000 || new Set(changes.map((c) => c?.key)).size !== changes.length) throw new Error("CUSTOM_INVALID_DATABASE_REQUEST");
  for (const change of changes) {
    if (!change || typeof change.key !== "string" || !change.key || change.key.length > 256 || ![change.before, change.value].every((r) => r === null || (r && typeof r === "object" && !Array.isArray(r) && r.key === change.key))) throw new Error("CUSTOM_INVALID_DATABASE_REQUEST");
    if (table === "books" && (!change.before || !change.value || change.before.path !== change.value.path || change.before.cover !== change.value.cover)) throw new Error("CUSTOM_UNSAFE_BOOK_CHANGE");
  }
  const sql = statements.sqlStatement;
  const get = db.prepare(sql.getStatement[table]);
  const save = db.prepare(sql.saveStatement[table]);
  const remove = db.prepare(sql.deleteStatement[table]);
  db.transaction(() => {
    for (const change of changes) {
      const raw = get.get(change.key);
      const current = raw ? statements.sqliteToJson[table](raw) : null;
      if (stable(current) !== stable(change.before)) throw new Error("CUSTOM_LOCAL_CHANGED");
    }
    for (const change of changes) {
      if (change.value) save.run(statements.jsonToSqlite[table](change.value));
      else remove.run(change.key);
    }
  })();
  return { applied: changes.length };
};

module.exports = { applyBatch };
