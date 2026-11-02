import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { ANDROID_MANAGER_DISMISS_EVENT, openAndroidManager } from "../../custom/android/navigation";
import { useAppStore } from "../../store/useAppStore";
import "./androidShelves.css";

const AndroidShelves = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetchBooks = useAppStore((s) => s.handleFetchBooks);
  const manageShelves = useAppStore((s) => s.handleSortShelfDialog);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => {
    if (!creating) return;
    const dismiss = (event: Event) => {
      event.preventDefault();
      setCreating(false);
      setName("");
    };
    window.addEventListener(ANDROID_MANAGER_DISMISS_EVENT, dismiss);
    return () => window.removeEventListener(ANDROID_MANAGER_DISMISS_EVENT, dismiss);
  }, [creating]);
  const shelves: Record<string, string[]> = ConfigService.getAllMapConfig("shelfList") || {};
  const sorted: string[] = ConfigService.getAllListConfig("sortedShelfList") || [];
  const names = [...sorted.filter((key) => Object.hasOwn(shelves, key)), ...Object.keys(shelves).filter((key) => !sorted.includes(key))];
  return (
    <main className="android-shelves">
      <div className="android-shelf-heading"><h2>{t("android.yourShelves")}</h2><button type="button" aria-label={t("Manage shelf")} onClick={() => manageShelves(true)}><span className="icon-more" aria-hidden="true" /></button><button type="button" onClick={() => setCreating(true)}>{t("New shelf")}</button></div>
      {creating && <form className="android-shelf-form" onSubmit={(event) => {
        event.preventDefault();
        const title = name.trim();
        if (!title) return toast.error(t("Shelf Title is Empty"));
        if (Object.hasOwn(shelves, title)) return toast.error(t("Duplicate shelf"));
        ConfigService.setOneMapConfig(title, [], "shelfList");
        ConfigService.setListConfig(title, "sortedShelfList");
        setName("");
        setCreating(false);
        void fetchBooks();
      }}>
        <label htmlFor="android-shelf-name">{t("New shelf")}</label>
        <input id="android-shelf-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        <div><button type="button" onClick={() => { setCreating(false); setName(""); }}>{t("Cancel")}</button><button type="submit">{t("Confirm")}</button></div>
      </form>}
      {!names.length && !creating && <div className="android-shelf-empty"><span className="icon-bookshelf-line" aria-hidden="true" /><h2>{t("android.emptyShelf")}</h2><p>{t("android.shelfHint")}</p></div>}
      <div className="android-shelf-list">{names.map((title) => <button type="button" key={title} onClick={() => openAndroidManager(navigate, "shelf", title)}><span className="icon-bookshelf-line" aria-hidden="true" /><span><strong>{title}</strong><small>{t("android.bookCount", { count: shelves[title].length })}</small></span><span aria-hidden="true">›</span></button>)}</div>
    </main>
  );
};

export default AndroidShelves;
