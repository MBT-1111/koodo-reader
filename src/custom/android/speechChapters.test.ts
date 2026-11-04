import { expect, it, vi } from "vitest";
import { pdfSpeechText, prepareSpeechChapters } from "./speechChapters";

it("joins PDF glyph runs and preserves the source's column reading order", () => {
  expect(pdfSpeechText({ items: [
    { str: "中文" }, { str: " PDF", hasEOL: true },
    { str: "左栏第一行", hasEOL: true }, { str: "左栏第二行", hasEOL: true },
    { str: "右栏第一行", hasEOL: true }, { str: " " }, { hasEOL: true }, { str: "末行" },
  ] })).toEqual(["中文 PDF", "左栏第一行", "左栏第二行", "右栏第一行", "末行"]);
});

it("prepares text PDF pages without rendering, skipping blank pages and retaining source anchors", async () => {
  const load = vi.fn(), getTextContent = vi.fn(async () => ({ items: [{ str: "原文第三页。", hasEOL: true }] }));
  const rendition = { getPosition: () => ({ chapterDocIndex: "0" }), getChapterDoc: () => [
    { text: {} }, { text: { getTextContent: async () => ({ items: [] }) } }, { label: "2", text: { load, getTextContent } },
  ] };
  const result = await prepareSpeechChapters(rendition, ["当前页"], text => text.replace("原文", "朗读"), new AbortController().signal, true);
  expect(result).toEqual({ chapterIndex: 0, chapterTitle: "1", followingChapters: [{ index: 2, title: "3", text: ["朗读第三页。"], anchors: ["原文第三页。"] }] });
  expect(load).not.toHaveBeenCalled();
});

it("does not enqueue PDF text arriving after preparation was cancelled", async () => {
  const controller = new AbortController();
  const rendition = { getPosition: () => ({ chapterDocIndex: 0 }), getChapterDoc: () => [{ text: {} }, { text: { getTextContent: async () => {
    controller.abort(); return { items: [{ str: "Late result" }] };
  } } }] };
  await expect(prepareSpeechChapters(rendition, ["Current"], text => text, controller.signal, true)).rejects.toMatchObject({ name: "AbortError" });
});
