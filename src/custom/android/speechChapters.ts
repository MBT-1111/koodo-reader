export interface SpeechChapter { index: number; title: string; text: string[]; anchors?: string[] }
interface ChapterDocument {
  label?: string;
  text: { createDocument?: () => Promise<Document>; load?: () => Promise<string>; getTextContent?: () => Promise<{ items: { str?: string; hasEOL?: boolean }[] }> };
}

// Keep PDF content order (including columns) and join glyph runs on the same line.
export function pdfSpeechText(content: { items: { str?: string; hasEOL?: boolean }[] }): string[] {
  const lines: string[] = [];
  let line = "";
  const flush = () => { const text = line.trim(); if (text) lines.push(text); line = ""; };
  for (const item of content.items) {
    if (typeof item.str === "string") line += item.str;
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}
interface ChapterRendition {
  getPosition(): { chapterDocIndex?: string | number };
  getChapterDoc(): ChapterDocument[];
}

// Read an inert chapter document without rendering it or executing book scripts.
export function speechDocumentText(root: Node): string[] {
  const paragraphs: string[] = [];
  let current = "";
  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
    current = "";
  };
  const blocks = new Set(["address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"]);
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { current += node.nodeValue || ""; return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element, tag = element.localName.toLowerCase();
    if (["script", "style", "noscript", "template", "rt", "rp", "svg"].includes(tag) || element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true" || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(element.getAttribute("style") || "")) return;
    if (tag === "br") { flush(); return; }
    if (blocks.has(tag)) flush();
    Array.from(element.childNodes).forEach(visit);
    if (blocks.has(tag)) flush();
  };
  visit(root); flush();
  return paragraphs;
}

export async function prepareSpeechChapters(rendition: ChapterRendition, currentText: string[], applyRules: (text: string) => string, signal: AbortSignal, pdf = false) {
  const docs = rendition.getChapterDoc();
  const index = Number(rendition.getPosition().chapterDocIndex);
  if (!Number.isInteger(index) || index < 0 || index >= docs.length || docs.length > 20000) throw new Error("ANDROID_SPEECH_CHAPTERS");
  let size = currentText.reduce((sum, text) => sum + text.length, 0), count = currentText.length;
  const followingChapters: SpeechChapter[] = [];
  for (let next = index + 1; next < docs.length; next++) {
    signal.throwIfAborted();
    const source = docs[next].text;
    let original: string[];
    if (pdf && source?.getTextContent) original = pdfSpeechText(await source.getTextContent());
    else {
      let doc: Document;
      if (source?.createDocument) doc = await source.createDocument();
      else if (source?.load) {
        const url = await source.load(); signal.throwIfAborted();
        if (new URL(url).protocol !== "blob:") throw new Error("ANDROID_SPEECH_CHAPTERS");
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error("ANDROID_SPEECH_CHAPTERS");
        doc = new DOMParser().parseFromString(await response.text(), "text/html");
      } else throw new Error("ANDROID_SPEECH_CHAPTERS");
      signal.throwIfAborted();
      const body = doc.querySelector("body");
      if (!body) throw new Error("ANDROID_SPEECH_CHAPTERS");
      original = speechDocumentText(body);
    }
    signal.throwIfAborted();
    const paragraphs = original.map(anchor => ({ anchor, text: applyRules(anchor) })).filter(value => value.text.trim());
    const text = paragraphs.map(value => value.text);
    size += text.reduce((sum, value) => sum + value.length, 0); count += text.length;
    if (size > 2000000 || count > 20000) throw new Error("ANDROID_SPEECH_CHAPTER_LIMIT");
    if (text.length) followingChapters.push({ index: next, title: (pdf ? String(next + 1) : docs[next].label || String(next + 1)).slice(0, 512), text, anchors: paragraphs.map(value => value.anchor) });
    // Let Stop/reader exit cancel preparation even when chapter documents are cached.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  if (size > 2000000 || count > 20000) throw new Error("ANDROID_SPEECH_CHAPTER_LIMIT");
  return { chapterIndex: index, chapterTitle: (pdf ? String(index + 1) : docs[index].label || String(index + 1)).slice(0, 512), followingChapters };
}
