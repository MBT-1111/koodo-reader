import { expect, test } from "@playwright/test";
import { seedPhoneNotes } from "./notes-fixtures.cjs";
import { fontFiles, importedFontKey } from "./font-fixtures.cjs";

test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
  await expect(page.locator(".android-bottom-nav")).toBeVisible();
});

test("opens grouped phone settings and returns from pages and font preview", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.locator(".android-settings");
  await expect(settings).toHaveAttribute("data-settings-level", "root");
  await expect(page.locator(".android-settings-group")).toHaveCount(3);
  await expect(settings.getByRole("button", { name: "About", exact: true })).toHaveCount(0);
  await expect(page.locator(".android-bottom-nav")).toBeInViewport();
  for (const name of ["General", "Reading", "Reading Stats", "Appearance", "Font management", "Background", "Data", "TXT parser", "Text rules", "Plugins", "AI service", "More settings"]) {
    await settings.getByRole("button", { name, exact: true }).click();
    await expect(settings.getByRole("heading", { level: 1 })).toHaveText(name);
    expect(await page.locator(".android-settings-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await settings.getByRole("button", { name: "Back", exact: true }).click();
    await expect(settings).toHaveAttribute("data-settings-level", "root");
  }
  await page.screenshot({ path: testInfo.outputPath("phone-settings-groups.png") });
  await settings.getByRole("button", { name: "Font management", exact: true }).click();
  await page.locator('.setting-dialog-main input[type="file"]').setInputFiles((await fontFiles())[1]);
  await page.locator(".font-setting-item").filter({ hasText: importedFontKey }).click();
  await expect(page.locator(".font-preview-content")).toBeVisible();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("android-settings-dismiss", { cancelable: true })))).toBe(true);
  await expect(page.locator(".font-preview-content")).toBeHidden();
  await expect(settings.getByRole("heading", { level: 1 })).toHaveText("Font management");
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Home", exact: true }).click();
  await expect(settings).toBeHidden();
  expect(errors).toEqual([]);
});

test("shows MEGA setup without enabling native account actions in browser preview", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".android-settings").getByRole("button", { name: "Personal sync", exact: true }).click();
  const sync = page.locator(".android-sync");
  await expect(sync).toBeVisible();
  await expect(sync.getByText("Connect MEGA in the installed Android app.", { exact: true })).toBeVisible();
  await expect(sync.locator('input[type="password"]')).toBeDisabled();
  await expect(sync.getByRole("button", { name: "Sync now", exact: true })).toBeDisabled();
  expect(await sync.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("combines phone note filters with search, edits a record and opens its book", async ({ page }, testInfo) => {
  const keys = await seedPhoneNotes(page);
  await expect(page.locator(".android-note-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const filter = page.getByRole("dialog", { name: "Filter", exact: true });
  await filter.getByLabel("Filter by book").selectOption(keys.book);
  await filter.getByRole("button", { name: "Alpha", exact: true }).click();
  await filter.getByRole("button", { name: "Beta", exact: true }).click();
  await filter.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".android-notes-empty")).toBeVisible();
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(page.locator(".android-note-card")).toHaveCount(3);
  await page.locator(".android-header").getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByPlaceholder("Search my notes");
  await search.fill("QA phone note 1");
  await search.press("Enter");
  await expect(page.locator(".android-note-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await filter.getByLabel("Filter by book").selectOption(keys.otherBook);
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("android-manager-sheet-dismiss", { cancelable: true })))).toBe(true);
  await expect(filter).toBeHidden();
  await expect(search).toHaveValue("QA phone note 1");
  await expect(page.locator(".android-notes-empty")).toBeVisible();
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(page.locator(".android-note-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit", exact: true });
  await editor.locator(".editor-box").fill("QA edited on phone");
  await page.setViewportSize({ width: 393, height: 500 });
  await expect(editor.getByText("Confirm", { exact: true })).toBeInViewport();
  await editor.getByText("Confirm", { exact: true }).click();
  await expect(editor).toBeHidden();
  // Inspect the edited record in the full list.
  await page.locator(".android-header").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".android-note-card").filter({ hasText: "QA edited on phone" })).toBeVisible();
  await page.setViewportSize({ width: 393, height: 851 });
  await page.screenshot({ path: testInfo.outputPath("phone-global-notes.png") });
  await page.locator(".android-note-card").filter({ hasText: "QA edited on phone" }).getByRole("button", { name: "Show in the book", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/epub/${keys.book}`));
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
});

test("paginates phone notes and keeps the last book filter after rapid changes", async ({ page }) => {
  const keys = await seedPhoneNotes(page, 35);
  const initial = await page.evaluate(() => innerHeight > 800 ? 24 : 16);
  await expect(page.locator(".android-note-card")).toHaveCount(initial);
  await page.locator(".card-list-container").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator(".android-note-card")).toHaveCount(Math.min(initial * 2, 35));
  if (initial * 2 < 35) await page.locator(".card-list-container").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator(".android-note-card")).toHaveCount(35);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const filter = page.getByRole("dialog", { name: "Filter", exact: true });
  await filter.getByLabel("Filter by book").selectOption(keys.otherBook);
  await filter.getByLabel("Filter by book").selectOption(keys.book);
  await filter.getByLabel("Filter by book").selectOption(keys.otherBook);
  await filter.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".android-note-card")).toHaveCount(1);
  await expect(page.locator(".android-note-content")).toHaveText("QA phone note 2");
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(page.locator(".android-note-card")).toHaveCount(initial);
  await page.locator(".android-note-tabs").getByRole("button", { name: "Highlights", exact: true }).click();
  await expect(page.locator(".android-note-card")).toHaveCount(1);
  await page.locator(".android-note-tabs").getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.locator(".android-note-card")).toHaveCount(initial);
});

test("keeps empty notes and grouped settings usable on a narrow dark phone", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.locator(".android-notes-empty")).toBeVisible();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  const filter = page.getByRole("dialog", { name: "Filter", exact: true });
  await expect(filter).toBeInViewport();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("android-manager-sheet-dismiss", { cancelable: true })))).toBe(true);
  await expect(filter).toBeHidden();
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".android-settings")).toHaveCSS("background-color", "rgb(23, 30, 35)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("phone-settings-dark.png") });
});
