import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import OperationPanel from "../../containers/panels/operationPanel";
import ProgressPanel from "../../containers/panels/progressPanel";
import { isReadingRawPDF } from "../../utils/common";
import { closeAndroidReader } from "../../custom/android/navigation";
import "./androidReader.css";

interface AndroidReaderControlsProps {
  visible: boolean;
  currentDuration: number;
  onToggle: () => void;
  onNavigate: (tab: string) => void;
  onSettings: (tab: "theme" | "font" | "study") => void;
  onPage: (next: boolean) => void;
}

const AndroidReaderControls = (props: AndroidReaderControlsProps) => {
  const { t } = useTranslation();
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const menuOpen = useAppStore((s) => s.viewArea.isOpenMenu);
  const handleSpeechDialog = useAppStore((s) => s.handleSpeechDialog);
  if (menuOpen) return null;
  return (
    <>
      {!props.visible && <button className="android-reader-menu-toggle" type="button" aria-label={t("android.reader.showControls")} onClick={props.onToggle}><span className="icon-menu" aria-hidden="true" /></button>}
      <header className="android-reader-toolbar" hidden={!props.visible}>
        <button type="button" aria-label={t("Exit reader")} onClick={() => void closeAndroidReader()}><span className="icon-exit" aria-hidden="true" /></button>
        <span className="android-reader-title">{currentBook.name}</span>
        <button type="button" aria-label={t("Text to speech")} onClick={() => handleSpeechDialog(true)}><span className="icon-speaker" aria-hidden="true" /></button>
        {htmlBook && currentBook.key && htmlBook.key === currentBook.key && <OperationPanel compact currentDuration={props.currentDuration} />}
        <button type="button" aria-label={t("android.reader.hideControls")} onClick={props.onToggle}><span className="icon-close" aria-hidden="true" /></button>
      </header>
      <div className="android-reader-bottom" hidden={!props.visible}>
        <div className="android-reader-progress-row">
          <button type="button" className="previous-chapter-single-container" aria-label={t("Previous page")} onClick={() => props.onPage(false)}><span className="icon-dropdown previous-chapter-single" aria-hidden="true" /></button>
          <ProgressPanel compact />
          <button type="button" className="next-chapter-single-container" aria-label={t("Next page")} onClick={() => props.onPage(true)}><span className="icon-dropdown next-chapter-single" aria-hidden="true" /></button>
        </div>
        <nav aria-label={t("android.reader.tools")} data-translation={!isReadingRawPDF(currentBook)}>
          {[
            { tab: "contents", label: "Chapters", icon: "menu" },
            { tab: "notes", label: "Notes", icon: "idea-line" },
            { tab: "bookmarks", label: "Bookmark", icon: "bookmark" },
          ].map((item) => <button key={item.tab} type="button" onClick={() => props.onNavigate(item.tab)}><span className={`icon-${item.icon}`} aria-hidden="true" /><span>{t(item.label)}</span></button>)}
          <button type="button" onClick={() => props.onSettings("theme")}><span className="icon-light-bulb" aria-hidden="true" /><span>{t("Theme")}</span></button>
          {!isReadingRawPDF(currentBook) && <button type="button" onClick={() => props.onSettings("study")}><span className="icon-trans" aria-hidden="true" /><span>{t("Translation")}</span></button>}
          <button type="button" onClick={() => props.onSettings("font")}><span className="icon-setting" aria-hidden="true" /><span>{t("Setting")}</span></button>
        </nav>
      </div>
    </>
  );
};

export default AndroidReaderControls;
