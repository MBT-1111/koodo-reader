import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useAppStore } from "../../store/useAppStore";
import "./androidSettings.css";

interface AndroidSettingsProps {
  title: string;
  contentRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

const groups = [
  { title: "android.settings.reading", items: [
    { mode: "reading", label: "Reading", icon: "bookshelf-line" },
    { mode: "appearance", label: "Appearance", icon: "highlight-line" },
    { mode: "font", label: "Font management", icon: "font" },
  ] },
  { title: "android.settings.library", items: [
    { mode: "general", label: "General", icon: "setting" },
    { mode: "chapter", label: "TXT parser", icon: "convert-text" },
    { mode: "text", label: "Text rules", icon: "edit-line" },
  ] },
  { title: "android.settings.tools", items: [
    { mode: "plugins", label: "Plugins", icon: "internet" },
    { mode: "ai", label: "AI service", icon: "idea-line" },
    { mode: "more", label: "More settings", icon: "more" },
    { mode: "about", label: "About", icon: "detail" },
  ] },
];

const AndroidSettings = ({ title, contentRef, children }: AndroidSettingsProps) => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const mode = useAppStore((s) => s.manager.settingMode);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);
  const root = mode === "index";
  const close = () => { handleSetting(false); handleSettingMode("index"); };
  return (
    <section className="setting-dialog-container android-settings" data-settings-level={root ? "root" : "page"}>
      <div className="setting-dialog-main">
        <header className="android-settings-header">
          {!root && <button type="button" aria-label={t("Back")} onClick={() => pathname.startsWith("/manager") ? handleSettingMode("index") : close()}><span className="icon-dropdown android-settings-back" aria-hidden="true" /></button>}
          <h1>{t(root ? "Setting" : title)}</h1>
          <button type="button" className="setting-close-container" aria-label={t("Close")} onClick={close}><span className="icon-close" aria-hidden="true" /></button>
        </header>
        <div className="setting-dialog-info android-settings-content" ref={contentRef}>
          {root ? groups.map((group) => <section className="android-settings-group" key={group.title}>
            <h2>{t(group.title)}</h2>
            <div>{group.items.map((item) => <button type="button" key={item.mode} onClick={() => handleSettingMode(item.mode)}>
              <span className={`icon-${item.icon}`} aria-hidden="true" /><span>{t(item.label)}</span><span aria-hidden="true">›</span>
            </button>)}</div>
          </section>) : children}
        </div>
      </div>
    </section>
  );
};

export default AndroidSettings;
