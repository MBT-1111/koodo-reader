import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import "./popupNote.css";
import { isReadingRawPDF } from "../../../utils/common";
import Note from "../../../models/Note";
import NoteTag from "../../noteTag";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { getIframeDoc } from "../../../utils/reader/docUtil";
import {
  ConfigService,
  HighlightUtil,
  NoteSyncManager,
} from "../../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../../../utils/storage/databaseService";
import ColorOption from "../../colorOption";
import copy from "copy-text-to-clipboard";
import { useAppStore } from "../../../store/useAppStore";
import { isAndroid } from "../../../utils/platform";

export interface PopupNoteProps {
  isDockedRight: boolean;

  chapterDocIndex: number;
  chapter: string;
}

const highlightUtil: any = new HighlightUtil(ConfigService);

const PopupNote = (props: PopupNoteProps) => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const highlight = useAppStore((s) => s.reader.highlight);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const noteKey = useAppStore((s) => s.reader.noteKey);
  const handleNoteKey = useAppStore((s) => s.handleNoteKey);
  const handleHighlight = useAppStore((s) => s.handleHighlight);
  const handleOpenMenu = useAppStore((s) => s.handleOpenMenu);
  const handleShowPopupNote = useAppStore((s) => s.handleShowPopupNote);
  const handleMenuMode = useAppStore((s) => s.handleMenuMode);
  const handleFetchNotes = useAppStore((s) => s.handleFetchNotes);
  const { t } = useTranslation();
  const [tag, setTag] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const draftLocation = useRef<Pick<Note, "cfi" | "range" | "percentage"> | null>(null);

  const captureLocation = async () => {
    const location = ConfigService.getObjectConfig(currentBook.key, "recordLocation", {});
    return {
      cfi: JSON.stringify(isReadingRawPDF(currentBook)
        ? htmlBook.rendition.getPositionByChapter(props.chapterDocIndex)
        : location),
      range: JSON.stringify(await htmlBook.rendition.getHighlightCoords(props.chapterDocIndex)),
      percentage: location.percentage || "0",
    };
  };

  useEffect(() => {
    const textArea = document.querySelector<HTMLTextAreaElement>(".editor-box");
    if (!isAndroid) textArea?.focus();
    (async () => {
      if (noteKey) {
        let loadedNote: Note = await DatabaseService.getRecord(
          noteKey,
          "notes"
        );
        setText(loadedNote.text);
        setTag(loadedNote.tag);
        setNote(loadedNote);
        if (textArea) {
          textArea.value = loadedNote.notes;
        }
        let { styleType, color } = highlightUtil.getHighlightValue(
          loadedNote.color || "background-#FEF3CD"
        );
        handleHighlight({
          styleType,
          color,
        });
        if (isAndroid) textArea?.focus();
      } else {
        let docs = getIframeDoc(currentBook);
        let selectedText = "";
        for (let i = 0; i < docs.length; i++) {
          let doc = docs[i];
          if (!doc) continue;
          selectedText = doc.getSelection()?.toString() || "";
          if (selectedText) {
            break;
          }
        }
        if (!selectedText) return;

        selectedText = selectedText.replace(/\s\s/g, "");
        selectedText = selectedText.replace(/\r/g, "");
        selectedText = selectedText.replace(/\n/g, "");
        selectedText = selectedText.replace(/\t/g, "");
        selectedText = selectedText.replace(/\f/g, "");
        setText(selectedText);
        if (isAndroid) {
          // The keyboard can replace the book iframe; keep the quote's original anchor.
          draftLocation.current = await captureLocation();
          textArea?.focus();
        }
      }
    })();
  }, []);

  const handleTag = (nextTag: string[]) => {
    setTag(nextTag);
  };

  const handleNoteClick = (event: Event) => {
    handleNoteKey((event.target as any).dataset.key);
    handleMenuMode("note");
    handleOpenMenu(true);
  };

  const createNote = async () => {
    let notes = (document.querySelector(".editor-box") as HTMLInputElement)
      .value;

    if (noteKey) {
      let newNote = await DatabaseService.getRecord(noteKey, "notes");
      newNote.notes = notes;
      newNote.tag = tag;
      newNote.color =
        highlightUtil.formatHighlightValue(highlight) || newNote.color;
      DatabaseService.updateRecord(newNote, "notes").then(() => {
        handleOpenMenu(false);
        handleFetchNotes();
        handleMenuMode("");
        handleNoteKey("");
        handleShowPopupNote(false);
        if (htmlBook && htmlBook.rendition) {
          htmlBook.rendition.removeOneNote(
            noteKey,
            props.chapterDocIndex
          );
          htmlBook.rendition.createOneNote(newNote, handleNoteClick);
        }
      });
    } else {
      const location = isAndroid ? draftLocation.current : await captureLocation();
      if (!location) return;
      const { cfi, range, percentage } = location;
      let bookKey = currentBook.key;

      let color =
        highlightUtil.formatHighlightValue(highlight) ||
        "background-#FEF3CD";

      let newNote = new Note(
        bookKey,
        props.chapter,
        props.chapterDocIndex,
        text,
        cfi,
        range,
        notes,
        percentage,
        color,
        tag
      );
      DatabaseService.saveRecord(newNote, "notes").then(async () => {
        handleOpenMenu(false);
        handleFetchNotes();
        handleMenuMode("");
        // Saving is also valid while a keyboard resize is replacing the rendition.
        const rendition = isAndroid ? useAppStore.getState().reader.htmlBook?.rendition : htmlBook.rendition;
        await rendition?.createOneNote(newNote, handleNoteClick);
        let noteSyncManager = new NoteSyncManager(
          DatabaseService,
          ConfigService,
          window.electronAPI?.fs,
          window.electronAPI?.path
        );
        noteSyncManager.syncNote(newNote, bookKey);
      });
    }
  };

  const handleUpdateHighlight = () => {};

  const handleClose = () => {
    if (noteKey) {
      DatabaseService.deleteRecord(noteKey, "notes").then(() => {
        toast.success(t("Deletion successful"));
        handleMenuMode("");
        handleFetchNotes();
        handleNoteKey("");
        if (htmlBook && htmlBook.rendition) {
          htmlBook.rendition.removeOneNote(
            noteKey,
            props.chapterDocIndex
          );
        }

        handleOpenMenu(false);
        handleShowPopupNote(false);
      });
    } else {
      handleOpenMenu(false);
      handleMenuMode("");
      handleNoteKey("");
    }
  };

  const colorOptionProps = {
    handleDigest: handleUpdateHighlight,
    isEdit: true,
    noteItem: note,
  };

  return (
    <div className="note-editor">
      <div className="note-original-text">{text}</div>
      <div className="editor-box-parent">
        <textarea
          className="editor-box"
          style={{ height: "calc(100% - 90px)" }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.ctrlKey || event.metaKey) &&
              !(event.nativeEvent as any).isComposing
            ) {
              event.preventDefault();
              createNote();
            }
          }}
        />
      </div>
      <ColorOption {...(colorOptionProps as any)} />
      <div
        className="note-tags"
        style={{
          position: "absolute",
          bottom: "35px",
          height: "40px",
          width: "calc(100% - 40px)",
        }}
      >
        <NoteTag
          {...({
            handleTag: handleTag,
            tag: noteKey && note ? note.tag : [],
          } as any)}
        />
      </div>

      <div className="note-button-container">
        <span
          className="book-manage-title"
          onClick={() => {
            copy(text);
            toast.success(t("Copying successful"));
          }}
        >
          <Trans>Copy quotes</Trans>
        </span>
        <span
          className="book-manage-title"
          onClick={() => {
            handleClose();
          }}
        >
          {noteKey ? <Trans>Delete</Trans> : <Trans>Cancel</Trans>}
        </span>
        <span
          className="book-manage-title"
          onClick={() => {
            createNote();
          }}
        >
          <Trans>Confirm</Trans>
          {!isAndroid && <span> (CTRL + ↵)</span>}
        </span>
      </div>
    </div>
  );
};

export default PopupNote;
