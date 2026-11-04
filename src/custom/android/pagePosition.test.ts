import { expect, it, vi } from "vitest";
import { adaptAndroidPagePosition, visiblePageIndex } from "./pagePosition";

it.each([1, 2, 3])("keeps comic page %s consistent across stored index, title and progress", page => {
  const original = { chapterDocIndex: "2", chapterHref: "page10.png", percentage: "1", text: "", count: 0, extra: "preserve" };
  const chapters = ["page1.png", "page2.png", "page10.png"].map(href => ({ href, label: href }));
  const rendition = { getPosition: () => original, getChapterDoc: () => chapters };
  adaptAndroidPagePosition(rendition, () => page - 1);
  expect(rendition.getPosition()).toEqual({ ...original, chapterDocIndex: String(page - 1), chapterHref: chapters[page - 1].href, chapterTitle: chapters[page - 1].label, percentage: String(page / 3) });
  expect(original.chapterDocIndex).toBe("2");
});

it("keeps the original position while comic progress is not ready", () => {
  const original = { chapterDocIndex: 0 };
  const rendition = { getPosition: () => original, getChapterDoc: () => [] };
  adaptAndroidPagePosition(rendition, () => undefined);
  expect(rendition.getPosition()).toBe(original);
});

it.each([0, 1, 2])("finds dominant comic page %s while another page is partly visible", index => {
  const rect = (top: number, height: number) => ({ left: 0, top, right: 400, bottom: top + height });
  const frames = [0, 1, 2].map(page => ({ id: `pdf-iframe-${page}`, getBoundingClientRect: () => rect(page * 600, 600) }));
  const outer = { clientLeft: 0, clientTop: 0, contentDocument: { querySelectorAll: () => frames }, getBoundingClientRect: () => rect(-index * 600, 1800) };
  const area = { ownerDocument: { defaultView: { innerWidth: 400, innerHeight: 800 } }, querySelector: () => outer, getBoundingClientRect: () => rect(0, 800) };
  expect(visiblePageIndex(area as unknown as HTMLElement)).toBe(index);
});

it("retains the last visible comic page while its view is hidden", () => {
  let visible: number | undefined = 1;
  const rendition = { getPosition: () => ({ chapterDocIndex: "2" }), getChapterDoc: () => ["one", "two", "three"].map(href => ({ href })) };
  adaptAndroidPagePosition(rendition, () => visible);
  expect(rendition.getPosition()).toMatchObject({ chapterDocIndex: "1", chapterHref: "two" });
  visible = undefined;
  expect(rendition.getPosition()).toMatchObject({ chapterDocIndex: "1", chapterHref: "two" });
});

it("turns exactly one image from the visible page and stays within the book", () => {
  let visible = 0;
  const jump = vi.fn((index: number) => { visible = index; }), next = vi.fn(), prev = vi.fn();
  const rendition = { getPosition: () => ({}), getChapterDoc: () => ["one", "two", "three"].map(href => ({ href })), goToChapterIndex: jump, next, prev };
  adaptAndroidPagePosition(rendition, () => visible);
  rendition.prev(); expect(jump).not.toHaveBeenCalled();
  rendition.next(); rendition.next(); rendition.next(); rendition.prev();
  expect(jump.mock.calls.map(([index]) => index)).toEqual([1, 2, 1]);
  expect(next).not.toHaveBeenCalled(); expect(prev).not.toHaveBeenCalled();
});
it.each([0, 1, 2])("preserves zero-based PDF page %s when the engine reports the partly visible next page", index => {
  const rendition = { getPosition: () => ({ page: "2", chapterDocIndex: "2" }), getChapterDoc: () => [0, 1, 2].map(page => ({ href: `title${page}`, label: String(page) })) };
  adaptAndroidPagePosition(rendition, () => index, true);
  expect(rendition.getPosition()).toMatchObject({ page: String(index), chapterDocIndex: String(index), chapterTitle: String(index + 1), percentage: String(index / 2) });
});
