import { expect, test } from "@playwright/test";
import { encodedTextFixtures } from "./encoding-fixtures.cjs";
import { showReadingTools } from "./fixtures.cjs";

for (const fixture of encodedTextFixtures()) {
  test(`${fixture.encoding}: imports, reads both Chinese chapters and restores progress`, async ({ page, context }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
    await page.goto("/");
    await expect(page.locator(".android-header")).toBeVisible({ timeout: 15000 });
    await page.locator("#import-book-box").setInputFiles(fixture);
    const card = page.locator(".book-list-item").filter({ hasText: fixture.title });
    await expect(card).toBeVisible(); await card.locator(".book-item-cover").click();
    await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    const body = page.frameLocator("#page-area > iframe").locator("body");
    await expect(body).toContainText(fixture.anchor);
    await showReadingTools(page); await page.getByRole("button", { name: "Chapters", exact: true }).click();
    await page.locator(".content-chapter-title").filter({ hasText: "第二章" }).click();
    await expect(body).toContainText(fixture.secondAnchor);
    await showReadingTools(page); await page.getByRole("button", { name: "Exit reader", exact: true }).click();
    await expect(page.locator(".android-header")).toBeVisible(); await page.reload();
    await card.locator(".book-item-cover").click();
    await expect(body).toContainText(fixture.secondAnchor);
    expect(errors).toEqual([]);
  });
}
