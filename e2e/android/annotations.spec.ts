import { showReadingTools } from "./fixtures.cjs";
import { expect, test, type Page } from "@playwright/test";
import { readingFixtures, visibleParagraphs } from "./fixtures.cjs";
import type Note from "../../src/models/Note";

async function notes(page: Page): Promise<Note[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("localforage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Note[]>((resolve, reject) => {
        const request = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get("notes");
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

async function selectParagraph(page: Page, index = 0) {
  return page.frameLocator("#page-area > iframe").locator("body").evaluate((body, index) => {
    const doc = body.ownerDocument;
    const viewport = doc.defaultView!;
    const paragraphs = Array.from(body.querySelectorAll("p")).filter((paragraph) =>
      Array.from(paragraph.getClientRects()).some((rect) => rect.right > 0 && rect.left < viewport.innerWidth && rect.bottom > 0 && rect.top < viewport.innerHeight));
    const paragraph = paragraphs[index];
    if (!paragraph) throw new Error("Missing visible fixture paragraph");
    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    const selection = viewport.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
    return paragraph.textContent!;
  }, index);
}

test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
  await expect(page.locator(".android-header")).toBeVisible();
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await page.locator(".book-item-cover").first().click();
  await showReadingTools(page);
  await expect(page.frameLocator("#page-area > iframe").locator("body")).toContainText("第一章");
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
});

test("applies touch font-size changes and dark theme, then restores them", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".setting-panel-container").getByText("Font", { exact: true }).click();
  const row = page.locator(".font-size-setting").filter({ hasText: "Font size" });
  const slider = row.locator('input[type="range"]');
  const bounds = (await slider.boundingBox())!;
  const current = Number(await slider.inputValue());
  const min = Number(await slider.getAttribute("min")), max = Number(await slider.getAttribute("max"));
  const x = (value: number) => bounds.x + 8 + (value - min) / (max - min) * (bounds.width - 16);
  const y = bounds.y + bounds.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x(current), y }] });
  for (let step = 1; step <= 5; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x(current + (25 - current) * step / 5), y }] });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
  const chosenSize = await slider.inputValue();
  expect(Number(chosenSize)).toBeGreaterThan(current);
  await expect(page.frameLocator("#page-area > iframe").locator("p").first()).toHaveCSS("font-size", `${chosenSize}px`);
  await page.locator(".setting-panel-container").getByText("Theme", { exact: true }).click();
  const presets = page.locator(".preset-theme-item");
  const backgrounds = await presets.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor));
  const dark = backgrounds.findIndex((color) => color.match(/\d+/g)!.slice(0, 3).every((channel) => Number(channel) < 100));
  expect(dark).toBeGreaterThanOrEqual(0);
  await presets.nth(dark).click();
  await page.locator(".setting-panel-container").getByRole("button", { name: "Close", exact: true }).click();
  const paragraph = page.frameLocator("#page-area > iframe").locator("p").first();
  await expect(paragraph).toHaveCSS("font-size", `${chosenSize}px`);
  await expect(page.locator(".background").first()).toHaveCSS("background-color", backgrounds[dark]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("readerConfig") || "{}"));
  const textColor = await page.evaluate(() => {
    const style = document.createElement("span").style;
    style.color = JSON.parse(localStorage.getItem("readerConfig") || "{}").textColor;
    return style.color;
  });
  await expect(paragraph).toHaveCSS("color", textColor);
  await page.reload();
  await expect(page.frameLocator("#page-area > iframe").locator("p").first()).toHaveCSS("font-size", `${chosenSize}px`);
  await expect(page.locator(".background").first()).toHaveCSS("background-color", backgrounds[dark]);
  await expect(page.frameLocator("#page-area > iframe").locator("p").first()).toHaveCSS("color", textColor);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("readerConfig") || "{}").textColor)).toBe(saved.textColor);
  await page.screenshot({ path: testInfo.outputPath("phone-dark-theme.png") });
});

test("creates and restores a highlight and a note within the phone viewport", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const highlighted = await selectParagraph(page);
  await page.locator(".popup-menu-box .highlight-option").click();
  await expect.poll(async () => (await notes(page)).length).toBe(1);
  let records = await notes(page);
  expect(records[0].text).toBe(highlighted);
  await expect(page.frameLocator("#page-area > iframe").locator(`[data-key="${records[0].key}"]`).first()).toBeAttached();
  const quoted = await selectParagraph(page, 1);
  await page.locator(".popup-menu-box .note-option").click();
  const editor = page.locator(".editor-box");
  await expect(editor).toBeInViewport();
  await expect(page.locator(".note-original-text")).toHaveText(quoted);
  const box = (await page.locator(".popup-box-container").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(393);
  await editor.fill("安卓离线笔记测试");
  const oldBody = await page.frameLocator("#page-area > iframe").locator("body").elementHandle();
  await page.setViewportSize({ width: 393, height: 500 });
  await expect(page.locator("#page-area")).toHaveCSS("height", "380px");
  expect(await oldBody!.evaluate((body) => body.isConnected)).toBe(true);
  await expect(editor).toBeInViewport();
  await expect(editor).toHaveValue("安卓离线笔记测试");
  await expect(page.locator(".note-original-text")).toHaveText(quoted);
  await expect(page.locator(".note-button-container").getByText("Confirm", { exact: true })).toBeInViewport();
  await page.locator(".note-button-container .book-manage-title").filter({ hasText: "Confirm" }).click();
  await expect.poll(async () => (await notes(page)).length).toBe(2);
  await expect.poll(() => oldBody!.evaluate((body) => body.isConnected).catch(() => false)).toBe(false);
  records = await notes(page);
  expect(records.find((record) => record.notes === "安卓离线笔记测试")?.text).toBe(quoted);
  await page.setViewportSize({ width: 393, height: 851 });
  await page.reload();
  for (const record of records) {
    await expect(page.frameLocator("#page-area > iframe").locator(`[data-key="${record.key}"]`).first()).toBeAttached();
  }
  await expect.poll(() => visibleParagraphs(page)).not.toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("phone-annotations.png") });
});
