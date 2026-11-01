import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import SearchBox from "../searchBox";
import ImportLocal from "../importLocal";
import "./android.css";

interface AndroidHeaderProps {
  handleDrag: (isDrag: boolean) => void;
}

const AndroidHeader = ({ handleDrag }: AndroidHeaderProps) => {
  const { t } = useTranslation();
  const location = useLocation();
  const isCollapsed = useAppStore((s) => s.sidebar.isCollapsed);
  const handleCollapse = useAppStore((s) => s.handleCollapse);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);

  useEffect(() => {
    handleCollapse(true);
  }, [location.pathname, handleCollapse]);

  return (
    <header className="android-header">
      <button
        type="button"
        aria-label={t("android.navigation")}
        aria-expanded={!isCollapsed}
        onClick={() => handleCollapse(!isCollapsed)}
      >
        <span className="icon-menu" />
      </button>
      <div className="android-search"><SearchBox /></div>
      <button
        type="button"
        aria-label={t("Setting")}
        onClick={() => {
          handleSettingMode("reading");
          handleSetting(true);
        }}
      >
        <span className="icon-setting" />
      </button>
      <ImportLocal handleDrag={handleDrag} />
      {!isCollapsed && (
        <button
          type="button"
          className="android-nav-backdrop"
          aria-label={t("Close")}
          onClick={() => handleCollapse(true)}
        />
      )}
    </header>
  );
};

export default AndroidHeader;
