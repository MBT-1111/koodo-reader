import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { changeLanguage } from "../../i18n";
import "./storageStartupError.css";

const StorageStartupError = () => {
  const { t } = useTranslation();
  return (
    <main className="storage-startup-error" role="alert">
      <p>{t("android.storage.startFailed")}</p>
      <button type="button" onClick={() => window.location.reload()}>{t("android.storage.retry")}</button>
    </main>
  );
};

export async function showStorageStartupError() {
  await changeLanguage(navigator.language.startsWith("zh") ? "zhCN" : "en");
  createRoot(document.getElementById("root")!).render(<StorageStartupError />);
}

export default StorageStartupError;
