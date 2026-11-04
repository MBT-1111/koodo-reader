interface ComicPosition { [key: string]: unknown }
interface ComicRendition {
  getPosition(): ComicPosition;
  getChapterDoc(): { href: string; label?: string }[];
  next?(): unknown;
  prev?(): unknown;
  goToChapterIndex?(index: number): unknown;
}

export function visibleComicIndex(area: HTMLElement | null): number | undefined {
  const outer = area?.querySelector<HTMLIFrameElement>("iframe"), doc = outer?.contentDocument, view = area?.ownerDocument.defaultView;
  if (!area || !outer || !doc || !view) return;
  const bounds = area.getBoundingClientRect(), offset = outer.getBoundingClientRect();
  const clip = { left: Math.max(0, bounds.left), top: Math.max(0, bounds.top), right: Math.min(view.innerWidth, bounds.right), bottom: Math.min(view.innerHeight, bounds.bottom) };
  let largest = 0, selected: number | undefined;
  for (const frame of doc.querySelectorAll<HTMLIFrameElement>("iframe[id^='pdf-iframe-']")) {
    const match = /^pdf-iframe-(\d+)$/.exec(frame.id);
    if (!match) continue;
    const rect = frame.getBoundingClientRect();
    const width = Math.max(0, Math.min(clip.right, offset.left + outer.clientLeft + rect.right) - Math.max(clip.left, offset.left + outer.clientLeft + rect.left));
    const height = Math.max(0, Math.min(clip.bottom, offset.top + outer.clientTop + rect.bottom) - Math.max(clip.top, offset.top + outer.clientTop + rect.top));
    if (width * height > largest) { largest = width * height; selected = Number(match[1]); }
  }
  return selected;
}

// Save the dominant visible comic page, rather than a partly visible next page.
export function adaptAndroidComicPosition(rendition: ComicRendition, readVisibleIndex: () => number | undefined) {
  const original = rendition.getPosition.bind(rendition);
  let lastVisible: number | undefined;
  const currentIndex = () => {
    const visible = readVisibleIndex(), count = rendition.getChapterDoc().length;
    if (visible !== undefined && Number.isInteger(visible) && visible >= 0 && visible < count) lastVisible = visible;
    return lastVisible !== undefined && lastVisible < count ? lastVisible : undefined;
  };
  rendition.getPosition = () => {
    const position = original(), chapters = rendition.getChapterDoc(), index = currentIndex();
    if (index === undefined) return position;
    const chapter = chapters[index];
    if (!chapter || typeof chapter.href !== "string") return position;
    return { ...position, chapterDocIndex: String(index), chapterHref: chapter.href, chapterTitle: chapter.label || chapter.href, percentage: String((index + 1) / chapters.length) };
  };
  const jump = rendition.goToChapterIndex?.bind(rendition);
  if (jump) for (const method of ["next", "prev"] as const) {
    const fallback = rendition[method]?.bind(rendition);
    if (!fallback) continue;
    rendition[method] = () => {
      const index = currentIndex();
      if (index === undefined) return fallback();
      const target = index + (method === "next" ? 1 : -1);
      if (target >= 0 && target < rendition.getChapterDoc().length) return jump(target);
    };
  }
}
