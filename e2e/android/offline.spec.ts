import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";

async function makeEpub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("book.opf", `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">android-offline-fixture</dc:identifier><dc:title>Android offline fixture</dc:title><dc:language>en</dc:language><dc:creator>Test</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>`);
  zip.file("toc.ncx", `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="android-offline-fixture"/></head><docTitle><text>Android offline fixture</text></docTitle><navMap><navPoint id="chapter" playOrder="1"><navLabel><text>Offline chapter</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>`);
  const paragraphs = Array.from({ length: 100 }, (_, i) => `<p>Paragraph ${i + 1}. This synthetic book verifies offline reading and saved progress on an Android phone. No personal library is used.</p>`).join("");
  zip.file("chapter.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Offline chapter</title></head><body><h1>Offline chapter</h1>${paragraphs}</body></html>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function savedPosition(page: Page) {
  return page.evaluate(() => {
    const locations = JSON.parse(localStorage.getItem("recordLocation") || "{}");
    return Object.values(locations)[0] as { percentage: string; page: string } | undefined;
  });
}

test("imports, reads and reopens an EPUB in the same phone window", async ({ page, context }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    if (!localStorage.getItem("readerConfig")) {
      localStorage.setItem("readerConfig", JSON.stringify({ appSkin: "system", isOSNight: "yes" }));
    }
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || url.protocol === "blob:" || url.protocol === "data:"
      ? route.continue()
      : route.abort();
  });
  await page.goto("/");
  await expect(page.locator(".android-header")).toBeVisible();
  await page.locator("#import-book-box").setInputFiles({
    name: "offline.epub",
    mimeType: "application/epub+zip",
    buffer: await makeEpub(),
  });
  await expect(page.locator(".book-item-title").first()).toContainText("Android offline fixture");
  await page.locator(".book-item-cover").first().click();
  await expect(page).toHaveURL(/#\/epub\//);
  await expect(page.locator("#page-area iframe").first()).toBeAttached();
  await expect.poll(() => savedPosition(page)).toBeTruthy();
  await expect(page.locator(".background").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(context.pages()).toHaveLength(1);
  await expect(page.locator("#page-area")).toHaveCSS("width", "369px");

  // Exercise real pagination and the reader's exit control, including SPA cleanup.
  const initial = await savedPosition(page);
  await page.locator(".next-chapter-single-container").click();
  await expect.poll(async () => (await savedPosition(page))?.percentage).not.toBe(initial?.percentage);
  const advanced = await savedPosition(page);
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  await expect(page).toHaveURL(/#\/manager\/home/);
  await page.reload();
  await expect(page.locator(".book-item-title").first()).toContainText("Android offline fixture");
  await page.locator(".book-item-cover").first().click();
  await expect(page.locator("#page-area iframe").first()).toBeAttached();
  await expect(page.frameLocator("#page-area iframe").first().locator("body")).toContainText("Paragraph");
  await page.evaluate(() => window.dispatchEvent(new Event("android-reader-close")));
  await expect.poll(() => savedPosition(page)).toMatchObject({ percentage: advanced?.percentage });
  await page.screenshot({ path: testInfo.outputPath("phone-reader.png") });
  expect(context.pages()).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("keeps phone navigation and settings within the viewport", async ({ page }, testInfo) => {
  await page.goto("/");
  const navigation = page.getByRole("button", { name: "Navigation menu" });
  await navigation.click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.locator(".android-nav-backdrop").click({ position: { x: 380, y: 100 } });
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("phone-library.png") });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".setting-dialog-container")).toHaveCSS("width", "393px");
  await expect(page.locator(".setting-close-container")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("phone-settings.png") });
  await page.locator(".setting-close-container").click();
  await expect(page.locator(".setting-dialog-container")).toBeHidden();
});
