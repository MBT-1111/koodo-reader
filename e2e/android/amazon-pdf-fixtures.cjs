const fs = require("node:fs/promises"), path = require("node:path");
const { PDFDocument } = require("../../public/lib/pdf-lib/pdf-lib.min.js");

async function imagePdfFixture(page) {
  const images = await page.evaluate(() => Array.from({ length: 8 }, (_, index) => {
    const canvas = document.createElement("canvas"); canvas.width = 360; canvas.height = 540;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = `hsl(${index * 40}, 65%, 40%)`; ctx.fillRect(0, 0, 360, 540);
    ctx.fillStyle = "white"; ctx.font = "32px sans-serif"; ctx.fillText(`Scanned page ${index + 1}`, 30, 70);
    return canvas.toDataURL("image/png");
  }));
  const pdf = await PDFDocument.create();
  pdf.setTitle("Android image PDF touch sample");
  for (const image of images) pdf.addPage([360, 540]).drawImage(await pdf.embedPng(image), { x: 0, y: 0, width: 360, height: 540 });
  return { format: "pdf", name: "android-image-touch.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) };
}

async function amazonPdfFixtures(files) {
  const fixtures = [
    ...["mobi", "azw", "azw3"].map(format => ({ format, file: `${format}-zh.${format}`, name: `安卓 ${format.toUpperCase()} 中文样本.${format}`, mimeType: "application/x-mobipocket-ebook", anchor: "安卓手机离线阅读样本", nextAnchor: "第二章第10段。", chapter: "第二章" })),
    ...[1, 2].map(columns => ({ format: "pdf", file: `pdf-zh-${columns}col.pdf`, name: `安卓中文文字PDF${columns}栏.pdf`, mimeType: "application/pdf", anchor: "中文 PDF 第1页", nextAnchor: `第3页${columns === 2 ? "右栏" : "正文"}第4段。`, page: 3, columns })),
  ];
  return Promise.all(fixtures.filter(fixture => !files || files.includes(fixture.file)).map(async fixture => ({ ...fixture, buffer: await fs.readFile(path.join(__dirname, "samples", fixture.file)) })));
}
const visiblePdfPage = page => page.locator("#page-area").evaluate(area => {
  const outer = area.querySelector("iframe");
  if (!outer?.contentDocument) return null;
  const offset = outer.getBoundingClientRect(), clip = area.getBoundingClientRect();
  let selected = null, largest = 0;
  for (const frame of outer.contentDocument.querySelectorAll("iframe[id^='pdf-iframe-']")) {
    const rect = frame.getBoundingClientRect();
    const width = Math.max(0, Math.min(innerWidth, clip.right, offset.left + rect.right) - Math.max(0, clip.left, offset.left + rect.left));
    const height = Math.max(0, Math.min(innerHeight, clip.bottom, offset.top + rect.bottom) - Math.max(0, clip.top, offset.top + rect.top));
    if (width * height > largest) { largest = width * height; selected = { index: Number(frame.id.replace("pdf-iframe-", "")), text: frame.contentDocument?.body.textContent || "" }; }
  }
  return selected;
});
module.exports = { amazonPdfFixtures, imagePdfFixture, visiblePdfPage };
