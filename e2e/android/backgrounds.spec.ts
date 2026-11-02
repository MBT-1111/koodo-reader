import { expect, test } from "@playwright/test";
import { backgroundFile, openBackgrounds } from "./background-fixtures.cjs";
import { fontBook } from "./font-fixtures.cjs";
import { showReadingTools } from "./fixtures.cjs";

test("imports, applies, restores and deletes a local background offline", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
  const file = await backgroundFile(page);
  await openBackgrounds(page);
  await page.locator('.setting-dialog-main input[type="file"]').setInputFiles(file);
  const item = page.locator(".background-setting-item").filter({ has: page.getByAltText(file.name, { exact: true }) });
  await expect(item).toBeVisible();
  await expect(item.getByRole("button", { name: "Delete", exact: true })).toHaveCSS("opacity", "1");
  await item.click();
  const actions = page.locator(".background-preview-actions");
  await expect(actions).toBeInViewport();
  await actions.getByRole("button", { name: "Set as app background", exact: true }).click();
  await actions.getByRole("button", { name: "Set as book background", exact: true }).click();
  await page.locator(".background-preview-close").click();
  await page.locator(".setting-close-container").click();
  await expect(page.locator("#root")).toHaveCSS("background-image", /data:image\/png;base64/);
  const data = await page.locator("#root").evaluate((root) => getComputedStyle(root).backgroundImage);
  await expect(page.locator(".android-manager")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.locator("#import-book-box").setInputFiles(await fontBook());
  await page.locator(".book-item-cover").first().click();
  await expect(page.locator(".android-reader-background")).toHaveCSS("background-image", data);
  await expect(page.frameLocator("#page-area > iframe").locator("body")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.reload();
  await expect(page.locator(".android-reader-background")).toHaveCSS("background-image", data);
  await page.screenshot({ path: testInfo.outputPath("background-reader.png") });
  await showReadingTools(page);
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await openBackgrounds(page);
  await item.click();
  await actions.getByRole("button", { name: "Clear app background", exact: true }).click();
  await expect(page.locator("#root")).toHaveCSS("background-image", "none");
  await actions.getByRole("button", { name: "Set as app background", exact: true }).click();
  await page.locator(".background-preview-close").click();
  await item.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(item).toHaveCount(0);
  await expect(page.locator("#root")).toHaveCSS("background-image", "none");
  expect(await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
    return [config.appBackgroundImage, config.readerBackgroundImage, config.textColor, config.backgroundColor];
  })).toEqual(["", "", "", ""]);
  expect(errors).toEqual([]);
});

test("keeps background preview actions usable on narrow and landscape dark phones", async ({ page, context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await openBackgrounds(page);
  const file = await backgroundFile(page);
  await page.locator('.setting-dialog-main input[type="file"]').setInputFiles(file);
  await page.locator(".background-setting-item").click();
  for (const viewport of [{ width: 320, height: 568 }, { width: 727, height: 320 }]) {
    await page.setViewportSize(viewport);
    for (const button of await page.locator(".background-preview-overlay button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
  }
  const consumed = await page.evaluate(() => !window.dispatchEvent(new Event("android-settings-dismiss", { cancelable: true })));
  expect(consumed).toBe(true);
  await expect(page.locator(".background-preview-overlay")).toHaveCount(0);
  await expect(page.locator(".android-settings h1")).toHaveText("Background");
});
