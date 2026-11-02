const JSZip = require("jszip");
const { PDFDocument, StandardFonts, rgb } = require("../../public/lib/pdf-lib/pdf-lib.min.js");

async function readingFixtures() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("book.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">android-reading-fixture-v1</dc:identifier><dc:title>安卓章节样本</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine></package>');
  zip.file("toc.ncx", '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="android-reading-fixture-v1"/></head><docTitle><text>安卓章节样本</text></docTitle><navMap><navPoint id="one" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="one.xhtml"/></navPoint><navPoint id="two" playOrder="2"><navLabel><text>第二章</text></navLabel><content src="two.xhtml"/></navPoint></navMap></ncx>');
  for (const [file, title] of [["one", "第一章"], ["two", "第二章"]]) {
    const paragraphs = Array.from({ length: 80 }, (_, i) => `<p>${title}第${i + 1}段。安卓手机离线阅读样本，用来验证触控翻页、目录跳转、书签和屏幕旋转后的进度恢复。</p>`).join("");
    zip.file(`${file}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${paragraphs}</body></html>`);
  }
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setTitle("安卓 PDF 样本");
  pdf.setAuthor("Koodo Android test");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 8; index++) {
    const page = pdf.addPage([360, 540]);
    page.drawRectangle({ x: 24, y: 460, width: 312, height: 48, color: rgb(0.1, 0.4, 0.7) });
    page.drawText(`PDF page ${index}`, { x: 36, y: 478, font, size: 24, color: rgb(1, 1, 1) });
    for (let line = 0; line < 14; line++) {
      page.drawText(`Android offline reading. Page ${index}, line ${line + 1}.`, { x: 24, y: 425 - line * 25, font, size: 13 });
    }
  }
  const text = ["第一章 离线阅读", ...Array.from({ length: 60 }, (_, i) => `第${i + 1}段：安卓中文文本样本，验证 UTF-8 编码、中文文件名和本机阅读进度。`), "第二章 继续阅读", ...Array.from({ length: 60 }, (_, i) => `后续第${i + 1}段：手机旋转后继续阅读，并将阅读位置保存到本机。`)].join("\n\n");
  zip.forEach((_name, entry) => { entry.date = new Date("2026-01-01T00:00:00Z"); });
  return [
    { title: "安卓章节样本", name: "安卓章节样本.epub", mimeType: "application/epub+zip", format: "epub", buffer: await zip.generateAsync({ type: "nodebuffer" }) },
    { title: "安卓文本样本", name: "安卓文本样本.txt", mimeType: "text/plain", format: "txt", buffer: Buffer.from(text, "utf8") },
    { title: "安卓 PDF 样本", name: "安卓 PDF 样本.pdf", mimeType: "application/pdf", format: "pdf", buffer: Buffer.from(await pdf.save()) },
  ];
}

async function visibleParagraphs(page) {
  return page.frameLocator("#page-area > iframe").locator("body").evaluate((body) => {
    const viewport = body.ownerDocument.defaultView;
    return Array.from(body.querySelectorAll("p"))
      .filter((paragraph) => Array.from(paragraph.getClientRects()).some((rect) => rect.right > 0 && rect.left < viewport.innerWidth && rect.bottom > 0 && rect.top < viewport.innerHeight))
      .map((paragraph) => paragraph.textContent);
  });
}

module.exports = { readingFixtures, visibleParagraphs };
