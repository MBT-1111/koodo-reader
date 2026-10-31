interface PageRendition {
  visibleText(): Promise<string[] | string>;
  audioText(): Promise<string[]>;
}

export async function getPageTranslationTexts(rendition: PageRendition): Promise<string[]> {
  const visible = await rendition.visibleText();
  const texts = [...new Set((Array.isArray(visible) ? visible : [visible]).filter(text => typeof text === "string" && text.trim()))];
  if (!texts.length) return [];
  // Translate only paragraphs intersecting the viewport. Keep crossing
  // paragraphs whole because the engine replaces each paragraph as one unit.
  const originals = await rendition.audioText();
  const page: string[] = [];
  for (const text of texts) {
    const source = originals.includes(text) ? text : originals.find(original => original.includes(text));
    if (source !== undefined && !page.includes(source)) page.push(source);
  }
  if (page.length > 64 || page.reduce((sum, text) => sum + text.length, 0) > 6000) throw new Error("CUSTOM_AI_TEXT_TOO_LONG");
  return page;
}

export function clearTranslationLoading(rendition: { getDocument?(): Document | null }): void {
  rendition.getDocument?.()?.querySelectorAll(".kookit-translation-loading").forEach(element => element.classList.remove("kookit-translation-loading"));
}
