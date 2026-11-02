export const NATIVE_TABLES = ["books", "notes", "bookmarks", "words", "plugins"] as const;

interface LegacyStore { getItem(key: string): Promise<unknown> }
interface MigrationTarget {
  writeBook(name: string, buffer: ArrayBuffer): Promise<void>;
  saveCover(key: string, cover: string): Promise<boolean>;
  replaceTable(table: string, rows: Record<string, unknown>[]): Promise<void>;
}

async function binary(value: unknown): Promise<ArrayBuffer | null> {
  if (value === null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).buffer;
  if (value instanceof Blob) return value.arrayBuffer();
  throw new Error("ANDROID_STORAGE_LEGACY_FILE");
}

export async function migrateLegacyLibrary(legacy: LegacyStore, target: MigrationTarget): Promise<void> {
  for (const table of NATIVE_TABLES) {
    const value = await legacy.getItem(table);
    if (value !== null && !Array.isArray(value)) throw new Error("ANDROID_STORAGE_LEGACY_TABLE");
    const rows: Record<string, unknown>[] = [];
    for (const entry of value || []) {
      if (!entry || typeof entry !== "object" || typeof entry.key !== "string" || !entry.key) {
        throw new Error("ANDROID_STORAGE_LEGACY_RECORD");
      }
      const row = { ...entry };
      if (table === "books") {
        if (typeof row.format !== "string" || !row.format) throw new Error("ANDROID_STORAGE_LEGACY_FORMAT");
        const original = await binary(await legacy.getItem(row.key));
        if (original) await target.writeBook(`${row.key}.${row.format.toLowerCase()}`, original);
        const cache = await binary(await legacy.getItem(`cache-${row.key}`));
        if (cache) await target.writeBook(`cache-${row.key}.zip`, cache);
        if (typeof row.cover === "string" && await target.saveCover(row.key, row.cover)) row.cover = "";
      }
      rows.push(row);
    }
    await target.replaceTable(table, rows);
  }
}
