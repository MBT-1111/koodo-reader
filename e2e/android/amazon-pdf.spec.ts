import { expect, test } from "@playwright/test";
import { amazonPdfFixtures, visiblePdfPage } from "./amazon-pdf-fixtures.cjs";
import { showReadingTools, visibleParagraphs } from "./fixtures.cjs";
import { mockSpeech, type SpeechHarness } from "./speech-fixtures";

for (const file of ["mobi-zh.mobi", "azw-zh.azw", "azw3-zh.azw3", "pdf-zh-1col.pdf", "pdf-zh-2col.pdf"]) {
  test(`${file}: Chinese reading, continuous speech, following and restart position`, async ({ page, context }, testInfo) => {
    await mockSpeech(page);
    await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const [fixture] = await amazonPdfFixtures([file]);
    await page.goto("/"); await expect(page.locator(".android-header")).toBeVisible();
    await page.locator("#import-book-box").setInputFiles(fixture);
    await expect(page.locator(".book-list-item")).toHaveCount(1, { timeout: 30000 });
    await page.locator(".book-item-cover").click();
    await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    const pdf = fixture.format === "pdf";
    if (pdf) await expect.poll(async () => (await visiblePdfPage(page))?.text).toContain(fixture.anchor);
    else await expect(page.frameLocator("#page-area > iframe").locator("body")).toContainText(fixture.anchor);
    await showReadingTools(page);
    if (pdf) {
      await page.locator(".next-chapter-single-container").click();
      await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(1);
    }
    await page.getByRole("button", { name: "Text to speech", exact: true }).click();
    await page.getByRole("checkbox", { name: "Continue to next chapters", exact: true }).check();
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.find(item => item.action === "start"))).toBeTruthy();
    const request = await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.find(item => item.action === "start")!);
    expect(request.saveReadingPosition).toBe(true);
    if (pdf) {
      expect(request.chapterIndex).toBe(1);
      expect((request.text as string[]).join("")).toContain("中文 PDF 第2页");
      expect((request.text as string[]).join("")).not.toContain("中文 PDF 第3页");
    }
    expect(JSON.stringify(request)).toContain(fixture.nextAnchor);
    const following = request.followingChapters as { index: number; title: string; text: string[]; anchors?: string[] }[];
    const target = [{ index: Number(request.chapterIndex), title: String(request.chapterTitle), anchors: request.anchors as string[] }, ...following.map(chapter => ({ index: chapter.index, title: chapter.title, anchors: chapter.anchors || chapter.text }))]
      .flatMap(chapter => chapter.anchors.map(text => ({ index: chapter.index, title: chapter.title, text }))).find(anchor => anchor.text.includes(fixture.nextAnchor))!;
    const { index } = target;
    if (pdf) { expect(index).toBe(2); expect(request.isPdf).toBe(true); }
    await page.locator(".android-speech").getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(({ text, index, title, pdf }) => {
      const qa = (window as unknown as { speechQA: SpeechHarness }).speechQA;
      qa.emit({ ...qa.state, status: "playing", position: { id: crypto.randomUUID(), bookKey: qa.state.bookKey, chapterDocIndex: index, chapterTitle: title, text, ...(pdf ? { page: index } : {}) } });
    }, { text: target.text, index, title: target.title, pdf });
    if (pdf) {
      await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(2);
      await expect(page.locator(".background-page-left")).toHaveText("Page 3");
    }
    else await expect.poll(() => visibleParagraphs(page)).toEqual(expect.arrayContaining([expect.stringContaining(fixture.nextAnchor)]));
    await showReadingTools(page); await page.locator(".add-bookmark-button").click();
    await page.getByRole("button", { name: "Exit reader", exact: true }).click();
    await expect(page.locator(".android-header")).toBeVisible(); await page.reload();
    await page.locator(".book-item-cover").click(); await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    if (pdf) {
      await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(2);
      await expect(page.locator(".background-page-left")).toHaveText("Page 3");
    }
    else await expect.poll(() => visibleParagraphs(page)).toEqual(expect.arrayContaining([expect.stringContaining(fixture.nextAnchor)]));
    expect(await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.some(item => item.action === "start"))).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`${file}-reader.png`) });
    expect(errors).toEqual([]);
  });
}
