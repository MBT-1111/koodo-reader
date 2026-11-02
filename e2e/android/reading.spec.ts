import { showReadingTools } from "./fixtures.cjs";
import { expect, test, type Page } from "@playwright/test";
import { readingFixtures, visibleParagraphs } from "./fixtures.cjs";

const errors = new WeakMap<Page, string[]>();

async function position(page: Page) {
  return page.evaluate(() => {
    const key = location.hash.split("?")[0].split("/").pop()!;
    return JSON.parse(localStorage.getItem("recordLocation") || "{}")[key] as { percentage: string; chapterDocIndex: string; text: string } | undefined;
  });
}

test.beforeEach(async ({ page, context }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
  await expect(page.locator(".android-header")).toBeVisible({ timeout: 15000 });
});

test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

test("imports Chinese-named TXT and PDF together and restores their positions", async ({ page }) => {
  const fixtures = (await readingFixtures()).filter((fixture) => fixture.format !== "epub");
  await page.locator("#import-book-box").setInputFiles(fixtures);
  for (const fixture of fixtures) await expect(page.locator(".book-item-title").filter({ hasText: fixture.title })).toBeVisible();
  for (const fixture of fixtures) {
    const card = () => page.locator(".book-list-item").filter({ hasText: fixture.title });
    await card().locator(".book-item-cover").click();
    await showReadingTools(page);
    await expect(page).toHaveURL(new RegExp(`#/${fixture.format}/`));
    await expect.poll(() => position(page)).toBeTruthy();
    if (fixture.format === "pdf") {
      await expect(page.frameLocator("#page-area > iframe").frameLocator("#pdf-iframe-0").locator("body")).toContainText("PDF page 1");
    } else {
      await expect(page.frameLocator("#page-area > iframe").locator("body")).toContainText("安卓中文文本样本");
    }
    const before = await position(page);
    await page.locator(".next-chapter-single-container").click();
    await expect.poll(async () => (await position(page))?.percentage).not.toBe(before?.percentage);
    const saved = await position(page);
    await showReadingTools(page);
    await page.getByRole("button", { name: "Exit reader", exact: true }).click();
    await expect(page).toHaveURL(/#\/manager\/home/);
    await page.reload();
    await card().locator(".book-item-cover").click();
    await showReadingTools(page);
    await expect.poll(() => position(page)).toMatchObject({ percentage: saved?.percentage });
    await page.evaluate(() => window.dispatchEvent(new Event("android-reader-close")));
    await expect.poll(() => position(page)).toMatchObject({ percentage: saved?.percentage });
    await showReadingTools(page);
    await page.getByRole("button", { name: "Exit reader", exact: true }).click();
    await expect(page).toHaveURL(/#\/manager\/home/);
  }
});

test("a closed TXT cannot replace the PDF rendition through its delayed refresh", async ({ page }) => {
  const fixtures = (await readingFixtures()).filter((fixture) => fixture.format !== "epub");
  await page.locator("#import-book-box").setInputFiles(fixtures);
  const card = (title: string) => page.locator(".book-list-item").filter({ hasText: title });
  await card(fixtures[0].title).locator(".book-item-cover").click();
  await showReadingTools(page);
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await showReadingTools(page);
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await expect(page).toHaveURL(/#\/manager\/home/);
  await card(fixtures[1].title).locator(".book-item-cover").click();
  await showReadingTools(page);
  await expect(page).toHaveURL(/#\/pdf\//);
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  // The old TXT refresh was scheduled one second after initial rendering.
  await page.waitForTimeout(1200);
  await page.locator(".next-chapter-single-container").click();
  await expect.poll(async () => Number((await position(page))?.percentage)).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event("android-reader-close")));
  expect((await position(page))?.text).not.toMatch(/安卓中文文本样本|手机旋转后继续阅读/);
  await expect(page.frameLocator("#page-area > iframe").frameLocator('iframe[id^="pdf-iframe-"]').first().locator("body")).toContainText("PDF page");
});

test("dismisses reader panels and saves a bookmark from the phone toolbar", async ({ page }) => {
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await page.locator(".book-item-cover").first().click();
  await showReadingTools(page);
  await expect.poll(() => position(page)).toBeTruthy();
  for (const label of ["Chapters", "Settings"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(".android-reader-backdrop")).toBeVisible();
    expect(await page.evaluate(() => !window.dispatchEvent(new Event("android-reader-dismiss", { cancelable: true })))).toBe(true);
    await expect(page.locator(".android-reader-backdrop")).toBeHidden();
    await expect(page).toHaveURL(/#\/epub\//);
  }
  await page.locator(".add-bookmark-button").click();
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open("localforage"); request.onsuccess = () => resolve(request.result); });
    const count = await new Promise<number>((resolve) => { const request = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get("bookmarks"); request.onsuccess = () => resolve(request.result?.length || 0); });
    db.close();
    return count;
  })).toBe(1);
  await page.waitForTimeout(700); // Touch panels must outlive the desktop hover-close delay.
  await expect(page.locator(".android-reader-backdrop")).toBeVisible();
  await page.locator(".android-reader-backdrop").click({ position: { x: 380, y: 80 } });
  await expect(page.locator(".android-reader-backdrop")).toBeHidden();
  await expect(page).toHaveURL(/#\/epub\//);
});

