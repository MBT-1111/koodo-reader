import { Buffer } from "buffer";
import { pauseAndroidPreferences } from "./bootstrap";
import { hydratePreferences } from "./preferencesPersistence";
import { nativeCommand, nativeFiles, nativeLibraryCommand, readNativePreferences, type FileGroup, type PreferencesSnapshot } from "./storage";
import { BACKUP_GROUPS, createBackupArchive, type BackupManifest, type BackupProgress, type PreparedBackup } from "./backupArchive";

interface NativeSnapshot {
  token: string;
  tables: BackupManifest["tables"];
  preferences: PreferencesSnapshot;
  files: Record<FileGroup, string[]>;
}

export async function createAndroidBackup(progress?: BackupProgress) {
  const resume = await pauseAndroidPreferences();
  const token = crypto.randomUUID();
  try {
    const snapshot = await nativeLibraryCommand<NativeSnapshot>("backupBeginStatement", undefined, token);
    return await createBackupArchive({
      tables: snapshot.tables, preferences: snapshot.preferences.values,
      files: BACKUP_GROUPS.flatMap((group) => snapshot.files[group].map((name) => ({ group, name }))),
      read: (file) => nativeFiles.read(file.group, file.name),
    }, progress);
  } finally {
    try { await nativeLibraryCommand("backupEndStatement", undefined, token); }
    finally { resume(); }
  }
}

export async function restoreAndroidBackup(backup: PreparedBackup, progress?: BackupProgress): Promise<void> {
  const resume = await pauseAndroidPreferences();
  const token = crypto.randomUUID();
  let committed = false;
  try {
    await nativeLibraryCommand("restoreBeginStatement", backup.manifest, token);
    for (let index = 0; index < backup.manifest.files.length; index++) {
      const file = backup.manifest.files[index];
      const bytes = await backup.read(file);
      const result = await nativeCommand<{ size: number; sha256: string }>({ channel: "file-command", action: "restore-write", token, group: file.group, name: file.name, data: Buffer.from(bytes).toString("base64") });
      if (result.size !== file.size || result.sha256 !== file.sha256) throw new Error("ANDROID_STORAGE_VERIFY_FAILED");
      progress?.(index + 1, backup.manifest.files.length);
    }
    const snapshot = await nativeLibraryCommand<PreferencesSnapshot>("restoreCommitStatement", undefined, token);
    committed = true;
    hydratePreferences(localStorage, snapshot);
  } catch (error) {
    const current = await readNativePreferences().catch(() => null);
    if (current?.values.__koodo_native_restore_id === token) {
      committed = true;
      hydratePreferences(localStorage, current);
      return;
    }
    if (!committed) await nativeLibraryCommand("restoreAbortStatement", undefined, token).catch(() => {});
    throw error;
  } finally { resume(); }
}
