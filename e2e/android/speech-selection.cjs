async function selectSpeechParagraph(page, index = 2) {
  return page.frameLocator("#page-area > iframe").locator("body").evaluate((body, index) => {
    const doc = body.ownerDocument, viewport = doc.defaultView;
    const paragraphs = Array.from(body.querySelectorAll("p")).filter(paragraph =>
      Array.from(paragraph.getClientRects()).some(rect => rect.right > 0 && rect.left < viewport.innerWidth && rect.bottom > 0 && rect.top < viewport.innerHeight));
    const paragraph = paragraphs[Math.min(index, paragraphs.length - 1)];
    if (!paragraph) throw new Error("No visible speech fixture paragraph");
    const range = doc.createRange(); range.selectNodeContents(paragraph);
    const selection = doc.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    paragraph.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
    return paragraph.textContent.trim();
  }, index);
}
module.exports = { selectSpeechParagraph };
