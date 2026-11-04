import { expect, test, type Page } from "@playwright/test";
import { readingFixtures, showReadingTools, visibleParagraphs } from "./fixtures.cjs";
import { mockSpeech, type SpeechHarness } from "./speech-fixtures";
import type { AndroidSpeechPosition } from "../../src/custom/android/speech";

const emit = (page: Page, text: string) => page.evaluate(text => {
  const qa = (window as unknown as { speechQA: SpeechHarness }).speechQA;
  const position: AndroidSpeechPosition = { id: crypto.randomUUID(), bookKey: qa.state.bookKey, chapterDocIndex: 1, chapterTitle: "第二章", text };
  qa.emit({ ...qa.state, index: qa.state.index + 1, status: "playing", position });
}, text);

test("native speech follows chapter and sentence anchors with the panel closed, then reopens at the saved text without autoplay", async ({ page, context }) => {
  await mockSpeech(page);
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await page.locator(".book-item-cover").first().click(); await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await showReadingTools(page); await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  await page.locator(".android-speech").getByRole("button", { name: "Close", exact: true }).click();
  for (const paragraph of [40, 70]) {
    await emit(page, `第二章第${paragraph}段。`);
    await expect.poll(() => visibleParagraphs(page)).toEqual(expect.arrayContaining([expect.stringContaining(`第二章第${paragraph}段。`)]));
  }
  await showReadingTools(page); await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await expect(page.locator(".android-header")).toBeVisible(); await page.reload();
  await page.locator(".book-item-cover").first().click();
  await expect.poll(() => visibleParagraphs(page)).toEqual(expect.arrayContaining([expect.stringContaining("第二章第70段。")]));
  expect(await page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.some(request => request.action === "start"))).toBe(false);
  expect(errors).toEqual([]);
});

test("Home offers manual cloud sync and opens connection settings without an automatic schedule", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Cloud sync", exact: true }).click();
  await expect(page.locator(".android-sync")).toBeVisible();
  await expect(page.locator(".android-sync")).toContainText("Sync runs only when you tap");
  await expect(page.locator(".android-sync select")).toHaveCount(0);
});
