import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { useAppStore } from "../../store/useAppStore";
import { closeAndroidReader, dismissAndroidReaderOverlay } from "../../custom/android/navigation";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ANDROID_STORAGE_ERROR_EVENT, hasNativeStorageError } from "../../custom/android/bootstrap";

const AndroidNavigation = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const report = () => { if (hasNativeStorageError()) toast.error(t("android.storage.writeFailed"), { id: "android-storage" }); };
    window.addEventListener(ANDROID_STORAGE_ERROR_EVENT, report);
    report();
    return () => window.removeEventListener(ANDROID_STORAGE_ERROR_EVENT, report);
  }, [t]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    let disposed = false;
    let closing = false;
    let removeListener: (() => Promise<void>) | undefined;
    const listener = App.addListener("backButton", async () => {
      if (disposed || closing) return;
      const state = useAppStore.getState();
      if (state.manager.isSettingOpen) {
        state.handleSetting(false);
      } else if (state.viewArea.isOpenMenu) {
        state.handleOpenMenu(false);
      } else if (!location.pathname.startsWith("/manager")) {
        if (dismissAndroidReaderOverlay()) return;
        closing = true;
        try {
          await closeAndroidReader();
        } finally {
          closing = false;
        }
      } else if (!state.sidebar.isCollapsed) {
        state.handleCollapse(true);
      } else if (location.pathname !== "/manager/home") {
        navigate("/manager/home", { replace: true });
      } else {
        await App.minimizeApp();
      }
    });
    void listener.then((handle) => {
      if (disposed) {
        void handle.remove();
      } else {
        removeListener = () => handle.remove();
      }
    });
    return () => {
      disposed = true;
      void removeListener?.();
    };
  }, [location.pathname, navigate]);
  return null;
};

export default AndroidNavigation;
