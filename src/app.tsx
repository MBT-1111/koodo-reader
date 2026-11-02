import "./custom/preferences";
import React from "react";
import { createRoot } from "react-dom/client";
import "./assets/styles/reset.css";
import "./assets/styles/global.css";
import "./assets/styles/style.css";
import "./assets/styles/eink.css";
import "./i18n";
import Router from "./router/index";
import StyleUtil from "./utils/reader/styleUtil";
import {
  initSystemFont,
  initTheme,
  applyCustomSystemCSS,
  applyAppBackgroundImage,
} from "./utils/reader/launchUtil";
import { migrateConfig } from "./utils/common";
import { ConfigService } from "./assets/lib/kookit-extra-browser.min";
import { useAppStore } from "./store/useAppStore";
import { isAndroid } from "./utils/platform";
initTheme();
// Zustand is initialized while modules load, before initTheme refreshes isOSNight.
if (
  isAndroid &&
  !ConfigService.getReaderConfig("backgroundColor") &&
  ConfigService.getReaderConfig("isMergeWord") !== "yes"
) {
  useAppStore.getState().handleBackgroundColor(
    document.documentElement.dataset.theme === "dark"
      ? "rgba(44,47,49,1)"
      : "rgba(255,255,255,1)"
  );
}
initSystemFont();
migrateConfig();
applyCustomSystemCSS();
applyAppBackgroundImage();
const container = document.getElementById("root")!;
createRoot(container).render(<Router />);
StyleUtil.applyTheme();
