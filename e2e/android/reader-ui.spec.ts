import { expect, test } from "@playwright/test";
import { readingFixtures, showReadingTools } from "./fixtures.cjs";

test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await page.locator(".book-item-cover").first().click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
});

test("a short body tap toggles tools without moving the book or its position", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const frame = page.locator("#page-area > iframe");
  const bounds = (await frame.boundingBox())!;
  const body = await page.frameLocator("#page-area > iframe").locator("body").elementHandle();
  const saved = () => page.evaluate(() => localStorage.getItem("recordLocation"));
  const before = await saved();
  await expect(page.locator(".android-reader-toolbar")).toBeHidden();
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.locator(".android-reader-toolbar")).toBeVisible();
  await expect(page.locator(".android-reader-bottom")).toBeVisible();
  expect(await frame.boundingBox()).toEqual(bounds);
  expect(await body!.evaluate((element) => element.isConnected)).toBe(true);
  expect(await saved()).toBe(before);
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.locator(".android-reader-toolbar")).toBeHidden();
  expect(await frame.boundingBox()).toEqual(bounds);
  await page.screenshot({ path: testInfo.outputPath("phone-immersive-reader.png") });
  expect(errors).toEqual([]);
});

test("bottom sheets preserve the viewport and the touch progress slider persists its target", async ({ page }, testInfo) => {
  await showReadingTools(page);
  const frame = page.locator("#page-area > iframe");
  const bounds = await frame.boundingBox();
  for (const label of ["Chapters", "Notes", "Bookmark", "Theme", "Settings"]) {
    await page.locator(".android-reader-bottom").getByRole("button", { name: label, exact: true }).click();
    const sheet = page.getByRole("dialog", { includeHidden: false });
    await expect(sheet).toBeInViewport();
    const rect = (await sheet.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(393);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(await frame.boundingBox()).toEqual(bounds);
    if (label === "Theme") await page.screenshot({ path: testInfo.outputPath("phone-theme-sheet.png") });
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".android-reader-backdrop")).toBeHidden();
  }
  const slider = page.locator(".android-reader-progress .input-progress");
  const rect = (await slider.boundingBox())!;
  await page.touchscreen.tap(rect.x + rect.width * 0.65, rect.y + rect.height / 2);
  const position = () => page.evaluate(() => JSON.parse(localStorage.getItem("recordLocation") || "{}")[location.hash.split("?")[0].split("/").pop()!]);
  await expect.poll(async () => Number((await position())?.percentage)).toBeGreaterThanOrEqual(0.5);
  expect((await position()).chapterDocIndex).toBe("1");
  const target = (await position()).percentage;
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await page.locator(".android-continue-card").click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  expect((await position()).percentage).toBe(target);
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("android-reader-dismiss", { cancelable: true })))).toBe(false);
  await showReadingTools(page);
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("android-reader-dismiss", { cancelable: true })))).toBe(true);
  await expect(page.locator(".android-reader-toolbar")).toBeHidden();
});
