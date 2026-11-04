import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { isNativeAndroid } from "../../utils/platform";
import { androidSyncConnection, type AndroidSyncConnection } from "../../custom/android/mega";
import { configureAndroidSync, disconnectSync, inspectAndroidConflicts, runAndroidSync } from "../../custom/android/sync";
import { syncErrorKey } from "../../custom/sync/service";
import type { Conflict, Json } from "../../custom/sync/types";
import "./androidSync.css";

const preview = (value: Json) => value && typeof value === "object" && !Array.isArray(value) ? [value.name, value.notes, value.text, value.label, value.chapter, value.percentage].filter((item) => typeof item === "string" || typeof item === "number").join(" · ").slice(0, 240) : String(value ?? "").slice(0, 240);

export default function AndroidSync() {
  const { t } = useTranslation();
  const canSync = useLocation().pathname.startsWith("/manager/");
  const [connection, setConnection] = useState<AndroidSyncConnection | null>(null);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [otp, setOtp] = useState("");
  const [namespace, setNamespace] = useState("default");
  const [busy, setBusy] = useState(false), [versions, setVersions] = useState<Conflict[]>([]);
  const pending = useRef(false);
  const dirty = !connection || connection.email !== email || connection.namespace !== namespace || !!password || !!otp;
  useEffect(() => {
    if (!isNativeAndroid) return;
    let mounted = true;
    androidSyncConnection().then(async (saved) => {
      if (!mounted) return;
      setConnection(saved);
      if (saved) { setEmail(saved.email); setNamespace(saved.namespace); }
      const conflicts = await inspectAndroidConflicts();
      if (mounted) setVersions(conflicts);
    }).catch((error: unknown) => { if (mounted) toast.error(t(syncErrorKey(error))); });
    return () => { mounted = false; };
  }, [t]);
  const execute = async (task: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await task(); }
    catch (error) { toast.error(t(syncErrorKey(error)), { id: "android-sync" }); }
    finally { pending.current = false; setBusy(false); }
  };
  const sync = (resolutions: Record<string, string> = {}) => execute(async () => {
    toast.loading(t("custom.sync.working"), { id: "android-sync" });
    const result = await runAndroidSync(resolutions);
    setVersions(result.conflicts);
    toast.success(t(result.unchanged ? "custom.sync.unchanged" : "custom.sync.complete"), { id: "android-sync" });
    if (result.pendingBooks) toast(t("custom.sync.pendingBooks", { count: result.pendingBooks }));
    if (result.skippedBooks) toast(t("custom.sync.skippedBooks", { count: result.skippedBooks }));
  });
  return <section className="android-sync" aria-busy={busy}>
    <h2>{t("custom.sync.title")}</h2><p>{t("android.sync.help")}</p>
    <p>{t("custom.sync.closeReaders")}</p>
    {!isNativeAndroid && <p>{t("android.sync.nativeOnly")}</p>}
    <fieldset disabled={busy || !isNativeAndroid}>
      <p role="status">{t(connection ? "custom.sync.connectionSaved" : "custom.sync.notConnected")}</p>
      <label>{t("Email")}<input type="email" value={email} autoComplete="off" onChange={(event) => setEmail(event.target.value)} /></label>
      <label>{t("Password")}<input type="password" value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} /></label>
      <label>{t("custom.sync.otp")}<input value={otp} inputMode="numeric" maxLength={6} autoComplete="off" onChange={(event) => setOtp(event.target.value)} /></label>
      {connection && <small>{t("custom.sync.keepAccount")}</small>}
      <label>{t("custom.sync.namespace")}<input value={namespace} maxLength={64} pattern="[a-zA-Z0-9_-]+" onChange={(event) => setNamespace(event.target.value)} /></label>
      <small>{t("custom.sync.namespaceHelp")}</small>
      <small>{t("android.sync.foreground")}</small>
      {dirty && connection && <small>{t("custom.sync.unsaved")}</small>}
      <button type="button" onClick={() => void execute(async () => {
        try {
          const saved = await configureAndroidSync({ email, password, secondFactorCode: otp, namespace, autoMinutes: 0 });
          setConnection(saved); toast.success(t("custom.sync.connectionSaved"));
        } finally { setPassword(""); setOtp(""); }
      })}>{t(connection ? "custom.sync.save" : "custom.sync.loginSave")}</button>
      <button type="button" disabled={dirty || !canSync} onClick={() => void sync()}>{t(busy ? "custom.sync.working" : "custom.sync.now")}</button>
      <button type="button" disabled={!connection} onClick={() => void execute(async () => { await disconnectSync(); setConnection(null); setVersions([]); setPassword(""); setOtp(""); })}>{t("custom.sync.disconnect")}</button>
    </fieldset>
    {!!versions.length && <section className="android-sync-conflicts">
      <h3>{t("custom.sync.conflictsPending")}</h3><p>{t("custom.sync.conflictsHelp")}</p>
      {versions.map((conflict) => <article key={conflict.entity}>
        <strong>{t(`custom.sync.kind.${conflict.kind}`)}</strong>
        {conflict.bookTitle && <p>{conflict.bookTitle}</p>}
        {conflict.versions.map((revision, index) => <div key={revision.id}>
          <span>{t("custom.sync.version", { count: index + 1 })}{revision.id === conflict.selected ? ` · ${t("custom.sync.selected")}` : ""}</span>
          <p>{revision.deleted ? t("custom.sync.deleted") : preview(revision.value)}</p>
          <button type="button" disabled={busy || dirty || !canSync} onClick={() => void sync({ [conflict.entity]: revision.id })}>{t("custom.sync.useVersion")}</button>
        </div>)}
      </article>)}
    </section>}
  </section>;
}
