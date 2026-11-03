import { expect, test, type Page } from "@playwright/test";
import { backgroundFile, openBackgrounds } from "./background-fixtures.cjs";
import { readingFixtures, showReadingTools } from "./fixtures.cjs";

async function toggleEink(page: Page, enabled: boolean) {
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.locator(".setting-dialog-new-title").filter({ hasText: "E-ink mode" }).locator(".single-control-switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-eink", String(enabled));
  await expect(page.locator(".android-header")).toBeVisible();
}

async function exitReader(page: Page) {
  await showReadingTools(page);
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await expect(page).toHaveURL(/#\/manager\/home/);
}

const savedAppearance = (page: Page) => page.evaluate(() => {
  const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
  return Object.fromEntries(["appSkin", "themeColor", "textColor", "backgroundColor", "animation", "appBackgroundImage", "readerBackgroundImage"].map((key) => [key, config[key]]));
});

test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    if (localStorage.getItem("eink-test-seeded")) return;
    localStorage.setItem("eink-test-seeded", "yes");
    localStorage.setItem("readerConfig", JSON.stringify({ appSkin: "night", themeColor: "#0179CA", textColor: "rgba(255,255,255,1)", backgroundColor: "rgba(44,47,49,1)", animation: "sliding", isEinkMode: "no" }));
  });
  await page.goto("/");
});

test("e-ink covers phone surfaces and books, then restores saved colors, images and animation", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBackgrounds(page);
  const file = await backgroundFile(page);
  await page.locator('.setting-dialog-main input[type="file"]').setInputFiles(file);
  await page.locator(".background-setting-item").click();
  const actions = page.locator(".background-preview-actions");
  await actions.getByRole("button", { name: "Set as app background", exact: true }).click();
  await actions.getByRole("button", { name: "Set as book background", exact: true }).click();
  await page.locator(".background-preview-close").click();
  await page.locator(".setting-close-container").click();
  // Background selection clears the page colors. Reapply an existing dark palette.
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("readerConfig")!);
    Object.assign(config, { textColor: "rgba(255,255,255,1)", backgroundColor: "rgba(44,47,49,1)" });
    localStorage.setItem("readerConfig", JSON.stringify(config));
  });
  const original = await savedAppearance(page);
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await toggleEink(page, true);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#root")).toHaveCSS("filter", "grayscale(1)");
  await expect(page.locator("#root")).toHaveCSS("background-image", "none");
  await expect(page.locator(".android-manager")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".android-title-row .import-from-local")).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(page.locator(".android-title-row .import-from-local")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator('.android-bottom-nav button[aria-current="page"] > span').first()).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("eink-library.png") });
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".android-settings")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".android-settings")).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.locator(".setting-close-container").click();
  await page.locator(".book-item-cover").first().click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  const body = page.frameLocator("#page-area > iframe").locator("body");
  await expect(body).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(body.locator("p").first()).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(page.locator(".android-reader-background")).toHaveCount(0);
  await showReadingTools(page);
  await expect(page.locator(".next-chapter-single-container")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".next-chapter-single-container")).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const panel = page.locator(".setting-panel-container");
  await expect(panel).toHaveCSS("transition-duration", "0s");
  await expect(panel).toHaveCSS("box-shadow", "none");
  await panel.getByText("Theme", { exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("E-ink mode uses black text");
  await expect(panel.locator(".preset-theme-item")).toHaveCount(0);
  await panel.getByText("More", { exact: true }).click();
  await expect(panel.getByLabel("Page turning animation")).toBeDisabled();
  await expect(panel.getByLabel("Page turning animation")).toHaveValue("none");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("eink-reader.png") });
  await page.reload();
  await expect(body.locator("p").first()).toHaveCSS("color", "rgb(0, 0, 0)");
  expect(await savedAppearance(page)).toEqual(original);
  await exitReader(page);
  await toggleEink(page, false);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#root")).toHaveCSS("filter", "none");
  await expect(page.locator("#root")).toHaveCSS("background-image", /data:image\/png;base64/);
  expect(await savedAppearance(page)).toEqual(original);
  await page.locator(".book-item-cover").first().click();
  await expect(page.locator(".android-reader-background")).toBeVisible();
  await expect(body.locator("p").first()).toHaveCSS("color", "rgb(255, 255, 255)");
  await showReadingTools(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await panel.getByText("More", { exact: true }).click();
  await expect(panel.getByLabel("Page turning animation")).toBeEnabled();
  await expect(panel.getByLabel("Page turning animation")).toHaveValue("sliding");
  expect(errors).toEqual([]);
});

test("e-ink keeps TXT and PDF readable in dark system and narrow or landscape viewports", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const fixtures = (await readingFixtures()).filter((fixture) => fixture.format !== "epub");
  await page.locator("#import-book-box").setInputFiles(fixtures);
  for (const fixture of fixtures) await expect(page.locator(".book-item-title").filter({ hasText: fixture.title })).toBeVisible();
  const original = await savedAppearance(page);
  await toggleEink(page, true);
  for (const fixture of fixtures) {
    await page.locator(".book-list-item").filter({ hasText: fixture.title }).locator(".book-item-cover").click();
    await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    await showReadingTools(page);
    if (fixture.format === "txt") {
      const body = page.frameLocator("#page-area > iframe").locator("body");
      await expect(body).toContainText("安卓中文文本样本");
      await expect(body.locator("p").first()).toHaveCSS("color", "rgb(0, 0, 0)");
    } else {
      await expect(page.frameLocator("#page-area > iframe").frameLocator("#pdf-iframe-0").locator("body")).toContainText("PDF page 1");
      await expect(page.locator(".android-reader")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    }
    for (const viewport of [{ width: 320, height: 568 }, { width: 727, height: 320 }]) {
      await page.setViewportSize(viewport);
      await showReadingTools(page);
      await expect(page.locator(".android-reader-toolbar")).toBeInViewport();
      await page.getByRole("button", { name: "Chapters", exact: true }).click();
      const panel = page.locator(".navigation-panel-container");
      await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
      const close = panel.getByRole("button", { name: "Close", exact: true });
      await expect(close).toBeInViewport();
      await close.click();
    }
    await page.screenshot({ path: testInfo.outputPath(`eink-${fixture.format}.png`) });
    await exitReader(page);
  }
  expect(await savedAppearance(page)).toEqual(original);
});
