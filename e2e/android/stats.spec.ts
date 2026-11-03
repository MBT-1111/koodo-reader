import { expect, test, type Page } from "@playwright/test";
import { readingFixtures, showReadingTools } from "./fixtures.cjs";

async function openStats(page: Page) {
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".android-settings").getByRole("button", { name: "Reading Stats", exact: true }).click();
  await expect(page.locator(".android-stats")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".android-stats-card")).toHaveCount(4);
}

const counters = (page: Page) => page.evaluate(() => Object.fromEntries(
  ["readingTime", "readingStats", "recordLocation"].map(key => [key, localStorage.getItem(key)])
));

test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
  await expect(page.locator(".android-bottom-nav")).toBeVisible();
});

test("shows empty statistics and fits narrow, dark and e-ink phone layouts", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openStats(page);
  const stats = page.locator(".android-stats");
  await expect(stats.locator('[data-stat="books"] strong')).toHaveText("0");
  await expect(stats.locator('[data-stat="total"] strong')).toHaveText("0s");
  await expect(stats.locator(".android-stats-empty")).toBeVisible();
  await expect(stats.locator(".android-stats-day-summary li")).toHaveCount(7);
  await expect(stats.locator(".android-stats-cell[data-date]")).toHaveCount(90);
  for (const theme of ["dark", "eink"]) {
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
      document.documentElement.dataset.eink = String(theme === "eink");
    }, theme);
    const card = stats.locator(".android-stats-card").first();
    if (theme === "eink") await expect(card).toHaveCSS("border-top-color", "rgb(0, 0, 0)");
    await expect(card).toHaveCSS("color", theme === "dark" ? "rgb(226, 233, 233)" : "rgb(0, 0, 0)");
    expect(await page.locator(".android-settings-content").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`stats-empty-${theme}.png`) });
  }
  await page.setViewportSize({ width: 851, height: 393 });
  await stats.locator(".android-stats-legend").scrollIntoViewIfNeeded();
  await expect(stats.locator(".android-stats-legend")).toBeInViewport();
  expect(await page.locator(".android-settings-content").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("aggregates saved records, switches charts and refreshes without writing counters", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await expect(page.locator(".book-list-item")).toHaveCount(1);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("localforage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const books = await new Promise<Array<{ key: string }>>((resolve, reject) => {
        const request = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get("books");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const key = books[0].key;
      const daily = Object.fromEntries([0, 1, 2].map(offset => {
        const date = new Date(); date.setDate(date.getDate() - offset);
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return [day, [`${key}-${(offset + 1) * 60}`]];
      }));
      localStorage.setItem("readingStats", JSON.stringify(daily));
      localStorage.setItem("readingTime", JSON.stringify({ [key]: 900 }));
    } finally { db.close(); }
  });
  await page.reload();
  const before = await counters(page);
  await openStats(page);
  const stats = page.locator(".android-stats");
  await expect(stats.locator('[data-stat="books"] strong')).toHaveText("1");
  await expect(stats.locator('[data-stat="total"] strong')).toHaveText("15m");
  await expect(stats.locator('[data-stat="streak"] strong')).toHaveText("3");
  await expect(stats.locator('[data-stat="average"] strong')).toHaveText("2m");
  await expect(stats.locator('.android-stats-cell[data-date]:not([data-level="0"])')).toHaveCount(3);
  await expect(stats.locator(".android-stats-day-summary li").last()).toHaveText(/1m/);
  await stats.getByRole("button", { name: "Line Chart", exact: true }).click();
  await expect(stats.locator(".recharts-area")).toHaveCount(1);
  await expect(stats.getByRole("button", { name: "Line Chart", exact: true })).toHaveAttribute("aria-pressed", "true");
  await stats.getByRole("button", { name: "Bar Chart", exact: true }).click();
  await expect(stats.locator(".recharts-bar")).toHaveCount(1);
  await stats.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(stats).toHaveAttribute("aria-busy", "false");
  expect(await counters(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("stats-saved-records.png") });
  await stats.locator(".android-stats-activity").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("stats-reading-activity.png") });
  expect(errors).toEqual([]);
});

test("records actual reading and retains the same statistics after reopening", async ({ page }) => {
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await expect(page.locator(".book-list-item")).toHaveCount(1);
  await page.locator(".book-item-cover").click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  // The real tracker uses wall-clock reading time; do not seed or fake these counters.
  await page.waitForTimeout(2200);
  await showReadingTools(page);
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  const saved = await counters(page);
  expect(Object.values(JSON.parse(saved.readingTime || "{}")).some(value => Number(value) >= 2)).toBe(true);
  await openStats(page);
  const values = await page.locator(".android-stats-card strong").allTextContents();
  expect(values[0]).toBe("1"); expect(values[1]).not.toBe("0s"); expect(values[2]).toBe("1");
  await page.reload();
  await openStats(page);
  expect(await page.locator(".android-stats-card strong").allTextContents()).toEqual(values);
  expect(await counters(page)).toEqual(saved);
});
