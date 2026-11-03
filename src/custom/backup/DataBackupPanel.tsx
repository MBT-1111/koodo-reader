import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { saveAs } from "file-saver";
import { backupSummary, parseDataBackup, type DataBackup } from "./dataBackup";
import { desktopDataBackup } from "./desktopBackup";
import "./dataBackup.css";

export default function DataBackupPanel() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState<DataBackup | null>(null);
  const pending = useRef(false), input = useRef<HTMLInputElement>(null);
  const run = async (task: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await task(); }
    catch { toast.error(t("android.backup.restoreFailed")); }
    finally { pending.current = false; setBusy(false); }
  };
  const select = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (file) void run(async () => {
      if (file.size > 100 * 1024 * 1024) throw new Error("CUSTOM_INVALID_DOCUMENT");
      setBackup(await parseDataBackup(await file.text()));
    });
  };
  return <section className="custom-data-backup" aria-busy={busy}>
    <h3>{t("android.backup.title")}</h3><p>{t("android.backup.help")}</p>
    <p>{t("custom.sync.closeReaders")}</p>
    <div inert={!!backup}>
      <button disabled={busy} type="button" onClick={() => void run(async () => {
        const result = await desktopDataBackup();
        if (result.blob) saveAs(result.blob, `KoodoReader-Data-${Date.now()}.json`);
      })}>{t("android.backup.create")}</button>
      <button disabled={busy} type="button" onClick={() => input.current?.click()}>{t("android.backup.restore")}</button>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={select} />
    </div>
    {backup && <section className="custom-data-preview" role="dialog" aria-label={t("android.backup.restore")}>
      <p>{new Date(backup.createdAt).toLocaleString()}</p><p>{t("android.backup.summary", backupSummary(backup))}</p>
      <p>{t("android.backup.replaceHelp")}</p>
      <button disabled={busy} type="button" onClick={() => void run(async () => {
        const result = await desktopDataBackup(backup);
        sessionStorage.setItem("customDataPendingBooks", String(result.pendingBooks));
        window.location.reload();
      })}>{t("android.backup.replace")}</button>
      <button disabled={busy} type="button" onClick={() => setBackup(null)}>{t("Cancel")}</button>
    </section>}
  </section>;
}
