import { expect, test } from "@playwright/test";
import { formatFixtures, savedPosition, showReadingTools, visibleComicColor, readFormatState, expectFormatState } from "./format-fixtures.cjs";

for (const format of ["md", "html", "fb2", "docx", "cbz"]) {
  test(`${format}: imports, turns a page and reopens at the saved position`, async ({ page, context }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
    await page.goto("/"); await expect(page.locator(".android-header")).toBeVisible();
    const fixture = (await formatFixtures(page)).find(item => item.format === format)!;
    await page.locator("#import-book-box").setInputFiles(fixture);
    await expect(page.locator(".book-list-item")).toHaveCount(1, { timeout: 30000 });
    await page.locator(".book-item-cover").click();
    await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    if (fixture.anchor) await expect(page.frameLocator("#page-area > iframe").locator("body")).toContainText(fixture.anchor);
    if (fixture.colors) await expect.poll(() => visibleComicColor(page)).toEqual([...fixture.colors[0], 255]);
    await expect.poll(() => savedPosition(page)).toBeTruthy();
    await showReadingTools(page);
    const initial = await savedPosition(page);
    await page.locator(".next-chapter-single-container").click();
    await expect.poll(async () => (await savedPosition(page))?.percentage).not.toBe(initial.percentage);
    if (fixture.colors) await expect.poll(() => visibleComicColor(page)).toEqual([...fixture.colors[1], 255]);
    const advanced = await readFormatState(page, fixture);
    await testInfo.attach("advanced-position", { body: JSON.stringify(advanced), contentType: "application/json" });
    await showReadingTools(page); await page.getByRole("button", { name: "Exit reader", exact: true }).click();
    await expect(page.locator(".android-header")).toBeVisible(); await page.reload();
    await page.locator(".book-item-cover").click();
    await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    await testInfo.attach("reopened-position", { body: JSON.stringify(await readFormatState(page, fixture)), contentType: "application/json" });
    await expectFormatState(page, advanced);
    if (fixture.colors) await expect.poll(async () => (await savedPosition(page))?.percentage).toBe(advanced.position.percentage);
    await page.screenshot({ path: testInfo.outputPath(`${format}-reader.png`) });
    expect(errors).toEqual([]);
  });
}
