import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { useAppStore } from "../../store/useAppStore";
import TTSUtil from "../../utils/reader/ttsUtil";
import { flushAndroidPreferences } from "./bootstrap";

export const ANDROID_READER_CLOSE_EVENT = "android-reader-close";
export const ANDROID_READER_DISMISS_EVENT = "android-reader-dismiss";
export const ANDROID_MANAGER_DISMISS_EVENT = "android-manager-dismiss";
export const ANDROID_MANAGER_SHEET_DISMISS_EVENT = "android-manager-sheet-dismiss";
export const ANDROID_SETTINGS_DISMISS_EVENT = "android-settings-dismiss";

export function dismissAndroidSettingsOverlay(): boolean {
  const event = new Event(ANDROID_SETTINGS_DISMISS_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export function openAndroidManager(navigate: (path: string) => void, mode: string, shelf = "") {
  const state = useAppStore.getState();
  state.handleSearch(false);
  state.handleSelectBook(false);
  state.handleSelectedBooks([]);
  state.handleShelf(shelf);
  state.handleMode(mode);
  state.handleCollapse(true);
  navigate(`/manager/${mode}`);
}

export function dismissAndroidReaderOverlay(): boolean {
  const event = new Event(ANDROID_READER_DISMISS_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export function dismissAndroidManagerOverlay(): boolean {
  const sheetEvent = new Event(ANDROID_MANAGER_SHEET_DISMISS_EVENT, { cancelable: true });
  window.dispatchEvent(sheetEvent);
  if (sheetEvent.defaultPrevented) return true;
  const event = new Event(ANDROID_MANAGER_DISMISS_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export async function closeAndroidReader() {
  // Flush the current position before clearing the rendition or changing routes.
  window.dispatchEvent(new Event(ANDROID_READER_CLOSE_EVENT));
  try {
    await flushAndroidPreferences();
  } catch {
    // The cache retains its newer revision; keep the reader open for retry.
    return;
  }
  window.speechSynthesis?.cancel();
  await TTSUtil.stopAudio();
  const state = useAppStore.getState();
  state.handleReadingState(false);
  state.handleSearch(false);
  state.handleOpenMenu(false);
  state.handleHtmlBook(null);
  ConfigService.setReaderConfig("isFullscreen", "no");
  if (document.fullscreenElement) await document.exitFullscreen();
  // Replacing prevents Back from reopening a reader that has already been closed.
  window.location.replace(`${window.location.href.split("#")[0]}#/manager/home`);
}
