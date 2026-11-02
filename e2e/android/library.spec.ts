import { showReadingTools } from "./fixtures.cjs";
import { expect, test } from "@playwright/test";
import { readingFixtures } from "./fixtures.cjs";

test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
  await expect(page.locator(".android-bottom-nav")).toBeVisible();
});

test("resumes reading from Home and searches the phone library", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#import-book-box").setInputFiles(await readingFixtures());
  await expect(page.locator(".book-list-item")).toHaveCount(3);
  await expect(page.locator(".android-continue-card")).toHaveCount(0);
  await page.locator(".book-list-item").filter({ hasText: "安卓章节样本" }).locator(".book-item-cover").click();
  await showReadingTools(page);
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await page.locator(".next-chapter-single-container").click();
  await showReadingTools(page);
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  const resume = page.getByRole("button", { name: "Continue reading 安卓章节样本", exact: true });
  await expect(resume).toBeVisible();
  const percentage = await resume.locator("progress").getAttribute("value");
  expect(Number(percentage)).toBeGreaterThan(0);
  await resume.click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await showReadingTools(page);
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await page.locator(".android-header").getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByPlaceholder("Search my library");
  const readingLocks = () => page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
    return [config.isNavLocked, config.isTempLocked];
  });
  const locksBefore = await readingLocks();
  await search.dispatchEvent("compositionstart", { data: "安" });
  expect(await readingLocks()).toEqual(locksBefore);
  await search.dispatchEvent("compositionend", { data: "安卓" });
  expect(await readingLocks()).toEqual(locksBefore);
  await search.fill("PDF");
  await search.press("Enter");
  await expect(page.locator(".book-list-item")).toHaveCount(1);
  await expect(page.locator(".book-item-title")).toContainText("安卓 PDF 样本");
  await expect(page.locator(".android-continue-card")).toHaveCount(0);
  await page.locator(".android-header").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".book-list-item")).toHaveCount(3);
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.locator(".android-library-empty")).toBeVisible();
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".book-list-item")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("phone-new-home.png") });
  expect(errors).toEqual([]);
});

test("creates a shelf and adds a book through its existing action menu", async ({ page }, testInfo) => {
  const nav = page.locator(".android-bottom-nav");
  await nav.getByRole("button", { name: "Shelf", exact: true }).click();
  await page.getByRole("button", { name: "New shelf", exact: true }).click();
  await page.getByLabel("New shelf", { exact: true }).fill("Phone QA Shelf");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator(".android-shelf-list")).toContainText("Phone QA Shelf");
  await page.reload();
  await expect(page.locator(".android-shelf-list")).toContainText("Phone QA Shelf");
  await page.getByRole("button", { name: "Manage shelf", exact: true }).click();
  await expect(page.locator(".backup-page-container")).toBeInViewport();
  const dialog = (await page.locator(".backup-page-container").boundingBox())!;
  expect(dialog.x).toBeGreaterThanOrEqual(0);
  expect(dialog.x + dialog.width).toBeLessThanOrEqual(393);
  await page.locator(".backup-page-close-icon").click();
  await nav.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await page.locator(".book-list-item .book-more-action").click();
  await page.locator(".action-dialog-container").getByText("Add to shelf", { exact: true }).click();
  await page.locator(".add-dialog-shelf-list-box").selectOption("Phone QA Shelf");
  await page.locator(".add-dialog-confirm").click();
  await expect(page).toHaveURL(/#\/manager\/shelf/);
  await expect(page.locator(".android-shelf-breadcrumb")).toContainText("Phone QA Shelf");
  await expect(page.locator(".book-list-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Back to shelves", exact: true }).click();
  await expect(page.locator(".android-shelf-list")).toContainText("1 book");
  await nav.getByRole("button", { name: "Notes", exact: true }).click();
  await page.locator(".android-note-tabs").getByRole("button", { name: "Highlights", exact: true }).click();
  await expect(page).toHaveURL(/#\/manager\/highlight/);
  await expect(nav.getByRole("button", { name: "Notes", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Home", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("phone-shelves-home.png") });
});

test("keeps the new navigation usable in dark mode on a narrow phone", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator(".android-manager")).toHaveCSS("background-color", "rgb(23, 30, 35)");
  await page.setViewportSize({ width: 320, height: 720 });
  const nav = page.locator(".android-bottom-nav");
  for (const button of await nav.getByRole("button").all()) {
    await expect(button).toBeInViewport();
    const rect = (await button.boundingBox())!;
    expect(rect.width).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("phone-dark-empty.png") });
});
