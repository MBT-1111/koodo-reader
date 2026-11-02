import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../../store/useAppStore";
import { openAndroidManager } from "../../custom/android/navigation";
import "./androidBottomNav.css";

const AndroidBottomNav = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const settingsOpen = useAppStore((s) => s.manager.isSettingOpen);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);
  const mode = pathname.split("/").pop();
  const selected = settingsOpen ? "settings" : mode === "shelf" ? "shelf" : ["note", "highlight"].includes(mode || "") ? "note" : "home";
  return (<>
    {["note", "highlight"].includes(mode || "") && <div className="android-note-tabs">{["note", "highlight"].map((tab) => <button key={tab} type="button" aria-pressed={mode === tab} onClick={() => openAndroidManager(navigate, tab)}>{t(tab === "note" ? "Notes" : "Highlights")}</button>)}</div>}
    <nav className="android-bottom-nav" aria-label={t("android.navigation")}>
      {[
        { mode: "home", label: "android.home", icon: "home-line" },
        { mode: "shelf", label: "Shelf", icon: "bookshelf-line" },
        { mode: "note", label: "Notes", icon: "idea-line" },
        { mode: "settings", label: "Setting", icon: "setting" },
      ].map((item) => (
        <button key={item.mode} type="button" aria-current={selected === item.mode ? "page" : undefined} onClick={() => {
          if (item.mode === "settings") {
            handleSettingMode("index");
            handleSetting(true);
          } else {
            handleSetting(false);
            openAndroidManager(navigate, item.mode);
          }
        }}>
          <span className={`icon-${item.icon}`} aria-hidden="true" />
          <span>{t(item.label)}</span>
        </button>
      ))}
    </nav></>
  );
};

export default AndroidBottomNav;
