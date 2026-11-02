import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ConfigService, CollectionUtil } from "../../assets/lib/kookit-extra-browser.min";
import { useAppStore } from "../../store/useAppStore";
import DatabaseService from "../../utils/storage/databaseService";
import CoverUtil from "../../utils/file/coverUtil";
import BookUtil from "../../utils/file/bookUtil";
import type Book from "../../models/Book";
import { openAndroidManager } from "../../custom/android/navigation";
import "./androidLibrary.css";

interface AndroidLibraryOverviewProps { count: number; empty: boolean }
const collections = new CollectionUtil(ConfigService);

const AndroidLibraryOverview = ({ count, empty }: AndroidLibraryOverviewProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const books = useAppStore((s) => s.manager.books);
  const mode = useAppStore((s) => s.sidebar.mode);
  const isSearch = useAppStore((s) => s.manager.isSearch);
  const handleReadingBook = useAppStore((s) => s.handleReadingBook);
  const [recent, setRecent] = useState<{ book: Book; cover: string } | null>(null);
  const home = mode === "home" && !isSearch;

  useEffect(() => {
    let cancelled = false;
    const key = home && (ConfigService.getAllListConfig("recentBooks") as string[]).find((key) =>
      books?.some((book) => book.key === key) && !collections.isCollection(key) &&
      ConfigService.getObjectConfig(key, "recordLocation", {}).percentage !== undefined);
    setRecent(null);
    if (key) void (async () => {
      const book: Book | null = await DatabaseService.getRecord(key, "books");
      if (!book) return;
      const cover = await CoverUtil.getCover(book);
      if (!cancelled) setRecent({ book, cover });
    })();
    return () => { cancelled = true; };
  }, [books, home]);

  const sortRecent = (sort: number) => {
    ConfigService.setReaderConfig("bookSortCode", JSON.stringify({ sort, order: 2 }));
    const state = useAppStore.getState();
    state.handleFetchBookSortCode();
    void state.handleFetchBooks();
    openAndroidManager(navigate, "home");
  };
  const percentage = recent ? Math.min(1, Math.max(0, Number(ConfigService.getObjectConfig(recent.book.key, "recordLocation", {}).percentage) || 0)) : 0;
  return (
    <li className="android-library-overview">
      {home && recent && (
        <button className="android-continue-card" type="button" aria-label={t("android.continueBook", { name: recent.book.name })} onClick={() => {
          handleReadingBook(recent.book);
          void BookUtil.redirectBook(recent.book);
        }}>
          <span className="android-continue-cover">
            {recent.cover ? <img src={recent.cover} alt="" /> : <span>{recent.book.format}</span>}
          </span>
          <span className="android-continue-info">
            <span className="android-eyebrow">{t("android.continueReading")}</span>
            <strong>{recent.book.name}</strong>
            <span className="android-muted">{recent.book.author}</span>
            <span className="android-continue-progress"><progress max={1} value={percentage} aria-label={t("Reading progress")} /><span>{Math.round(percentage * 100)}%</span></span>
          </span>
        </button>
      )}
      {home && (
        <div className="android-library-shortcuts">
          <button type="button" onClick={() => openAndroidManager(navigate, "favorite")}><span className="icon-heart" aria-hidden="true" /><span>{t("Favorites")}</span></button>
          <button type="button" onClick={() => sortRecent(3)}><span className="icon-add" aria-hidden="true" /><span>{t("android.recentlyAdded")}</span></button>
          <button type="button" onClick={() => sortRecent(1)}><span className="icon-bookshelf-line" aria-hidden="true" /><span>{t("Recently read")}</span></button>
          <button type="button" onClick={() => openAndroidManager(navigate, "trash")}><span className="icon-trash-line" aria-hidden="true" /><span>{t("Deleted Books")}</span></button>
        </div>
      )}
      <div className="android-library-section">
        <h2>{t(isSearch ? "Search" : mode === "favorite" ? "Favorites" : "All books")}</h2>
        <span className="android-muted">{count}</span>
      </div>
      {empty && <div className="android-library-empty"><span className="icon-bookshelf-line" aria-hidden="true" /><h2>{t(home && !books?.length ? "android.library.emptyTitle" : "android.library.noResults")}</h2><p>{t(home && !books?.length ? "android.library.emptyHint" : "android.library.noResultsHint")}</p></div>}
    </li>
  );
};

export default AndroidLibraryOverview;
