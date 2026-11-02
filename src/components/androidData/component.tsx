import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import DatabaseService from "../../utils/storage/databaseService";
import { exportBooks, exportNotes, exportHighlights, exportDictionaryHistory, type ExportFormat } from "../../utils/file/export";
import type Note from "../../models/Note";
import { isNativeAndroid } from "../../utils/platform";
import { saveExportFile } from "../../utils/file/saveExportFile";
import { createAndroidBackup, restoreAndroidBackup } from "../../custom/android/backup";
import { prepareBackupArchive, type PreparedBackup } from "../../custom/android/backupArchive";
import { ANDROID_SETTINGS_DISMISS_EVENT } from "../../custom/android/navigation";
import "./androidData.css";

const AndroidData = () => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const dataRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null);
  const [progress, setProgress] = useState(0);
  const lastProgress = useRef(0);
  const reportProgress = (done: number, total: number) => {
    const value = Math.round(done / Math.max(total, 1) * 100);
    if (value !== lastProgress.current) { lastProgress.current = value; setProgress(value); }
  };
  const begin = () => {
    if (pending.current) return false;
    pending.current = true; setBusy(true); lastProgress.current = 0; setProgress(0);
    return true;
  };
  const finish = () => { pending.current = false; setBusy(false); };
  useEffect(() => {
    if (!busy && !prepared) return;
    const elements = [dataRef.current?.closest(".android-settings")?.querySelector<HTMLElement>(".android-settings-header"), document.querySelector<HTMLElement>(".android-bottom-nav")].filter((element): element is HTMLElement => !!element);
    const previous = elements.map((element) => element.inert);
    elements.forEach((element) => { element.inert = true; });
    const dismiss = (event: Event) => { event.preventDefault(); if (!busy) setPrepared(null); };
    window.addEventListener(ANDROID_SETTINGS_DISMISS_EVENT, dismiss);
    return () => {
      elements.forEach((element, index) => { element.inert = previous[index]; });
      window.removeEventListener(ANDROID_SETTINGS_DISMISS_EVENT, dismiss);
    };
  }, [busy, prepared]);
  const backup = async () => {
    if (!begin()) return;
    toast.loading(t("android.backup.creating"), { id: "backup" });
    try {
      const { blob } = await createAndroidBackup(reportProgress);
      const result = await saveExportFile(blob, `KoodoReader-Android-Backup-${Date.now()}.zip`);
      if (result === "success") toast.success(t("android.backup.saved"), { id: "backup" });
      else if (result === "failed") toast.error(t("android.backup.failed"), { id: "backup" });
      else toast.dismiss("backup");
    } catch { toast.error(t("android.backup.failed"), { id: "backup" }); }
    finally { finish(); }
  };
  const selectBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !begin()) return;
    toast.loading(t("android.backup.checking"), { id: "backup" });
    try { setPrepared(await prepareBackupArchive(await file.arrayBuffer(), reportProgress)); toast.dismiss("backup"); }
    catch { toast.error(t("android.backup.invalid"), { id: "backup" }); }
    finally { finish(); }
  };
  const restore = async () => {
    if (!prepared || !begin()) return;
    toast.loading(t("Restoring..."), { id: "backup" });
    try {
      await restoreAndroidBackup(prepared, reportProgress);
      window.location.hash = "/manager/home";
      window.location.reload();
    } catch { toast.error(t("android.backup.restoreFailed"), { id: "backup" }); }
    finally { finish(); }
  };
  const run = async (kind: "books" | "notes" | "highlights" | "words", format: ExportFormat = "json") => {
    if (!begin()) return;
    toast.loading(t("Exporting..."), { id: "exporting" });
    try {
      const books = await DatabaseService.getAllRecords("books");
      const records = kind === "books" ? books : kind === "words" ? await DatabaseService.getAllRecords("words") :
        (await DatabaseService.getAllRecords("notes")).filter((note: Note) => kind === "notes" ? !!note.notes && note.notes !== "annotation" : note.notes === "");
      if (!records.length) { toast(t("Nothing to export"), { id: "exporting" }); return; }
      const result = kind === "books" ? await exportBooks(books) : kind === "notes" ? await exportNotes(records, books, format) :
        kind === "highlights" ? await exportHighlights(records, books, format) : await exportDictionaryHistory(records, books, format === "json" ? "json" : "csv");
      if (result === "success") toast.success(t("Export successful"), { id: "exporting" });
      else if (result === "failed") toast.error(t("Failed to export"), { id: "exporting" });
      else toast.dismiss("exporting");
    } catch {
      toast.error(t("Failed to export"), { id: "exporting" });
    } finally {
      finish();
    }
  };
  return <section className="android-data" aria-busy={busy} ref={dataRef}>
    <div inert={!!prepared}>
    <p>{t("android.export.help")}</p>
    <div className="android-data-row"><label>{t("Export all books")}</label><button type="button" disabled={busy} onClick={() => void run("books")}>{t("Export")}</button></div>
    {([
      { kind: "notes", label: "Export all notes" },
      { kind: "highlights", label: "Export all highlights" },
      { kind: "words", label: "Export all dictionary history" },
    ] as const).map(({ kind, label }) => <div className="android-data-row" key={kind}>
      <label htmlFor={`android-export-${kind}`}>{t(label)}</label>
      <select id={`android-export-${kind}`} value="" disabled={busy} onChange={(event) => { if (event.target.value) void run(kind, event.target.value as ExportFormat); }}>
        <option value="">{t("Select format")}</option>
        {(kind === "words" ? ["json", "csv"] : ["json", "csv", "md", "txt", "html", "pdf"]).map((format) => <option key={format} value={format}>{t(format === "md" ? "Markdown" : format.toUpperCase())}</option>)}
      </select>
    </div>)}
    {isNativeAndroid && <section className="android-backup-section">
      <h2>{t("android.backup.title")}</h2><p>{t("android.backup.help")}</p>
      <div className="android-backup-buttons"><button type="button" disabled={busy} onClick={() => void backup()}>{t("android.backup.create")}</button><button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{t("android.backup.restore")}</button></div>
      <input ref={inputRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => void selectBackup(event)} />
      {busy && progress > 0 && <progress aria-label={t("android.backup.progress")} max={100} value={progress} />}
    </section>}
    </div>
    {prepared && <div className="android-backup-overlay"><section className="android-backup-preview" role="dialog" aria-modal="true" aria-label={t("android.backup.restore")}>
      <h2>{t("android.backup.restore")}</h2>
      <p>{new Date(prepared.manifest.createdAt).toLocaleString()}</p>
      <p>{t("android.backup.summary", { books: prepared.manifest.tables.books.length, notes: prepared.manifest.tables.notes.length, files: prepared.manifest.files.length })}</p>
      <p>{t("android.backup.replaceHelp")}</p>
      {busy && <progress aria-label={t("android.backup.progress")} max={100} value={progress} />}
      <button type="button" disabled={busy} onClick={() => void restore()}>{t("android.backup.replace")}</button>
      <button type="button" disabled={busy} onClick={() => setPrepared(null)}>{t("Cancel")}</button>
    </section></div>}
  </section>;
};

export default AndroidData;
