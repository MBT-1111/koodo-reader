import { expect, test } from "@playwright/test";
import { encodedTextFixtures } from "./encoding-fixtures.cjs";
import { showReadingTools } from "./fixtures.cjs";

const small = encodedTextFixtures();
const fixtures = [
  ...small.filter(fixture => ["utf16le", "utf16be"].includes(fixture.encoding)).map(fixture => ({ ...fixture, title: `no-bom-${fixture.title}`, name: `no-bom-${fixture.name}`, buffer: fixture.buffer.subarray(2) })),
  ...small.filter(fixture => ["utf8", "gb18030"].includes(fixture.encoding)).map(fixture => ({ ...fixture, title: `crlf-${fixture.title}`, name: `crlf-${fixture.name}`, buffer: Buffer.from(fixture.buffer.toString("latin1").replace(/\n/g, "\r\n"), "latin1") })),
  ...encodedTextFixtures(35000).filter(fixture => ["utf8", "gb18030", "big5"].includes(fixture.encoding)).map(fixture => ({ ...fixture, title: `large-${fixture.title}`, name: `large-${fixture.name}` })),
];

for (const fixture of fixtures) {
  test(`${fixture.name}: preserves Chinese text, chapter navigation and reload progress`, async ({ page, context }, testInfo) => {
    test.setTimeout(180000);
    const errors: string[] = [], timing: Record<string, number> = { bytes: fixture.buffer.length };
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
    await page.goto("/");
    await expect(page.locator(".android-header")).toBeVisible({ timeout: 15000 });
    const mark = async (key: string, action: () => Promise<void>) => {
      const start = performance.now(); await action(); timing[key] = Math.round(performance.now() - start);
    };
    const card = page.locator(".book-list-item").filter({ hasText: fixture.title });
    const body = page.frameLocator("#page-area > iframe").locator("body");
    try {
      await mark("importMs", async () => {
        await page.locator("#import-book-box").setInputFiles(fixture);
        await expect(card).toBeVisible({ timeout: 60000 });
      });
      await mark("openMs", async () => {
        await card.locator(".book-item-cover").click();
        await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false", { timeout: 60000 });
        await expect(body).toContainText(fixture.anchor);
      });
      await mark("chapterMs", async () => {
        await showReadingTools(page); await page.getByRole("button", { name: "Chapters", exact: true }).click();
        // The engine splits very large TXT into numbered chunks instead of heading chapters.
        const chapters = page.locator(".content-chapter-title");
        if (fixture.name.startsWith("large-")) await chapters.last().click();
        else await chapters.filter({ hasText: "第二章" }).click();
        await expect(body).toContainText(fixture.secondAnchor);
      });
      const savedPosition = () => page.evaluate(() => {
        const key = location.hash.split("?")[0].split("/").pop()!;
        return JSON.parse(localStorage.getItem("recordLocation") || "{}")[key] as { chapterDocIndex: string | number } | undefined;
      });
      await expect.poll(async () => Number((await savedPosition())?.chapterDocIndex)).toBeGreaterThan(0);
      const chapterIndex = Number((await savedPosition())!.chapterDocIndex);
      if (!fixture.name.startsWith("large-")) expect(chapterIndex).toBe(1);
      await showReadingTools(page); await page.getByRole("button", { name: "Exit reader", exact: true }).click();
      await expect(page.locator(".android-header")).toBeVisible();
      await mark("reloadMs", async () => {
        await page.reload(); await card.locator(".book-item-cover").click();
        await expect(body).toContainText(fixture.secondAnchor);
        await expect.poll(async () => Number((await savedPosition())?.chapterDocIndex)).toBe(chapterIndex);
      });
      expect(errors).toEqual([]);
    } finally {
      await testInfo.attach("txt-boundary-timings", { body: JSON.stringify(timing, null, 2), contentType: "application/json" });
    }
  });
}
