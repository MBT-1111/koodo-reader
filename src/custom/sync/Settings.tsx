import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { getStorageLocation } from "../../utils/common";
import { customSyncIPC, inspectConflicts, restoreSyncBackup, runCustomSync, syncErrorKey } from "./service";
import type { Conflict, Json, SyncProvider, SyncStatus } from "./types";
import "./settings.css";
import DataBackupPanel from "../backup/DataBackupPanel";

const preview = (value: Json): string => {
  if (value && typeof value === "object" && !Array.isArray(value)) return [value.name, value.notes, value.text, value.label, value.chapter, value.percentage].filter((v) => typeof v === "string" || typeof v === "number").join(" · ").slice(0, 240);
  return String(value ?? "").slice(0, 240);
};

export default function CustomSyncSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [provider, setProvider] = useState<SyncProvider>("mega");
  const [namespace, setNamespace] = useState("default");
  const [autoMinutes, setAutoMinutes] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secondFactorCode, setSecondFactorCode] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<Conflict[]>([]);
  const [verified, setVerified] = useState(false);
  const connection = status?.connections.find((item) => item.provider === provider);
  const dirty = !connection || namespace !== connection.namespace || autoMinutes !== connection.autoMinutes || (provider === "folder" ? folder !== connection.folder : email !== connection.email || !!password || !!secondFactorCode);
  const loadConnection = (selected: SyncProvider, saved: SyncStatus) => {
    const item = saved.connections.find((value) => value.provider === selected);
    setProvider(selected); setNamespace(item?.namespace || "default"); setAutoMinutes(item?.autoMinutes || 0);
    setEmail(item?.email || ""); setFolder(item?.folder || ""); setPassword(""); setSecondFactorCode(""); setVerified(false); setVersions([]);
  };
  useEffect(() => {
    let mounted = true;
    customSyncIPC<SyncStatus>("status").then((saved) => {
      if (!mounted) return;
      setStatus(saved); loadConnection(saved.provider, saved);
    }).catch((error: unknown) => { if (mounted) toast.error(t(syncErrorKey(error))); });
    return () => { mounted = false; };
  }, [t]);
  useEffect(() => {
    let mounted = true;
    if (connection) inspectConflicts(provider).then((conflicts) => { if (mounted) setVersions(conflicts); }).catch((error: unknown) => { if (mounted) toast.error(t(syncErrorKey(error))); });
    return () => { mounted = false; };
  }, [provider, status, t]);
  const execute = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await task(); } catch (error) { toast.error(t(syncErrorKey(error))); }
    finally { setBusy(false); }
  };
  const sync = (resolutions: Record<string, string> = {}) => execute(async () => {
    const result = await runCustomSync(resolutions, provider);
    setVerified(true);
    setVersions(result.conflicts);
    toast.success(t(result.unchanged ? "custom.sync.unchanged" : "custom.sync.complete"));
    if (result.pendingBooks) toast(t("custom.sync.pendingBooks", { count: result.pendingBooks }));
    if (result.skippedBooks) toast(t("custom.sync.skippedBooks", { count: result.skippedBooks }));
  });
  return <section className="custom-sync" aria-labelledby="custom-sync-title">
    <h3 id="custom-sync-title">{t("custom.sync.title")}</h3>
    <p>{t("custom.sync.description")}</p>
    <p>{t("custom.sync.closeReaders")}</p>
    <fieldset disabled={busy || !status}>
      <label>{t("custom.sync.provider")}<select value={provider} onChange={(e) => { if (status) loadConnection(e.target.value as SyncProvider, status); }}>
        <option value="mega">{t("custom.sync.mega")}</option><option value="folder">{t("custom.sync.folder")}</option>
      </select></label>
      <div className="custom-sync-status" role="status">
        <strong>{t(connection ? "custom.sync.connectionSaved" : "custom.sync.notConnected")}</strong>
        {connection && <p>{t("custom.sync.targetLabel", { provider: t(`custom.sync.${provider}`), destination: connection.folder || connection.email || t("custom.sync.savedAccount"), namespace: connection.namespace })}</p>}
        {verified && <p>{t("custom.sync.connectionVerified")}</p>}
        {dirty && connection && <p>{t("custom.sync.unsaved")}</p>}
      </div>
      <label>{t("custom.sync.namespace")}<input value={namespace} maxLength={64} pattern="[a-zA-Z0-9_-]+" onChange={(e) => setNamespace(e.target.value)} /></label>
      <small>{t("custom.sync.namespaceHelp")}</small>
      {provider === "mega" ? <>
        <label>{t("Email")}<input type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} /></label>
        <label>{t("Password")}<input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} /></label>
        <label>{t("custom.sync.otp")}<input value={secondFactorCode} inputMode="numeric" maxLength={6} autoComplete="off" onChange={(e) => setSecondFactorCode(e.target.value)} /></label>
        {connection && <small>{t("custom.sync.keepAccount")}</small>}
      </> : <label>{t("custom.sync.folder")}<button type="button" onClick={() => execute(async () => { const selected = await customSyncIPC<string | null>("choose-folder"); if (selected) setFolder(selected); })}>{folder || t("custom.sync.chooseFolder")}</button></label>}
      <label>{t("custom.sync.automatic")}<select value={autoMinutes} onChange={(e) => setAutoMinutes(Number(e.target.value))}>
        <option value={0}>{t("custom.sync.manual")}</option>{[5, 15, 30, 60].map((n) => <option key={n} value={n}>{t("custom.sync.minutes", { count: n })}</option>)}
      </select></label>
      <small>{t("custom.sync.automaticHelp")}</small>
      <div className="custom-sync-actions">
        <button type="button" onClick={() => execute(async () => {
          const loggedIn = provider === "mega" && !!password;
          const saved = await customSyncIPC<SyncStatus>("configure", { provider, namespace, autoMinutes, email, password, secondFactorCode, folder });
          setStatus(saved); loadConnection(provider, saved); toast.success(t(loggedIn ? "custom.sync.loginSuccess" : "custom.sync.connectionSaved"));
        })}>{t(provider === "mega" && !connection ? "custom.sync.loginSave" : "custom.sync.save")}</button>
        <button type="button" disabled={dirty} onClick={() => execute(async () => { await customSyncIPC("test", { provider }); setVerified(true); toast.success(t("custom.sync.connectionVerified")); })}>{t("custom.sync.test")}</button>
        <button type="button" disabled={dirty} onClick={() => sync()}>{t(busy ? "custom.sync.working" : "custom.sync.now")}</button>
        {provider === "folder" && <button type="button" disabled={dirty} onClick={() => execute(async () => { await customSyncIPC("open-folder", { provider }); })}>{t("custom.sync.openFolder")}</button>}
        <button type="button" onClick={() => execute(async () => { await customSyncIPC("backups", { storagePath: getStorageLocation() }); })}>{t("custom.sync.backups")}</button>
        <button type="button" disabled={dirty} onClick={() => execute(async () => { await restoreSyncBackup(provider); const saved = await customSyncIPC<SyncStatus>("status", { provider }); setStatus(saved); loadConnection(provider, saved); toast.success(t("custom.sync.restored")); })}>{t("custom.sync.restore")}</button>
        <button type="button" disabled={!connection} onClick={() => execute(async () => { const saved = await customSyncIPC<SyncStatus>("disconnect", { provider }); setStatus(saved); loadConnection(provider, saved); })}>{t("custom.sync.disconnect")}</button>
      </div>
    </fieldset>
    <DataBackupPanel />
    <p>{t("custom.sync.restoreHelp")}</p>
    <small>{t("custom.sync.backupsHelp")}</small>
    <details><summary>{t("custom.sync.details")}</summary>
      <p>{t("custom.sync.identityHelp")}</p><p>{t("custom.sync.snapshotHelp")}</p><p>{t("custom.sync.statsPolicy")}</p>
    </details>
    {!!versions.length && <div className="custom-sync-conflicts">
      <h4>{t("custom.sync.conflictsPending")}</h4><p>{t("custom.sync.conflictsHelp")}</p>
      {versions.map((conflict) => <div className="custom-sync-conflict" key={conflict.entity}>
        <strong>{t(`custom.sync.kind.${conflict.kind}`)}</strong>
        {conflict.bookTitle && <p>{conflict.bookTitle}</p>}
        {conflict.versions.map((revision, index) => <div key={revision.id}>
          <span>{t("custom.sync.version", { count: index + 1 })}{revision.id === conflict.selected ? ` · ${t("custom.sync.selected")}` : ""}</span>
          <p>{revision.deleted ? t("custom.sync.deleted") : revision.value === true ? t("custom.sync.present") : conflict.kind === "recent" && typeof revision.value === "number" ? t("custom.sync.recentRank", { count: revision.value + 1 }) : preview(revision.value)}</p>
          <button type="button" disabled={busy || dirty} onClick={() => sync({ [conflict.entity]: revision.id })}>{t("custom.sync.useVersion")}</button>
        </div>)}
      </div>)}
    </div>}
  </section>;
}
