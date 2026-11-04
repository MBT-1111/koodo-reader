const fs = require("node:fs/promises"), path = require("node:path");

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
module.exports = { amazonPdfFixtures, visiblePdfPage };