test("keeps the current chapter and position across phone rotation", async ({ page }, testInfo) => {
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await page.locator(".book-item-cover").first().click();
  await showReadingTools(page);
  await expect(page.frameLocator("#page-area iframe").first().locator("body")).toContainText("第一章");
  await page.getByRole("button", { name: "Chapters", exact: true }).click();
  await page.locator(".content-chapter-title").filter({ hasText: "第二章" }).click();
  await expect(page.frameLocator("#page-area iframe").first().locator("body")).toContainText("第二章");
  await expect(page.locator(".android-reader-backdrop")).toBeHidden();
  await expect.poll(async () => (await position(page))?.chapterDocIndex).toBe("1");
  const chapterStart = await position(page);
  await page.locator(".next-chapter-single-container").click();
  await expect.poll(async () => (await position(page))?.percentage).not.toBe(chapterStart?.percentage);
  const anchor = (await visibleParagraphs(page))[0];
  expect(anchor).toBeTruthy();
  const portraitBody = await page.frameLocator("#page-area iframe").first().locator("body").elementHandle();
  await page.setViewportSize({ width: 851, height: 393 });
  await expect(page.locator("#page-area")).toHaveCSS("width", "827px");
  await expect.poll(() => portraitBody!.evaluate((body) => body.isConnected).catch(() => false)).toBe(false);
  await expect(page.frameLocator("#page-area iframe").first().locator("body")).toContainText("第二章");
  await expect.poll(() => visibleParagraphs(page)).toContain(anchor);
  const landscapeBody = await page.frameLocator("#page-area iframe").first().locator("body").elementHandle();
  await page.setViewportSize({ width: 393, height: 851 });
  await expect(page.locator("#page-area")).toHaveCSS("width", "369px");
  await expect.poll(() => landscapeBody!.evaluate((body) => body.isConnected).catch(() => false)).toBe(false);
  await expect(page.frameLocator("#page-area iframe").first().locator("body")).toContainText("第二章");
  await expect.poll(() => visibleParagraphs(page)).toContain(anchor);
  await page.screenshot({ path: testInfo.outputPath("rotated-reader.png") });
});

test("a slow touch swipe turns one page", async ({ page }) => {
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await page.locator(".book-item-cover").first().click();
  await showReadingTools(page);
  await expect.poll(() => position(page)).toBeTruthy();
  const initial = await position(page);
  await page.locator(".next-chapter-single-container").click();
  await expect.poll(async () => Number((await position(page))?.percentage)).toBeGreaterThan(Number(initial?.percentage));
  const expected = await position(page);
  await expect(async () => {
    await page.locator(".previous-chapter-single-container").click();
    expect((await position(page))?.percentage).toBe(initial?.percentage);
  }).toPass({ intervals: [250], timeout: 5000 });
  const bounds = (await page.locator("#page-area iframe").first().boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const y = bounds.y + bounds.height / 2;
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds.x + bounds.width * 0.8, y }] });
  for (let step = 1; step <= 20; step++) {
    await page.waitForTimeout(25); // Exercise a real half-second gesture, not a synthetic pan event.
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: bounds.x + bounds.width * (0.8 - step * 0.03), y }] });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => position(page)).toMatchObject({ percentage: expected?.percentage });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds.x + bounds.width * 0.8, y }] });
  for (const fraction of [0.77, 0.74, 0.71, 0.68, 0.65, 0.68, 0.71, 0.74, 0.77, 0.8]) {
    await page.waitForTimeout(25);
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: bounds.x + bounds.width * fraction, y }] });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => position(page)).toMatchObject({ percentage: expected?.percentage });
  await session.detach();
});
