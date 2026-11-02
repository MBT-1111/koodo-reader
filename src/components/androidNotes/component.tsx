import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/useAppStore";
import BookUtil from "../../utils/file/bookUtil";
import CardList from "../../containers/lists/cardList";
import { ANDROID_MANAGER_SHEET_DISMISS_EVENT } from "../../custom/android/navigation";
import "./androidNotes.css";

const AndroidNotes = () => {
  const { t } = useTranslation();
  const notes = useAppStore((s) => s.reader.notes);
  const highlights = useAppStore((s) => s.reader.highlights);
  const mode = useAppStore((s) => s.sidebar.mode);
  const isSearch = useAppStore((s) => s.manager.isSearch);
  const searchResults = useAppStore((s) => s.manager.searchResults);
  const fetchNotes = useAppStore((s) => s.handleFetchNotes);
  const [names, setNames] = useState<Record<string, string>>({});
  const [book, setBook] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const records = mode === "note" ? notes : highlights;

  useEffect(() => { void fetchNotes(); }, [fetchNotes]);
  useEffect(() => {
    let cancelled = false;
    const keys = Array.from(new Set([...notes, ...highlights].map((note) => note.bookKey)));
    void BookUtil.getBookNamesMapByKeys(keys).then((value) => { if (!cancelled) setNames(value); });
    return () => { cancelled = true; };
  }, [notes, highlights]);
  useEffect(() => { setBook(""); setTags([]); setFilterOpen(false); }, [mode]);
  useEffect(() => {
    if (!filterOpen) return;
    const dismiss = (event: Event) => { event.preventDefault(); setFilterOpen(false); };
    window.addEventListener(ANDROID_MANAGER_SHEET_DISMISS_EVENT, dismiss);
    return () => window.removeEventListener(ANDROID_MANAGER_SHEET_DISMISS_EVENT, dismiss);
  }, [filterOpen]);

  const cards = useMemo(() => {
    const keys = isSearch ? new Set(searchResults.map((result: unknown) => result && typeof result === "object" && "key" in result ? String(result.key) : String(result))) : null;
    return records.filter((note) => (!keys || keys.has(note.key)) && (!book || note.bookKey === book) && tags.every((tag) => (note.tag || []).includes(tag)));
  }, [records, isSearch, searchResults, book, tags]);
  const bookKeys = Array.from(new Set(records.map((note) => note.bookKey)));
  const availableTags = Array.from(new Set(records.flatMap((note) => note.tag || [])));
  const filtered = !!book || tags.length > 0;
  const reset = () => { setBook(""); setTags([]); };

  return (
    <main className="android-notes">
      <div className="android-notes-toolbar">
        <span>{t("android.notes.count", { count: cards.length })}</span>
        <button type="button" aria-label={t("Filter")} aria-expanded={filterOpen} aria-controls="android-note-filter" data-active={filtered} onClick={() => setFilterOpen(true)}><span className="icon-sort" aria-hidden="true" />{t("Filter")}{filtered && <span>{tags.length + (book ? 1 : 0)}</span>}</button>
      </div>
      {filtered && <div className="android-notes-filter-summary"><span>{[book && (names[book] || t("Unknown book")), ...tags].filter(Boolean).join(" · ")}</span><button type="button" onClick={reset}>{t("android.notes.resetFilters")}</button></div>}
      {cards.length ? <CardList cards={cards} mode={mode} bookNamesMap={names} /> : <div className="android-notes-empty"><span className="icon-idea-line" aria-hidden="true" /><h2>{t(isSearch || filtered ? "android.notes.noResults" : "android.notes.emptyTitle")}</h2><p>{t(isSearch || filtered ? "android.notes.noResultsHint" : "android.notes.emptyHint")}</p></div>}
      {filterOpen && <>
        <button className="android-notes-filter-backdrop" type="button" aria-label={t("Close")} onClick={() => setFilterOpen(false)} />
        <section className="android-notes-filter" id="android-note-filter" role="dialog" aria-modal="true" aria-label={t("Filter")}>
          <header><h2>{t("Filter")}</h2><button type="button" aria-label={t("Close")} onClick={() => setFilterOpen(false)}><span className="icon-close" aria-hidden="true" /></button></header>
          <label htmlFor="android-note-book">{t("Filter by book")}</label>
          <select id="android-note-book" value={book} onChange={(event) => setBook(event.target.value)}>
            <option value="">{t("All books")}</option>
            {bookKeys.map((key) => <option key={key} value={key}>{names[key] || t("Unknown book")}</option>)}
          </select>
          <fieldset><legend>{t("Tags")}</legend><div className="android-notes-tag-options">
            <button type="button" aria-pressed={!tags.length} onClick={() => setTags([])}>{t("android.notes.allTags")}</button>
            {availableTags.map((tag) => <button key={tag} type="button" aria-pressed={tags.includes(tag)} onClick={() => setTags((current) => current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag])}>{tag}</button>)}
          </div></fieldset>
          <button type="button" className="android-notes-reset" onClick={reset}>{t("android.notes.resetFilters")}</button>
        </section>
      </>}
    </main>
  );
};

export default AndroidNotes;
