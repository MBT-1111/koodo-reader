const fs = require("node:fs/promises");
const path = require("node:path");
const JSZip = require("jszip");
const { readingFixtures } = require("./fixtures.cjs");

const legacyFontKey = "安卓字体迁移测试";
const importedFontKey = "Android_Custom_Font_Test";

async function fontFiles() {
  const buffer = await fs.readFile(path.join(__dirname, "../../public/lib/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf"));
  return [legacyFontKey, importedFontKey].map((key) => ({ name: `${key}.ttf`, mimeType: "font/ttf", buffer }));
}

async function fontBook() {
  const source = (await readingFixtures())[0];
  const zip = await JSZip.loadAsync(source.buffer);
  zip.file("book.opf", (await zip.file("book.opf").async("string")).replaceAll("安卓章节样本", "Android custom font sample").replaceAll("android-reading-fixture-v1", "android-font-fixture-v1"));
  zip.file("one.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Font sample</title></head><body><h1>Custom font sample</h1>' + Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog. Android offline font test. 中文使用后备字体。</p>`).join("") + '</body></html>');
  return { name: "Android custom font sample.epub", mimeType: source.mimeType, buffer: await zip.generateAsync({ type: "nodebuffer" }) };
}

const openFonts = async (page) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Font management", exact: true }).click();
  await page.locator(".font-setting-actions").waitFor();
};

const fontLoaded = (page, key) => page.frameLocator("#page-area > iframe").locator("body").evaluate((body, key) => {
  const doc = body.ownerDocument;
  return [...doc.fonts].some((font) => font.family.replaceAll('"', "") === key && font.status === "loaded");
}, key);

module.exports = { legacyFontKey, importedFontKey, fontFiles, fontBook, openFonts, fontLoaded };
