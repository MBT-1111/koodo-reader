import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), flush: vi.fn(), native: vi.fn() }));
vi.mock("../../assets/lib/kookit-extra-browser.min", () => ({ ConfigService: { setObjectConfig: mocks.save, getReaderConfig: () => "" }, HighlightUtil: class { buildTtsHighlightStyle() { return {}; } } }));
vi.mock("./bootstrap", () => ({ flushAndroidPreferences: mocks.flush }));
vi.mock("../../utils/platform", () => ({ isNativeAndroid: true }));
vi.mock("./speech", () => ({ hasAndroidSpeech: () => true, androidSpeech: { readingPosition: mocks.native } }));
import { flushSpeechReadingPositions, followSpeechPosition } from "./speechPosition";
const position = { id: "test-position", bookKey: "test-book", chapterDocIndex: 1, chapterTitle: "Next", text: "Original sentence." };
beforeEach(() => { vi.clearAllMocks(); mocks.native.mockResolvedValue({ positions: [position] }); mocks.flush.mockResolvedValue(undefined); });
it("persists suspended speech anchors into normal reading progress before acknowledging them", async () => {
  await flushSpeechReadingPositions();
  expect(mocks.save).toHaveBeenCalledWith("test-book", expect.objectContaining({ text: position.text, chapterDocIndex: "1" }), "recordLocation");
  expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(mocks.native.mock.invocationCallOrder[1]);
  expect(mocks.native).toHaveBeenLastCalledWith({ bookKey: position.bookKey, acknowledge: position.id });
});
it("retains native anchors when saving the reading preferences fails", async () => {
  mocks.flush.mockRejectedValue(new Error("storage failed"));
  await expect(flushSpeechReadingPositions()).rejects.toThrow("storage failed");
  expect(mocks.native).toHaveBeenCalledTimes(1);
});
it("does not save or highlight a stale navigation after the reader changes", async () => {
  let current = true;
  const rendition = { getPosition: () => ({ chapterDocIndex: 0 }), getChapterDoc: () => [{}, { href: "next.xhtml" }], visibleText: async () => ["Old page"],
    goToPosition: vi.fn(async () => { current = false; }), highlightAudioNode: vi.fn(), record: async () => {} };
  await followSpeechPosition(rendition, position, () => current);
  expect(rendition.goToPosition).toHaveBeenCalled(); expect(rendition.highlightAudioNode).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("keeps an already visible sentence on its page and saves the engine's actual position", async () => {
  const actual = { chapterDocIndex: 1, cfi: "engine-position" };
  const rendition = { getPosition: () => actual, getChapterDoc: () => [], visibleText: async () => [position.text], goToPosition: vi.fn(), highlightAudioNode: vi.fn(), record: async () => {} };
  await followSpeechPosition(rendition, position, () => true);
  expect(rendition.goToPosition).not.toHaveBeenCalled(); expect(rendition.highlightAudioNode).toHaveBeenCalled(); expect(mocks.save).toHaveBeenCalledWith(position.bookKey, expect.objectContaining({ text: position.text, chapterDocIndex: "1", count: "ignore" }), "recordLocation");
});
