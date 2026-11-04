import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { readingFixtures, showReadingTools } from "./fixtures.cjs";
import { mockSpeech, type SpeechHarness } from "./speech-fixtures";

async function open(page: Page, format = 0, body?: string) {
  const fixture = (await readingFixtures())[format];
  if (body) {
    const zip = await JSZip.loadAsync(fixture.buffer);
    zip.file("two.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Metadata only</title></head><body>${body}</body></html>`);
    fixture.buffer = await zip.generateAsync({ type: "nodebuffer" });
  }
  await page.goto("/");
  await page.locator("#import-book-box").setInputFiles(fixture);
  await page.locator(".book-item-cover").first().click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await showReadingTools(page); await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await expect(page.getByRole("button", { name: "Read aloud", exact: true })).toBeEnabled();
}
const starts = (page: Page) => page.evaluate(() => (window as unknown as { speechQA: SpeechHarness }).speechQA.requests.filter(item => item.action === "start"));
const position = (page: Page) => page.evaluate(() => {
  const key = location.hash.split("?")[0].split("/").pop() || "";
  const { chapterDocIndex, chapterTitle, text, percentage } = JSON.parse(localStorage.getItem("recordLocation") || "{}")[key] || {};
  return { chapterDocIndex, chapterTitle, text, percentage };
});

test.beforeEach(async ({ page, context }) => {
  await mockSpeech(page);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
});

for (const [format, title] of [[0, "第二章"], [1, "第二章 继续阅读"]] as const) {
  test(`${format === 0 ? "EPUB" : "TXT"} prepares later chapters without moving the reader`, async ({ page }) => {
    await open(page, format);
    const before = await position(page);
    const checkbox = page.getByRole("checkbox", { name: "Continue to next chapters", exact: true });
    await expect(checkbox).not.toBeChecked(); await checkbox.check();
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    await expect.poll(() => starts(page)).toHaveLength(1);
    expect((await starts(page))[0]).toMatchObject({ chapterIndex: 0, followingChapters: [{ index: 1, title, text: expect.arrayContaining([expect.stringContaining(format === 0 ? "第二章第1段" : "后续第1段")]) }] });
    expect(await position(page)).toEqual(before);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.locator(".android-speech").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Text to speech", exact: true }).click();
    await expect(checkbox).toBeChecked();
    expect(await starts(page)).toHaveLength(1);
  });
}

test("chapter speech preserves nested text once and excludes scripts, metadata, hidden text and ruby readings", async ({ page }) => {
  await open(page, 0, '<h1>Next title</h1><div>Before <em>inline</em><p>Nested <ruby>字<rt>zi</rt></ruby></p>After</div><p hidden="">Hidden</p><p style="display:none">Invisible</p><script>window.chapterScriptRan=true</script><style>hidden css</style><table><tr><td>Left</td><td>Right</td></tr></table>');
  await page.getByRole("checkbox", { name: "Continue to next chapters", exact: true }).check();
  await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect.poll(() => starts(page)).toHaveLength(1);
  const chapters = (await starts(page))[0].followingChapters as { text: string[] }[];
  expect(chapters[0].text).toEqual(["Next title", "Before inline", "Nested 字", "After", "Left", "Right"]);
  expect(await page.evaluate(() => "chapterScriptRan" in window)).toBe(false);
});

test("stopping or exiting during slow preparation never creates a late native queue", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    Object.assign(window, { delayChapterBlob: false });
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).startsWith("blob:") && (window as unknown as { delayChapterBlob: boolean }).delayChapterBlob) await new Promise(resolve => setTimeout(resolve, 1500));
      return original(...args);
    };
  });
  await open(page, 1);
  await page.getByRole("checkbox", { name: "Continue to next chapters", exact: true }).check();
  await page.evaluate(() => { (window as unknown as { delayChapterBlob: boolean }).delayChapterBlob = true; });
  await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect(page.getByText("Preparing chapters…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForTimeout(1800); expect(await starts(page)).toHaveLength(0);
  await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect(page.getByText("Preparing chapters…", { exact: true })).toBeVisible();
  await page.locator(".android-speech").getByRole("button", { name: "Close", exact: true }).click();
  await showReadingTools(page); await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await expect(page.locator(".android-header")).toBeVisible();
  await page.waitForTimeout(1800); expect(await starts(page)).toHaveLength(0);
});

test("oversized continuous text leaves the current chapter available and PDF does not offer continuous chapters", async ({ page }) => {
  await open(page, 0, `<p>${"x".repeat(2000001)}</p>`);
  const checkbox = page.getByRole("checkbox", { name: "Continue to next chapters", exact: true });
  await checkbox.check(); await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("exceeds the continuous reading limit");
  expect(await starts(page)).toHaveLength(0);
  await checkbox.uncheck(); await page.getByRole("button", { name: "Read aloud", exact: true }).click();
  await expect.poll(() => starts(page)).toHaveLength(1);
  expect((await starts(page))[0]).not.toHaveProperty("followingChapters");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.locator(".android-speech").getByRole("button", { name: "Close", exact: true }).click();
  await showReadingTools(page); await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await expect(page.locator(".android-header")).toBeVisible();
  await page.locator("#import-book-box").setInputFiles((await readingFixtures())[2]);
  await page.locator(".book-list-item").filter({ hasText: "安卓 PDF 样本" }).locator(".book-item-cover").click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await showReadingTools(page); await page.getByRole("button", { name: "Text to speech", exact: true }).click();
  await expect(checkbox).toBeDisabled(); await expect(checkbox).not.toBeChecked();
});
