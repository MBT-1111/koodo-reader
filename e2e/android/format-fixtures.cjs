const JSZip = require("jszip");
const { expect } = require("@playwright/test");
const { showReadingTools, visibleParagraphs } = require("./fixtures.cjs");
const { visiblePdfPage } = require("./amazon-pdf-fixtures.cjs");
const stamp = new Date("2026-01-01T00:00:00Z");
const paragraphs = label => Array.from({ length: 70 }, (_, i) => `${label}第${i + 1}段。中文格式兼容样本，验证手机正文显示、翻页和阅读位置恢复。`);
const pack = async zip => { zip.forEach((_name, entry) => { entry.date = stamp; }); return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }); };

async function formatFixtures(page) {
  const docx = new JSZip(), text = paragraphs("DOCX");
  docx.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  docx.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docx.file("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  docx.file("word/styles.xml", '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style></w:styles>');
  docx.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>DOCX 格式验证</w:t></w:r></w:p>${text.map(t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
  const fb2 = `<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>sf</genre><author><first-name>Koodo</first-name><last-name>Test</last-name></author><book-title>安卓 FB2 格式样本</book-title><lang>zh</lang></title-info><document-info><author><first-name>Koodo</first-name><last-name>Test</last-name></author><date value="2026-01-01">2026-01-01</date><id>fb2-android-synthetic-format</id><version>1.0</version></document-info></description><body><section id="one"><title><p>FB2 格式验证</p></title>${paragraphs("FB2").map(t => `<p>${t}</p>`).join("")}</section></body></FictionBook>`;
  const colors = [[210, 40, 55], [40, 160, 80], [50, 90, 210]];
  const images = await page.evaluate(colors => colors.map((rgb, index) => {
    const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 600;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = `rgb(${rgb.join(",")})`; ctx.fillRect(0, 0, 400, 600);
    ctx.fillStyle = "white"; for (let i = 0; i <= index; i++) ctx.fillRect(30 + i * 50, 30, 25, 40);
    return canvas.toDataURL("image/png").split(",")[1];
  }), colors);
  const comic = new JSZip();
  // Deliberately insert out of order to exercise natural filename ordering.
  for (const [index, name] of [[2, "page10.png"], [0, "page1.png"], [1, "page2.png"]]) comic.file(name, Buffer.from(images[index], "base64"));
  return [
    { format: "md", name: "安卓 Markdown 格式样本.md", mimeType: "text/markdown", anchor: "Markdown第1段", buffer: Buffer.from("# Markdown 格式验证\n\n" + paragraphs("Markdown").join("\n\n")) },
    { format: "html", name: "安卓 HTML 格式样本.html", mimeType: "text/html", anchor: "HTML第1段", buffer: Buffer.from(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>安卓 HTML 格式样本</title></head><body><h1>HTML 格式验证</h1>${paragraphs("HTML").map(t => `<p>${t}</p>`).join("")}</body></html>`) },
    { format: "fb2", name: "安卓 FB2 格式样本.fb2", mimeType: "application/x-fictionbook+xml", anchor: "FB2第1段", buffer: Buffer.from(fb2) },
    { format: "docx", name: "安卓 DOCX 格式样本.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", anchor: "DOCX第1段", buffer: await pack(docx) },
    { format: "cbz", name: "安卓 CBZ 格式样本.cbz", mimeType: "application/vnd.comicbook+zip", colors, buffer: await pack(comic) },
  ];
}

const savedPosition = page => page.evaluate(() => {
  const key = location.hash.split("?")[0].split("/").pop();
  return JSON.parse(localStorage.getItem("recordLocation") || "{}")[key];
});

const visibleComicColor = page => page.locator("#page-area").evaluate(area => {
  const intersection = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const candidates = [];
  const visit = (root, x, y, clip) => {
    for (const image of root.querySelectorAll("img")) {
      if (!image.complete || image.naturalWidth !== 400 || image.naturalHeight !== 600) continue;
      const rect = image.getBoundingClientRect(), visible = intersection(clip, { left: x + rect.left, top: y + rect.top, right: x + rect.right, bottom: y + rect.bottom });
      const size = Math.max(0, visible.right - visible.left) * Math.max(0, visible.bottom - visible.top);
      if (size) candidates.push({ image, size });
    }
    for (const frame of root.querySelectorAll("iframe")) {
      const rect = frame.getBoundingClientRect(), next = { left: x + rect.left, top: y + rect.top, right: x + rect.right, bottom: y + rect.bottom }, visible = intersection(clip, next);
      if (visible.right > visible.left && visible.bottom > visible.top && frame.contentDocument) visit(frame.contentDocument, next.left, next.top, visible);
    }
  };
  visit(area, 0, 0, intersection(area.getBoundingClientRect(), { left: 0, top: 0, right: innerWidth, bottom: innerHeight }));
  const image = candidates.sort((a, b) => b.size - a.size)[0]?.image;
  if (!image) return null;
  const canvas = image.ownerDocument.createElement("canvas"); canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d"); context.drawImage(image, 200, 300, 1, 1, 0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data];
});
async function readFormatState(page, fixture) {
  const position = await savedPosition(page);
  if (fixture.format === "pdf") return { position, pdf: (await visiblePdfPage(page))?.index };
  if (fixture.colors) return { position, color: await visibleComicColor(page) };
  const anchor = (await visibleParagraphs(page))[0]; expect(anchor).toBeTruthy();
  return { position, anchor };
}
async function expectFormatState(page, state) {
  if (state.pdf !== undefined) await expect.poll(async () => (await visiblePdfPage(page))?.index).toBe(state.pdf);
  else if (state.color) await expect.poll(() => visibleComicColor(page)).toEqual(state.color);
  else await expect.poll(() => visibleParagraphs(page)).toContain(state.anchor);
}
module.exports = { formatFixtures, savedPosition, showReadingTools, visibleParagraphs, visibleComicColor, readFormatState, expectFormatState };
