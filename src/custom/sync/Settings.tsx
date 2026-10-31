import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { customSyncIPC, inspectConflicts, restoreSyncBackup, runCustomSync, syncErrorKey } from "./service";
import type { Conflict, Json, SyncStatus } from "./types";
import "./settings.css";

const preview = (value: Json): string => {
  if (value && typeof value === "object" && !Array.isArray(value)) return [value.name, value.notes, value.text, value.label, value.chapter, value.percentage].filter((v) => typeof v === "string" || typeof v === "number").join(" · ").slice(0, 240);
  return String(value ?? "").slice(0, 240);
};

export default function CustomSyncSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [provider, setProvider] = useState<"mega" | "folder">("mega");
  const [namespace, setNamespace] = useState("default");
  const [autoMinutes, setAutoMinutes] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secondFactorCode, setSecondFactorCode] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<Conflict[]>([]);
  useEffect(() => {
    let mounted = true;
    customSyncIPC<SyncStatus>("status").then(async (saved) => {
      if (!mounted) return;
      setStatus(saved); setProvider(saved.provider); setNamespace(saved.namespace); setAutoMinutes(saved.autoMinutes);
      if (saved.configured) { const conflicts = await inspectConflicts(); if (mounted) setVersions(conflicts); }
    }).catch((error: unknown) => { if (mounted) toast.error(t(syncErrorKey(error))); });
    return () => { mounted = false; };
  }, [t]);
  const execute = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await task(); } catch (error) { toast.error(t(syncErrorKey(error))); }
    finally { setBusy(false); }
  };
  const sync = (resolutions: Record<string, string> = {}) => execute(async () => {
    const result = await runCustomSync(resolutions);
    setVersions(result.conflicts);
    toast.success(t(result.unchanged ? "custom.sync.unchanged" : "custom.sync.complete"));
    if (result.pendingBooks) toast(t("custom.sync.pendingBooks", { count: result.pendingBooks }));
    if (result.skippedBooks) toast(t("custom.sync.skippedBooks", { count: result.skippedBooks }));
  });
  return <section className="custom-sync" aria-labelledby="custom-sync-title">
    <h3 id="custom-sync-title">{t("custom.sync.title")}</h3>
    <p>{t("custom.sync.description")}</p>
    <p>{t("custom.sync.identityHelp")}</p>
    <p>{t("custom.sync.snapshotHelp")}</p>
    <p>{t("custom.sync.statsPolicy")}</p>
    <p>{t("custom.sync.closeReaders")}</p>
    <fieldset disabled={busy || !status}>
      <label>{t("custom.sync.provider")}<select value={provider} onChange={(e) => setProvider(e.target.value as "mega" | "folder")}>
        <option value="mega">{t("custom.sync.mega")}</option><option value="folder">{t("custom.sync.folder")}</option>
      </select></label>
      <label>{t("custom.sync.namespace")}<input value={namespace} maxLength={64} pattern="[a-zA-Z0-9_-]+" onChange={(e) => setNamespace(e.target.value)} /></label>
      {provider === "mega" ? <>
        <label>{t("Email")}<input type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} /></label>
        <label>{t("Password")}<input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} /></label>
        <label>{t("custom.sync.otp")}<input value={secondFactorCode} inputMode="numeric" maxLength={6} autoComplete="off" onChange={(e) => setSecondFactorCode(e.target.value)} /></label>
        {status?.configured && status.provider === "mega" && <small>{t("custom.sync.keepAccount")}</small>}
      </> : <label>{t("custom.sync.folder")}<button type="button" onClick={() => execute(async () => { const selected = await customSyncIPC<string | null>("choose-folder"); if (selected) setFolder(selected); })}>{folder || t("custom.sync.chooseFolder")}</button></label>}
      <label>{t("custom.sync.automatic")}<select value={autoMinutes} onChange={(e) => setAutoMinutes(Number(e.target.value))}>
        <option value={0}>{t("custom.sync.manual")}</option>{[5, 15, 30, 60].map((n) => <option key={n} value={n}>{t("custom.sync.minutes", { count: n })}</option>)}
      </select></label>
      <div className="custom-sync-actions">
        <button type="button" onClick={() => execute(async () => {
          const saved = await customSyncIPC<SyncStatus>("configure", { provider, namespace, autoMinutes, email, password, secondFactorCode, folder });
          setStatus(saved); setPassword(""); setSecondFactorCode(""); setEmail(""); setVersions(await inspectConflicts()); toast.success(t("Setup successful"));
        })}>{t("custom.sync.save")}</button>
        <button type="button" disabled={!status?.configured} onClick={() => sync()}>{t(busy ? "custom.sync.working" : "custom.sync.now")}</button>
        <button type="button" onClick={() => execute(async () => { await customSyncIPC("backups"); })}>{t("custom.sync.backups")}</button>
        <button type="button" disabled={!status?.configured} onClick={() => execute(async () => { await restoreSyncBackup(); setStatus(await customSyncIPC<SyncStatus>("status")); setAutoMinutes(0); toast.success(t("custom.sync.restored")); })}>{t("custom.sync.restore")}</button>
        <button type="button" disabled={!status?.configured} onClick={() => execute(async () => { setStatus(await customSyncIPC<SyncStatus>("disconnect")); setVersions([]); setPassword(""); setEmail(""); })}>{t("custom.sync.disconnect")}</button>
      </div>
    </fieldset>
    <p>{t("custom.sync.restoreHelp")}</p>
    {!!versions.length && <div className="custom-sync-conflicts">
      <h4>{t("custom.sync.conflictsPending")}</h4><p>{t("custom.sync.conflictsHelp")}</p>
      {versions.map((conflict) => <div className="custom-sync-conflict" key={conflict.entity}>
        <strong>{t(`custom.sync.kind.${conflict.kind}`)}</strong>
        {conflict.bookTitle && <p>{conflict.bookTitle}</p>}
        {conflict.versions.map((revision, index) => <div key={revision.id}>
          <span>{t("custom.sync.version", { count: index + 1 })}{revision.id === conflict.selected ? ` · ${t("custom.sync.selected")}` : ""}</span>
          <p>{revision.deleted ? t("custom.sync.deleted") : revision.value === true ? t("custom.sync.present") : conflict.kind === "recent" && typeof revision.value === "number" ? t("custom.sync.recentRank", { count: revision.value + 1 }) : preview(revision.value)}</p>
          <button type="button" disabled={busy} onClick={() => sync({ [conflict.entity]: revision.id })}>{t("custom.sync.useVersion")}</button>
        </div>)}
      </div>)}
    </div>}
  </section>;
}
