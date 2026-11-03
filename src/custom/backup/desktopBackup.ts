import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import BookUtil from "../../utils/file/bookUtil";
import type Book from "../../models/Book";
import { getStorageLocation } from "../../utils/common";
import { apply, collect, customSyncIPC } from "../sync/service";
import { stable } from "../sync/protocol";
import { createDataBackup, DATA_STATE_KEY, parseDataBackup, planDataRestore, type DataBackup } from "./dataBackup";

async function captured() {
  const raw = await collect();
  for (const key of ["readerConfig", DATA_STATE_KEY]) raw.config[key] = ConfigService.getItem(key) || null;
  return raw;
}

export async function desktopDataBackup(input?: DataBackup) {
  const backup = input && await parseDataBackup(JSON.stringify(input));
  const { token } = await customSyncIPC<{ token: string }>("begin-data", { storagePath: getStorageLocation() });
  try {
    const before = await captured();
    const values = Object.fromEntries(Object.entries(before.config).filter((entry): entry is [string, string] => entry[1] !== null));
    const hashes = await customSyncIPC<Record<string, string>>("fingerprints", { token, books: before.tables.books.map((book) => ({ key: book.key, path: BookUtil.getBookPath(book as unknown as Book) })) });
    const exported = !backup ? await createDataBackup(before, values, hashes) : undefined;
    const restored = backup ? planDataRestore(backup, before, values, hashes) : undefined;
    const next = restored?.next || { tables: before.tables, config: before.config };
    next.config = { ...before.config, ...(restored?.preferences || {}), ...(!restored ? { [DATA_STATE_KEY]: JSON.stringify(exported!.state) } : {}) };
    if (stable(before) !== stable(await captured())) throw new Error("CUSTOM_LOCAL_CHANGED");
    await customSyncIPC("stage-restore", { token, backup: before });
    await apply(before, next, token);
    await customSyncIPC("finish-restore", { token });
    return { blob: exported?.blob, pendingBooks: restored?.pendingBooks || 0 };
  } finally { await customSyncIPC("abort", { token }).catch(() => undefined); }
}
