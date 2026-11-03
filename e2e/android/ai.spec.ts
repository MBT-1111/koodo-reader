import { expect, test, type Page } from "@playwright/test";
import { readingFixtures, showReadingTools } from "./fixtures.cjs";
import { endpoint, modelId, serviceResponse } from "./ai-fixtures.cjs";

async function openAI(page: Page) {
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI service", exact: true }).click();
}
test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === "android-ai.invalid") {
      const result = serviceResponse(request.url(), request.method(), request.headers(), request.postData());
      return route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
    }
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
});

test("configures Gemini, lists models, tests authentication and preserves the selected model after reload", async ({ page }) => {
  await openAI(page);
  await page.getByText("Add new model", { exact: true }).click();
  const provider = page.getByLabel("Provider", { exact: true });
  const id = await provider.locator("option").evaluateAll((options) => options.map((option) => option.value).find((value) => ["google", "gemini"].includes(value)));
  expect(id).toBeTruthy(); await provider.selectOption(id!);
  await page.getByLabel("Endpoint", { exact: true }).fill(endpoint);
  const key = page.getByPlaceholder("Enter your API Key");
  await key.fill("synthetic-gemini-key");
  await page.getByRole("button", { name: "Fetch models", exact: true }).click();
  await page.getByLabel("Select model", { exact: true }).selectOption(modelId);
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText(/Test successful: OK/)).toBeVisible();
  await key.fill("invalid");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText(/Test failed: HTTP 401/)).toBeVisible();
  await key.fill("synthetic-gemini-key");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".setting-plugin-name").filter({ hasText: "Gemini phone fixture" })).toBeVisible();
  await page.reload(); await openAI(page);
  await expect(page.locator(".setting-plugin-name").filter({ hasText: "Gemini phone fixture" })).toBeVisible();
});

test("opens touch translation controls, renders Gemini bilingual text and removes it when disabled", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(({ endpoint, modelId }) => {
    localStorage.setItem("aiModelConfig", JSON.stringify({ qa: { key: "qa", displayName: "Gemini phone fixture", config: { endpoint, modelId, apiKey: "synthetic-gemini-key", providerId: "google" } } }));
    const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
    Object.assign(config, { aiTranslateModel: "qa", aiDictModel: "qa", fullTranslationTarget: "zhCN" });
    localStorage.setItem("readerConfig", JSON.stringify(config));
  }, { endpoint, modelId });
  await page.reload();
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
  await page.locator(".book-item-cover").first().click();
  await showReadingTools(page);
  await page.getByRole("button", { name: "Translation", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Translation", exact: true });
  await expect(panel.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  await panel.getByLabel("Current page translation").selectOption("both");
  const body = page.frameLocator("#page-area > iframe").locator("body");
  await expect.poll(() => body.evaluate((element) => element.innerHTML.includes("译文："))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("gemini-bilingual.png") });
  await panel.getByLabel("Current page translation").selectOption("no");
  await expect.poll(() => body.evaluate((element) => element.innerHTML.includes("译文："))).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event("android-reader-dismiss", { cancelable: true })));
  await expect(panel).toBeHidden();
  await body.evaluate((element) => {
    const paragraph = element.querySelector("p")!, doc = element.ownerDocument;
    const range = doc.createRange(); range.selectNodeContents(paragraph);
    const selection = doc.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    paragraph.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
  });
  await page.locator(".popup-menu-box .translation-option").click();
  await expect(page.locator(".trans-text-box")).toContainText("Gemini 翻译结果");
  expect(errors).toEqual([]);
});
