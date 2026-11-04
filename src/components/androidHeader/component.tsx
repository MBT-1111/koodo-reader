import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import SearchBox from "../searchBox";
import ImportLocal from "../importLocal";
import { ANDROID_MANAGER_DISMISS_EVENT } from "../../custom/android/navigation";
import { isNativeAndroid } from "../../utils/platform";
import { androidSyncConnection } from "../../custom/android/mega";
import { runAndroidSync } from "../../custom/android/sync";
import { syncErrorKey } from "../../custom/sync/service";
import toast from "react-hot-toast";
import "./android.css";

interface AndroidHeaderProps {
  handleDrag: (isDrag: boolean) => void;
}

const AndroidHeader = ({ handleDrag }: AndroidHeaderProps) => {
  const { t } = useTranslation();
  const location = useLocation();
  const handleCollapse = useAppStore((s) => s.handleCollapse);
  const handleMode = useAppStore((s) => s.handleMode);
  const handleShelf = useAppStore((s) => s.handleShelf);
  const handleSearch = useAppStore((s) => s.handleSearch);
  const shelfTitle = useAppStore((s) => s.sidebar.shelfTitle);
  const [searchOpen, setSearchOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncPending = useRef(false);
  const openSyncSettings = () => {
    const state = useAppStore.getState(); state.handleSettingMode("sync"); state.handleSetting(true);
  };
  const sync = async () => {
    if (syncPending.current) return;
    syncPending.current = true; setSyncing(true);
    try {
      if (!isNativeAndroid || !await androidSyncConnection()) { openSyncSettings(); return; }
      toast.loading(t("custom.sync.working"), { id: "android-sync" });
      const result = await runAndroidSync();
      toast.success(t(result.unchanged ? "custom.sync.unchanged" : "custom.sync.complete"), { id: "android-sync" });
      if (result.pendingBooks) toast(t("custom.sync.pendingBooks", { count: result.pendingBooks }));
      if (result.skippedBooks) toast(t("custom.sync.skippedBooks", { count: result.skippedBooks }));
      if (result.conflicts.length) { toast(t("custom.sync.conflictsPending")); openSyncSettings(); }
    } catch (error) { toast.error(t(syncErrorKey(error)), { id: "android-sync" }); }
    finally { syncPending.current = false; setSyncing(false); }
  };
  const mode = location.pathname.split("/").pop() || "home";
  const titles: Record<string, string> = { home: "android.home", empty: "android.home", shelf: "Shelf", note: "Notes", highlight: "Highlights", favorite: "Favorites", trash: "Deleted Books" };

  useEffect(() => {
    handleCollapse(true);
    handleMode(mode === "empty" ? "home" : mode);
    if (mode !== "shelf") handleShelf("");
    handleSearch(false);
    setSearchOpen(false);
  }, [location.pathname, handleCollapse, handleMode, handleShelf, handleSearch, mode]);
  useEffect(() => { setSearchOpen(false); handleSearch(false); }, [shelfTitle, handleSearch]);
  useEffect(() => {
    if (!searchOpen) return;
    const dismiss = (event: Event) => {
      event.preventDefault();
      handleSearch(false);
      setSearchOpen(false);
    };
    window.addEventListener(ANDROID_MANAGER_DISMISS_EVENT, dismiss);
    return () => window.removeEventListener(ANDROID_MANAGER_DISMISS_EVENT, dismiss);
  }, [searchOpen, handleSearch]);

  return (
    <header className="android-header" data-search-open={searchOpen} data-mode={mode}>
      <div className="android-title-row">
      <h1>{t(titles[mode] || "android.home")}</h1>
      {["home", "empty"].includes(mode) && <button type="button" aria-label={t("android.sync.home")} title={t("android.sync.home")} aria-busy={syncing} disabled={syncing} onClick={() => void sync()}>
        <span className="icon-sync" aria-hidden="true" />
      </button>}
      {(mode !== "shelf" || shelfTitle) && mode !== "trash" && <button
        type="button"
        aria-label={t("Search")}
        aria-expanded={searchOpen}
        aria-controls="android-library-search"
        onClick={() => {
          if (searchOpen) handleSearch(false);
          setSearchOpen(!searchOpen);
        }}
      >
        <span className="icon-search" aria-hidden="true" />
      </button>}
      <ImportLocal handleDrag={handleDrag} />
      </div>
      {searchOpen && <div id="android-library-search" className="android-search"><SearchBox /></div>}
    </header>
  );
};

export default AndroidHeader;
