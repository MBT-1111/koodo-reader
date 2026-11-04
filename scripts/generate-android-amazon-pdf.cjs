// Regenerate only our synthetic compatibility samples; Calibre is a local test tool.
const fs = require("node:fs/promises"), path = require("node:path"), { execFileSync } = require("node:child_process");
const JSZip = require("jszip"), { chromium } = require("playwright");
const { readingFixtures } = require("../e2e/android/fixtures.cjs");
const output = path.resolve(__dirname, "../e2e/android/samples"), temporary = path.resolve(__dirname, "../dist/android-format-tools");
const titles = { mobi: "安卓 MOBI 中文样本", azw: "安卓 AZW 中文样本", azw3: "安卓 AZW3 中文样本" };

async function main() {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(temporary, { recursive: true });
  const calibre = process.env.CALIBRE_CONVERT;
  const calibreConfig = path.join(temporary, "calibre-config"), calibreTemp = path.join(temporary, "calibre-temp");
  await fs.mkdir(calibreConfig, { recursive: true }); await fs.mkdir(calibreTemp, { recursive: true });
  if (calibre) for (const format of ["mobi", "azw", "azw3"]) {
    const source = (await readingFixtures())[0], zip = await JSZip.loadAsync(source.buffer);
    zip.file("book.opf", (await zip.file("book.opf").async("string")).replaceAll("安卓章节样本", titles[format]).replaceAll("android-reading-fixture-v1", `android-${format}-fixture-v1`));
    for (const [file, chapter] of [["one", "第一章"], ["two", "第二章"]]) zip.file(`${file}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter}</title></head><body><h1>${chapter}</h1>${Array.from({ length: 20 }, (_, index) => `<p>${chapter}第${index + 1}段。安卓手机离线阅读样本，验证中文排版、连续朗读和阅读位置恢复。</p>`).join("")}</body></html>`);
    const input = path.join(temporary, `${format}.epub`), converted = path.join(temporary, `${format}.${format === "azw" ? "mobi" : format}`);
    await fs.writeFile(input, await zip.generateAsync({ type: "nodebuffer" }));
    execFileSync(calibre, [input, converted, ...(format === "azw3" ? [] : ["--mobi-file-type", "old"]), "--no-inline-toc", "--chapter-mark", "none"], {
      stdio: "pipe", env: { ...process.env, CALIBRE_CONFIG_DIRECTORY: calibreConfig, CALIBRE_TEMP_DIR: calibreTemp },
    });
    const bytes = await fs.readFile(converted), first = bytes.readUInt32BE(78);
    if (bytes.toString("ascii", 60, 68) !== "BOOKMOBI" || bytes.readUInt32BE(first + 36) !== (format === "azw3" ? 8 : 6)) throw Error(`Invalid ${format} fixture`);
    await fs.writeFile(path.join(output, `${format}-zh.${format}`), bytes);
  }
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || "chrome" });
  try {
    const page = await browser.newPage();
    for (const columns of [1, 2]) {
      const pages = Array.from({ length: 4 }, (_, index) => `<section><h1>中文 PDF 第${index + 1}页</h1><main style="display:grid;grid-template-columns:repeat(${columns},1fr);gap:24px">${Array.from({ length: columns }, (_, column) => `<article>${Array.from({ length: 6 }, (_, line) => `<p>第${index + 1}页${columns === 2 ? (column ? "右栏" : "左栏") : "正文"}第${line + 1}段。中文文字阅读，测试朗读连续播放与位置恢复。</p>`).join("")}</article>`).join("")}</main></section>`).join("");
      await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>@page{size:A5;margin:15mm}body{font-family:"Microsoft YaHei",sans-serif;font-size:12px}h1{font-size:20px}section{break-after:page}section:last-child{break-after:auto}p{line-height:1.8;margin:0 0 12px}</style></head><body>${pages}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(columns => { document.title = `安卓中文文字PDF${columns}栏`; }, columns);
      const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      if (!bytes.includes(Buffer.from("/FontFile2"))) throw Error("The Chinese PDF must contain an embedded font");
      await fs.writeFile(path.join(output, `pdf-zh-${columns}col.pdf`), bytes);
    }
  } finally { await browser.close(); }
  console.log("Synthetic Amazon / embedded-font Chinese PDF samples generated");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
