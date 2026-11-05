import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { amazonPdfFixtures, imagePdfFixture, visiblePdfPage } from "./amazon-pdf-fixtures.cjs";
import { hideReadingTools, showReadingTools } from "./fixtures.cjs";

async function swipePdf(page: Page, session: CDPSession, direction: "left" | "right" | "up" | "down") {
  const bounds = (await page.locator("#page-area").boundingBox())!;
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "left" || direction === "up";
  const point = (fraction: number) => ({ x: bounds.x + bounds.width * (horizontal ? fraction : 0.5), y: bounds.y + Math.min(bounds.height, 500) * (horizontal ? 0.5 : fraction) });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(forward ? 0.8 : 0.2)] });
  for (let step = 1; step <= 16; step++) {
    await page.waitForTimeout(25);
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(forward ? 0.8 - step * 0.0375 : 0.2 + step * 0.0375)] });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

for (const kind of ["image", "text"]) test(`${kind} PDF touch swipes turn pages instead of drawing desktop selections`, async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.locator(".android-header")).toBeVisible();
  await page.locator("#import-book-box").setInputFiles(kind === "image" ? await imagePdfFixture(page) : (await amazonPdfFixtures(["pdf-zh-1col.pdf"]))[0]);
  await page.locator(".book-item-cover").first().click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await hideReadingTools(page);
  await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(0);
  const session = await context.newCDPSession(page);
  const swipe = (direction: "left" | "right" | "up" | "down") => swipePdf(page, session, direction);
  await swipe("left");
  await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(1);
  await swipe("right");
  await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(0);
  await swipe("up");
  await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(1);
  await swipe("down");
  await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(0);
  const target = kind === "image" ? 6 : 2;
  for (let index = 1; index <= target; index++) {
    await swipe("left");
    await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(index);
  }
  await swipe("right");
  await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(target - 1);
  await expect.poll(() => page.evaluate(() => {
    const key = location.hash.split("?")[0].split("/").pop()!;
    return Number(JSON.parse(localStorage.getItem("recordLocation") || "{}")[key]?.page);
  })).toBe(target - 1);
  await showReadingTools(page);
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await page.reload();
  await page.locator(".book-item-cover").first().click();
  await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(target - 1);
  expect(errors).toEqual([]);
  await session.detach();
});

test("an explicitly selected PDF scroll mode keeps native vertical touch scrolling", async ({ page, context }) => {
  await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.locator(".android-header")).toBeVisible();
  await page.evaluate(() => { const config = JSON.parse(localStorage.getItem("readerConfig") || "{}"); config.pdfReaderMode = "scroll"; localStorage.setItem("readerConfig", JSON.stringify(config)); });
  await page.locator("#import-book-box").setInputFiles(await imagePdfFixture(page));
  await page.locator(".book-item-cover").first().click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await hideReadingTools(page);
  const area = page.locator("#page-area"), session = await context.newCDPSession(page);
  const initial = await area.evaluate(element => element.scrollTop);
  await swipePdf(page, session, "up");
  await expect.poll(() => area.evaluate(element => element.scrollTop)).toBeGreaterThan(initial + 100);
  await swipePdf(page, session, "down");
  await expect.poll(() => area.evaluate(element => element.scrollTop)).toBeLessThan(initial + 100);
  await session.detach();
});
