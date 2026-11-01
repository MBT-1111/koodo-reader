import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isAndroid } from "../../utils/platform";

export function initAndroidPreferences() {
  if (!isAndroid) return;
  document.documentElement.dataset.platform = "android";
  const defaults = {
    readerMode: "single",
    isTouch: "yes",
    isCollapsed: "yes",
    isNavLocked: "no",
    isSettingLocked: "no",
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!ConfigService.getReaderConfig(key)) {
      ConfigService.setReaderConfig(key, value);
    }
  }
}
