import { expect, test, type Locator } from "@playwright/test";

async function touchable(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(() => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
  const box = (await locator.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
});

test("phone plugin categories keep cards, details and footer controls separate on narrow and landscape screens", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".android-settings").getByRole("button", { name: "Plugins", exact: true }).click();
  const plugins = page.locator(".plugin-setting-phone");
  await plugins.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(plugins.locator(".plugin-card-market")).toHaveCount(2);
  const mimo = plugins.locator(".plugin-card-market").filter({ hasText: "MiMo TTS" });
  await mimo.getByRole("button", { name: "Install", exact: true }).click();
  await page.locator('.vex-dialog-form input[name="apiKey"]').fill("synthetic-layout-key");
  await page.locator(".vex-dialog-form").getByRole("button", { name: "Confirm", exact: true }).click();
  const installed = plugins.locator(".plugin-card-installed");
  await expect(installed).toHaveCount(1);
  await touchable(installed.getByRole("button", { name: "Delete", exact: true }));
  for (const viewport of [{ width: 393, height: 851 }, { width: 320, height: 640 }, { width: 851, height: 393 }]) {
    await page.setViewportSize(viewport);
    await plugins.getByRole("button", { name: "OCR", exact: true }).click();
    await expect(plugins.locator('.plugin-card:not([data-plugin-type="ocr"])')).toHaveCount(0);
    const card = plugins.locator(".plugin-card-market").filter({ hasText: "OpenAI Compatible OCR (SiliconFlow)" });
    const details = card.getByRole("button", { name: "Details", exact: true });
    if (await details.getAttribute("aria-expanded") === "false") await details.click();
    await expect(card.locator(".plugin-setting-details")).toBeVisible();
    for (const button of await card.getByRole("button").all()) await touchable(button);
    const footer = plugins.locator(".plugin-setting-footer");
    for (const button of await footer.getByRole("button").all()) await touchable(button);
    const boxes = await footer.getByRole("button").evaluateAll(elements => elements.map(element => {
      const { top, bottom } = element.getBoundingClientRect(); return { top, bottom };
    }));
    expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top);
    expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[2].top);
    expect(await footer.evaluate(element => getComputedStyle(element).position)).toBe("static");
    expect(await page.locator(".android-settings-content").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`plugins-footer-${viewport.width}.png`) });
  }
  await plugins.getByRole("button", { name: "Voice", exact: true }).click();
  await installed.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(installed).toHaveCount(0);
  await expect(plugins.locator(".plugin-card-market")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("Chinese e-ink plugin settings keep categories and footer readable and remove About", async ({ page }, testInfo) => {
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
    Object.assign(config, { lang: "zh-CN", appSkin: "night", isEinkMode: "yes" });
    localStorage.setItem("readerConfig", JSON.stringify(config));
  });
  await page.reload();
  await page.locator(".android-bottom-nav").getByRole("button").last().click();
  const settings = page.locator(".android-settings");
  await expect(settings.getByRole("button", { name: "关于", exact: true })).toHaveCount(0);
  await settings.getByRole("button", { name: "插件", exact: true }).click();
  const plugins = page.locator(".plugin-setting-phone");
  await plugins.locator(".plugin-tab-item").nth(2).click();
  await expect(plugins.locator(".plugin-card-market")).toHaveCount(2);
  await expect(plugins.locator(".plugin-card-market").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(plugins.locator(".plugin-tab-item-active")).toHaveCSS("color", "rgb(0, 0, 0)");
  for (const button of await plugins.locator(".plugin-setting-footer").getByRole("button").all()) await touchable(button);
  await page.screenshot({ path: testInfo.outputPath("plugins-eink-zh.png") });
});
